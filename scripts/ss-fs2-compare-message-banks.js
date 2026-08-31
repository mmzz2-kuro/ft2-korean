#!/usr/bin/env node

'use strict';

const fs = require('fs');
const crypto = require('crypto');

const [ssImagePath, psDatPath, psExePath] = process.argv.slice(2);
if (!ssImagePath || !psDatPath || !psExePath) {
  console.error('usage: node scripts/ss-fs2-compare-message-banks.js <ss-track1.bin> <ps1-FS2_FILE.DAT> <ps1-exe>');
  process.exit(1);
}

const RAW = 2352, USER = 2048, SS_EXE_LBA = 21, SS_DATA_LBA = 178;
const SS_TABLE = 0x1ae9c, SS_MESSAGE_PAIR_INDEX = 4336;
const PS_MESSAGE_PAIR_INDEX = 4450, GROUPS = 17;
const ssFd = fs.openSync(ssImagePath, 'r');
const psDat = fs.readFileSync(psDatPath);
const psExe = fs.readFileSync(psExePath);

function readSsUser(lba, bytes) {
  const out = Buffer.alloc(bytes);
  for (let pos = 0; pos < bytes;) {
    const sector = Math.floor(pos / USER), within = pos % USER;
    const count = Math.min(USER - within, bytes - pos);
    fs.readSync(ssFd, out, pos, count, (lba + sector) * RAW + 0x10 + within);
    pos += count;
  }
  return out;
}

function sha1(data) {
  return crypto.createHash('sha1').update(data).digest('hex');
}

function unwrapPairs(readRaw, initialPrevious) {
  let carry = 0, previous = initialPrevious;
  const pairs = [];
  for (let group = 0; group < GROUPS; group++) {
    const rawStart = readRaw(group * 2);
    const rawEnd = readRaw(group * 2 + 1);
    if (rawStart < previous) carry += 0x10000;
    const start = rawStart + carry;
    if (rawEnd < rawStart) carry += 0x10000;
    const end = rawEnd + carry;
    pairs.push({ start, end });
    previous = rawEnd;
  }
  return pairs;
}

try {
  const ssExe = readSsUser(SS_EXE_LBA, 319524);
  const ssRead = (relative) => ssExe.readUInt16BE(SS_TABLE + (SS_MESSAGE_PAIR_INDEX + relative) * 2);
  const ssPrevious = ssExe.readUInt16BE(SS_TABLE + (SS_MESSAGE_PAIR_INDEX - 1) * 2);
  const ssPairs = unwrapPairs(ssRead, ssPrevious);

  const psLoad = psExe.readUInt32LE(0x18);
  const psTable = 0x801c4f68 - psLoad + 0x800;
  const psRead = (relative) => psExe.readUInt16LE(psTable + (PS_MESSAGE_PAIR_INDEX + relative) * 2);
  const psPrevious = psExe.readUInt16LE(psTable + (PS_MESSAGE_PAIR_INDEX - 1) * 2);
  const psPairs = unwrapPairs(psRead, psPrevious);

  let identical = 0;
  for (let group = 0; group < GROUPS; group++) {
    const ss = ssPairs[group], ps = psPairs[group];
    const ssData = readSsUser(SS_DATA_LBA + ss.start, (ss.end - ss.start) * USER);
    const psData = psDat.subarray(ps.start * USER, ps.end * USER);
    const same = ssData.equals(psData);
    if (same) identical++;
    console.log(`group=${group} ss=${ss.start}..${ss.end} ps=${ps.start}..${ps.end} sectors=${ss.end - ss.start}/${ps.end - ps.start} same=${same} ssSha1=${sha1(ssData)} psSha1=${sha1(psData)}`);
  }
  console.log(`identical=${identical}/${GROUPS}`);
} finally {
  fs.closeSync(ssFd);
}
