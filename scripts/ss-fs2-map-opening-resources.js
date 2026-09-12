#!/usr/bin/env node
'use strict';

const fs = require('fs');
const crypto = require('crypto');

const [ssPath, psDatPath, psExePath, ...idArgs] = process.argv.slice(2);
if (!psExePath) {
  console.error('usage: node scripts/ss-fs2-map-opening-resources.js <ss-track1.bin> <ps1-DAT> <ps1-EXE> [ps-resource-id ...]');
  process.exit(1);
}

const IDS = idArgs.length ? idArgs.map(Number) : [255, 257, 263, 265, 268, 269, 286];
const RAW = 2352, USER = 2048, UOFF = 16;
const SS_EXE_LBA = 21, SS_EXE_BYTES = 319524, SS_DATA_LBA = 178, SS_TABLE = 0x1ae9c, SS_COUNT = 4335;

function hash(b) { return crypto.createHash('sha256').update(b).digest('hex'); }
function readUser(fd, lba, bytes) {
  const out = Buffer.alloc(bytes);
  for (let p = 0; p < bytes;) {
    const s = Math.floor(p / USER), w = p % USER, n = Math.min(USER - w, bytes - p);
    if (fs.readSync(fd, out, p, n, (lba + s) * RAW + UOFF + w) !== n) throw new Error(`short read LBA ${lba + s}`);
    p += n;
  }
  return out;
}
function boundaries(exe) {
  const out = []; let carry = 0, previous = exe.readUInt16BE(SS_TABLE);
  for (let id = 0; id <= SS_COUNT; id++) {
    const raw = exe.readUInt16BE(SS_TABLE + id * 2);
    if (id && raw < previous) carry += 0x10000;
    out.push(raw + carry); previous = raw;
  }
  return out;
}
function parse(data) {
  if (data.length < 0x10) return null;
  const wt = data.readUInt32BE(0), ht = data.readUInt32BE(4), td = data.readUInt32BE(12);
  if (wt < 1 || ht < 1 || wt > 100 || ht > 100) return null;
  const entries = wt * ht, align4 = n => (n + 3) & ~3;
  let mo = -1;
  if (align4(0x210 + entries * 2) === td) mo = 0x210;
  else if (align4(0x10 + entries * 2) === td) mo = 0x10;
  if (mo < 0 || td > data.length) return null;
  const cap = Math.floor((data.length - td) / 64), map = [];
  if (cap < 1) return null;
  for (let i = 0; i < entries; i++) {
    const ti = data.readUInt16BE(mo + i * 2) >> 1;
    if (ti >= cap) return null;
    map.push(ti);
  }
  const width = wt * 8, height = ht * 8, pix = Buffer.alloc(width * height);
  for (let ty = 0; ty < ht; ty++) for (let tx = 0; tx < wt; tx++) {
    const ti = map[ty * wt + tx];
    for (let y = 0; y < 8; y++) data.copy(pix, (ty * 8 + y) * width + tx * 8, td + ti * 64 + y * 8, td + ti * 64 + y * 8 + 8);
  }
  return { width, height, pix, pixelHash: hash(pix) };
}

const psDat = fs.readFileSync(psDatPath), psExe = fs.readFileSync(psExePath);
const psLoad = psExe.readUInt32LE(0x18), psTable = 0x801c4f68 - psLoad + 0x800;
const targets = IDS.map(id => {
  const start = psExe.readUInt16LE(psTable + id * 2) * USER;
  const end = psExe.readUInt16LE(psTable + (id + 1) * 2) * USER;
  const info = parse(psDat.subarray(start, end));
  if (!info) throw new Error(`PS1 resource ${id} is not a supported BE-HDR image`);
  return { id, ...info, matches: [] };
});

const fd = fs.openSync(ssPath, 'r');
try {
  const exe = readUser(fd, SS_EXE_LBA, SS_EXE_BYTES), starts = boundaries(exe);
  for (let id = 0; id < SS_COUNT; id++) {
    const sectors = starts[id + 1] - starts[id];
    if (sectors <= 0 || sectors > 1000) continue;
    const head = readUser(fd, SS_DATA_LBA + starts[id], Math.min(USER, sectors * USER));
    if (head.length < 16) continue;
    const wt = head.readUInt32BE(0), ht = head.readUInt32BE(4);
    const candidates = targets.filter(t => t.width === wt * 8 && t.height === ht * 8);
    if (!candidates.length) continue;
    const info = parse(readUser(fd, SS_DATA_LBA + starts[id], sectors * USER));
    if (!info) continue;
    for (const target of candidates) if (target.pixelHash === info.pixelHash) target.matches.push({ ssResourceId: id, lba: SS_DATA_LBA + starts[id], sectors });
  }
} finally { fs.closeSync(fd); }

for (const t of targets) console.log(JSON.stringify({ psResourceId: t.id, width: t.width, height: t.height, pixelHash: t.pixelHash, matches: t.matches }));
