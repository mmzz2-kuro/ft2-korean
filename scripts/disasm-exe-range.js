#!/usr/bin/env node

const fs = require("fs");

const exePath = process.argv[2];
const addr = Number(process.argv[3]);
const bytes = Number(process.argv[4] || 0x100);

if (!exePath || !Number.isFinite(addr)) {
  console.error("usage: node scripts/disasm-exe-range.js <SLPS_019.03> <ram-addr> [bytes]");
  process.exit(2);
}

const exe = fs.readFileSync(exePath);
const load = exe.readUInt32LE(0x18);
const textSize = exe.readUInt32LE(0x1c);
const startOff = addr - load + 0x800;
const endOff = Math.min(exe.length, 0x800 + textSize, startOff + bytes);

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

function jumpTarget(word, pc) {
  return (((pc + 4) & 0xf0000000) | ((word & 0x03ffffff) << 2)) >>> 0;
}

function decodeCop2(word) {
  if ((word & 0xfeffffff) === 0x4a180001) return "rtps";
  if ((word & 0xfeffffff) === 0x4a280030) return "rtpt";
  if ((word & 0xfeffffff) === 0x4a280010) return "nclip";
  return null;
}

function decode(word, pc) {
  const cop2 = decodeCop2(word);
  if (cop2) return cop2;

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
  if (op === 0x04) return `beq ${regs[rs]}, ${regs[rt]}, ${hex(pc + 4 + (simm << 2), 8)}`;
  if (op === 0x05) return `bne ${regs[rs]}, ${regs[rt]}, ${hex(pc + 4 + (simm << 2), 8)}`;
  if (op === 0x06) return `blez ${regs[rs]}, ${hex(pc + 4 + (simm << 2), 8)}`;
  if (op === 0x07) return `bgtz ${regs[rs]}, ${hex(pc + 4 + (simm << 2), 8)}`;
  if (op === 0x09) return `addiu ${regs[rt]}, ${regs[rs]}, ${simm}`;
  if (op === 0x0a) return `slti ${regs[rt]}, ${regs[rs]}, ${simm}`;
  if (op === 0x0b) return `sltiu ${regs[rt]}, ${regs[rs]}, ${simm}`;
  if (op === 0x0c) return `andi ${regs[rt]}, ${regs[rs]}, ${hex(imm)}`;
  if (op === 0x0d) return `ori ${regs[rt]}, ${regs[rs]}, ${hex(imm)}`;
  if (op === 0x0e) return `xori ${regs[rt]}, ${regs[rs]}, ${hex(imm)}`;
  if (op === 0x0f) return `lui ${regs[rt]}, ${hex(imm)}`;
  if (op === 0x20) return `lb ${regs[rt]}, ${simm}(${regs[rs]})`;
  if (op === 0x21) return `lh ${regs[rt]}, ${simm}(${regs[rs]})`;
  if (op === 0x22) return `lwl ${regs[rt]}, ${simm}(${regs[rs]})`;
  if (op === 0x23) return `lw ${regs[rt]}, ${simm}(${regs[rs]})`;
  if (op === 0x24) return `lbu ${regs[rt]}, ${simm}(${regs[rs]})`;
  if (op === 0x25) return `lhu ${regs[rt]}, ${simm}(${regs[rs]})`;
  if (op === 0x26) return `lwr ${regs[rt]}, ${simm}(${regs[rs]})`;
  if (op === 0x28) return `sb ${regs[rt]}, ${simm}(${regs[rs]})`;
  if (op === 0x29) return `sh ${regs[rt]}, ${simm}(${regs[rs]})`;
  if (op === 0x2a) return `swl ${regs[rt]}, ${simm}(${regs[rs]})`;
  if (op === 0x2b) return `sw ${regs[rt]}, ${simm}(${regs[rs]})`;
  if (op === 0x2e) return `swr ${regs[rt]}, ${simm}(${regs[rs]})`;

  if (op === 0) {
    if (fn === 0x00) return `sll ${regs[rd]}, ${regs[rt]}, ${sh}`;
    if (fn === 0x02) return `srl ${regs[rd]}, ${regs[rt]}, ${sh}`;
    if (fn === 0x03) return `sra ${regs[rd]}, ${regs[rt]}, ${sh}`;
    if (fn === 0x08) return `jr ${regs[rs]}`;
    if (fn === 0x09) return `jalr ${regs[rd]}, ${regs[rs]}`;
    if (fn === 0x21) return `addu ${regs[rd]}, ${regs[rs]}, ${regs[rt]}`;
    if (fn === 0x23) return `subu ${regs[rd]}, ${regs[rs]}, ${regs[rt]}`;
    if (fn === 0x24) return `and ${regs[rd]}, ${regs[rs]}, ${regs[rt]}`;
    if (fn === 0x25) return `or ${regs[rd]}, ${regs[rs]}, ${regs[rt]}`;
    if (fn === 0x2a) return `slt ${regs[rd]}, ${regs[rs]}, ${regs[rt]}`;
    if (fn === 0x2b) return `sltu ${regs[rd]}, ${regs[rs]}, ${regs[rt]}`;
  }

  return `word ${hex(word, 8)}`;
}

if (startOff < 0x800 || startOff >= exe.length) {
  console.error("address is outside EXE text");
  process.exit(1);
}

console.log(`addr=${hex(addr, 8)} fileOff=${hex(startOff)} bytes=${hex(bytes)}`);
for (let off = startOff; off + 4 <= endOff; off += 4) {
  const word = exe.readUInt32LE(off);
  console.log(`${hex(off)} ${hex(ramAt(off), 8)} ${hex(word, 8)}  ${decode(word, ramAt(off))}`);
}
