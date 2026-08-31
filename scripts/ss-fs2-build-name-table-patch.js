#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { recomputeMode1Sector, isMode1 } = require('./cdrom-eccedc.js');

const [inputBin, outputBin, psOriginalDatPath, psPatchedDatPath, psExePath, tsvPath, reportPath] = process.argv.slice(2);
if (!inputBin || !outputBin || !psOriginalDatPath || !psPatchedDatPath || !psExePath || !tsvPath || !reportPath) {
  console.error('usage: node scripts/ss-fs2-build-name-table-patch.js <input.bin> <output.bin> <original.dat> <patched.dat> <ps-exe> <name-table.tsv> <report.json>');
  process.exit(1);
}
if (path.resolve(inputBin) === path.resolve(outputBin)) throw new Error('input and output BIN must differ');

const RAW = 2352, USER = 2048, UOFF = 16, SS_EXE_LBA = 21, SS_EXE_BYTES = 319524;
const SS_DATA_LBA = 178, SS_TABLE = 0x1ae9c;
const TABLES = {
  char: { resource: 829, ssResource: 715, offset: 0x55d0, size: 160, idDelta: -1 },
  mon: { resource: 829, ssResource: 715, offset: 0x6950, size: 224, idDelta: 0 },
  status: { resource: 829, ssResource: 715, offset: 0xaaf0, size: 64, idDelta: 0 },
  item: { resource: 829, ssResource: 715, offset: 0xadf0, size: 240, idDelta: 0 },
  magic: { resource: 829, ssResource: 715, offset: 0x13a0, size: 240, idDelta: 0 },
  equip_char: { resource: 829, ssResource: 715, offset: 0x0ce0, size: 144, idDelta: 0 },
  levelup_char: { resource: 829, ssResource: 715, offset: 0x4fa0, size: 176, idDelta: 0 },
  equip_stat: { resource: 829, ssResource: 715, offset: 0x06e0, size: 128, idDelta: 0 },
  stage_name: { resource: 1169, ssResource: 1055, offset: 0x4870, size: 304, idDelta: 0 },
};

const psOriginal = fs.readFileSync(psOriginalDatPath), psPatched = fs.readFileSync(psPatchedDatPath), psExe = fs.readFileSync(psExePath);
if (psOriginal.length !== psPatched.length) throw new Error('PS DAT sizes differ');
const psLoad = psExe.readUInt32LE(0x18), psTable = 0x801c4f68 - psLoad + 0x800;

function readUser(fd, lba, bytes) {
  const out = Buffer.alloc(bytes);
  for (let pos = 0; pos < bytes;) {
    const sector = Math.floor(pos / USER), within = pos % USER, count = Math.min(USER - within, bytes - pos);
    if (fs.readSync(fd, out, pos, count, (lba + sector) * RAW + UOFF + within) !== count) throw new Error(`short read LBA ${lba + sector}`);
    pos += count;
  }
  return out;
}

function patchLogical(fd, baseLba, logicalOffset, data, touched) {
  for (let pos = 0; pos < data.length;) {
    const absolute = logicalOffset + pos, sectorIndex = Math.floor(absolute / USER), within = absolute % USER;
    const count = Math.min(USER - within, data.length - pos), lba = baseLba + sectorIndex;
    const sector = Buffer.alloc(RAW), rawOffset = lba * RAW;
    if (fs.readSync(fd, sector, 0, RAW, rawOffset) !== RAW || !isMode1(sector)) throw new Error(`invalid Mode 1 LBA ${lba}`);
    data.copy(sector, UOFF + within, pos, pos + count); recomputeMode1Sector(sector);
    fs.writeSync(fd, sector, 0, RAW, rawOffset); touched.add(lba); pos += count;
  }
}

const inputFd = fs.openSync(inputBin, 'r'), ssExe = readUser(inputFd, SS_EXE_LBA, SS_EXE_BYTES);
let carry = 0, previous = ssExe.readUInt16BE(SS_TABLE); const ssStarts = [];
for (let id = 0; id <= 1056; id++) {
  const value = ssExe.readUInt16BE(SS_TABLE + id * 2);
  if (id && value < previous) carry += 0x10000;
  ssStarts[id] = value + carry; previous = value;
}
for (const [psId, ssId] of [[829, 715], [1169, 1055]]) {
  const psStart = psExe.readUInt16LE(psTable + psId * 2) * USER;
  const psEnd = psExe.readUInt16LE(psTable + (psId + 1) * 2) * USER;
  const ssData = readUser(inputFd, SS_DATA_LBA + ssStarts[ssId], (ssStarts[ssId + 1] - ssStarts[ssId]) * USER);
  if (!ssData.equals(psOriginal.subarray(psStart, psEnd))) throw new Error(`PS ${psId}/SS ${ssId} original resource mismatch`);
}
fs.closeSync(inputFd);

const lines = fs.readFileSync(tsvPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
const columns = lines.shift().split('\t'), enabledAt = columns.indexOf('enabled'), tableAt = columns.indexOf('table'), idAt = columns.indexOf('id');
if ([enabledAt, tableAt, idAt].some((index) => index < 0)) throw new Error('TSV columns are missing');
const patches = [];
for (const line of lines) {
  const fields = line.split('\t');
  if (fields[enabledAt] !== '1') continue;
  const table = fields[tableAt], id = Number(fields[idAt]), cfg = TABLES[table];
  if (!cfg || !Number.isInteger(id)) throw new Error(`invalid table row ${table}/${fields[idAt]}`);
  const psResourceStart = psExe.readUInt16LE(psTable + cfg.resource * 2) * USER;
  const resourceOffset = cfg.offset + (id + cfg.idDelta) * cfg.size;
  const original = psOriginal.subarray(psResourceStart + resourceOffset, psResourceStart + resourceOffset + cfg.size);
  const korean = psPatched.subarray(psResourceStart + resourceOffset, psResourceStart + resourceOffset + cfg.size);
  patches.push({ table, id, cfg, resourceOffset, original, korean });
}
if (patches.length !== 420) throw new Error(`expected 420 enabled rows, got ${patches.length}`);

fs.copyFileSync(inputBin, outputBin);
const outputFd = fs.openSync(outputBin, 'r+'), touched = new Set(), results = [];
try {
  for (const patch of patches) {
    const lba = SS_DATA_LBA + ssStarts[patch.cfg.ssResource];
    patchLogical(outputFd, lba, patch.resourceOffset, patch.korean, touched);
    const verify = readUser(outputFd, lba + Math.floor(patch.resourceOffset / USER),
      patch.resourceOffset % USER + patch.korean.length).subarray(patch.resourceOffset % USER);
    if (!verify.equals(patch.korean)) throw new Error(`${patch.table}/${patch.id}: post-write mismatch`);
    results.push({ table: patch.table, id: patch.id, ssResourceId: patch.cfg.ssResource,
      resourceOffset: patch.resourceOffset, bytes: patch.korean.length,
      changedBytes: patch.original.reduce((n, value, index) => n + (value !== patch.korean[index] ? 1 : 0), 0),
      koreanSha1: crypto.createHash('sha1').update(patch.korean).digest('hex') });
  }
} finally { fs.closeSync(outputFd); }

const report = { version: 1, inputBin, outputBin, patches: results.length,
  changedEntries: results.filter((item) => item.changedBytes > 0).length,
  touchedLbas: [...touched].sort((a, b) => a - b), results };
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`patches=${report.patches} changedEntries=${report.changedEntries} touchedLbas=${report.touchedLbas.length}`);
for (const table of Object.keys(TABLES)) console.log(`${table}=${results.filter((item) => item.table === table).length}`);
console.log(`wrote ${outputBin}`);
console.log(`report ${reportPath}`);
