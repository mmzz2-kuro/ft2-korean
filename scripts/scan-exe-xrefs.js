#!/usr/bin/env node

const fs = require("fs");

const exePath = process.argv[2];
const summaryOnly = process.argv.includes("--summary");
const targetArgs = [];
for (let i = 3; i < process.argv.length; i += 1) {
  if (process.argv[i] === "--target") {
    targetArgs.push(Number(process.argv[i + 1]));
    i += 1;
  }
}

const targets = targetArgs.length > 0 ? targetArgs : [
  0x80187a64,
  0x80187b8c,
  0x80187d4c,
  0x80187d84,
  0x80187de4,
  0x80187e14,
  0x80187e70,
];

if (!exePath) {
  console.error("usage: node scripts/scan-exe-xrefs.js <SLPS_019.03> [--target 0x80187d84 ...]");
  process.exit(2);
}

const exe = fs.readFileSync(exePath);
const load = exe.readUInt32LE(0x18);
const textSize = exe.readUInt32LE(0x1c);
const textStart = 0x800;
const textEnd = Math.min(exe.length, textStart + textSize);

const regNames = [
  "zero", "at", "v0", "v1", "a0", "a1", "a2", "a3",
  "t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7",
  "s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7",
  "t8", "t9", "k0", "k1", "gp", "sp", "fp", "ra",
];

function hex(n, width = 0) {
  return "0x" + (n >>> 0).toString(16).padStart(width, "0");
}

function sx16(n) {
  return n & 0x8000 ? n - 0x10000 : n;
}

function ramAt(off) {
  return load + off - 0x800;
}

function fileAt(addr) {
  return addr - load + 0x800;
}

function wordAt(off) {
  if (off < textStart || off + 4 > textEnd) return null;
  return exe.readUInt32LE(off);
}

function jumpTarget(word, pc) {
  return (((pc + 4) & 0xf0000000) | ((word & 0x03ffffff) << 2)) >>> 0;
}

function decode(word, pc) {
  const op = word >>> 26;
  const rs = (word >>> 21) & 31;
  const rt = (word >>> 16) & 31;
  const rd = (word >>> 11) & 31;
  const sh = (word >>> 6) & 31;
  const fn = word & 63;
  const imm = word & 0xffff;
  const simm = sx16(imm);
  const target = jumpTarget(word, pc);

  if (word === 0) return "nop";
  if (op === 0x02) return `j ${hex(target, 8)}`;
  if (op === 0x03) return `jal ${hex(target, 8)}`;
  if (op === 0x04) return `beq ${regNames[rs]}, ${regNames[rt]}, ${hex(pc + 4 + (simm << 2), 8)}`;
  if (op === 0x05) return `bne ${regNames[rs]}, ${regNames[rt]}, ${hex(pc + 4 + (simm << 2), 8)}`;
  if (op === 0x08) return `addi ${regNames[rt]}, ${regNames[rs]}, ${simm}`;
  if (op === 0x09) return `addiu ${regNames[rt]}, ${regNames[rs]}, ${simm}`;
  if (op === 0x0a) return `slti ${regNames[rt]}, ${regNames[rs]}, ${simm}`;
  if (op === 0x0c) return `andi ${regNames[rt]}, ${regNames[rs]}, ${hex(imm)}`;
  if (op === 0x0d) return `ori ${regNames[rt]}, ${regNames[rs]}, ${hex(imm)}`;
  if (op === 0x0f) return `lui ${regNames[rt]}, ${hex(imm)}`;
  if (op === 0x20) return `lb ${regNames[rt]}, ${simm}(${regNames[rs]})`;
  if (op === 0x21) return `lh ${regNames[rt]}, ${simm}(${regNames[rs]})`;
  if (op === 0x23) return `lw ${regNames[rt]}, ${simm}(${regNames[rs]})`;
  if (op === 0x24) return `lbu ${regNames[rt]}, ${simm}(${regNames[rs]})`;
  if (op === 0x25) return `lhu ${regNames[rt]}, ${simm}(${regNames[rs]})`;
  if (op === 0x28) return `sb ${regNames[rt]}, ${simm}(${regNames[rs]})`;
  if (op === 0x29) return `sh ${regNames[rt]}, ${simm}(${regNames[rs]})`;
  if (op === 0x2b) return `sw ${regNames[rt]}, ${simm}(${regNames[rs]})`;

  if (op === 0) {
    if (fn === 0x08) return `jr ${regNames[rs]}`;
    if (fn === 0x09) return `jalr ${regNames[rd]}, ${regNames[rs]}`;
    if (fn === 0x21) return `addu ${regNames[rd]}, ${regNames[rs]}, ${regNames[rt]}`;
    if (fn === 0x23) return `subu ${regNames[rd]}, ${regNames[rs]}, ${regNames[rt]}`;
    if (fn === 0x24) return `and ${regNames[rd]}, ${regNames[rs]}, ${regNames[rt]}`;
    if (fn === 0x25) return `or ${regNames[rd]}, ${regNames[rs]}, ${regNames[rt]}`;
    if (fn === 0x00) return `sll ${regNames[rd]}, ${regNames[rt]}, ${sh}`;
    if (fn === 0x02) return `srl ${regNames[rd]}, ${regNames[rt]}, ${sh}`;
    if (fn === 0x2a) return `slt ${regNames[rd]}, ${regNames[rs]}, ${regNames[rt]}`;
  }

  return `word ${hex(word, 8)}`;
}

function writesReg(word, reg) {
  const op = word >>> 26;
  const rt = (word >>> 16) & 31;
  const rd = (word >>> 11) & 31;
  const fn = word & 63;
  if ([0x08, 0x09, 0x0a, 0x0c, 0x0d, 0x0f, 0x20, 0x21, 0x23, 0x24, 0x25].includes(op)) return rt === reg;
  if (op === 0 && [0x21, 0x23, 0x24, 0x25, 0x00, 0x02, 0x2a].includes(fn)) return rd === reg;
  return false;
}

function backtrackConst(hitOff, reg) {
  const candidates = [];
  for (let off = hitOff - 4; off >= Math.max(textStart, hitOff - 64); off -= 4) {
    const word = wordAt(off);
    if (word === null) break;
    if (!writesReg(word, reg)) continue;

    const op = word >>> 26;
    const rs = (word >>> 21) & 31;
    const rt = (word >>> 16) & 31;
    const imm = word & 0xffff;
    if ((op === 0x09 || op === 0x0d) && rt === reg && rs === 0) {
      candidates.push({ off, value: op === 0x09 ? sx16(imm) >>> 0 : imm, kind: decode(word, ramAt(off)) });
    }
    if (op === 0x0f && rt === reg) {
      const next = wordAt(off + 4);
      if (next !== null) {
        const nop = next >>> 26;
        const nrs = (next >>> 21) & 31;
        const nrt = (next >>> 16) & 31;
        const nimm = next & 0xffff;
        if ((nop === 0x0d || nop === 0x09) && nrt === reg && nrs === reg) {
          candidates.push({ off, value: ((imm << 16) | nimm) >>> 0, kind: `${decode(word, ramAt(off))}; ${decode(next, ramAt(off + 4))}` });
        }
      }
    }
  }
  return candidates;
}

function constRegAt(off, reg) {
  const word = wordAt(off);
  if (word === null) return null;
  const op = word >>> 26;
  const rs = (word >>> 21) & 31;
  const rt = (word >>> 16) & 31;
  const imm = word & 0xffff;
  if ((op === 0x09 || op === 0x0d) && rt === reg && rs === 0) {
    return op === 0x09 ? sx16(imm) & 0xffff : imm;
  }
  return null;
}

function inferRecentConst(hitOff, reg) {
  const delay = constRegAt(hitOff + 4, reg);
  if (delay !== null) return { value: delay, where: "delay" };

  for (let off = hitOff - 4; off >= Math.max(textStart, hitOff - 48); off -= 4) {
    if (!writesReg(wordAt(off), reg)) continue;
    const value = constRegAt(off, reg);
    return value === null ? null : { value, where: hex(off) };
  }
  return null;
}

console.log(`exe=${exePath}`);
console.log(`load=${hex(load, 8)} textFile=${hex(textStart)}..${hex(textEnd)} textSize=${hex(textSize)}`);
console.log(`targets=${targets.map((target) => hex(target, 8)).join(", ")}`);

if (summaryOnly) {
  const byTarget = new Map();
  for (let off = textStart; off + 4 <= textEnd; off += 4) {
    const word = wordAt(off);
    const op = word >>> 26;
    if (op !== 0x03) continue;

    const pc = ramAt(off);
    const target = jumpTarget(word, pc);
    if (!targets.includes(target)) continue;

    const rec = byTarget.get(target) || { count: 0, ids: new Map() };
    rec.count += 1;
    const id = inferRecentConst(off, 4);
    if (id) rec.ids.set(id.value, (rec.ids.get(id.value) || 0) + 1);
    byTarget.set(target, rec);
  }

  for (const [target, rec] of [...byTarget].sort((a, b) => a[0] - b[0])) {
    const ids = [...rec.ids].sort((a, b) => a[0] - b[0]).map(([id, count]) => `${id}:${count}`).join(" ");
    console.log(`\n${hex(target, 8)} calls=${rec.count} constA0=${[...rec.ids.values()].reduce((a, b) => a + b, 0)}`);
    console.log(ids);
  }
  process.exit(0);
}

for (let off = textStart; off + 4 <= textEnd; off += 4) {
  const word = wordAt(off);
  const op = word >>> 26;
  if (op !== 0x03) continue;

  const pc = ramAt(off);
  const target = jumpTarget(word, pc);
  if (!targets.includes(target)) continue;

  console.log(`\ncall file=${hex(off)} ram=${hex(pc, 8)} -> ${hex(target, 8)}`);
  const a0 = backtrackConst(off, 4);
  const a1 = backtrackConst(off, 5);
  if (a0.length > 0) console.log(`  recent a0 constants: ${a0.map((c) => `${hex(c.value)} at ${hex(c.off)} (${c.kind})`).join("; ")}`);
  if (a1.length > 0) console.log(`  recent a1 constants: ${a1.map((c) => `${hex(c.value, 8)} at ${hex(c.off)} (${c.kind})`).join("; ")}`);
  for (let ctx = Math.max(textStart, off - 32); ctx <= Math.min(textEnd - 4, off + 20); ctx += 4) {
    const marker = ctx === off ? "=>" : "  ";
    console.log(`${marker} ${hex(ctx)} ${hex(ramAt(ctx), 8)}  ${decode(wordAt(ctx), ramAt(ctx))}`);
  }
}
