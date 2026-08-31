#!/usr/bin/env node

'use strict';

const fs = require('fs');

const imagePath = process.argv[2];
const startAddress = Number.parseInt(process.argv[3] || '', 0);
const byteCount = Number.parseInt(process.argv[4] || '256', 0);
if (!imagePath || !Number.isSafeInteger(startAddress) || !Number.isSafeInteger(byteCount)) {
  console.error('usage: node scripts/ss-fs2-disasm-sh2.js <track1.bin> <ram-address> [bytes]');
  process.exit(1);
}

const BASE = 0x06010000;
const FILE_LBA = 21;
const FILE_BYTES = 319524;
const fd = fs.openSync(imagePath, 'r');
const exe = Buffer.alloc(FILE_BYTES);
try {
  for (let pos = 0; pos < exe.length;) {
    const sector = Math.floor(pos / 2048);
    const within = pos % 2048;
    const count = Math.min(2048 - within, exe.length - pos);
    fs.readSync(fd, exe, pos, count, (FILE_LBA + sector) * 2352 + 0x10 + within);
    pos += count;
  }
} finally {
  fs.closeSync(fd);
}

const hex = (n, width = 8) => `0x${(n >>> 0).toString(16).padStart(width, '0')}`;
const signed8 = (n) => (n & 0x80 ? n - 0x100 : n);
const signed12 = (n) => (n & 0x800 ? n - 0x1000 : n);

function decode(op, address, offset) {
  const n = (op >>> 8) & 15, m = (op >>> 4) & 15, low = op & 15;
  const top = op >>> 12, imm = op & 255;
  if (op === 0x0009) return 'NOP';
  if (op === 0x000b) return 'RTS';
  if (op === 0x001b) return 'SLEEP';
  if ((op & 0xf0ff) === 0x400b) return `JSR @R${n}`;
  if ((op & 0xf0ff) === 0x402b) return `JMP @R${n}`;
  if ((op & 0xf0ff) === 0x4015) return `CMP/PL R${n}`;
  if ((op & 0xf0ff) === 0x4011) return `CMP/PZ R${n}`;
  if ((op & 0xf0ff) === 0x4000) return `SHLL R${n}`;
  if ((op & 0xf0ff) === 0x4001) return `SHLR R${n}`;
  if ((op & 0xf0ff) === 0x4008) return `SHLL2 R${n}`;
  if ((op & 0xf0ff) === 0x4009) return `SHLR2 R${n}`;
  if ((op & 0xf0ff) === 0x4018) return `SHLL8 R${n}`;
  if ((op & 0xf0ff) === 0x4019) return `SHLR8 R${n}`;
  if ((op & 0xf0ff) === 0x4022) return `STS.L PR,@-R${n}`;
  if ((op & 0xf0ff) === 0x4026) return `LDS.L @R${n}+,PR`;
  if ((op & 0xf0ff) === 0x4010) return `DT R${n}`;
  if (top === 0xe) return `MOV #${signed8(imm)},R${n}`;
  if (top === 0x7) return `ADD #${signed8(imm)},R${n}`;
  if (top === 0xa || top === 0xb) {
    const target = address + 4 + signed12(op & 0xfff) * 2;
    return `${top === 0xa ? 'BRA' : 'BSR'} ${hex(target)}`;
  }
  if ((op & 0xff00) === 0x8900 || (op & 0xff00) === 0x8b00 || (op & 0xff00) === 0x8d00 || (op & 0xff00) === 0x8f00) {
    const names = {0x89:'BT',0x8b:'BF',0x8d:'BT/S',0x8f:'BF/S'};
    return `${names[op >>> 8]} ${hex(address + 4 + signed8(imm) * 2)}`;
  }
  if (top === 0xd) {
    const literal = (offset & ~3) + 4 + imm * 4;
    return `MOV.L @(${hex(literal, 0)},PC),R${n} ; ${literal + 4 <= exe.length ? hex(exe.readUInt32BE(literal)) : 'out'}`;
  }
  if (top === 0x9) {
    const literal = offset + 4 + imm * 2;
    return `MOV.W @(${hex(literal, 0)},PC),R${n} ; ${literal + 2 <= exe.length ? hex(exe.readUInt16BE(literal), 4) : 'out'}`;
  }
  if (top === 0x1) return `MOV.L R${m},@(${(op & 15) * 4},R${n})`;
  if (top === 0x5) return `MOV.L @(${(op & 15) * 4},R${m}),R${n}`;
  const group2 = ['MOV.B','MOV.W','MOV.L','?','MOV.B','MOV.W','MOV.L','DIV0S','TST','AND','XOR','OR','CMP/STR','XTRCT','MULU.W','MULS.W'];
  if (top === 0x2) {
    if (low <= 2) return `${group2[low]} R${m},@R${n}`;
    if (low >= 4 && low <= 6) return `${group2[low]} R${m},@-R${n}`;
    return `${group2[low]} R${m},R${n}`;
  }
  const group6 = ['MOV.B @R','MOV.W @R','MOV.L @R','MOV','MOV.B @R+','MOV.W @R+','MOV.L @R+','NOT','SWAP.B','SWAP.W','NEGC','NEG','EXTU.B','EXTU.W','EXTS.B','EXTS.W'];
  if (top === 0x6) return low <= 2 ? `${group6[low]}${m},R${n}` : low <= 6 ? `${group6[low]}${m},R${n}` : `${group6[low]} R${m},R${n}`;
  const group3 = ['CMP/EQ','?','CMP/HS','CMP/GE','DIV1','DMULU.L','CMP/HI','CMP/GT','SUB','?','SUBC','SUBV','ADD','DMULS.L','ADDC','ADDV'];
  if (top === 0x3) return `${group3[low]} R${m},R${n}`;
  if ((op & 0xf00f) === 0x0002) return `STC ?,R${n}`;
  if ((op & 0xf00f) === 0x0006) return `MOV.L R${m},@(R0,R${n})`;
  if ((op & 0xf00f) === 0x000c) return `MOV.B @(R0,R${m}),R${n}`;
  if ((op & 0xf00f) === 0x000d) return `MOV.W @(R0,R${m}),R${n}`;
  if ((op & 0xf00f) === 0x000e) return `MOV.L @(R0,R${m}),R${n}`;
  if ((op & 0xf0ff) === 0x000a) return `STS MACH,R${n}`;
  if ((op & 0xf0ff) === 0x001a) return `STS MACL,R${n}`;
  if ((op & 0xff00) === 0xc900) return `AND #${imm},R0`;
  return `DATA.W ${hex(op, 4)}`;
}

const start = startAddress - BASE;
if (start < 0 || start + byteCount > exe.length) throw new Error('range outside executable');
for (let offset = start; offset < start + byteCount; offset += 2) {
  const op = exe.readUInt16BE(offset);
  const address = BASE + offset;
  console.log(`${hex(address)}  ${hex(op, 4)}  ${decode(op, address, offset)}`);
}
