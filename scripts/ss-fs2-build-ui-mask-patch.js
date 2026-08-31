#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { recomputeMode1Sector, isMode1 } = require('./cdrom-eccedc.js');

const [inputBin, outputBin, mapPath, pbmDirectory, reportPath] = process.argv.slice(2);
if (!inputBin || !outputBin || !mapPath || !pbmDirectory || !reportPath) {
  console.error('usage: node scripts/ss-fs2-build-ui-mask-patch.js <input.bin> <output.bin> <ui-map.json> <ko-pbm-directory> <report.json>');
  process.exit(1);
}
if (path.resolve(inputBin) === path.resolve(outputBin)) throw new Error('input and output BIN must differ');

const RAW = 2352, USER = 2048, UOFF = 16;
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
if (!Array.isArray(map.entries)) throw new Error('UI map entries are missing');

function sha1(data) { return crypto.createHash('sha1').update(data).digest('hex'); }

function readUser(fd, lba, bytes) {
  const out = Buffer.alloc(bytes);
  for (let pos = 0; pos < bytes;) {
    const sector = Math.floor(pos / USER), within = pos % USER, count = Math.min(USER - within, bytes - pos);
    if (fs.readSync(fd, out, pos, count, (lba + sector) * RAW + UOFF + within) !== count) throw new Error(`short read LBA ${lba + sector}`);
    pos += count;
  }
  return out;
}

function readPbm(pbmPath, width, height) {
  const tokens = fs.readFileSync(pbmPath, 'utf8').split(/\r?\n/)
    .flatMap((line) => line.replace(/#.*/, '').trim().split(/\s+/).filter(Boolean));
  if (tokens.shift() !== 'P1' || Number(tokens.shift()) !== width || Number(tokens.shift()) !== height) {
    throw new Error(`${pbmPath} must be P1 ${width}x${height}`);
  }
  if (tokens.length < width * height) throw new Error(`${pbmPath} has too few pixels`);
  const pixels = new Uint8Array(width * height);
  for (let index = 0; index < pixels.length; index++) {
    if (tokens[index] !== '0' && tokens[index] !== '1') throw new Error(`${pbmPath}: invalid pixel ${tokens[index]}`);
    pixels[index] = tokens[index] === '1' ? 1 : 0;
  }
  return pixels;
}

function packMask(pixels, width, height, stride) {
  const packed = Buffer.alloc(stride * height, 0xff);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[y * width + x]) packed[y * stride + Math.floor(x / 8)] &= ~(1 << (7 - (x & 7)));
    }
  }
  return packed;
}

function patchLogical(fd, lba, data, touched) {
  for (let pos = 0; pos < data.length;) {
    const sectorIndex = Math.floor(pos / USER), within = pos % USER;
    const count = Math.min(USER - within, data.length - pos), targetLba = lba + sectorIndex;
    const sector = Buffer.alloc(RAW), rawOffset = targetLba * RAW;
    if (fs.readSync(fd, sector, 0, RAW, rawOffset) !== RAW || !isMode1(sector)) throw new Error(`invalid Mode 1 LBA ${targetLba}`);
    data.copy(sector, UOFF + within, pos, pos + count);
    recomputeMode1Sector(sector);
    fs.writeSync(fd, sector, 0, RAW, rawOffset);
    touched.add(targetLba); pos += count;
  }
}

const patches = [];
for (const entry of map.entries) {
  const ssResourceId = entry.psResourceId - 114;
  const match = entry.matches.find((item) => item.ssResourceIdsAtStart.includes(ssResourceId));
  if (!match) continue;
  const pbmPath = path.join(pbmDirectory, `ui-mask-${entry.psResourceId}-ko.pbm`);
  if (!fs.existsSync(pbmPath)) throw new Error(`missing Korean PBM ${pbmPath}`);
  patches.push({ entry, ssResourceId, match, pbmPath });
}
if (patches.length !== 334) throw new Error(`expected 334 safe UI patches, got ${patches.length}`);

const inputFd = fs.openSync(inputBin, 'r');
try {
  for (const patch of patches) {
    const original = readUser(inputFd, patch.match.lba, patch.entry.maskBytes);
    if (sha1(original) !== patch.entry.sha1) throw new Error(`resource PS ${patch.entry.psResourceId}/SS ${patch.ssResourceId}: input mask mismatch`);
  }
} finally { fs.closeSync(inputFd); }

fs.mkdirSync(path.dirname(outputBin), { recursive: true });
fs.copyFileSync(inputBin, outputBin);
const outputFd = fs.openSync(outputBin, 'r+'), touched = new Set(), results = [];
try {
  for (const patch of patches) {
    const pixels = readPbm(patch.pbmPath, patch.entry.width, patch.entry.rows);
    const packed = packMask(pixels, patch.entry.width, patch.entry.rows, patch.entry.bytesPerRow);
    if (packed.length !== patch.entry.maskBytes) throw new Error(`resource ${patch.entry.psResourceId}: packed size mismatch`);
    patchLogical(outputFd, patch.match.lba, packed, touched);
    const verify = readUser(outputFd, patch.match.lba, packed.length);
    if (!verify.equals(packed)) throw new Error(`resource ${patch.entry.psResourceId}: post-write mismatch`);
    results.push({
      category: patch.entry.category, psResourceId: patch.entry.psResourceId,
      ssResourceId: patch.ssResourceId, lba: patch.match.lba, bytes: packed.length,
      sourceSha1: patch.entry.sha1, koreanSha1: sha1(packed), pbm: patch.pbmPath,
    });
  }
} finally { fs.closeSync(outputFd); }

const report = {
  version: 1, inputBin, outputBin, mapPath, pbmDirectory,
  patches: results.length, touchedLbas: [...touched].sort((a, b) => a - b), results,
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`patches=${results.length} touchedLbas=${touched.size}`);
for (const category of [...new Set(results.map((item) => item.category))]) {
  console.log(`${category}=${results.filter((item) => item.category === category).length}`);
}
console.log(`wrote ${outputBin}`);
console.log(`report ${reportPath}`);
