#!/usr/bin/env node

'use strict';

const fs = require('fs');

const RAW_SECTOR_SIZE = 2352;
const USER_DATA_OFFSET = 16;
const USER_DATA_SIZE = 2048;

function usage() {
  console.error(
    'usage: node scripts/ss-fs2-scan-exe-xrefs.js <track1.bin> ' +
      '[--lba 21] [--bytes 319524] [--base 0x06010000] [--target ADDRESS]'
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const imagePath = args.shift();
if (!imagePath) usage();

let fileLba = 21;
let fileBytes = 319524;
let base = 0x06010000;
const targets = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--lba') fileLba = Number.parseInt(args[++i] || '', 0);
  else if (arg === '--bytes') fileBytes = Number.parseInt(args[++i] || '', 0);
  else if (arg === '--base') base = Number.parseInt(args[++i] || '', 0);
  else if (arg === '--target') targets.push(Number.parseInt(args[++i] || '', 0));
  else usage();
}

if (targets.length === 0) {
  targets.push(0x0602ae9c, 0x0602e700, 0x0602e724, 0x0602e7ec);
}
if (![fileLba, fileBytes, base, ...targets].every(Number.isSafeInteger)) {
  throw new Error('invalid numeric option');
}

const fd = fs.openSync(imagePath, 'r');
const exe = Buffer.alloc(fileBytes);
try {
  for (let position = 0; position < fileBytes; ) {
    const sector = Math.floor(position / USER_DATA_SIZE);
    const withinSector = position % USER_DATA_SIZE;
    const count = Math.min(USER_DATA_SIZE - withinSector, fileBytes - position);
    const rawOffset = (fileLba + sector) * RAW_SECTOR_SIZE + USER_DATA_OFFSET + withinSector;
    const got = fs.readSync(fd, exe, position, count, rawOffset);
    if (got !== count) throw new Error(`short read at executable offset 0x${position.toString(16)}`);
    position += count;
  }
} finally {
  fs.closeSync(fd);
}

function hex(value, width = 0) {
  return `0x${value.toString(16).padStart(width, '0')}`;
}

function literalOffsetsFor(target) {
  const needle = Buffer.alloc(4);
  needle.writeUInt32BE(target);
  const offsets = [];
  for (let offset = exe.indexOf(needle); offset >= 0; offset = exe.indexOf(needle, offset + 1)) {
    offsets.push(offset);
  }
  return offsets;
}

function movlPcReferences(target) {
  const refs = [];
  for (let pc = 0; pc + 2 <= exe.length; pc += 2) {
    const opcode = exe.readUInt16BE(pc);
    if ((opcode & 0xf000) !== 0xd000) continue;
    const register = (opcode >>> 8) & 0x0f;
    const literalOffset = (pc & ~3) + 4 + (opcode & 0xff) * 4;
    if (literalOffset + 4 > exe.length || exe.readUInt32BE(literalOffset) !== target) continue;

    let nearbyJsr = null;
    for (let cursor = pc + 2; cursor <= Math.min(pc + 20, exe.length - 2); cursor += 2) {
      if (exe.readUInt16BE(cursor) === (0x400b | (register << 8))) {
        nearbyJsr = cursor;
        break;
      }
    }
    refs.push({ pc, literalOffset, register, nearbyJsr });
  }
  return refs;
}

function directBsrReferences(targetOffset) {
  const refs = [];
  for (let pc = 0; pc + 2 <= exe.length; pc += 2) {
    const opcode = exe.readUInt16BE(pc);
    if ((opcode & 0xf000) !== 0xb000) continue;
    let displacement = opcode & 0x0fff;
    if (displacement & 0x0800) displacement -= 0x1000;
    if (pc + 4 + displacement * 2 === targetOffset) refs.push(pc);
  }
  return refs;
}

console.log(`image=${imagePath}`);
console.log(`executableLba=${fileLba} bytes=${fileBytes} base=${hex(base, 8)}`);
for (const target of targets) {
  const targetOffset = target - base;
  const literals = literalOffsetsFor(target);
  const movRefs = movlPcReferences(target);
  const bsrRefs = targetOffset >= 0 && targetOffset < exe.length ? directBsrReferences(targetOffset) : [];
  console.log(`\ntarget=${hex(target, 8)} fileOff=${hex(targetOffset)}`);
  console.log(`literalOffsets=${literals.map((value) => hex(value)).join(',') || 'none'}`);
  console.log(`directBsr=${bsrRefs.map((value) => hex(base + value, 8)).join(',') || 'none'}`);
  console.log(`movlPcRefs=${movRefs.length}`);
  for (const ref of movRefs) {
    console.log(
      `  pc=${hex(base + ref.pc, 8)} literalOff=${hex(ref.literalOffset)} R${ref.register} ` +
        `jsr=${ref.nearbyJsr === null ? 'not-near' : hex(base + ref.nearbyJsr, 8)}`
    );
  }
}
