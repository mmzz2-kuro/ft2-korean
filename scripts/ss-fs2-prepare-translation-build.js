#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args.length !== 8) {
  console.error('usage: node scripts/ss-fs2-prepare-translation-build.js <track1.bin> <track2.bin> <PS1-FS2_FILE.DAT> <PS1-exe> <translation.tsv> <ko-pgm-dir> <out-manifest.json> <out-report.json>');
  process.exit(1);
}
const [track1Arg, track2Arg, psDatArg, psExeArg, tsvArg, koDirArg, manifestArg, reportArg] = args;
const track1 = path.resolve(track1Arg), track2 = path.resolve(track2Arg), tsvPath = path.resolve(tsvArg);
const psDat = fs.readFileSync(path.resolve(psDatArg)), psExe = fs.readFileSync(path.resolve(psExeArg));
const koDir = path.resolve(koDirArg);
const manifestPath = path.resolve(manifestArg), reportPath = path.resolve(reportArg);

const RAW = 2352, USER = 2048, EXE_LBA = 21, DATA_LBA = 178, EXE_BYTES = 319524;
const TABLE_OFFSET = 0x1ae9c, ZERO_PAIR_INDEX = 4336, GROUP_TABLE = 0x0602e5ac, BASE = 0x06010000;
const PS_ZERO_PAIR_INDEX = 4450, PS_GROUP_TABLE = 0x80169db0;
const WIDTH = 200, HEIGHT = 48, MASK_BYTES = 0x930, REVEAL_STEP = 14, MAX_REVEAL_COUNT = 42;
const TRACK1_SHA256 = '267CB97B787E4F3C804CBCB0495977C7F3B309513CA15F918A9C3C6D18996D02';
const TRACK2_SHA256 = '1E3504C775B34E839B52C9DEA95C40D51E3F4DCDAE82CC88A11413D6ED301741';

function readUser(fd, lba, bytes) {
  const out = Buffer.alloc(bytes);
  for (let pos = 0; pos < bytes;) {
    const sector = Math.floor(pos / USER), within = pos % USER, count = Math.min(USER - within, bytes - pos);
    if (fs.readSync(fd, out, pos, count, (lba + sector) * RAW + 0x10 + within) !== count) throw new Error(`short read at LBA ${lba + sector}`);
    pos += count;
  }
  return out;
}

function loadMap(fd) {
  const exe = readUser(fd, EXE_LBA, EXE_BYTES);
  let previous = exe.readUInt16BE(TABLE_OFFSET + (ZERO_PAIR_INDEX - 1) * 2), carry = 0;
  const bases = [];
  for (let group = 0; group < 17; group++) {
    const start = exe.readUInt16BE(TABLE_OFFSET + (ZERO_PAIR_INDEX + group * 2) * 2);
    const end = exe.readUInt16BE(TABLE_OFFSET + (ZERO_PAIR_INDEX + group * 2 + 1) * 2);
    if (start < previous) carry += 0x10000;
    if (end < start) carry += 0x10000;
    bases.push(end + carry); previous = end;
  }
  return { exe, bases };
}

function mapMessage(map, messageId) {
  const n = messageId - 1001, group = Math.floor(n / 1000), index = n % 1000;
  if (group < 0 || group >= 17 || index < 0) throw new Error('ID outside 17 groups');
  const table = map.exe.readUInt32BE(GROUP_TABLE - BASE + group * 4) - BASE;
  if (table < 0 || table + (index + 1) * 2 + 2 > map.exe.length) throw new Error('ID outside executable table');
  const first = map.exe.readUInt16BE(table + index * 2), last = map.exe.readUInt16BE(table + (index + 1) * 2);
  if (last <= first) throw new Error('empty or reversed SS slot');
  const startSector = map.bases[group] + first, endSector = map.bases[group] + last;
  return { messageId, group, index, startSector, endSector, trackLba: DATA_LBA + startSector };
}

function loadPsMap() {
  const loadAddress = psExe.readUInt32LE(0x18);
  const fileOffset = (address) => address - loadAddress + 0x800;
  const resourceTable = fileOffset(0x801c4f68);
  let previous = psExe.readUInt16LE(resourceTable + (PS_ZERO_PAIR_INDEX - 1) * 2), carry = 0;
  const bases = [];
  for (let group = 0; group < 17; group++) {
    const start = psExe.readUInt16LE(resourceTable + (PS_ZERO_PAIR_INDEX + group * 2) * 2);
    const end = psExe.readUInt16LE(resourceTable + (PS_ZERO_PAIR_INDEX + group * 2 + 1) * 2);
    if (start < previous) carry += 0x10000;
    if (end < start) carry += 0x10000;
    bases.push(end + carry); previous = end;
  }
  return { fileOffset, bases };
}

function readPsMask(map, messageId) {
  const n = messageId - 1001, group = Math.floor(n / 1000), index = n % 1000;
  if (group < 0 || group >= 17 || index < 0) throw new Error('ID outside PS1 groups');
  const pointerArray = map.fileOffset(PS_GROUP_TABLE);
  const tableAddress = psExe.readUInt32LE(pointerArray + group * 4), table = map.fileOffset(tableAddress);
  const first = psExe.readUInt16LE(table + index * 2), last = psExe.readUInt16LE(table + (index + 1) * 2);
  if (last <= first) throw new Error('empty or reversed PS1 slot');
  const byteStart = (map.bases[group] + first) * USER;
  if (byteStart + MASK_BYTES > psDat.length) throw new Error('PS1 mask outside DAT');
  return psDat.subarray(byteStart, byteStart + MASK_BYTES);
}

function parsePgm(filePath) {
  const tokens = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
    .flatMap((line) => line.replace(/#.*/, '').trim().split(/\s+/).filter(Boolean));
  if (tokens.shift() !== 'P2' || Number(tokens.shift()) !== WIDTH || Number(tokens.shift()) !== HEIGHT || Number(tokens.shift()) !== 3) {
    throw new Error('expected P2 200x48 max 3');
  }
  if (tokens.length < WIDTH * HEIGHT) throw new Error('too few pixels');
  const pixels = new Uint8Array(WIDTH * HEIGHT);
  for (let i = 0; i < pixels.length; i++) {
    const value = Number(tokens[i]);
    if (!Number.isInteger(value) || value < 0 || value > 3) throw new Error(`invalid pixel ${i}`);
    pixels[i] = value;
  }
  return pixels;
}

function packMask(pixels) {
  const packed = Buffer.alloc(MASK_BYTES);
  for (let index = 0; index < 588; index++) {
    const band = Math.floor(index / 196), x = index % 196, rowBase = band * 16;
    for (let word = 0; word < 2; word++) {
      let value = 0;
      for (let pair = 0; pair < 8; pair++) value |= pixels[(rowBase + word * 8 + 7 - pair) * WIDTH + x] << (pair * 2);
      packed.writeUInt16BE(value, index * 4 + word * 2);
    }
  }
  return packed;
}

function visibleLimit(pixels) {
  let last = -1;
  for (let index = 0; index < 588; index++) {
    const band = Math.floor(index / 196), x = index % 196, rowBase = band * 16;
    for (let y = rowBase; y < rowBase + 16; y++) if (pixels[y * WIDTH + x]) { last = index; break; }
  }
  return last + 1;
}

function parseTsv(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').replace(/^\ufeff/, '').split(/\r?\n/).filter((line) => line.length);
  const headers = lines.shift().split('\t');
  return lines.map((line) => {
    const values = line.split('\t'), row = {};
    headers.forEach((header, index) => { row[header] = (values[index] || '').replace(/\\n/g, '\n').replace(/\\t/g, '\t'); });
    return row;
  });
}

function relativeFrom(filePath, target) { return path.relative(path.dirname(filePath), target).replace(/\\/g, '/'); }

const rows = parseTsv(tsvPath), fd = fs.openSync(track1, 'r'), map = loadMap(fd), psMap = loadPsMap();
const ready = [], rejected = [], seen = new Set();
try {
  for (const row of rows) {
    if (row.kind || !/^\d+$/.test(row.message_id || '') || !(row.ko_text || '').trim()) continue;
    const messageId = Number(row.message_id);
    if (seen.has(messageId)) { rejected.push({ messageId, reason: 'duplicate TSV message ID' }); continue; }
    seen.add(messageId);
    const koPgm = path.join(koDir, `message-mask-${messageId}-ko.pgm`);
    try {
      if (!fs.existsSync(koPgm)) throw new Error('missing Korean PGM');
      const mapped = mapMessage(map, messageId);
      const prefix = readUser(fd, mapped.trackLba, MASK_BYTES + 4 + (MAX_REVEAL_COUNT + 1) * 4);
      if (!prefix.subarray(0, MASK_BYTES).equals(readPsMask(psMap, messageId))) throw new Error('PS1 raw mask differs from SS raw mask');
      const count = prefix.readUInt32BE(MASK_BYTES), capacity = Math.min(588, count * REVEAL_STEP);
      if (count < 1 || count > MAX_REVEAL_COUNT) throw new Error(`unsupported reveal count ${count}`);
      let previous = 0;
      for (let i = 0; i <= count; i++) {
        const boundary = prefix.readUInt32BE(MASK_BYTES + 4 + i * 4);
        if (i && boundary < previous) throw new Error('non-monotonic SS reveal boundaries');
        previous = boundary;
      }
      const visibleEntries = visibleLimit(parsePgm(koPgm));
      if (visibleEntries > capacity) throw new Error(`Korean reveal overflow ${visibleEntries}/${capacity}`);
      ready.push({ ...mapped, koText: row.ko_text, pgm: koPgm, visibleEntries, revealCount: count, revealCapacity: capacity });
    } catch (error) {
      const reason = error.message;
      const category = reason.startsWith('Korean reveal overflow') ? 'reveal-overflow'
        : reason === 'PS1 raw mask differs from SS raw mask' ? 'platform-mask-difference' : 'invalid-input';
      rejected.push({ messageId, koText: row.ko_text, category, reason });
    }
  }
} finally { fs.closeSync(fd); }

fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
const outputBase = path.resolve(path.dirname(manifestPath), '../output/ss-fs2-korean-safe');
const manifest = {
  version: 1,
  input: { track1: relativeFrom(manifestPath, track1), track2: relativeFrom(manifestPath, track2),
    track1Sha256: TRACK1_SHA256, track2Sha256: TRACK2_SHA256 },
  output: { track1: relativeFrom(manifestPath, `${outputBase}.bin`), cue: relativeFrom(manifestPath, `${outputBase}.cue`),
    report: relativeFrom(manifestPath, `${outputBase}.report.json`) },
  patches: ready.map((entry) => ({ messageId: entry.messageId, pgm: relativeFrom(manifestPath, entry.pgm) })),
};
const report = {
  version: 1, sourceTsv: tsvPath, totalRows: rows.length, candidateMessageRows: seen.size,
  ready: ready.length, rejected: rejected.length,
  readyEntries: ready.map(({ pgm, ...entry }) => ({ ...entry, pgm })), rejectedEntries: rejected,
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`candidateMessageRows=${seen.size}`);
console.log(`ready=${ready.length}`);
console.log(`rejected=${rejected.length}`);
const reasons = new Map();
for (const entry of rejected) reasons.set(entry.category, (reasons.get(entry.category) || 0) + 1);
for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`rejectedCategory=${reason} count=${count}`);
console.log(`manifest=${manifestPath}`);
console.log(`report=${reportPath}`);
