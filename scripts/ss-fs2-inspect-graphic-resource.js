#!/usr/bin/env node

'use strict';

const fs = require('fs');

const imagePath = process.argv[2];
const ids = (process.argv[3] || '645,646,665').split(',').map((v) => Number.parseInt(v, 0));
if (!imagePath || ids.some((v) => !Number.isSafeInteger(v))) {
  console.error('usage: node scripts/ss-fs2-inspect-graphic-resource.js <track1.bin> [ids]');
  process.exit(1);
}

const RAW = 2352, USER = 2048, USER_OFFSET = 0x10;
const FILE0_LBA = 21, FILE1_LBA = 178, TABLE_OFFSET = 0x1ae9c;
const fd = fs.openSync(imagePath, 'r');

function readUser(lba, bytes) {
  const out = Buffer.alloc(bytes);
  for (let pos = 0; pos < bytes;) {
    const sector = Math.floor(pos / USER);
    const within = pos % USER;
    const count = Math.min(USER - within, bytes - pos);
    fs.readSync(fd, out, pos, count, (lba + sector) * RAW + USER_OFFSET + within);
    pos += count;
  }
  return out;
}

try {
  const exe = readUser(FILE0_LBA, 319524);
  for (const id of ids) {
    const first = exe.readUInt16BE(TABLE_OFFSET + id * 2);
    const last = exe.readUInt16BE(TABLE_OFFSET + (id + 1) * 2);
    const allocated = (last - first) * USER;
    const data = readUser(FILE1_LBA + first, allocated);
    const width = data.readUInt32BE(0);
    const height = data.readUInt32BE(4);
    const payloadBytes = data.readUInt32BE(8);
    const payloadOffset = data.readUInt32BE(12);
    const calculated = 0x10 + 0x200 + width * height * 2;
    const calculatedAligned = (calculated + 3) & ~3;
    const logicalEnd = payloadOffset + payloadBytes;
    console.log(JSON.stringify({
      id, firstSector: first, lastSector: last, allocated,
      width, height, paletteOffset: 0x10, paletteBytes: 0x200,
      tilemapOffset: 0x210, tilemapEntries: width * height,
      payloadOffset, payloadBytes, logicalEnd,
      paddingBytes: allocated - logicalEnd,
      layoutMatches: payloadOffset === calculated || payloadOffset === calculatedAligned
    }));
  }
} finally {
  fs.closeSync(fd);
}
