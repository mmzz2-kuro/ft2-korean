#!/usr/bin/env node

const fs = require("fs");

const args = process.argv.slice(2);
const exePath = args.shift();
let mode = "all";
const targetArgs = [];

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--stores") mode = "stores";
  else if (arg === "--loads") mode = "loads";
  else targetArgs.push(arg);
}

const targets = targetArgs.map(Number).filter(Number.isFinite);

if (!exePath || targets.length === 0) {
  console.error("usage: node scripts/scan-exe-data-refs.js <SLPS_019.03> <addr> [addr...] [--loads|--stores]");
  process.exit(2);
}

const exe = fs.readFileSync(exePath);
const load = exe.readUInt32LE(0x18);
const textSize = exe.readUInt32LE(0x1c);
const textStart = 0x800;
const textEnd = Math.min(exe.length, textStart + textSize);

const regs = [
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

function wordAt(off) {
  if (off < textStart || off + 4 > textEnd) return null;
  return exe.readUInt32LE(off);
}

function insnAt(off) {
  const word = wordAt(off);
  if (word == null) return null;
  return {
    off,
    word,
    op: word >>> 26,
    rs: (word >>> 21) & 31,
    rt: (word >>> 16) & 31,
    rd: (word >>> 11) & 31,
    sh: (word >>> 6) & 31,
    fn: word & 63,
    imm: word & 0xffff,
    simm: sx16(word & 0xffff),
  };
}

function jumpTarget(word, pc) {
  return (((pc + 4) & 0xf0000000) | ((word & 0x03ffffff) << 2)) >>> 0;
}

function decode(i) {
  if (!i) return "(none)";
  const pc = ramAt(i.off);
  const jt = jumpTarget(i.word, pc);
  if (i.word === 0) return "nop";
  if (i.op === 0x02) return `j ${hex(jt, 8)}`;
  if (i.op === 0x03) return `jal ${hex(jt, 8)}`;
  if (i.op === 0x04) return `beq ${regs[i.rs]}, ${regs[i.rt]}, ${hex(pc + 4 + (i.simm << 2), 8)}`;
  if (i.op === 0x05) return `bne ${regs[i.rs]}, ${regs[i.rt]}, ${hex(pc + 4 + (i.simm << 2), 8)}`;
  if (i.op === 0x09) return `addiu ${regs[i.rt]}, ${regs[i.rs]}, ${i.simm}`;
  if (i.op === 0x0d) return `ori ${regs[i.rt]}, ${regs[i.rs]}, ${hex(i.imm)}`;
  if (i.op === 0x0f) return `lui ${regs[i.rt]}, ${hex(i.imm)}`;
  if (i.op === 0x21) return `lh ${regs[i.rt]}, ${i.simm}(${regs[i.rs]})`;
  if (i.op === 0x23) return `lw ${regs[i.rt]}, ${i.simm}(${regs[i.rs]})`;
  if (i.op === 0x25) return `lhu ${regs[i.rt]}, ${i.simm}(${regs[i.rs]})`;
  if (i.op === 0x29) return `sh ${regs[i.rt]}, ${i.simm}(${regs[i.rs]})`;
  if (i.op === 0x2b) return `sw ${regs[i.rt]}, ${i.simm}(${regs[i.rs]})`;
  if (i.op === 0 && i.fn === 0x21) return `addu ${regs[i.rd]}, ${regs[i.rs]}, ${regs[i.rt]}`;
  if (i.op === 0 && i.fn === 0x08) return `jr ${regs[i.rs]}`;
  return `word ${hex(i.word, 8)}`;
}

function accessName(op) {
  return {
    0x20: "lb", 0x21: "lh", 0x23: "lw", 0x24: "lbu", 0x25: "lhu",
    0x28: "sb", 0x29: "sh", 0x2b: "sw",
  }[op] || null;
}

console.log(`exe=${exePath}`);
for (const target of targets) {
  console.log(`\ntarget=${hex(target, 8)}`);
  let hits = 0;
  for (let off = textStart; off + 8 <= textEnd; off += 4) {
    const hi = insnAt(off);
    if (!hi || hi.op !== 0x0f) continue;
    const base = hi.imm * 0x10000;
    for (let p = off + 4; p < Math.min(textEnd, off + 72); p += 4) {
      const i = insnAt(p);
      if (!i) break;
      const kind = accessName(i.op);
      if (!kind || i.rs !== hi.rt) continue;
      if (mode === "stores" && !["sb", "sh", "sw"].includes(kind)) continue;
      if (mode === "loads" && !["lb", "lh", "lw", "lbu", "lhu"].includes(kind)) continue;
      const addr = (base + i.simm) >>> 0;
      if (addr !== (target >>> 0)) continue;
      hits += 1;
      console.log(`${kind} file=${hex(p)} ram=${hex(ramAt(p), 8)} via=${regs[hi.rt]} setup=${hex(ramAt(off), 8)}`);
      for (let q = Math.max(textStart, p - 20); q <= Math.min(textEnd - 4, p + 20); q += 4) {
        const mark = q === p ? "=>" : "  ";
        console.log(`  ${mark} ${hex(ramAt(q), 8)} ${decode(insnAt(q))}`);
      }
    }
  }
  console.log(`hits=${hits}`);
}
