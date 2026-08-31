#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const imagePath = process.argv[2];
const outputPath = process.argv[3] || path.join('output', 'ss-fs2-structured-resource-catalog.json');
if (!imagePath) {
  console.error('usage: node scripts/ss-fs2-scan-structured-resources.js <track1.bin> [output.json]');
  process.exit(1);
}

const RAW = 2352, USER = 2048, USER_OFFSET = 0x10;
const EXE_LBA = 21, DATA_LBA = 178, EXE_BYTES = 319524;
const TABLE_OFFSET = 0x1ae9c, RESOURCE_COUNT = 4335;
const fd = fs.openSync(imagePath, 'r');

function readUser(lba, bytes) {
  const out = Buffer.alloc(bytes);
  for (let pos = 0; pos < bytes;) {
    const sector = Math.floor(pos / USER), within = pos % USER;
    const count = Math.min(USER - within, bytes - pos);
    const got = fs.readSync(fd, out, pos, count, (lba + sector) * RAW + USER_OFFSET + within);
    if (got !== count) throw new Error(`short read at LBA ${lba + sector}`);
    pos += count;
  }
  return out;
}

function entropy(data) {
  const counts = new Uint32Array(256);
  for (const value of data) counts[value]++;
  let result = 0;
  for (const count of counts) if (count) {
    const p = count / data.length;
    result -= p * Math.log2(p);
  }
  return result;
}

function ascendingTable(data, width) {
  const read = width === 2 ? Buffer.prototype.readUInt16BE : Buffer.prototype.readUInt32BE;
  const first = read.call(data, 0);
  if (first === 0 || first > data.length || first % width) return null;
  const entryCount = first / width;
  if (entryCount < 2 || entryCount > 2048 || first + width > data.length) return null;
  let previous = first;
  for (let i = 1; i < entryCount; i++) {
    const value = read.call(data, i * width);
    if (value < previous || value > data.length) return null;
    previous = value;
  }
  return { width, entryCount, firstOffset: first, lastOffset: previous };
}

function sparsePointerTable(data) {
  const entryCount = 192;
  if (data.length < entryCount * 2) return null;
  let nonzeroEntries = 0, validEntries = 0, evenEntries = 0;
  let firstDataOffset = 0xffff;
  for (let i = 0; i < entryCount; i++) {
    const value = data.readUInt16BE(i * 2);
    if (value === 0) continue;
    nonzeroEntries++;
    if (value >= entryCount * 2 && value < data.length) validEntries++;
    if ((value & 1) === 0) evenEntries++;
    if (value < firstDataOffset) firstDataOffset = value;
  }
  if (nonzeroEntries < 2 || validEntries / nonzeroEntries < 0.95 || evenEntries / nonzeroEntries < 0.95) return null;
  return { firstDataOffset, entryCount, nonzeroEntries };
}

function lowCardinalityWords(data) {
  const count = Math.min(1024, Math.floor(data.length / 2));
  const values = new Set();
  let small = 0, zero = 0;
  for (let i = 0; i < count; i++) {
    const value = data.readUInt16BE(i * 2);
    values.add(value);
    if (value <= 0xff) small++;
    if (value === 0) zero++;
  }
  return { sampleWords: count, uniqueWords: values.size, smallWordRatio: small / count, zeroWordRatio: zero / count };
}

function periodicity(data) {
  const sample = data.subarray(0, Math.min(data.length, 0x8000));
  let best = null;
  for (const stride of [4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128]) {
    if (sample.length < stride * 8) continue;
    let equal = 0, total = 0;
    for (let i = stride; i < sample.length; i++) {
      if (sample[i] === sample[i - stride]) equal++;
      total++;
    }
    const ratio = equal / total;
    if (!best || ratio > best.ratio) best = { stride, ratio };
  }
  return best;
}

function isGraphic(data) {
  if (data.length < 0x210) return false;
  const width = data.readUInt32BE(0), height = data.readUInt32BE(4);
  const payloadBytes = data.readUInt32BE(8), payloadOffset = data.readUInt32BE(12);
  if (width < 1 || height < 1 || width > 512 || height > 512) return false;
  const end = 0x210 + width * height * 2;
  if (payloadOffset !== end && payloadOffset !== ((end + 3) & ~3)) return false;
  return payloadBytes >= 16 && payloadOffset + payloadBytes <= data.length && (payloadBytes - 16) % 64 === 0;
}

try {
  const exe = readUser(EXE_LBA, EXE_BYTES);
  const resources = [];
  for (let id = 0; id < RESOURCE_COUNT; id++) {
    const firstSector = exe.readUInt16BE(TABLE_OFFSET + id * 2);
    const lastSector = exe.readUInt16BE(TABLE_OFFSET + (id + 1) * 2);
    const allocated = (lastSector - firstSector) * USER;
    if (allocated <= 0 || allocated > 0x400000) continue;
    const data = readUser(DATA_LBA + firstSector, allocated);
    if (isGraphic(data)) continue;
    const bytes = new Uint32Array(256);
    for (const value of data) bytes[value]++;
    let nonZeroEnd = data.length;
    while (nonZeroEnd > 0 && data[nonZeroEnd - 1] === 0) nonZeroEnd--;
    const active = data.subarray(0, Math.max(1, nonZeroEnd));
    const be16Table = active.length >= 4 ? ascendingTable(active, 2) : null;
    const be32Table = active.length >= 8 ? ascendingTable(active, 4) : null;
    const sparsePointers = sparsePointerTable(active);
    const words = lowCardinalityWords(active);
    const repeat = periodicity(active);
    let score = 0;
    if (be16Table) score += 6;
    if (be32Table) score += 8;
    if (sparsePointers) score += 10;
    if (words.smallWordRatio > 0.75 && words.zeroWordRatio < 0.8) score += 2;
    if (words.uniqueWords >= 8 && words.uniqueWords <= 128) score += 2;
    if (repeat && repeat.ratio > 0.45) score += 2;
    if (active.length >= 0x100 && active.length <= 0x20000) score += 1;
    const ent = entropy(active);
    if (ent >= 2.0 && ent <= 6.5) score += 1;
    resources.push({
      id, firstSector, lastSector, allocated, activeBytes: nonZeroEnd,
      trailingZeroBytes: allocated - nonZeroEnd, entropy: ent,
      zeroByteRatio: bytes[0] / allocated, be16Table, be32Table,
      sparsePointers,
      ...words, periodicity: repeat, score,
      head: data.subarray(0, 32).toString('hex')
    });
  }
  resources.sort((a, b) => b.score - a.score || (b.be32Table !== null) - (a.be32Table !== null) || a.id - b.id);
  const result = { imagePath, resourceCount: RESOURCE_COUNT, nonGraphicCount: resources.length, resources };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`nonGraphicResources=${resources.length} output=${outputPath}`);
  for (const item of resources.slice(0, 80)) {
    const table = item.sparsePointers ? `ptr16[${item.sparsePointers.nonzeroEntries}/${item.sparsePointers.entryCount}]` : item.be32Table ? `be32[${item.be32Table.entryCount}]` : item.be16Table ? `be16[${item.be16Table.entryCount}]` : '-';
    console.log(`id=${item.id} score=${item.score} bytes=0x${item.allocated.toString(16)} active=0x${item.activeBytes.toString(16)} H=${item.entropy.toFixed(2)} table=${table} words=${item.uniqueWords}/${item.sampleWords} small=${item.smallWordRatio.toFixed(2)} period=${item.periodicity.stride}:${item.periodicity.ratio.toFixed(2)} head=${item.head}`);
  }
} finally {
  fs.closeSync(fd);
}
