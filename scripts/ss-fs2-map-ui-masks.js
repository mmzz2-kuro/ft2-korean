#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [ssBinPath, psDatPath, psExePath, outputPath, ...tsvPaths] = process.argv.slice(2);
if (!ssBinPath || !psDatPath || !psExePath || !outputPath || tsvPaths.length === 0) {
  console.error('usage: node scripts/ss-fs2-map-ui-masks.js <ss-track1.bin> <ps1-DAT> <ps1-EXE> <output.json> <ui.tsv...>');
  process.exit(1);
}

const RAW = 2352, USER = 2048, UOFF = 16, SS_EXE_LBA = 21, SS_EXE_BYTES = 319524;
const SS_DATA_LBA = 178, SS_TABLE = 0x1ae9c, SS_RESOURCE_COUNT = 4336;
const psDat = fs.readFileSync(psDatPath), psExe = fs.readFileSync(psExePath);
const psLoad = psExe.readUInt32LE(0x18), psTable = 0x801c4f68 - psLoad + 0x800;

const entries = [];
for (const tsvPath of tsvPaths) {
  const lines = fs.readFileSync(tsvPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const columns = lines.shift().split('\t');
  const column = (name) => {
    const index = columns.indexOf(name);
    if (index < 0) throw new Error(`${tsvPath}: missing column ${name}`);
    return index;
  };
  const resourceIndex = column('resource_id'), widthIndex = column('width'), rowsIndex = column('rows');
  const strideIndex = column('bytes_per_row'), offsetIndex = column('data_offset'), textIndex = column('ko_text');
  for (const line of lines) {
    const fields = line.split('\t'), psResourceId = Number(fields[resourceIndex]);
    const width = Number(fields[widthIndex]), rows = Number(fields[rowsIndex]);
    const bytesPerRow = Number(fields[strideIndex]), dataOffset = Number(fields[offsetIndex]);
    if (![psResourceId, width, rows, bytesPerRow, dataOffset].every(Number.isSafeInteger)) throw new Error(`${tsvPath}: invalid numeric row`);
    const startSector = psExe.readUInt16LE(psTable + psResourceId * 2);
    const endSector = psExe.readUInt16LE(psTable + (psResourceId + 1) * 2);
    const maskStart = startSector * USER + dataOffset, maskBytes = bytesPerRow * rows;
    if (endSector <= startSector || maskStart + maskBytes > endSector * USER) throw new Error(`PS resource ${psResourceId}: mask exceeds resource`);
    const mask = psDat.subarray(maskStart, maskStart + maskBytes);
    entries.push({
      category: path.basename(tsvPath, '.tsv'), psResourceId, width, rows, bytesPerRow, dataOffset,
      koText: fields[textIndex] || '', psDatOffset: maskStart, maskBytes,
      sha1: crypto.createHash('sha1').update(mask).digest('hex'), mask, matches: [],
    });
  }
}

const byPrefix = new Map();
for (const entry of entries) {
  const key = entry.mask.subarray(0, Math.min(32, entry.mask.length)).toString('hex');
  if (!byPrefix.has(key)) byPrefix.set(key, []);
  byPrefix.get(key).push(entry);
}

function readUser(fd, lba, bytes) {
  const out = Buffer.alloc(bytes);
  for (let pos = 0; pos < bytes;) {
    const sector = Math.floor(pos / USER), within = pos % USER, count = Math.min(USER - within, bytes - pos);
    if (fs.readSync(fd, out, pos, count, (lba + sector) * RAW + UOFF + within) !== count) return null;
    pos += count;
  }
  return out;
}

const fd = fs.openSync(ssBinPath, 'r'), totalSectors = Math.floor(fs.fstatSync(fd).size / RAW);
try {
  const exe = readUser(fd, SS_EXE_LBA, SS_EXE_BYTES), starts = new Map();
  let carry = 0, previous = exe.readUInt16BE(SS_TABLE);
  for (let id = 0; id < SS_RESOURCE_COUNT; id++) {
    const rawSector = exe.readUInt16BE(SS_TABLE + id * 2);
    if (id > 0 && rawSector < previous) carry += 0x10000;
    const lba = SS_DATA_LBA + rawSector + carry;
    if (!starts.has(lba)) starts.set(lba, []);
    starts.get(lba).push(id); previous = rawSector;
  }
  const prefix = Buffer.alloc(32);
  for (let lba = SS_DATA_LBA; lba + 1 < totalSectors; lba++) {
    if (fs.readSync(fd, prefix, 0, 32, lba * RAW + UOFF) !== 32) break;
    const candidates = byPrefix.get(prefix.toString('hex'));
    if (!candidates) continue;
    for (const entry of candidates) {
      const data = readUser(fd, lba, entry.maskBytes);
      if (data && data.equals(entry.mask)) entry.matches.push({
        lba, rawOffset: lba * RAW + UOFF, ssResourceIdsAtStart: starts.get(lba) || [],
      });
    }
  }
} finally { fs.closeSync(fd); }

const resultEntries = entries.map(({ mask, ...entry }) => entry);
const histogram = {};
for (const entry of resultEntries) histogram[entry.matches.length] = (histogram[entry.matches.length] || 0) + 1;
const output = {
  version: 1, input: { ssBinPath, psDatPath, psExePath, tsvPaths },
  totalEntries: resultEntries.length,
  translatedEntries: resultEntries.filter((entry) => entry.koText.trim()).length,
  uniqueMatches: resultEntries.filter((entry) => entry.matches.length === 1).length,
  missingMatches: resultEntries.filter((entry) => entry.matches.length === 0).length,
  ambiguousMatches: resultEntries.filter((entry) => entry.matches.length > 1).length,
  matchCountHistogram: histogram, entries: resultEntries,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(`entries=${output.totalEntries} translated=${output.translatedEntries}`);
console.log(`unique=${output.uniqueMatches} missing=${output.missingMatches} ambiguous=${output.ambiguousMatches}`);
console.log(`histogram=${JSON.stringify(histogram)}`);
console.log(`wrote ${outputPath}`);
