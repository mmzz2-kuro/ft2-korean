#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [ssBinPath, psDatPath, psExePath, tsvPath, outputPath] = process.argv.slice(2);
if (!outputPath) {
  console.error('usage: node scripts/ss-fs2-map-behdr-ui.js <ss-track1.bin> <ps1-DAT> <ps1-EXE> <translation.tsv> <output.json>');
  process.exit(1);
}

const RAW = 2352, USER = 2048, UOFF = 16;
const SS_EXE_LBA = 21, SS_EXE_BYTES = 319524, SS_DATA_LBA = 178, SS_TABLE = 0x1ae9c;
const psDat = fs.readFileSync(psDatPath), psExe = fs.readFileSync(psExePath);
const psLoad = psExe.readUInt32LE(0x18), psTable = 0x801c4f68 - psLoad + 0x800;

function sha1(data) { return crypto.createHash('sha1').update(data).digest('hex'); }
function readUser(fd, lba, bytes) {
  const out = Buffer.alloc(bytes);
  for (let pos = 0; pos < bytes;) {
    const sector = Math.floor(pos / USER), within = pos % USER;
    const count = Math.min(USER - within, bytes - pos);
    if (fs.readSync(fd, out, pos, count, (lba + sector) * RAW + UOFF + within) !== count) throw new Error(`short read at LBA ${lba + sector}`);
    pos += count;
  }
  return out;
}
function startsFromSsExe(exe, count) {
  const starts = [];
  let carry = 0, previous = exe.readUInt16BE(SS_TABLE);
  for (let id = 0; id <= count; id++) {
    const raw = exe.readUInt16BE(SS_TABLE + id * 2);
    if (id > 0 && raw < previous) carry += 0x10000;
    starts.push(SS_DATA_LBA + raw + carry);
    previous = raw;
  }
  return starts;
}

const lines = fs.readFileSync(tsvPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
const headers = lines.shift().split('\t');
const col = Object.fromEntries(headers.map((name, index) => [name, index]));
const rows = lines.map((line) => line.split('\t'));
const fd = fs.openSync(ssBinPath, 'r');
let result;
try {
  const ssExe = readUser(fd, SS_EXE_LBA, SS_EXE_BYTES);
  const ssStarts = startsFromSsExe(ssExe, 4336);
  const entries = rows.map((fields) => {
    const psResourceId = Number(fields[col.resource_id]), ssResourceId = psResourceId - 114;
    const psStartSector = psExe.readUInt16LE(psTable + psResourceId * 2);
    const psEndSector = psExe.readUInt16LE(psTable + (psResourceId + 1) * 2);
    const psBytes = psDat.subarray(psStartSector * USER, psEndSector * USER);
    const ssLba = ssStarts[ssResourceId], ssEndLba = ssStarts[ssResourceId + 1];
    const ssBytes = readUser(fd, ssLba, (ssEndLba - ssLba) * USER);
    const replacementPng = fields[col.replacement_png] || '';
    const normalizedPng = replacementPng.replace(/^[A-Za-z]:\\[^]*?\\tmp\\SLPS-01903\\/, 'tmp\\SLPS-01903\\');
    const localPng = path.resolve(normalizedPng);
    return {
      psResourceId, ssResourceId, width: Number(fields[col.width]), height: Number(fields[col.height]),
      psStartSector, psSectors: psEndSector - psStartSector, ssLba, ssSectors: ssEndLba - ssLba,
      sameAllocatedSize: psBytes.length === ssBytes.length,
      exactAllocatedMatch: psBytes.equals(ssBytes), psSha1: sha1(psBytes), ssSha1: sha1(ssBytes),
      replacementPng: replacementPng || null, replacementPngExists: Boolean(replacementPng && fs.existsSync(localPng)),
    };
  });
  result = {
    version: 1,
    mappingRule: 'ssResourceId = psResourceId - 114',
    inputs: { ssBinPath, psDatPath, psExePath, tsvPath },
    total: entries.length,
    exactAllocatedMatches: entries.filter((x) => x.exactAllocatedMatch).length,
    sameAllocatedSizes: entries.filter((x) => x.sameAllocatedSize).length,
    replacementPngPresent: entries.filter((x) => x.replacementPngExists).length,
    entries,
  };
} finally { fs.closeSync(fd); }

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(`total=${result.total} exact=${result.exactAllocatedMatches} sameSize=${result.sameAllocatedSizes} png=${result.replacementPngPresent}`);
console.log(`wrote ${outputPath}`);
