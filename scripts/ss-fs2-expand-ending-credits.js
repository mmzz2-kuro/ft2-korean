#!/usr/bin/env node
'use strict';

// Losslessly expand ending-credit resources into the six-sector gap between
// the normal-resource archive and the first zero separator.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { recomputeMode1Sector, isMode1 } = require('./cdrom-eccedc.js');

const RAW = 2352, USER = 2048, UOFF = 16;
const EXE_LBA = 21, EXE_BYTES = 319524, DATA_LBA = 178;
const TABLE = 0x1ae9c, NORMAL_END_INDEX = 4335, ZERO_START_INDEX = 4336;
const EXTRA = new Map([[14, 2], [18, 1], [20, 1], [21, 2]]);
const REQUIRED = new Set([14, 15, 16, 18, 19, 20, 21]);

function usage() {
  console.error('usage: node scripts/ss-fs2-expand-ending-credits.js <input.bin> <output.bin> <manifest.json> <report.json>');
  process.exit(1);
}
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}
function readUser(fd, lba, bytes) {
  const out = Buffer.alloc(bytes);
  for (let p = 0; p < bytes;) {
    const sector = Math.floor(p / USER), within = p % USER, take = Math.min(USER - within, bytes - p);
    if (fs.readSync(fd, out, p, take, (lba + sector) * RAW + UOFF + within) !== take)
      throw new Error(`short read at LBA ${lba + sector}`);
    p += take;
  }
  return out;
}
function writeUser(fd, lba, data, touched) {
  for (let p = 0; p < data.length; p += USER) {
    const target = lba + p / USER, off = target * RAW, sector = Buffer.alloc(RAW);
    if (fs.readSync(fd, sector, 0, RAW, off) !== RAW || !isMode1(sector))
      throw new Error(`invalid Mode 1 sector at LBA ${target}`);
    data.copy(sector, UOFF, p, p + USER);
    recomputeMode1Sector(sector);
    fs.writeSync(fd, sector, 0, RAW, off);
    touched.add(target);
  }
}
function readPgm(file) {
  const tokens = fs.readFileSync(file, 'utf8').replace(/#[^\r\n]*/g, ' ').trim().split(/\s+/);
  if (tokens.shift() !== 'P2') throw new Error(`${file}: expected P2 PGM`);
  const width = +tokens.shift(), height = +tokens.shift(), maximum = +tokens.shift();
  const pixels = Buffer.from(tokens.map(Number));
  if (maximum !== 255 || pixels.length !== width * height) throw new Error(`${file}: invalid PGM`);
  return { width, height, pixels };
}
function parse(data) {
  const wt = data.readUInt32BE(0), ht = data.readUInt32BE(4), td = data.readUInt32BE(12);
  const entries = wt * ht, mapBytes = entries * 2, align4 = n => (n + 3) & ~3;
  let mo = -1;
  if (align4(0x210 + mapBytes) === td) mo = 0x210;
  else if (align4(0x10 + mapBytes) === td) mo = 0x10;
  if (wt < 1 || ht < 1 || mo < 0x10 || td > data.length) throw new Error('invalid BE-HDR resource');
  const map = [];
  for (let i = 0; i < entries; i++) map.push(data.readUInt16BE(mo + i * 2));
  return { wt, ht, td, mo, width: wt * 8, height: ht * 8, map, capacity: Math.floor((data.length - td) / 64) };
}
function tileAt(pixels, width, tx, ty) {
  const tile = Buffer.alloc(64);
  for (let y = 0; y < 8; y++)
    pixels.copy(tile, y * 8, (ty * 8 + y) * width + tx * 8, (ty * 8 + y) * width + tx * 8 + 8);
  return tile;
}
function pack(original, allocationBytes, pgm, id) {
  const info = parse(original);
  if (pgm.width !== info.width || pgm.height !== info.height)
    throw new Error(`resource ${id}: PGM is ${pgm.width}x${pgm.height}, expected ${info.width}x${info.height}`);
  const out = Buffer.alloc(allocationBytes);
  original.copy(out, 0, 0, Math.min(original.length, out.length));
  const tiles = [], byKey = new Map(), cells = [];
  for (let ty = 0; ty < info.ht; ty++) for (let tx = 0; tx < info.wt; tx++) {
    const tile = tileAt(pgm.pixels, info.width, tx, ty), key = tile.toString('latin1');
    let index = byKey.get(key);
    if (index === undefined) { index = tiles.length; tiles.push(tile); byKey.set(key, index); }
    cells.push(index);
  }
  const capacity = Math.floor((allocationBytes - info.td) / 64);
  if (tiles.length > capacity) throw new Error(`resource ${id}: needs ${tiles.length} tiles, expanded capacity is ${capacity}`);
  out.writeUInt32BE(0x10 + tiles.length * 64, 8);
  for (let i = 0; i < cells.length; i++) out.writeUInt16BE((cells[i] << 1) | (info.map[i] & 1), info.mo + i * 2);
  out.fill(0, info.td);
  for (let i = 0; i < tiles.length; i++) tiles[i].copy(out, info.td + i * 64);
  return { data: out, uniqueTiles: tiles.length, capacity };
}
function main() {
  const [input, output, manifestFile, reportFile] = process.argv.slice(2);
  if (!reportFile) usage();
  if (path.resolve(input) === path.resolve(output)) throw new Error('input and output must differ');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const edits = new Map(manifest.items.map(item => [Number(item.id), item.pgm]));
  for (const id of REQUIRED) if (!edits.has(id)) throw new Error(`manifest is missing resource ${id}`);

  const inFd = fs.openSync(input, 'r');
  const exe = readUser(inFd, EXE_LBA, EXE_BYTES);
  const starts = [];
  for (let i = 0; i <= ZERO_START_INDEX; i++) starts.push(exe.readUInt16BE(TABLE + i * 2));
  const oldEnd = starts[NORMAL_END_INDEX], zeroStart = starts[ZERO_START_INDEX];
  const totalExtra = [...EXTRA.values()].reduce((a, b) => a + b, 0);
  if (zeroStart - oldEnd !== totalExtra)
    throw new Error(`expected a ${totalExtra}-sector gap, found ${zeroStart - oldEnd}`);

  const newStarts = starts.slice();
  let shift = 0;
  for (let id = 0; id < NORMAL_END_INDEX; id++) {
    newStarts[id] = starts[id] + shift;
    shift += EXTRA.get(id) || 0;
  }
  newStarts[NORMAL_END_INDEX] = starts[NORMAL_END_INDEX] + shift;
  if (newStarts[NORMAL_END_INDEX] !== zeroStart) throw new Error('expanded archive does not end at zero separator');

  fs.copyFileSync(input, output);
  const outFd = fs.openSync(output, 'r+'), touched = new Set(), itemReports = [];
  try {
    for (let id = 14; id < NORMAL_END_INDEX; id++) {
      const originalBytes = (starts[id + 1] - starts[id]) * USER;
      const allocationBytes = originalBytes + (EXTRA.get(id) || 0) * USER;
      const original = readUser(inFd, DATA_LBA + starts[id], originalBytes);
      let data = Buffer.alloc(allocationBytes);
      original.copy(data);
      if (edits.has(id)) {
        const packed = pack(original, allocationBytes, readPgm(edits.get(id)), id);
        data = packed.data;
        itemReports.push({ id, oldSectors: originalBytes / USER, newSectors: allocationBytes / USER,
          uniqueTiles: packed.uniqueTiles, capacity: packed.capacity });
      }
      writeUser(outFd, DATA_LBA + newStarts[id], data, touched);
    }
    for (let i = 15; i <= NORMAL_END_INDEX; i++) exe.writeUInt16BE(newStarts[i], TABLE + i * 2);
    writeUser(outFd, EXE_LBA, exe, touched);
  } finally {
    fs.closeSync(outFd);
    fs.closeSync(inFd);
  }
  const report = { version: 1, inputBin: path.resolve(input), outputBin: path.resolve(output),
    inputSha256: sha256(input), outputSha256: sha256(output), oldNormalEnd: oldEnd,
    newNormalEnd: newStarts[NORMAL_END_INDEX], zeroSeparatorStart: zeroStart,
    consumedGapSectors: totalExtra, touchedSectors: touched.size, items: itemReports };
  fs.mkdirSync(path.dirname(path.resolve(reportFile)), { recursive: true });
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`wrote ${output}`);
  console.log(`normal archive end ${oldEnd} -> ${newStarts[NORMAL_END_INDEX]}; consumed ${totalExtra} sectors`);
  console.log(`touched sectors ${touched.size}`);
  console.log(`report ${reportFile}`);
}
try { main(); } catch (error) { console.error(error.stack || String(error)); process.exit(1); }
