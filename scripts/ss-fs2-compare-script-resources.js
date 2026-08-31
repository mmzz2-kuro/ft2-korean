#!/usr/bin/env node

'use strict';

const fs = require('fs');
const crypto = require('crypto');

const [ssImagePath, psDatPath, psExePath] = process.argv.slice(2);
if (!ssImagePath || !psDatPath || !psExePath) {
  console.error('usage: node scripts/ss-fs2-compare-script-resources.js <ss-track1.bin> <ps1-FS2_FILE.DAT> <ps1-exe>');
  process.exit(1);
}

const RAW = 2352, USER = 2048, USER_OFFSET = 0x10;
const SS_EXE_LBA = 21, SS_DATA_LBA = 178, SS_TABLE = 0x1ae9c;
const ssFd = fs.openSync(ssImagePath, 'r');
const psDat = fs.readFileSync(psDatPath);
const psExe = fs.readFileSync(psExePath);

function readSsUser(lba, bytes) {
  const out = Buffer.alloc(bytes);
  for (let pos = 0; pos < bytes;) {
    const sector = Math.floor(pos / USER), within = pos % USER;
    const count = Math.min(USER - within, bytes - pos);
    fs.readSync(ssFd, out, pos, count, (lba + sector) * RAW + USER_OFFSET + within);
    pos += count;
  }
  return out;
}

function sha1(data) {
  return crypto.createHash('sha1').update(data).digest('hex');
}

try {
  const ssExe = readSsUser(SS_EXE_LBA, 319524);
  const psLoad = psExe.readUInt32LE(0x18);
  const psTable = 0x801c4f68 - psLoad + 0x800;
  let identical = 0;
  for (let ssId = 278; ssId <= 295; ssId++) {
    const psId = ssId + 31;
    const ssFirst = ssExe.readUInt16BE(SS_TABLE + ssId * 2);
    const ssLast = ssExe.readUInt16BE(SS_TABLE + (ssId + 1) * 2);
    const ssData = readSsUser(SS_DATA_LBA + ssFirst, (ssLast - ssFirst) * USER);
    const psFirst = psExe.readUInt16LE(psTable + psId * 2);
    const psLast = psExe.readUInt16LE(psTable + (psId + 1) * 2);
    const psData = psDat.subarray(psFirst * USER, psLast * USER);
    const same = ssData.equals(psData);
    if (same) identical++;
    console.log(`ss=${ssId} ps=${psId} ssBytes=0x${ssData.length.toString(16)} psBytes=0x${psData.length.toString(16)} same=${same} ssSha1=${sha1(ssData)} psSha1=${sha1(psData)}`);
  }
  console.log(`identical=${identical}/18`);
} finally {
  fs.closeSync(ssFd);
}
