#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const imagePath = process.argv[2];
const outputPath = process.argv[3] || path.join('output', 'ss-fs2-graphic-resource-catalog.json');
if (!imagePath) {
  console.error('usage: node scripts/ss-fs2-scan-graphic-resources.js <track1.bin> [output.json]');
  process.exit(1);
}

const RAW = 2352, USER = 2048, USER_OFFSET = 0x10;
const FILE0_LBA = 21, FILE1_LBA = 178, TABLE_OFFSET = 0x1ae9c, RESOURCE_COUNT = 4335;
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

function inspect(id, first, last) {
  const allocated = (last - first) * USER;
  if (allocated < 0x210 || allocated > 0x400000) return null;
  const data = readUser(FILE1_LBA + first, allocated);
  const width = data.readUInt32BE(0), height = data.readUInt32BE(4);
  const payloadBytes = data.readUInt32BE(8), payloadOffset = data.readUInt32BE(12);
  if (width < 1 || height < 1 || width > 512 || height > 512) return null;
  const entries = width * height;
  const layoutEnd = 0x210 + entries * 2;
  const aligned = (layoutEnd + 3) & ~3;
  if (payloadOffset !== layoutEnd && payloadOffset !== aligned) return null;
  if (payloadBytes < 16 || payloadOffset + payloadBytes > allocated) return null;
  const patternBytes = payloadBytes - 16;
  if (patternBytes % 64 !== 0) return null;
  const patternCount = patternBytes / 64;
  if (patternCount < 1 || patternCount > 65536) return null;

  const values = new Set();
  let odd = 0, outOfRange = 0, max = 0;
  for (let i = 0; i < entries; i++) {
    const value = data.readUInt16BE(0x210 + i * 2);
    values.add(value);
    if (value & 1) odd += 1;
    if (value > max) max = value;
    if (value * 32 + 64 > patternBytes) outOfRange += 1;
  }
  if (odd || outOfRange) return null;
  const uniqueTiles = values.size;
  const reuseRatio = 1 - uniqueTiles / entries;
  const usedPatternRatio = uniqueTiles / patternCount;
  const pixelArea = width * 8 * height * 8;
  let fontScore = 0;
  if (height <= 16) fontScore += 2;
  if (width >= 8 && width <= 64) fontScore += 1;
  if (reuseRatio >= 0.25) fontScore += 2;
  if (patternCount >= 64 && patternCount <= 512) fontScore += 2;
  if (width % 16 === 0 || width % 10 === 0) fontScore += 1;
  if (pixelArea <= 512 * 256) fontScore += 1;

  return {
    id, firstSector: first, lastSector: last, allocated,
    width, height, pixelWidth: width * 8, pixelHeight: height * 8,
    payloadOffset, payloadBytes, patternCount, maxCharacterNumber: max,
    entries, uniqueTiles, reuseRatio, usedPatternRatio,
    paddingBytes: allocated - payloadOffset - payloadBytes,
    fontScore
  };
}

try {
  const exe = readUser(FILE0_LBA, 319524);
  const resources = [];
  for (let id = 0; id < RESOURCE_COUNT; id++) {
    const first = exe.readUInt16BE(TABLE_OFFSET + id * 2);
    const last = exe.readUInt16BE(TABLE_OFFSET + (id + 1) * 2);
    if (last > first) {
      const result = inspect(id, first, last);
      if (result) resources.push(result);
    }
  }
  resources.sort((a, b) => b.fontScore - a.fontScore || b.reuseRatio - a.reuseRatio || a.id - b.id);
  const result = { imagePath, resourceCount: RESOURCE_COUNT, graphicResourceCount: resources.length, resources };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`graphicResources=${resources.length} output=${outputPath}`);
  console.log('top candidates:');
  for (const item of resources.slice(0, 40)) {
    console.log(`id=${item.id} score=${item.fontScore} ${item.width}x${item.height} patterns=${item.patternCount} unique=${item.uniqueTiles}/${item.entries} reuse=${item.reuseRatio.toFixed(3)} bytes=0x${item.allocated.toString(16)}`);
  }
} finally {
  fs.closeSync(fd);
}
