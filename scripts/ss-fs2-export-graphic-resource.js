#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const imagePath = process.argv[2];
const id = Number.parseInt(process.argv[3] || '', 0);
const outputPath = process.argv[4] || path.join('output', `ss-fs2-resource-${id}.bmp`);
if (!imagePath || !Number.isSafeInteger(id)) {
  console.error('usage: node scripts/ss-fs2-export-graphic-resource.js <track1.bin> <id> [output.bmp]');
  process.exit(1);
}

const RAW = 2352, USER = 2048, USER_OFFSET = 0x10;
const FILE0_LBA = 21, FILE1_LBA = 178, TABLE_OFFSET = 0x1ae9c;
const fd = fs.openSync(imagePath, 'r');
function readUser(lba, bytes) {
  const out = Buffer.alloc(bytes);
  for (let pos = 0; pos < bytes;) {
    const sector = Math.floor(pos / USER), within = pos % USER;
    const count = Math.min(USER - within, bytes - pos);
    fs.readSync(fd, out, pos, count, (lba + sector) * RAW + USER_OFFSET + within);
    pos += count;
  }
  return out;
}

try {
  const exe = readUser(FILE0_LBA, 319524);
  const first = exe.readUInt16BE(TABLE_OFFSET + id * 2);
  const last = exe.readUInt16BE(TABLE_OFFSET + (id + 1) * 2);
  const data = readUser(FILE1_LBA + first, (last - first) * USER);
  const tilesWide = data.readUInt32BE(0), tilesHigh = data.readUInt32BE(4);
  const payloadBytes = data.readUInt32BE(8), payloadOffset = data.readUInt32BE(12);
  const width = tilesWide * 8, height = tilesHigh * 8;
  if (tilesWide <= 0 || tilesHigh <= 0 || width > 4096 || height > 4096) throw new Error('implausible dimensions');

  const palette = [];
  for (let i = 0; i < 256; i++) {
    const c = data.readUInt16BE(0x10 + i * 2);
    const r = (c & 31) * 255 / 31;
    const g = ((c >>> 5) & 31) * 255 / 31;
    const b = ((c >>> 10) & 31) * 255 / 31;
    palette.push([Math.round(b), Math.round(g), Math.round(r)]); // BMP BGR
  }

  const rowBytes = (width * 3 + 3) & ~3;
  const pixels = Buffer.alloc(rowBytes * height);
  let outOfRange = 0;
  for (let ty = 0; ty < tilesHigh; ty++) {
    for (let tx = 0; tx < tilesWide; tx++) {
      const characterNumber = data.readUInt16BE(0x210 + (ty * tilesWide + tx) * 2);
      const tileOffset = payloadOffset + characterNumber * 32;
      if (tileOffset + 64 > payloadOffset + payloadBytes) outOfRange += 1;
      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px++) {
          const index = tileOffset + py * 8 + px < data.length ? data[tileOffset + py * 8 + px] : 0;
          const [b, g, r] = palette[index];
          const x = tx * 8 + px, y = ty * 8 + py;
          const dst = (height - 1 - y) * rowBytes + x * 3;
          pixels[dst] = b; pixels[dst + 1] = g; pixels[dst + 2] = r;
        }
      }
    }
  }

  const header = Buffer.alloc(54);
  header.write('BM', 0, 'ascii');
  header.writeUInt32LE(header.length + pixels.length, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18); header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26); header.writeUInt16LE(24, 28);
  header.writeUInt32LE(pixels.length, 34);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.concat([header, pixels]));
  console.log(JSON.stringify({ id, tilesWide, tilesHigh, width, height, payloadOffset, payloadBytes, outOfRange, outputPath }, null, 2));
} finally {
  fs.closeSync(fd);
}
