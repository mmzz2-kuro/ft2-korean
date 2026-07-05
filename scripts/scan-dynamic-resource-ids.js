#!/usr/bin/env node

const fs = require("fs");

const exePath = process.argv[2];
const context = Number(process.argv[process.argv.indexOf("--context") + 1]) || 0;

if (!exePath) {
  console.error("usage: node scripts/scan-dynamic-resource-ids.js <SLPS_019.03> [--context N]");
  process.exit(2);
}

const exe = fs.readFileSync(exePath);
const load = exe.readUInt32LE(0x18);
const textSize = exe.readUInt32LE(0x1c);
const textStart = 0x800;
const textEnd = Math.min(exe.length, textStart + textSize);

const targets = new Set([
  0x80187d4c,
  0x80187d84,
  0x80187de4,
  0x80187e14,
]);

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
  return (load + off - 0x800) >>> 0;
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

function insnAt(off) {
  const word = wordAt(off);
  if (word === null) return null;
  const op = word >>> 26;
  const rs = (word >>> 21) & 31;
  const rt = (word >>> 16) & 31;
  const rd = (word >>> 11) & 31;
  const sh = (word >>> 6) & 31;
  const fn = word & 63;
  const imm = word & 0xffff;
  return { off, word, op, rs, rt, rd, sh, fn, imm, simm: sx16(imm) };
}

function writesReg(insn, reg) {
  if (!insn) return false;
  if ([0x08, 0x09, 0x0a, 0x0c, 0x0d, 0x0f, 0x20, 0x21, 0x23, 0x24, 0x25].includes(insn.op)) return insn.rt === reg;
  if (insn.op === 0 && [0x21, 0x23, 0x24, 0x25, 0x00, 0x02, 0x2a].includes(insn.fn)) return insn.rd === reg;
  return false;
}

function decode(insn) {
  if (!insn) return "(none)";
  const pc = ramAt(insn.off);
  const target = jumpTarget(insn.word, pc);
  if (insn.word === 0) return "nop";
  if (insn.op === 0x02) return `j ${hex(target, 8)}`;
  if (insn.op === 0x03) return `jal ${hex(target, 8)}`;
  if (insn.op === 0x04) return `beq ${regNames[insn.rs]}, ${regNames[insn.rt]}, ${hex(pc + 4 + (insn.simm << 2), 8)}`;
  if (insn.op === 0x05) return `bne ${regNames[insn.rs]}, ${regNames[insn.rt]}, ${hex(pc + 4 + (insn.simm << 2), 8)}`;
  if (insn.op === 0x09) return `addiu ${regNames[insn.rt]}, ${regNames[insn.rs]}, ${insn.simm}`;
  if (insn.op === 0x0c) return `andi ${regNames[insn.rt]}, ${regNames[insn.rs]}, ${hex(insn.imm)}`;
  if (insn.op === 0x0d) return `ori ${regNames[insn.rt]}, ${regNames[insn.rs]}, ${hex(insn.imm)}`;
  if (insn.op === 0x0f) return `lui ${regNames[insn.rt]}, ${hex(insn.imm)}`;
  if (insn.op === 0x20) return `lb ${regNames[insn.rt]}, ${insn.simm}(${regNames[insn.rs]})`;
  if (insn.op === 0x21) return `lh ${regNames[insn.rt]}, ${insn.simm}(${regNames[insn.rs]})`;
  if (insn.op === 0x23) return `lw ${regNames[insn.rt]}, ${insn.simm}(${regNames[insn.rs]})`;
  if (insn.op === 0x24) return `lbu ${regNames[insn.rt]}, ${insn.simm}(${regNames[insn.rs]})`;
  if (insn.op === 0x25) return `lhu ${regNames[insn.rt]}, ${insn.simm}(${regNames[insn.rs]})`;
  if (insn.op === 0x2b) return `sw ${regNames[insn.rt]}, ${insn.simm}(${regNames[insn.rs]})`;
  if (insn.op === 0 && insn.fn === 0x08) return `jr ${regNames[insn.rs]}`;
  if (insn.op === 0 && insn.fn === 0x21) return `addu ${regNames[insn.rd]}, ${regNames[insn.rs]}, ${regNames[insn.rt]}`;
  if (insn.op === 0 && insn.fn === 0x00) return `sll ${regNames[insn.rd]}, ${regNames[insn.rt]}, ${insn.sh}`;
  if (insn.op === 0 && insn.fn === 0x02) return `srl ${regNames[insn.rd]}, ${regNames[insn.rt]}, ${insn.sh}`;
  if (insn.op === 0 && insn.fn === 0x03) return `sra ${regNames[insn.rd]}, ${regNames[insn.rt]}, ${insn.sh}`;
  return `word ${hex(insn.word, 8)}`;
}

function findWriter(callOff, reg) {
  const delay = insnAt(callOff + 4);
  if (writesReg(delay, reg)) return delay;
  for (let off = callOff - 4; off >= Math.max(textStart, callOff - 96); off -= 4) {
    const insn = insnAt(off);
    if (writesReg(insn, reg)) return insn;
  }
  return null;
}

function constWrittenBy(insn) {
  if (!insn) return null;
  if ((insn.op === 0x09 || insn.op === 0x0d) && insn.rs === 0) {
    return insn.op === 0x09 ? insn.simm & 0xffff : insn.imm;
  }
  if ((insn.op === 0x09 || insn.op === 0x0d) && insn.rs === insn.rt) {
    let prev = null;
    for (let off = insn.off - 4; off >= Math.max(textStart, insn.off - 16); off -= 4) {
      const candidate = insnAt(off);
      if (writesReg(candidate, insn.rs)) {
        prev = candidate;
        break;
      }
    }
    if (prev && prev.op === 0x0f && prev.rt === insn.rs) {
      return ((prev.imm << 16) + (insn.op === 0x09 ? insn.simm : insn.imm)) >>> 0;
    }
  }
  if (insn.op !== 0x0f) return null;
  const next = insnAt(insn.off + 4);
  if (!next || next.rt !== insn.rt || next.rs !== insn.rt) return null;
  if (next.op === 0x09 || next.op === 0x0d) return ((insn.imm << 16) | next.imm) >>> 0;
  return null;
}

function traceRegConst(beforeOff, reg, window = 96) {
  for (let off = beforeOff - 4; off >= Math.max(textStart, beforeOff - window); off -= 4) {
    const insn = insnAt(off);
    if (!writesReg(insn, reg)) continue;
    const value = constWrittenBy(insn);
    return value === null ? null : { value, off };
  }
  return null;
}

function resolveAddressFromReg(beforeOff, reg) {
  const direct = traceRegConst(beforeOff, reg);
  if (direct) return direct;

  for (let off = beforeOff - 4; off >= Math.max(textStart, beforeOff - 96); off -= 4) {
    const insn = insnAt(off);
    if (!insn || insn.op !== 0 || insn.fn !== 0x21 || insn.rd !== reg) continue;
    const left = traceRegConst(off, insn.rs);
    const right = traceRegConst(off, insn.rt);
    if (left) return { value: left.value, off: left.off, via: decode(insn) };
    if (right) return { value: right.value, off: right.off, via: decode(insn) };
  }
  return null;
}

function classifySource(writer, callOff) {
  if (!writer) return { kind: "unknown", detail: "" };
  const c = constWrittenBy(writer);
  if (c !== null) return { kind: "const", detail: `${c}` };

  if ([0x20, 0x21, 0x23, 0x24, 0x25].includes(writer.op)) {
    const base = resolveAddressFromReg(writer.off, writer.rs);
    const addr = base ? ((base.value + writer.simm) >>> 0) : null;
    const opName = { 0x20: "lb", 0x21: "lh", 0x23: "lw", 0x24: "lbu", 0x25: "lhu" }[writer.op];
    return {
      kind: opName,
      detail: `${opName} ${regNames[writer.rt]}, ${writer.simm}(${regNames[writer.rs]})` +
        (addr !== null ? ` staticBase=${hex(base.value, 8)} addr=${hex(addr, 8)}` : ""),
      addr,
    };
  }

  if (writer.op === 0x0c) return { kind: "andi", detail: decode(writer) };
  if (writer.op === 0 && writer.fn === 0x21) return { kind: "addu", detail: decode(writer) };
  if (writer.op === 0 && [0x00, 0x02].includes(writer.fn)) return { kind: "shift", detail: decode(writer) };
  return { kind: "other", detail: decode(writer) };
}

function dumpContext(callOff) {
  for (let off = Math.max(textStart, callOff - context * 4); off <= Math.min(textEnd - 4, callOff + (context + 1) * 4); off += 4) {
    const marker = off === callOff ? "=>" : "  ";
    const insn = insnAt(off);
    console.log(`${marker} ${hex(off)} ${hex(ramAt(off), 8)} ${decode(insn)}`);
  }
}

const rows = [];
const counts = new Map();
for (let off = textStart; off + 4 <= textEnd; off += 4) {
  const insn = insnAt(off);
  if (!insn || insn.op !== 0x03) continue;
  const target = jumpTarget(insn.word, ramAt(off));
  if (!targets.has(target)) continue;

  const writer = findWriter(off, 4);
  const source = classifySource(writer, off);
  counts.set(source.kind, (counts.get(source.kind) || 0) + 1);
  rows.push({ off, target, writer, source });
}

console.log(`exe=${exePath}`);
console.log(`load=${hex(load, 8)} textFile=${hex(textStart)}..${hex(textEnd)} textSize=${hex(textSize)}`);
console.log("source-kind counts:");
for (const [kind, count] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`  ${kind}: ${count}`);
}

console.log("\ndynamic/non-const call sources:");
for (const row of rows) {
  if (row.source.kind === "const") continue;
  console.log(
    [
      `file=${hex(row.off)}`,
      `ram=${hex(ramAt(row.off), 8)}`,
      `target=${hex(row.target, 8)}`,
      `kind=${row.source.kind}`,
      `writer=${row.writer ? `${hex(row.writer.off)} ${decode(row.writer)}` : "(none)"}`,
      row.source.detail,
    ].join(" ")
  );
  if (context > 0) dumpContext(row.off);
}
