#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { recomputeMode1Sector, isMode1 } = require('./cdrom-eccedc.js');

const [manifestArg, ...flags] = process.argv.slice(2);
if (!manifestArg) {
  console.error('usage: node scripts/ss-fs2-build-message-patch.js <build-manifest.json> [--force] [--dry-run] [--summary]');
  process.exit(1);
}
const force = flags.includes('--force'), dryRun = flags.includes('--dry-run'), summaryOnly = flags.includes('--summary');
if (flags.some((flag) => flag !== '--force' && flag !== '--dry-run' && flag !== '--summary')) throw new Error('unknown option');

const RAW = 2352, USER = 2048, USER_OFFSET = 0x10;
const EXE_LBA = 21, DATA_LBA = 178, EXE_BYTES = 319524;
const TABLE_OFFSET = 0x1ae9c, ZERO_PAIR_INDEX = 4336, GROUP_TABLE = 0x0602e5ac;
const BASE = 0x06010000, WIDTH = 200, HEIGHT = 48, MASK_BYTES = 0x930;
const REVEAL_STEP = 14, MAX_REVEAL_COUNT = Math.ceil(588 / REVEAL_STEP);
const EXPECTED_TRACK1_SHA256 = '267cb97b787e4f3c804cbcb0495977c7f3b309513ca15f918a9c3c6d18996d02';
const EXPECTED_TRACK2_SHA256 = '1e3504c775b34e839b52c9dea95c40d51e3f4dcdae82cc88a11413d6ed301741';

const manifestPath = path.resolve(manifestArg), manifestDir = path.dirname(manifestPath);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.version !== 1 || !manifest.input || !manifest.output || !Array.isArray(manifest.patches)) {
  throw new Error('manifest must contain version=1, input, output, and patches[]');
}
if (!manifest.patches.length) throw new Error('manifest patches[] is empty');

const resolveFromManifest = (value, label) => {
  if (typeof value !== 'string' || !value) throw new Error(`missing ${label}`);
  return path.resolve(manifestDir, value);
};
const track1Path = resolveFromManifest(manifest.input.track1, 'input.track1');
const track2Path = resolveFromManifest(manifest.input.track2, 'input.track2');
const outputBin = resolveFromManifest(manifest.output.track1, 'output.track1');
const outputCue = resolveFromManifest(manifest.output.cue, 'output.cue');
const outputReport = resolveFromManifest(manifest.output.report, 'output.report');
if (outputBin === track1Path) throw new Error('output Track 1 must differ from input Track 1');
const outputTargets = [outputBin, outputCue, outputReport];
if (new Set(outputTargets).size !== outputTargets.length) throw new Error('output.track1, output.cue, and output.report must be different paths');
if (outputTargets.includes(track1Path) || outputTargets.includes(track2Path) || outputTargets.includes(manifestPath)) {
  throw new Error('build output must not overwrite an input or the manifest');
}
if (new Set(manifest.patches.map((entry) => entry.messageId)).size !== manifest.patches.length) {
  throw new Error('duplicate messageId in patches[]');
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256'), fd = fs.openSync(filePath, 'r'), buffer = Buffer.alloc(1024 * 1024);
  try {
    for (;;) {
      const got = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!got) break;
      hash.update(buffer.subarray(0, got));
    }
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

function readUser(fd, lba, bytes) {
  const out = Buffer.alloc(bytes);
  for (let pos = 0; pos < bytes;) {
    const sector = Math.floor(pos / USER), within = pos % USER;
    const count = Math.min(USER - within, bytes - pos);
    if (fs.readSync(fd, out, pos, count, (lba + sector) * RAW + USER_OFFSET + within) !== count) {
      throw new Error(`short read at LBA ${lba + sector}`);
    }
    pos += count;
  }
  return out;
}

function loadMap() {
  const fd = fs.openSync(track1Path, 'r');
  let exe;
  try { exe = readUser(fd, EXE_LBA, EXE_BYTES); }
  finally { fs.closeSync(fd); }
  let previous = exe.readUInt16BE(TABLE_OFFSET + (ZERO_PAIR_INDEX - 1) * 2), carry = 0;
  const bases = [];
  for (let group = 0; group < 17; group++) {
    const rawStart = exe.readUInt16BE(TABLE_OFFSET + (ZERO_PAIR_INDEX + group * 2) * 2);
    const rawEnd = exe.readUInt16BE(TABLE_OFFSET + (ZERO_PAIR_INDEX + group * 2 + 1) * 2);
    if (rawStart < previous) carry += 0x10000;
    if (rawEnd < rawStart) carry += 0x10000;
    bases.push(rawEnd + carry);
    previous = rawEnd;
  }
  return { exe, bases };
}

function mapMessage(map, messageId) {
  const n = messageId - 1001, group = Math.floor(n / 1000), index = n % 1000;
  if (!Number.isInteger(messageId) || group < 0 || group >= 17 || index < 0) throw new Error(`invalid message ID ${messageId}`);
  const tableAddress = map.exe.readUInt32BE(GROUP_TABLE - BASE + group * 4), table = tableAddress - BASE;
  if (table < 0 || table + (index + 1) * 2 + 2 > map.exe.length) throw new Error(`message ${messageId} outside offset table`);
  const startOffset = map.exe.readUInt16BE(table + index * 2);
  const endOffset = map.exe.readUInt16BE(table + (index + 1) * 2);
  if (endOffset <= startOffset) throw new Error(`message ${messageId} has empty/reversed range`);
  const startSector = map.bases[group] + startOffset, endSector = map.bases[group] + endOffset;
  return { messageId, group, index, startSector, endSector, trackLba: DATA_LBA + startSector };
}

function readPgm(pgmPath) {
  const tokens = fs.readFileSync(pgmPath, 'utf8').split(/\r?\n/)
    .flatMap((line) => line.replace(/#.*/, '').trim().split(/\s+/).filter(Boolean));
  if (tokens.shift() !== 'P2') throw new Error(`${pgmPath}: PGM must use P2 format`);
  const width = Number(tokens.shift()), height = Number(tokens.shift()), max = Number(tokens.shift());
  if (width !== WIDTH || height !== HEIGHT || max !== 3) throw new Error(`${pgmPath}: expected ${WIDTH}x${HEIGHT}, max 3`);
  if (tokens.length < WIDTH * HEIGHT) throw new Error(`${pgmPath}: too few pixels`);
  const pixels = new Uint8Array(WIDTH * HEIGHT);
  for (let index = 0; index < pixels.length; index++) {
    const value = Number(tokens[index]);
    if (!Number.isInteger(value) || value < 0 || value > 3) throw new Error(`${pgmPath}: invalid pixel at ${index}`);
    pixels[index] = value;
  }
  return pixels;
}

function packMask(pixels) {
  const packed = Buffer.alloc(MASK_BYTES);
  for (let index = 0; index < 588; index++) {
    const group = Math.floor(index / 196), column = index % 196, rowBase = group * 16;
    for (let wordIndex = 0; wordIndex < 2; wordIndex++) {
      let value = 0;
      for (let pair = 0; pair < 8; pair++) {
        value |= pixels[(rowBase + wordIndex * 8 + (7 - pair)) * WIDTH + column] << (pair * 2);
      }
      packed.writeUInt16BE(value, index * 4 + wordIndex * 2);
    }
  }
  return packed;
}

function visibleRenderLimit(pixels) {
  let maxIndex = -1;
  for (let index = 0; index < 588; index++) {
    const group = Math.floor(index / 196), column = index % 196, rowBase = group * 16;
    for (let y = rowBase; y < rowBase + 16; y++) {
      if (pixels[y * WIDTH + column] !== 0) { maxIndex = index; break; }
    }
  }
  return maxIndex + 1;
}

function revealInfo(mapped) {
  const fd = fs.openSync(track1Path, 'r');
  let prefix;
  try { prefix = readUser(fd, mapped.trackLba, MASK_BYTES + 4 + (MAX_REVEAL_COUNT + 1) * 4); }
  finally { fs.closeSync(fd); }
  const count = prefix.readUInt32BE(MASK_BYTES);
  if (count < 1 || count > MAX_REVEAL_COUNT) throw new Error(`message ${mapped.messageId}: unsupported reveal count ${count}`);
  let previous = 0;
  for (let index = 0; index <= count; index++) {
    const value = prefix.readUInt32BE(MASK_BYTES + 4 + index * 4);
    if (index && value < previous) throw new Error(`message ${mapped.messageId}: non-monotonic reveal boundary`);
    previous = value;
  }
  return { count, capacity: Math.min(588, count * REVEAL_STEP) };
}

function patchMask(fd, mapped, packed) {
  const touched = [];
  for (let pos = 0; pos < packed.length;) {
    const sectorIndex = Math.floor(pos / USER), within = pos % USER;
    const count = Math.min(USER - within, packed.length - pos), lba = mapped.trackLba + sectorIndex;
    const sector = Buffer.alloc(RAW), rawOffset = lba * RAW;
    if (fs.readSync(fd, sector, 0, RAW, rawOffset) !== RAW || !isMode1(sector)) throw new Error(`invalid Mode 1 sector at LBA ${lba}`);
    packed.copy(sector, USER_OFFSET + within, pos, pos + count);
    recomputeMode1Sector(sector);
    fs.writeSync(fd, sector, 0, RAW, rawOffset);
    touched.push(lba);
    pos += count;
  }
  return touched;
}

function verifyOutput(allowedLbas, logicalRanges) {
  const originalFd = fs.openSync(track1Path, 'r'), outputFd = fs.openSync(outputBin, 'r');
  const originalSize = fs.fstatSync(originalFd).size, outputSize = fs.fstatSync(outputFd).size;
  if (originalSize !== outputSize || originalSize % RAW) throw new Error('output size differs or is not raw-sector aligned');
  const a = Buffer.alloc(RAW), b = Buffer.alloc(RAW), changedLbas = [];
  let userDiffBytes = 0, invalidParity = 0, forbiddenChanges = 0;
  try {
    for (let lba = 0; lba < originalSize / RAW; lba++) {
      fs.readSync(originalFd, a, 0, RAW, lba * RAW); fs.readSync(outputFd, b, 0, RAW, lba * RAW);
      if (a.equals(b)) continue;
      changedLbas.push(lba);
      if (!allowedLbas.has(lba)) forbiddenChanges++;
      if (!a.subarray(0, USER_OFFSET).equals(b.subarray(0, USER_OFFSET))) forbiddenChanges++;
      for (let offset = USER_OFFSET; offset < USER_OFFSET + USER; offset++) if (a[offset] !== b[offset]) {
        userDiffBytes++;
        const logical = lba * USER + offset - USER_OFFSET;
        if (!logicalRanges.some(([start, end]) => logical >= start && logical < end)) forbiddenChanges++;
      }
      if (!isMode1(b)) invalidParity++;
      else {
        const rebuilt = Buffer.from(b); recomputeMode1Sector(rebuilt);
        if (!rebuilt.subarray(USER_OFFSET + USER).equals(b.subarray(USER_OFFSET + USER))) invalidParity++;
      }
    }
  } finally { fs.closeSync(originalFd); fs.closeSync(outputFd); }
  if (invalidParity || forbiddenChanges) throw new Error(`verification failed: invalidParity=${invalidParity}, forbiddenChanges=${forbiddenChanges}`);
  return { changedLbas, changedSectorCount: changedLbas.length, userDiffBytes, invalidMode1Parity: invalidParity, forbiddenChanges };
}

const actualTrack1Sha256 = sha256File(track1Path), actualTrack2Sha256 = sha256File(track2Path);
const wantedTrack1 = (manifest.input.track1Sha256 || EXPECTED_TRACK1_SHA256).toLowerCase();
const wantedTrack2 = (manifest.input.track2Sha256 || EXPECTED_TRACK2_SHA256).toLowerCase();
if (actualTrack1Sha256 !== wantedTrack1) throw new Error(`Track 1 SHA-256 mismatch: ${actualTrack1Sha256}`);
if (actualTrack2Sha256 !== wantedTrack2) throw new Error(`Track 2 SHA-256 mismatch: ${actualTrack2Sha256}`);

const map = loadMap(), prepared = [], allowedLbas = new Set(), logicalRanges = [];
for (const entry of manifest.patches) {
  const mapped = mapMessage(map, entry.messageId), pgmPath = resolveFromManifest(entry.pgm, `patch ${entry.messageId} pgm`);
  const pixels = readPgm(pgmPath), visibleEntries = visibleRenderLimit(pixels), reveal = revealInfo(mapped);
  if (visibleEntries > reveal.capacity) throw new Error(`message ${entry.messageId}: reveal ${visibleEntries} exceeds ${reveal.capacity}`);
  const touchedLbas = [mapped.trackLba, mapped.trackLba + 1];
  touchedLbas.forEach((lba) => allowedLbas.add(lba));
  logicalRanges.push([mapped.trackLba * USER, mapped.trackLba * USER + MASK_BYTES]);
  prepared.push({ ...mapped, pgmPath, visibleEntries, revealCount: reveal.count, revealCapacity: reveal.capacity,
    packed: packMask(pixels), touchedLbas });
}

if (dryRun) {
  if (summaryOnly) {
    const touched = new Set(prepared.flatMap((entry) => entry.touchedLbas));
    console.log(`status=dry-run-ok patches=${prepared.length} touchedLbas=${touched.size}`);
    console.log(`track1Sha256=${actualTrack1Sha256}`);
    console.log(`track2Sha256=${actualTrack2Sha256}`);
  } else {
    console.log(JSON.stringify({ status: 'dry-run-ok', track1Sha256: actualTrack1Sha256, track2Sha256: actualTrack2Sha256,
      patches: prepared.map(({ packed, ...entry }) => entry) }, null, 2));
  }
  process.exit(0);
}
for (const target of [outputBin, outputCue, outputReport]) {
  if (fs.existsSync(target) && !force) throw new Error(`${target} already exists; use --force to replace build outputs`);
}
fs.mkdirSync(path.dirname(outputBin), { recursive: true });
fs.mkdirSync(path.dirname(outputCue), { recursive: true });
fs.mkdirSync(path.dirname(outputReport), { recursive: true });
fs.copyFileSync(track1Path, outputBin);
const outputFd = fs.openSync(outputBin, 'r+');
try { for (const entry of prepared) patchMask(outputFd, entry, entry.packed); }
finally { fs.closeSync(outputFd); }

const verification = verifyOutput(allowedLbas, logicalRanges), outputTrack1Sha256 = sha256File(outputBin);
const cueTrack1 = path.relative(path.dirname(outputCue), outputBin).replace(/\\/g, '/');
const cueTrack2 = path.relative(path.dirname(outputCue), track2Path).replace(/\\/g, '/');
const cue = `FILE "${cueTrack1}" BINARY\n  TRACK 01 MODE1/2352\n    INDEX 01 00:00:00\nFILE "${cueTrack2}" BINARY\n  TRACK 02 AUDIO\n    INDEX 00 00:00:00\n    INDEX 01 00:02:00\n`;
fs.writeFileSync(outputCue, cue, 'ascii');
const report = {
  version: 1, manifest: manifestPath,
  input: { track1: track1Path, track1Sha256: actualTrack1Sha256, track2: track2Path, track2Sha256: actualTrack2Sha256 },
  output: { track1: outputBin, track1Bytes: fs.statSync(outputBin).size, track1Sha256: outputTrack1Sha256,
    cue: outputCue, report: outputReport },
  patches: prepared.map(({ packed, ...entry }) => entry), verification,
};
fs.writeFileSync(outputReport, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`built ${outputBin}`);
if (summaryOnly) {
  console.log(`patches=${prepared.length} changedSectorCount=${verification.changedSectorCount}`);
  console.log(`changedLbaFirst=${verification.changedLbas[0] ?? '-'} changedLbaLast=${verification.changedLbas.at(-1) ?? '-'}`);
} else {
  console.log(`patches=${prepared.length} changedLbas=${verification.changedLbas.join(',')}`);
}
console.log(`userDiffBytes=${verification.userDiffBytes} invalidMode1Parity=${verification.invalidMode1Parity} forbiddenChanges=${verification.forbiddenChanges}`);
console.log(`outputSha256=${outputTrack1Sha256}`);
console.log(`cue=${outputCue}`);
console.log(`report=${outputReport}`);
