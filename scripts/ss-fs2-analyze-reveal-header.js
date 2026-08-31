#!/usr/bin/env node

'use strict';

const fs = require('fs');

const [ssImagePath, psDatPath, psExePath, ...idArgs] = process.argv.slice(2);
if (!ssImagePath || !psDatPath || !psExePath) {
  console.error('usage: node scripts/ss-fs2-analyze-reveal-header.js <ss-track1.bin> <ps1-FS2_FILE.DAT> <ps1-exe> [message IDs...]');
  process.exit(1);
}

const DEFAULT_IDS = [
  1001, 1004, 1103, 1104, 1105, 1106,
  2001, 2004, 2007, 2008, 2009,
  4001, 4003, 4004, 4005, 4007,
  6001, 6002, 6003, 6004, 6005,
  7002, 7003, 7004,
];
const messageIds = idArgs.length ? idArgs.map((value) => Number.parseInt(value, 0)) : DEFAULT_IDS;
if (messageIds.some((value) => !Number.isInteger(value))) throw new Error('invalid message ID');

const RAW = 2352, USER = 2048, SS_EXE_LBA = 21, SS_DATA_LBA = 178;
const SS_EXE_BYTES = 319524, SS_BASE = 0x06010000;
const SS_TABLE = 0x1ae9c, SS_ZERO_PAIR_INDEX = 4336, SS_GROUP_TABLE = 0x0602e5ac;
const PS_ZERO_PAIR_INDEX = 4450, PS_GROUP_TABLE = 0x80169db0;
const MASK_BYTES = 0x930, HEADER_BYTES = 0xd0;
const MAX_ENTRIES = (HEADER_BYTES - 4) / 4;

const ssFd = fs.openSync(ssImagePath, 'r');
const psDat = fs.readFileSync(psDatPath), psExe = fs.readFileSync(psExePath);

function readSsUser(lba, bytes) {
  const out = Buffer.alloc(bytes);
  for (let pos = 0; pos < bytes;) {
    const sector = Math.floor(pos / USER), within = pos % USER;
    const count = Math.min(USER - within, bytes - pos);
    const got = fs.readSync(ssFd, out, pos, count, (lba + sector) * RAW + 0x10 + within);
    if (got !== count) throw new Error(`short read at LBA ${lba + sector}`);
    pos += count;
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

function mapBlocks() {
  const ssExe = readSsUser(SS_EXE_LBA, SS_EXE_BYTES);
  const ssRead = (relative) => ssExe.readUInt16BE(SS_TABLE + (SS_ZERO_PAIR_INDEX + relative) * 2);
  const ssBases = unwrapPairEnds(ssRead, ssExe.readUInt16BE(SS_TABLE + (SS_ZERO_PAIR_INDEX - 1) * 2));
  const psLoad = psExe.readUInt32LE(0x18);
  const psFileOff = (address) => address - psLoad + 0x800;
  const psResourceTable = psFileOff(0x801c4f68);
  const psRead = (relative) => psExe.readUInt16LE(psResourceTable + (PS_ZERO_PAIR_INDEX + relative) * 2);
  const psBases = unwrapPairEnds(psRead, psExe.readUInt16LE(psResourceTable + (PS_ZERO_PAIR_INDEX - 1) * 2));

  return (messageId) => {
    const n = messageId - 1001, group = Math.floor(n / 1000), index = n % 1000;
    if (group < 0 || group >= 17 || index < 0) throw new Error(`invalid message ID ${messageId}`);
    const ssTableAddress = ssExe.readUInt32BE(SS_GROUP_TABLE - SS_BASE + group * 4);
    const ssTable = ssTableAddress - SS_BASE;
    const ssFirst = ssExe.readUInt16BE(ssTable + index * 2);
    const ssLast = ssExe.readUInt16BE(ssTable + (index + 1) * 2);
    const psTableAddress = psExe.readUInt32LE(psFileOff(PS_GROUP_TABLE) + group * 4);
    const psTable = psFileOff(psTableAddress);
    const psFirst = psExe.readUInt16LE(psTable + index * 2);
    const psLast = psExe.readUInt16LE(psTable + (index + 1) * 2);
    const ssStart = ssBases[group] + ssFirst, ssEnd = ssBases[group] + ssLast;
    const psStart = psBases[group] + psFirst, psEnd = psBases[group] + psLast;
    return {
      ss: readSsUser(SS_DATA_LBA + ssStart, (ssEnd - ssStart) * USER),
      ps: psDat.subarray(psStart * USER, psEnd * USER),
      ssStart, ssEnd, psStart, psEnd,
    };
  };
}

function inspectHeader(block) {
  if (block.length < MASK_BYTES + HEADER_BYTES) return { valid: false, reason: 'short block' };
  const header = block.subarray(MASK_BYTES, MASK_BYTES + HEADER_BYTES);
  const count = header.readUInt32BE(0);
  const pointers = [];
  for (let index = 0; index < MAX_ENTRIES; index++) pointers.push(header.readUInt32BE(4 + index * 4));
  const active = pointers.slice(0, Math.min(count, MAX_ENTRIES));
  const terminal = count < pointers.length ? pointers[count] : undefined;
  const tail = pointers.slice(Math.min(count, MAX_ENTRIES));
  const monotonic = active.every((value, index) => index === 0 || value >= active[index - 1]);
  const zeroTail = tail.every((value) => value === 0);
  return {
    valid: count > 0 && count <= MAX_ENTRIES && monotonic,
    count, pointers, active, monotonic, zeroTail,
    first: active[0], last: active[active.length - 1], terminal,
    header,
  };
}

function hex(value) { return value === undefined ? '-' : `0x${value.toString(16)}`; }

function visibleRenderLimit(block) {
  let maxIndex = -1;
  for (let index = 0; index < 588; index++) {
    const group = Math.floor(index / 196), column = index % 196;
    for (let word = 0; word < 2; word++) {
      let value = block.readUInt16BE(index * 4 + word * 2);
      if (value !== 0) { maxIndex = index; break; }
    }
  }
  return maxIndex + 1;
}

const map = mapBlocks();
let sameHeaders = 0, validSs = 0, validPs = 0;
try {
  for (const id of messageIds) {
    const blocks = map(id), ss = inspectHeader(blocks.ss), ps = inspectHeader(blocks.ps);
    const activeSame = ss.count === ps.count && ss.active.every((value, index) => value === ps.active[index]);
    const visible = visibleRenderLimit(blocks.ss);
    const sameHeader = ss.header && ps.header && ss.header.equals(ps.header);
    if (sameHeader) sameHeaders++;
    if (ss.valid) validSs++;
    if (ps.valid) validPs++;
    let common = 0;
    while (common < HEADER_BYTES && ss.header && ps.header && ss.header[common] === ps.header[common]) common++;
    console.log([
      `id=${id}`,
      `ssSectors=${blocks.ssEnd - blocks.ssStart}`,
      `psSectors=${blocks.psEnd - blocks.psStart}`,
      `ssCount=${ss.count}`,
      `psCount=${ps.count}`,
      `ssFirst=${hex(ss.first)}`,
      `ssLast=${hex(ss.last)}`,
      `ssTerminal=${hex(ss.terminal)}`,
      `psFirst=${hex(ps.first)}`,
      `psLast=${hex(ps.last)}`,
      `psTerminal=${hex(ps.terminal)}`,
      `visible=${visible}/${ss.count * 14}`,
      `ssMonotonic=${ss.monotonic}`,
      `ssZeroTail=${ss.zeroTail}`,
      `activeSame=${activeSame}`,
      `sameHeader=${sameHeader}`,
      `headerPrefix=0x${common.toString(16)}`,
    ].join(' '));
  }
  console.log(`summary messages=${messageIds.length} validSs=${validSs} validPs=${validPs} sameHeaders=${sameHeaders}`);
} finally {
  fs.closeSync(ssFd);
}
