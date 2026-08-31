#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const imagePath = process.argv[2], id = Number.parseInt(process.argv[3] || '', 0);
const modeName = process.argv[4] || '4bpp-8x8';
const outputPath = process.argv[5] || path.join('output', `ss-fs2-resource-${id}-${modeName}.bmp`);
const modes = {
  '1bpp-8x8': { bpp: 1, w: 8, h: 8, bytes: 8 },
  '1bpp-8x16': { bpp: 1, w: 8, h: 16, bytes: 16 },
  '1bpp-16x16': { bpp: 1, w: 16, h: 16, bytes: 32 },
  '2bpp-8x8': { bpp: 2, w: 8, h: 8, bytes: 16 },
  '2bpp-16x16': { bpp: 2, w: 16, h: 16, bytes: 64 },
  '4bpp-8x8': { bpp: 4, w: 8, h: 8, bytes: 32 },
  '4bpp-16x16': { bpp: 4, w: 16, h: 16, bytes: 128 },
  '8bpp-8x8': { bpp: 8, w: 8, h: 8, bytes: 64 },
  '8bpp-8x16': { bpp: 8, w: 8, h: 16, bytes: 128 }
};
const mode = modes[modeName];
if (!imagePath || !Number.isSafeInteger(id) || !mode) {
  console.error('usage: node scripts/ss-fs2-export-raw-tiles.js <track1.bin> <id> <mode> [output.bmp]');
  process.exit(1);
}

const RAW = 2352, USER = 2048, UOFF = 0x10, FILE0_LBA = 21, FILE1_LBA = 178, TABLE = 0x1ae9c;
const fd = fs.openSync(imagePath, 'r');
function readUser(lba, bytes) {
  const out = Buffer.alloc(bytes);
  for (let pos = 0; pos < bytes;) {
    const sector = Math.floor(pos / USER), within = pos % USER, count = Math.min(USER - within, bytes - pos);
    fs.readSync(fd, out, pos, count, (lba + sector) * RAW + UOFF + within); pos += count;
  }
  return out;
}
function sample(data, base, x, y) {
  if (mode.bpp === 1) {
    const rowBytes = mode.w / 8;
    return ((data[base + y * rowBytes + (x >>> 3)] >>> (7 - (x & 7))) & 1) * 255;
  }
  if (mode.bpp === 2) {
    const rowBytes = mode.w / 4;
    return ((data[base + y * rowBytes + (x >>> 2)] >>> ((3 - (x & 3)) * 2)) & 3) * 85;
  }
  if (mode.bpp === 4) {
    const b = data[base + y * (mode.w / 2) + (x >>> 1)];
    return ((x & 1 ? b & 15 : b >>> 4) * 17);
  }
  return data[base + y * mode.w + x];
}
try {
  const exe = readUser(FILE0_LBA, 319524);
  const first = exe.readUInt16BE(TABLE + id * 2), last = exe.readUInt16BE(TABLE + (id + 1) * 2);
  const data = readUser(FILE1_LBA + first, (last - first) * USER);
  const count = Math.floor(data.length / mode.bytes), columns = Math.min(32, Math.ceil(Math.sqrt(count * mode.h / mode.w)));
  const rows = Math.ceil(count / columns), gap = 1, scale = mode.w <= 8 ? 2 : 1;
  const width = columns * (mode.w * scale + gap) - gap, height = rows * (mode.h * scale + gap) - gap;
  const rowBytes = (width * 3 + 3) & ~3, pixels = Buffer.alloc(rowBytes * height, 32);
  for (let tile = 0; tile < count; tile++) {
    const ox = (tile % columns) * (mode.w * scale + gap), oy = Math.floor(tile / columns) * (mode.h * scale + gap);
    for (let y = 0; y < mode.h; y++) for (let x = 0; x < mode.w; x++) {
      const value = sample(data, tile * mode.bytes, x, y);
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        const px = ox + x * scale + sx, py = oy + y * scale + sy;
        const dst = (height - 1 - py) * rowBytes + px * 3;
        pixels[dst] = value; pixels[dst + 1] = value; pixels[dst + 2] = value;
      }
    }
  }
  const header = Buffer.alloc(54); header.write('BM'); header.writeUInt32LE(54 + pixels.length, 2); header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14); header.writeInt32LE(width, 18); header.writeInt32LE(height, 22); header.writeUInt16LE(1, 26); header.writeUInt16LE(24, 28); header.writeUInt32LE(pixels.length, 34);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, Buffer.concat([header, pixels]));
  console.log(JSON.stringify({ id, mode: modeName, bytes: data.length, tiles: count, columns, rows, width, height, outputPath }));
} finally { fs.closeSync(fd); }
