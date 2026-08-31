#!/usr/bin/env node

'use strict';

const fs = require('fs');

const imagePath = process.argv[2];
if (!imagePath) {
  console.error('usage: node scripts/ss-fs2-scan-text-loops.js <track1.bin>');
  process.exit(1);
}
const RAW = 2352, USER = 2048, BASE = 0x06010000, FILE_LBA = 21, BYTES = 319524;
const fd = fs.openSync(imagePath, 'r'), exe = Buffer.alloc(BYTES);
try {
  for (let pos = 0; pos < BYTES;) {
    const sector = Math.floor(pos / USER), within = pos % USER, count = Math.min(USER - within, BYTES - pos);
    fs.readSync(fd, exe, pos, count, (FILE_LBA + sector) * RAW + 0x10 + within); pos += count;
  }
} finally { fs.closeSync(fd); }

const hex = (v) => `0x${v.toString(16).padStart(8, '0')}`;
const candidates = [];
for (let offset = 0; offset + 48 <= exe.length; offset += 2) {
  const load = exe.readUInt16BE(offset);
  const low = load & 15;
  if ((load & 0xf000) !== 0x6000 || (low !== 4 && low !== 5)) continue; // MOV.B/W @Rm+,Rn
  const width = low === 4 ? 1 : 2;
  const register = (load >>> 8) & 15;
  let score = 0, backward = null, terminator = null, stores = 0;
  for (let cursor = offset + 2; cursor <= offset + 40; cursor += 2) {
    const op = exe.readUInt16BE(cursor);
    if ((op & 0xff00) === 0x8b00 || (op & 0xff00) === 0x8f00) {
      let d = op & 255; if (d & 128) d -= 256;
      const target = cursor + 4 + d * 2;
      if (target <= offset && target >= offset - 24) { backward = BASE + target; score += 3; }
    }
    if ((op & 0xf00f) === 0x3000 && ((op >>> 4) & 15) === register) score += 1; // CMP/EQ
    if ((op & 0xf0ff) === (0x2008 | (register << 8))) score += 1; // TST Rm,Rn rough
    if ((op & 0xf00f) === 0x2000 || (op & 0xf00f) === 0x2001) stores++;
    if ((op & 0xff00) === 0x8800) { terminator = op & 255; score += 2; } // CMP/EQ #imm,R0
  }
  if (backward !== null && score >= 3) candidates.push({ address: BASE + offset, width, register, backward, terminator, stores, score });
}

candidates.sort((a, b) => b.score - a.score || b.stores - a.stores || a.address - b.address);
console.log(`candidates=${candidates.length}`);
for (const item of candidates) console.log(`${hex(item.address)} width=${item.width} R${item.register} loop=${hex(item.backward)} term=${item.terminator === null ? '-' : `0x${item.terminator.toString(16)}`} stores=${item.stores} score=${item.score}`);
