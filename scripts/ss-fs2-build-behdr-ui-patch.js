#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { recomputeMode1Sector, isMode1 } = require('./cdrom-eccedc.js');

const [inputBin, outputBin, psOriginalDatPath, psPatchedDatPath, psExePath, mapPath, reportPath] = process.argv.slice(2);
if (!reportPath) {
  console.error('usage: node scripts/ss-fs2-build-behdr-ui-patch.js <input.bin> <output.bin> <ps-original.dat> <ps-patched.dat> <ps-exe> <map.json> <report.json>');
  process.exit(1);
}
if (path.resolve(inputBin) === path.resolve(outputBin)) throw new Error('input and output BIN must differ');

const RAW = 2352, USER = 2048, UOFF = 16;
const SS_EXE_LBA = 21, SS_EXE_BYTES = 319524, SS_DATA_LBA = 178, SS_TABLE = 0x1ae9c;
const psOriginal = fs.readFileSync(psOriginalDatPath), psPatched = fs.readFileSync(psPatchedDatPath);
const psExe = fs.readFileSync(psExePath), map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
if (psOriginal.length !== psPatched.length) throw new Error('PS DAT sizes differ');
const psLoad = psExe.readUInt32LE(0x18), psTable = 0x801c4f68 - psLoad + 0x800;
const sha1 = (data) => crypto.createHash('sha1').update(data).digest('hex');

function readUser(fd, lba, bytes) {
  const out = Buffer.alloc(bytes);
  for (let pos = 0; pos < bytes;) {
    const sector = Math.floor(pos / USER), within = pos % USER, count = Math.min(USER - within, bytes - pos);
    if (fs.readSync(fd, out, pos, count, (lba + sector) * RAW + UOFF + within) !== count) throw new Error(`short read LBA ${lba + sector}`);
    pos += count;
  }
  return out;
}
function writeResource(fd, lba, data, touched) {
  if (data.length % USER) throw new Error(`unaligned resource length ${data.length}`);
  for (let pos = 0; pos < data.length; pos += USER) {
    const sector = Buffer.alloc(RAW), targetLba = lba + pos / USER, rawOffset = targetLba * RAW;
    if (fs.readSync(fd, sector, 0, RAW, rawOffset) !== RAW || !isMode1(sector)) throw new Error(`invalid Mode 1 LBA ${targetLba}`);
    data.copy(sector, UOFF, pos, pos + USER);
    recomputeMode1Sector(sector);
    fs.writeSync(fd, sector, 0, RAW, rawOffset);
    touched.add(targetLba);
  }
}

const inputFd = fs.openSync(inputBin, 'r'), ssExe = readUser(inputFd, SS_EXE_LBA, SS_EXE_BYTES);
let carry = 0, previous = ssExe.readUInt16BE(SS_TABLE); const ssStarts = [];
for (let id = 0; id <= 4336; id++) {
  const raw = ssExe.readUInt16BE(SS_TABLE + id * 2);
  if (id && raw < previous) carry += 0x10000;
  ssStarts[id] = raw + carry; previous = raw;
}

const candidates = map.entries.filter((entry) => entry.exactAllocatedMatch && entry.replacementPngExists);
if (candidates.length !== 54) throw new Error(`expected 54 safe candidates, got ${candidates.length}`);
const resources = [];
try {
  for (const entry of candidates) {
    const psStart = psExe.readUInt16LE(psTable + entry.psResourceId * 2) * USER;
    const psEnd = psExe.readUInt16LE(psTable + (entry.psResourceId + 1) * 2) * USER;
    const original = psOriginal.subarray(psStart, psEnd), patched = psPatched.subarray(psStart, psEnd);
    const ssLba = SS_DATA_LBA + ssStarts[entry.ssResourceId];
    const ssLength = (ssStarts[entry.ssResourceId + 1] - ssStarts[entry.ssResourceId]) * USER;
    if (ssLength !== original.length) throw new Error(`PS ${entry.psResourceId}/SS ${entry.ssResourceId}: size mismatch`);
    const ssOriginal = readUser(inputFd, ssLba, ssLength);
    if (!ssOriginal.equals(original)) throw new Error(`PS ${entry.psResourceId}/SS ${entry.ssResourceId}: base resource mismatch`);
    if (patched.equals(original)) throw new Error(`PS ${entry.psResourceId}: patched resource is unchanged`);
    resources.push({ ...entry, ssLba, original, patched });
  }
} finally { fs.closeSync(inputFd); }

fs.copyFileSync(inputBin, outputBin);
const outputFd = fs.openSync(outputBin, 'r+'), touched = new Set(), results = [];
try {
  for (const item of resources) {
    writeResource(outputFd, item.ssLba, item.patched, touched);
    const verify = readUser(outputFd, item.ssLba, item.patched.length);
    if (!verify.equals(item.patched)) throw new Error(`SS ${item.ssResourceId}: post-write mismatch`);
    let changedBytes = 0;
    for (let i = 0; i < item.original.length; i++) if (item.original[i] !== item.patched[i]) changedBytes++;
    results.push({ psResourceId: item.psResourceId, ssResourceId: item.ssResourceId, ssLba: item.ssLba,
      sectors: item.patched.length / USER, changedBytes, patchedSha1: sha1(item.patched) });
  }
} finally { fs.closeSync(outputFd); }

const report = { version: 1, inputBin, outputBin, psPatchedDatPath, appliedResources: results.length,
  touchedSectors: touched.size, totalChangedUserBytes: results.reduce((sum, x) => sum + x.changedBytes, 0),
  excludedDifferentResources: map.entries.filter((x) => !x.exactAllocatedMatch).map((x) => ({ psResourceId: x.psResourceId, ssResourceId: x.ssResourceId })),
  results };
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`applied=${report.appliedResources} touchedSectors=${report.touchedSectors} changedUserBytes=${report.totalChangedUserBytes}`);
console.log(`wrote ${outputBin}`);
console.log(`report ${reportPath}`);
