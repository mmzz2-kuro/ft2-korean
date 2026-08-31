#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const imagePath = process.argv[2];
const outputPath = process.argv[3] || path.join('output', 'ss-fs2-raw-font-candidates.json');
if (!imagePath) {
  console.error('usage: node scripts/ss-fs2-scan-raw-fonts.js <track1.bin> [output.json]');
  process.exit(1);
}

const RAW = 2352, USER = 2048, UOFF = 0x10, FILE0_LBA = 21, FILE1_LBA = 178;
const TABLE = 0x1ae9c, COUNT = 4335;
const MODES = [
  { name: '1bpp-8x8', bpp: 1, width: 8, height: 8, bytes: 8 },
  { name: '1bpp-8x16', bpp: 1, width: 8, height: 16, bytes: 16 },
  { name: '1bpp-16x16', bpp: 1, width: 16, height: 16, bytes: 32 },
  { name: '2bpp-8x8', bpp: 2, width: 8, height: 8, bytes: 16 },
  { name: '2bpp-16x16', bpp: 2, width: 16, height: 16, bytes: 64 },
  { name: '4bpp-8x8', bpp: 4, width: 8, height: 8, bytes: 32 },
  { name: '4bpp-16x16', bpp: 4, width: 16, height: 16, bytes: 128 },
  { name: '8bpp-8x8', bpp: 8, width: 8, height: 8, bytes: 64 },
  { name: '8bpp-8x16', bpp: 8, width: 8, height: 16, bytes: 128 }
];
const fd = fs.openSync(imagePath, 'r');

function readUser(lba, bytes) {
  const out = Buffer.alloc(bytes);
  for (let pos = 0; pos < bytes;) {
    const sector = Math.floor(pos / USER), within = pos % USER;
    const count = Math.min(USER - within, bytes - pos);
    fs.readSync(fd, out, pos, count, (lba + sector) * RAW + UOFF + within);
    pos += count;
  }
  return out;
}

function pixel(data, base, mode, x, y) {
  if (mode.bpp === 1) {
    const rowBytes = mode.width / 8;
    return (data[base + y * rowBytes + (x >>> 3)] >>> (7 - (x & 7))) & 1;
  }
  if (mode.bpp === 2) {
    const rowBytes = mode.width / 4;
    return (data[base + y * rowBytes + (x >>> 2)] >>> ((3 - (x & 3)) * 2)) & 3;
  }
  if (mode.bpp === 4) {
    const value = data[base + y * (mode.width / 2) + (x >>> 1)];
    return x & 1 ? value & 15 : value >>> 4;
  }
  return data[base + y * mode.width + x];
}

function analyze(data, mode) {
  const tileCount = Math.floor(data.length / mode.bytes);
  if (tileCount < 32 || tileCount > 32768) return null;
  const colors = new Set(), unique = new Set();
  let blank = 0, nonzero = 0, pixels = 0, edgeChanges = 0;
  for (let tile = 0; tile < tileCount; tile++) {
    const base = tile * mode.bytes;
    const bytes = data.subarray(base, base + mode.bytes);
    unique.add(bytes.toString('base64'));
    if (bytes.every((v) => v === 0)) blank++;
    for (let y = 0; y < mode.height; y++) {
      let previous = pixel(data, base, mode, 0, y);
      colors.add(previous); if (previous) nonzero++; pixels++;
      for (let x = 1; x < mode.width; x++) {
        const value = pixel(data, base, mode, x, y);
        colors.add(value); if (value) nonzero++; pixels++;
        if ((value === 0) !== (previous === 0)) edgeChanges++;
        previous = value;
      }
    }
  }
  const density = nonzero / pixels, blankRatio = blank / tileCount;
  const uniqueRatio = unique.size / tileCount, edgeRate = edgeChanges / pixels;
  let score = 0;
  if (tileCount >= 64 && tileCount <= 8192) score += 2;
  if (density >= 0.05 && density <= 0.45) score += 3;
  if (blankRatio >= 0.005 && blankRatio <= 0.45) score += 2;
  if (uniqueRatio >= 0.5) score += 1;
  if (edgeRate >= 0.08 && edgeRate <= 0.45) score += 2;
  if (mode.bpp === 4 && colors.size <= 8) score += 2;
  if (mode.bpp === 2 && colors.size <= 4) score += 2;
  if (mode.bpp === 8 && colors.size <= 32) score += 2;
  if (mode.bpp === 8 && colors.size > 96) score -= 3;
  return { mode: mode.name, tileCount, colors: colors.size, blank, blankRatio, unique: unique.size, uniqueRatio, density, edgeRate, score };
}

try {
  const exe = readUser(FILE0_LBA, 319524);
  let graphicIds = new Set();
  try {
    const catalog = JSON.parse(fs.readFileSync(path.join('output', 'ss-fs2-graphic-resource-catalog.json'), 'utf8'));
    graphicIds = new Set(catalog.resources.map((item) => item.id));
  } catch (_) {}
  const candidates = [];
  for (let id = 0; id < COUNT; id++) {
    if (graphicIds.has(id)) continue;
    const first = exe.readUInt16BE(TABLE + id * 2), last = exe.readUInt16BE(TABLE + (id + 1) * 2);
    if (last <= first) continue;
    const bytes = (last - first) * USER;
    if (bytes < 0x400 || bytes > 0x200000) continue;
    const data = readUser(FILE1_LBA + first, bytes);
    for (const mode of MODES) {
      const result = analyze(data, mode);
      if (result && result.score >= 8) candidates.push({ id, firstSector: first, bytes, ...result });
    }
  }
  candidates.sort((a, b) => b.score - a.score || b.tileCount - a.tileCount || a.id - b.id);
  const result = { imagePath, excludedGraphicResources: graphicIds.size, candidates };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`candidates=${candidates.length} output=${outputPath}`);
  for (const item of candidates.slice(0, 60)) {
    console.log(`id=${item.id} score=${item.score} ${item.mode} tiles=${item.tileCount} colors=${item.colors} blank=${item.blankRatio.toFixed(3)} density=${item.density.toFixed(3)} edge=${item.edgeRate.toFixed(3)} bytes=0x${item.bytes.toString(16)}`);
  }
} finally {
  fs.closeSync(fd);
}
