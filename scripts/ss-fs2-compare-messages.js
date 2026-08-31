#!/usr/bin/env node

'use strict';

const fs = require('fs');
const crypto = require('crypto');

const [ssImagePath, psDatPath, psExePath] = process.argv.slice(2);
if (!ssImagePath || !psDatPath || !psExePath) {
  console.error('usage: node scripts/ss-fs2-compare-messages.js <ss-track1.bin> <ps1-FS2_FILE.DAT> <ps1-exe> [message IDs...]');
  process.exit(1);
}
const requested = process.argv.slice(5).map((value) => Number.parseInt(value, 0));
const messageIds = requested.length ? requested : [
  1001, 1004, 1103, 1104, 1105, 1106,
  2001, 2004, 2007, 2008, 2009,
  4001, 4003, 4004, 4005, 4007,
  6001, 6002, 6003, 6004, 6005,
  7002, 7003, 7004
];

const RAW = 2352, USER = 2048, SS_EXE_LBA = 21, SS_DATA_LBA = 178;
const SS_TABLE = 0x1ae9c, SS_ZERO_PAIR_INDEX = 4336, SS_GROUP_TABLE = 0x0602e5ac;
const PS_ZERO_PAIR_INDEX = 4450, PS_GROUP_TABLE = 0x80169db0;
const ssFd = fs.openSync(ssImagePath, 'r');
const psDat = fs.readFileSync(psDatPath), psExe = fs.readFileSync(psExePath);

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
function sha1(data) { return crypto.createHash('sha1').update(data).digest('hex'); }
function swap16Copy(data) {
  const out = Buffer.from(data);
  for (let offset = 0; offset + 1 < out.length; offset += 2) {
    const value = out[offset]; out[offset] = out[offset + 1]; out[offset + 1] = value;
  }
  return out;
}

function unwrapPairEnds(readRaw, initialPrevious) {
  let carry = 0, previous = initialPrevious;
  const ends = [];
  for (let group = 0; group < 17; group++) {
    const rawStart = readRaw(group * 2), rawEnd = readRaw(group * 2 + 1);
    if (rawStart < previous) carry += 0x10000;
    if (rawEnd < rawStart) carry += 0x10000;
    ends.push(rawEnd + carry);
    previous = rawEnd;
  }
  return ends;
}

try {
  const ssExe = readSsUser(SS_EXE_LBA, 319524);
  const ssRead = (relative) => ssExe.readUInt16BE(SS_TABLE + (SS_ZERO_PAIR_INDEX + relative) * 2);
  const ssPrev = ssExe.readUInt16BE(SS_TABLE + (SS_ZERO_PAIR_INDEX - 1) * 2);
  const ssBases = unwrapPairEnds(ssRead, ssPrev);

  const psLoad = psExe.readUInt32LE(0x18);
  const psFileOff = (address) => address - psLoad + 0x800;
  const psResourceTable = psFileOff(0x801c4f68);
  const psRead = (relative) => psExe.readUInt16LE(psResourceTable + (PS_ZERO_PAIR_INDEX + relative) * 2);
  const psPrev = psExe.readUInt16LE(psResourceTable + (PS_ZERO_PAIR_INDEX - 1) * 2);
  const psBases = unwrapPairEnds(psRead, psPrev);

  let identical = 0;
  for (const messageId of messageIds) {
    const n = messageId - 1001, group = Math.floor(n / 1000), index = n % 1000;
    if (group < 0 || group >= 17 || index < 0) throw new Error(`invalid message ID ${messageId}`);
    const ssOffsetTableAddress = ssExe.readUInt32BE(SS_GROUP_TABLE - 0x06010000 + group * 4);
    const ssOffsetTable = ssOffsetTableAddress - 0x06010000;
    const ssFirst = ssExe.readUInt16BE(ssOffsetTable + index * 2);
    const ssLast = ssExe.readUInt16BE(ssOffsetTable + (index + 1) * 2);

    const psOffsetTableAddress = psExe.readUInt32LE(psFileOff(PS_GROUP_TABLE) + group * 4);
    const psOffsetTable = psFileOff(psOffsetTableAddress);
    const psFirst = psExe.readUInt16LE(psOffsetTable + index * 2);
    const psLast = psExe.readUInt16LE(psOffsetTable + (index + 1) * 2);

    const ssStart = ssBases[group] + ssFirst, ssEnd = ssBases[group] + ssLast;
    const psStart = psBases[group] + psFirst, psEnd = psBases[group] + psLast;
    const ssData = readSsUser(SS_DATA_LBA + ssStart, (ssEnd - ssStart) * USER);
    const psData = psDat.subarray(psStart * USER, psEnd * USER);
    const same = ssData.equals(psData);
    const ssMask = ssData.subarray(0, Math.min(0x930, ssData.length));
    const psMask = psData.subarray(0, Math.min(0x930, psData.length));
    const maskRaw = ssMask.length === 0x930 && psMask.length === 0x930 && ssMask.equals(psMask);
    const maskPsSwap16 = ssMask.length === 0x930 && psMask.length === 0x930 && ssMask.equals(swap16Copy(psMask));
    let commonPrefix = 0;
    while (commonPrefix < ssData.length && commonPrefix < psData.length && ssData[commonPrefix] === psData[commonPrefix]) commonPrefix++;
    if (same) identical++;
    console.log(`id=${messageId} group=${group} index=${index} ss=${ssStart}..${ssEnd} ps=${psStart}..${psEnd} sectors=${ssEnd - ssStart}/${psEnd - psStart} same=${same} prefix=0x${commonPrefix.toString(16)} maskRaw=${maskRaw} maskPsSwap16=${maskPsSwap16} ssSha1=${sha1(ssData)} psSha1=${sha1(psData)}`);
  }
  console.log(`identical=${identical}/${messageIds.length}`);
} finally {
  fs.closeSync(ssFd);
}
