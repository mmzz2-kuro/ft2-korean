#!/usr/bin/env node

'use strict';

const fs = require('fs');
const crypto = require('crypto');

const [ssBinPath, psDatPath, tsvPath, outputPath] = process.argv.slice(2);
if (!ssBinPath || !psDatPath || !tsvPath || !outputPath) {
  console.error('usage: node scripts/ss-fs2-map-finale.js <ss-track1.bin> <ps1-FS2_FILE.DAT> <dialogue-translation.tsv> <output.json>');
  process.exit(1);
}

const RAW = 2352, USER = 2048, UOFF = 16, MASK_BYTES = 0x930;
const EXE_LBA = 21, EXE_BYTES = 319524, BASE = 0x06010000;
const RESOURCE_TABLE = 0x1ae9c, ZERO_INDEX = 4336, GROUP_TABLE = 0x0602e5ac;
const SLOT_COUNTS = [196, 292, 179, 166, 209, 155, 117, 148, 116, 125, 133, 130, 104, 26, 236, 108, 220];
const psDat = fs.readFileSync(psDatPath);
const lines = fs.readFileSync(tsvPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
const columns = lines.shift().split('\t');
const addressIndex = columns.indexOf('address'), kindIndex = columns.indexOf('kind');
const textIndex = columns.indexOf('ko_text'), idIndex = columns.indexOf('message_id');
if ([addressIndex, kindIndex, textIndex, idIndex].some((index) => index < 0)) throw new Error('required TSV columns are missing');

const entries = [];
for (const line of lines) {
  const fields = line.split('\t');
  if (fields[kindIndex] !== 'finale') continue;
  const addressText = fields[addressIndex];
  const address = Number.parseInt(addressText, 0);
  if (!Number.isSafeInteger(address) || address < 0 || address + MASK_BYTES > psDat.length) {
    throw new Error(`invalid finale address ${addressText}`);
  }
  const mask = psDat.subarray(address, address + MASK_BYTES);
  entries.push({
    messageId: fields[idIndex], address: addressText, psDatOffset: address,
    koText: fields[textIndex] || '', mask,
    sha1: crypto.createHash('sha1').update(mask).digest('hex'), matches: [],
  });
}

const byPrefix = new Map();
for (const entry of entries) {
  const prefix = entry.mask.subarray(0, 32).toString('hex');
  if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
  byPrefix.get(prefix).push(entry);
}

function readUser(fd, lba, bytes) {
  const out = Buffer.alloc(bytes);
  for (let pos = 0; pos < bytes;) {
    const sector = Math.floor(pos / USER), within = pos % USER;
    const count = Math.min(USER - within, bytes - pos);
    if (fs.readSync(fd, out, pos, count, (lba + sector) * RAW + UOFF + within) !== count) return null;
    pos += count;
  }
  return out;
}

const fd = fs.openSync(ssBinPath, 'r');
const totalSectors = Math.floor(fs.fstatSync(fd).size / RAW);
const prefixBuffer = Buffer.alloc(32);
try {
  const exe = readUser(fd, EXE_LBA, EXE_BYTES);
  let previous = exe.readUInt16BE(RESOURCE_TABLE + (ZERO_INDEX - 1) * 2), carry = 0;
  const bases = [], messageStarts = new Map();
  for (let group = 0; group < 17; group++) {
    const start = exe.readUInt16BE(RESOURCE_TABLE + (ZERO_INDEX + group * 2) * 2);
    const end = exe.readUInt16BE(RESOURCE_TABLE + (ZERO_INDEX + group * 2 + 1) * 2);
    if (start < previous) carry += 0x10000;
    if (end < start) carry += 0x10000;
    bases.push(end + carry); previous = end;
  }
  for (let group = 0; group < 17; group++) {
    const table = exe.readUInt32BE(GROUP_TABLE - BASE + group * 4) - BASE;
    for (let index = 0; index < SLOT_COUNTS[group]; index++) {
      const lba = 178 + bases[group] + exe.readUInt16BE(table + index * 2);
      const id = 1001 + group * 1000 + index;
      if (!messageStarts.has(lba)) messageStarts.set(lba, []);
      messageStarts.get(lba).push(id);
    }
  }
  for (let lba = 0; lba + 1 < totalSectors; lba++) {
    if (fs.readSync(fd, prefixBuffer, 0, 32, lba * RAW + UOFF) !== 32) break;
    const candidates = byPrefix.get(prefixBuffer.toString('hex'));
    if (!candidates) continue;
    const ssMask = readUser(fd, lba, MASK_BYTES);
    for (const entry of candidates) {
      if (ssMask.equals(entry.mask)) entry.matches.push({
        lba, rawOffset: lba * RAW + UOFF, messageIdsAtStart: messageStarts.get(lba) || [],
      });
    }
  }
} finally {
  fs.closeSync(fd);
}

const resultEntries = entries.map(({ mask, ...entry }) => entry);
const histogram = {};
for (const entry of resultEntries) histogram[entry.matches.length] = (histogram[entry.matches.length] || 0) + 1;
const translated = resultEntries.filter((entry) => entry.koText.trim()).length;
const unique = resultEntries.filter((entry) => entry.matches.length === 1).length;
const missing = resultEntries.filter((entry) => entry.matches.length === 0).length;
const ambiguous = resultEntries.filter((entry) => entry.matches.length > 1).length;
const output = {
  version: 1,
  input: { ssBinPath, psDatPath, tsvPath },
  maskBytes: MASK_BYTES,
  totalEntries: resultEntries.length,
  translatedEntries: translated,
  uniqueMatches: unique,
  missingMatches: missing,
  ambiguousMatches: ambiguous,
  matchCountHistogram: histogram,
  entries: resultEntries,
};
fs.mkdirSync(require('path').dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(`entries=${resultEntries.length} translated=${translated}`);
console.log(`unique=${unique} missing=${missing} ambiguous=${ambiguous}`);
console.log(`histogram=${JSON.stringify(histogram)}`);
console.log(`wrote ${outputPath}`);
