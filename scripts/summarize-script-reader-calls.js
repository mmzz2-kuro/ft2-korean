#!/usr/bin/env node

const fs = require("fs");

const args = process.argv.slice(2);
const exePath = args.shift();
let reader = 0x8017c364;
let brief = false;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--brief") brief = true;
  else reader = Number(arg);
}

if (!exePath || !Number.isFinite(reader)) {
  console.error("usage: node scripts/summarize-script-reader-calls.js <SLPS_019.03> [reader-addr] [--brief]");
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

function fileAt(addr) {
  return addr - load + 0x800;
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

function decode(insn) {
  if (!insn) return "(none)";
  const pc = ramAt(insn.off);
  const jt = jumpTarget(insn.word, pc);
  if (insn.word === 0) return "nop";
  if (insn.op === 0x02) return `j ${hex(jt, 8)}`;
  if (insn.op === 0x03) return `jal ${hex(jt, 8)}`;
  if (insn.op === 0x04) return `beq ${regs[insn.rs]}, ${regs[insn.rt]}, ${hex(pc + 4 + (insn.simm << 2), 8)}`;
  if (insn.op === 0x05) return `bne ${regs[insn.rs]}, ${regs[insn.rt]}, ${hex(pc + 4 + (insn.simm << 2), 8)}`;
  if (insn.op === 0x06) return `blez ${regs[insn.rs]}, ${hex(pc + 4 + (insn.simm << 2), 8)}`;
  if (insn.op === 0x07) return `bgtz ${regs[insn.rs]}, ${hex(pc + 4 + (insn.simm << 2), 8)}`;
  if (insn.op === 0x09) return `addiu ${regs[insn.rt]}, ${regs[insn.rs]}, ${insn.simm}`;
  if (insn.op === 0x0c) return `andi ${regs[insn.rt]}, ${regs[insn.rs]}, ${hex(insn.imm)}`;
  if (insn.op === 0x0d) return `ori ${regs[insn.rt]}, ${regs[insn.rs]}, ${hex(insn.imm)}`;
  if (insn.op === 0x0f) return `lui ${regs[insn.rt]}, ${hex(insn.imm)}`;
  if (insn.op === 0x20) return `lb ${regs[insn.rt]}, ${insn.simm}(${regs[insn.rs]})`;
  if (insn.op === 0x21) return `lh ${regs[insn.rt]}, ${insn.simm}(${regs[insn.rs]})`;
  if (insn.op === 0x23) return `lw ${regs[insn.rt]}, ${insn.simm}(${regs[insn.rs]})`;
  if (insn.op === 0x24) return `lbu ${regs[insn.rt]}, ${insn.simm}(${regs[insn.rs]})`;
  if (insn.op === 0x25) return `lhu ${regs[insn.rt]}, ${insn.simm}(${regs[insn.rs]})`;
  if (insn.op === 0x28) return `sb ${regs[insn.rt]}, ${insn.simm}(${regs[insn.rs]})`;
  if (insn.op === 0x29) return `sh ${regs[insn.rt]}, ${insn.simm}(${regs[insn.rs]})`;
  if (insn.op === 0x2b) return `sw ${regs[insn.rt]}, ${insn.simm}(${regs[insn.rs]})`;
  if (insn.op === 0) {
    if (insn.fn === 0x00) return `sll ${regs[insn.rd]}, ${regs[insn.rt]}, ${insn.sh}`;
    if (insn.fn === 0x02) return `srl ${regs[insn.rd]}, ${regs[insn.rt]}, ${insn.sh}`;
    if (insn.fn === 0x03) return `sra ${regs[insn.rd]}, ${regs[insn.rt]}, ${insn.sh}`;
    if (insn.fn === 0x08) return `jr ${regs[insn.rs]}`;
    if (insn.fn === 0x21) return `addu ${regs[insn.rd]}, ${regs[insn.rs]}, ${regs[insn.rt]}`;
    if (insn.fn === 0x23) return `subu ${regs[insn.rd]}, ${regs[insn.rs]}, ${regs[insn.rt]}`;
  }
  return `word ${hex(insn.word, 8)}`;
}

function isJalTo(off, target) {
  const insn = insnAt(off);
  return insn && insn.op === 0x03 && jumpTarget(insn.word, ramAt(off)) === target;
}

function isReturn(off) {
  const insn = insnAt(off);
  return insn && insn.op === 0 && insn.fn === 0x08 && insn.rs === 31;
}

function isStackEntry(off) {
  const insn = insnAt(off);
  return insn && insn.op === 0x09 && insn.rs === 29 && insn.rt === 29 && insn.simm < 0;
}

function functionStartFor(off) {
  for (let p = off; p >= textStart; p -= 4) {
    if (isStackEntry(p)) return p;
    if (p < off && isReturn(p)) return p + 8;
  }
  return textStart;
}

function functionEndFor(start) {
  for (let p = start; p + 4 < textEnd; p += 4) {
    if (isReturn(p)) return p + 8;
  }
  return textEnd;
}

function readsV0IntoArg(insn) {
  if (!insn) return null;
  if (insn.op === 0x0c && insn.rs === 2 && insn.rt >= 4 && insn.rt <= 7) return regs[insn.rt];
  if (insn.op === 0 && insn.fn === 0x21 && insn.rs === 2 && insn.rd >= 4 && insn.rd <= 7) return regs[insn.rd];
  if (insn.op === 0 && insn.fn === 0x03 && insn.rt === 2 && insn.rd >= 4 && insn.rd <= 7) return regs[insn.rd];
  return null;
}

function nextConsumer(callOff) {
  let sawUse = null;
  for (let off = callOff + 4; off < Math.min(textEnd, callOff + 80); off += 4) {
    const insn = insnAt(off);
    if (!insn) break;
    const arg = readsV0IntoArg(insn);
    if (arg) sawUse = { off, arg, text: decode(insn) };
    if (insn.op === 0x03) {
      const target = jumpTarget(insn.word, ramAt(off));
      return { off, target, via: sawUse };
    }
    if (isReturn(off)) return { off, target: null, via: sawUse, returns: true };
  }
  return null;
}

const calls = [];
for (let off = textStart; off + 4 <= textEnd; off += 4) {
  if (isJalTo(off, reader)) calls.push(off);
}

const groups = new Map();
for (const off of calls) {
  const start = functionStartFor(off);
  const end = functionEndFor(start);
  const key = start;
  if (!groups.has(key)) groups.set(key, { start, end, calls: [] });
  groups.get(key).calls.push(off);
}

console.log(`exe=${exePath}`);
console.log(`reader=${hex(reader, 8)} calls=${calls.length} functions=${groups.size}`);
if (brief) console.log("function calls nextConsumers");

for (const group of [...groups.values()].sort((a, b) => a.start - b.start)) {
  const consumers = group.calls.map((off) => nextConsumer(off));
  const consumerText = consumers
    .map((c) => {
      if (!c) return "none";
      const via = c.via ? `${c.via.arg}@${hex(c.via.off)}` : "no-v0-arg";
      if (c.target == null) return `return/${via}`;
      return `${hex(c.target, 8)}/${via}`;
    })
    .join(", ");
  if (brief) {
    console.log(`${hex(ramAt(group.start), 8)} ${group.calls.length} ${consumerText}`);
    continue;
  }
  console.log(
    `\nfunc=${hex(ramAt(group.start), 8)} file=${hex(group.start)} calls=${group.calls.length} ` +
      `range=${hex(ramAt(group.start), 8)}..${hex(ramAt(group.end), 8)}`
  );
  console.log(`  callSites=${group.calls.map((off) => hex(ramAt(off), 8)).join(" ")}`);
  console.log(`  nextConsumers=${consumerText}`);
  for (const off of group.calls.slice(0, 4)) {
    const start = Math.max(group.start, off - 16);
    const end = Math.min(group.end, off + 28);
    for (let p = start; p <= end; p += 4) {
      const mark = p === off ? "=>" : "  ";
      console.log(`  ${mark} ${hex(ramAt(p), 8)} ${decode(insnAt(p))}`);
    }
  }
}
