#!/usr/bin/env node

'use strict';

const fs = require('fs');
const imagePath = process.argv[2];
if (!imagePath) {
  console.error('usage: node scripts/ss-fs2-scan-vm-dispatch.js <track1.bin>');
  process.exit(1);
}

const RAW = 2352, USER = 2048, BASE = 0x06010000, LBA = 21, BYTES = 319524;
const READER = 0x0601fc3c;
const fd = fs.openSync(imagePath, 'r'), exe = Buffer.alloc(BYTES);
try {
  for (let pos = 0; pos < BYTES;) {
    const sector = Math.floor(pos / USER), within = pos % USER;
    const count = Math.min(USER - within, BYTES - pos);
    fs.readSync(fd, exe, pos, count, (LBA + sector) * RAW + 0x10 + within);
    pos += count;
  }
} finally { fs.closeSync(fd); }

const hex = (value) => `0x${value.toString(16).padStart(8, '0')}`;
const calls = [];
for (let off = 0; off + 8 <= exe.length; off += 2) {
  const op = exe.readUInt16BE(off);
  if ((op >>> 12) !== 0xd) continue;
  const reg = (op >>> 8) & 15;
  const literal = ((off & ~3) + 4 + (op & 255) * 4);
  if (literal + 4 > exe.length || exe.readUInt32BE(literal) !== READER) continue;
  for (let cursor = off + 2; cursor <= off + 8; cursor += 2) {
    if (exe.readUInt16BE(cursor) === (0x400b | (reg << 8))) {
      calls.push({ literalLoad: off, call: cursor });
      break;
    }
  }
}

console.log(`readerCalls=${calls.length}`);
for (const item of calls) {
  const indexedLoads = [], indirectCalls = [], shifts = [];
  for (let cursor = item.call + 2; cursor <= item.call + 80 && cursor + 2 <= exe.length; cursor += 2) {
    const op = exe.readUInt16BE(cursor);
    if ((op & 0xf00f) === 0x000e) indexedLoads.push(BASE + cursor);
    if ((op & 0xf0ff) === 0x400b) indirectCalls.push(BASE + cursor);
    if ((op & 0xf0ff) === 0x4008 || (op & 0xf0ff) === 0x4000) shifts.push(BASE + cursor);
    if (op === 0x000b) break;
  }
  if (indexedLoads.length && indirectCalls.length) {
    console.log(`readerCall=${hex(BASE + item.call)} indexed=${indexedLoads.map(hex).join(',')} jsr=${indirectCalls.map(hex).join(',')} shifts=${shifts.map(hex).join(',')}`);
  }
}
