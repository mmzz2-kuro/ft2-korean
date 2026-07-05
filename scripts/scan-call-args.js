#!/usr/bin/env node

const fs = require("fs");

const exePath = process.argv[2];
const target = Number(process.argv[3]);
const context = Number(process.argv[process.argv.indexOf("--context") + 1]) || 0;

if (!exePath || !Number.isFinite(target)) {
  console.error("usage: node scripts/scan-call-args.js <SLPS_019.03> <target-addr> [--context N]");
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
  if (word === null) return null;
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
  if (insn.op === 0 && insn.fn === 0x00) return `sll ${regs[insn.rd]}, ${regs[insn.rt]}, ${insn.sh}`;
  if (insn.op === 0 && insn.fn === 0x02) return `srl ${regs[insn.rd]}, ${regs[insn.rt]}, ${insn.sh}`;
  if (insn.op === 0 && insn.fn === 0x03) return `sra ${regs[insn.rd]}, ${regs[insn.rt]}, ${insn.sh}`;
  if (insn.op === 0 && insn.fn === 0x08) return `jr ${regs[insn.rs]}`;
  if (insn.op === 0 && insn.fn === 0x21) return `addu ${regs[insn.rd]}, ${regs[insn.rs]}, ${regs[insn.rt]}`;
  if (insn.op === 0 && insn.fn === 0x23) return `subu ${regs[insn.rd]}, ${regs[insn.rs]}, ${regs[insn.rt]}`;
  return `word ${hex(insn.word, 8)}`;
}

function writesReg(insn, reg) {
  if (!insn) return false;
  if ([0x09, 0x0c, 0x0d, 0x0f, 0x20, 0x21, 0x23, 0x24, 0x25].includes(insn.op)) return insn.rt === reg;
  if (insn.op === 0 && [0x00, 0x02, 0x03, 0x21, 0x23, 0x24, 0x25, 0x2a, 0x2b].includes(insn.fn)) return insn.rd === reg;
  return false;
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

function constValue(insn) {
  if (!insn) return null;
  if ((insn.op === 0x09 || insn.op === 0x0d) && insn.rs === 0) {
    return insn.op === 0x09 ? insn.simm : insn.imm;
  }
  if ((insn.op === 0x09 || insn.op === 0x0d) && insn.rs === insn.rt) {
    for (let off = insn.off - 4; off >= Math.max(textStart, insn.off - 16); off -= 4) {
      const prev = insnAt(off);
      if (writesReg(prev, insn.rs)) {
        if (prev.op === 0x0f) return ((prev.imm << 16) + (insn.op === 0x09 ? insn.simm : insn.imm)) >>> 0;
        return null;
      }
    }
  }
  return null;
}

function kindOf(insn) {
  if (!insn) return "unknown";
  if (constValue(insn) !== null) return "const";
  if ([0x20, 0x21, 0x23, 0x24, 0x25].includes(insn.op)) return decode(insn).split(" ")[0];
  if (insn.op === 0x09) return "addiu";
  if (insn.op === 0x0c) return "andi";
  if (insn.op === 0 && insn.fn === 0x21) return "addu";
  if (insn.op === 0 && [0x00, 0x02, 0x03].includes(insn.fn)) return "shift";
  return "other";
}

function describeArg(callOff, reg) {
  const writer = findWriter(callOff, reg);
  const c = constValue(writer);
  return {
    reg: regs[reg],
    kind: kindOf(writer),
    value: c,
    writer,
  };
}

function dumpContext(callOff) {
  if (context <= 0) return;
  for (let off = Math.max(textStart, callOff - context * 4); off <= Math.min(textEnd - 4, callOff + (context + 1) * 4); off += 4) {
    const mark = off === callOff ? "=>" : "  ";
    const insn = insnAt(off);
    console.log(`${mark} ${hex(off)} ${hex(ramAt(off), 8)} ${decode(insn)}`);
  }
}

const calls = [];
const kindCounts = new Map();
for (let off = textStart; off + 4 <= textEnd; off += 4) {
  const insn = insnAt(off);
  if (!insn || insn.op !== 0x03) continue;
  const jt = jumpTarget(insn.word, ramAt(off));
  if (jt !== target) continue;

  const args = [4, 5, 6, 7].map((reg) => describeArg(off, reg));
  for (const arg of args) {
    const key = `${arg.reg}:${arg.kind}`;
    kindCounts.set(key, (kindCounts.get(key) || 0) + 1);
  }
  calls.push({ off, args });
}

console.log(`exe=${exePath}`);
console.log(`target=${hex(target, 8)} calls=${calls.length}`);
console.log("arg source counts:");
for (const [key, count] of [...kindCounts].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`  ${key}: ${count}`);
}

console.log("\ncalls:");
for (const call of calls) {
  const argText = call.args.map((arg) => {
    const val = arg.value === null ? "" : `=${Number.isInteger(arg.value) && arg.value < 0 ? arg.value : hex(arg.value)}`;
    const writer = arg.writer ? ` @${hex(arg.writer.off)} ${decode(arg.writer)}` : "";
    return `${arg.reg}:${arg.kind}${val}${writer}`;
  }).join(" | ");
  console.log(`file=${hex(call.off)} ram=${hex(ramAt(call.off), 8)} ${argText}`);
  dumpContext(call.off);
}
