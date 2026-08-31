#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { recomputeMode1Sector, isMode1 } = require('./cdrom-eccedc.js');

function usage() {
  console.error(`usage:
  export: node scripts/ss-fs2-message-mask-tool.js export <track1.bin> <outDir> <messageId...>
  verify: node scripts/ss-fs2-message-mask-tool.js verify <track1.bin> <messageId...>
  patch:  node scripts/ss-fs2-message-mask-tool.js patch <track1.bin> <out.bin> <messageId> <mask.pgm>`);
  process.exit(1);
}

const [mode, imagePath, thirdArg, ...rest] = process.argv.slice(2);
if (!mode || !imagePath || !thirdArg) usage();

const RAW = 2352, USER = 2048, USER_OFFSET = 0x10;
const EXE_LBA = 21, DATA_LBA = 178, EXE_BYTES = 319524;
const TABLE_OFFSET = 0x1ae9c, ZERO_PAIR_INDEX = 4336, GROUP_TABLE = 0x0602e5ac;
const BASE = 0x06010000, WIDTH = 200, HEIGHT = 48, MASK_BYTES = 0x930;
const REVEAL_COUNT_BYTES = 4, REVEAL_STEP = 14, MAX_REVEAL_COUNT = Math.ceil(588 / REVEAL_STEP);

function readUser(fd, lba, bytes) {
  const out = Buffer.alloc(bytes);
  for (let pos = 0; pos < bytes;) {
    const sector = Math.floor(pos / USER), within = pos % USER;
    const count = Math.min(USER - within, bytes - pos);
    const got = fs.readSync(fd, out, pos, count, (lba + sector) * RAW + USER_OFFSET + within);
    if (got !== count) throw new Error(`short read at LBA ${lba + sector}`);
    pos += count;
  }
  return out;
}

function unwrapGroupBases(exe) {
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
  return bases;
}

function loadMap(image) {
  const fd = fs.openSync(image, 'r');
  try {
    const exe = readUser(fd, EXE_LBA, EXE_BYTES);
    return { exe, bases: unwrapGroupBases(exe) };
  } finally { fs.closeSync(fd); }
}

function mapMessage(map, messageId) {
  const n = messageId - 1001, group = Math.floor(n / 1000), index = n % 1000;
  if (group < 0 || group >= 17 || index < 0) throw new Error(`invalid message ID ${messageId}`);
  const tableAddress = map.exe.readUInt32BE(GROUP_TABLE - BASE + group * 4);
  if (tableAddress < BASE || tableAddress >= BASE + map.exe.length) throw new Error(`group ${group} table outside executable`);
  const table = tableAddress - BASE;
  const startOffset = map.exe.readUInt16BE(table + index * 2);
  const endOffset = map.exe.readUInt16BE(table + (index + 1) * 2);
  if (endOffset <= startOffset) throw new Error(`message ${messageId} has empty/reversed range`);
  const startSector = map.bases[group] + startOffset, endSector = map.bases[group] + endOffset;
  return { messageId, group, index, startSector, endSector, trackLba: DATA_LBA + startSector };
}

function readMask(image, mapped) {
  const fd = fs.openSync(image, 'r');
  try { return readUser(fd, mapped.trackLba, MASK_BYTES); }
  finally { fs.closeSync(fd); }
}

function readMessagePrefix(image, mapped, bytes) {
  const fd = fs.openSync(image, 'r');
  try { return readUser(fd, mapped.trackLba, bytes); }
  finally { fs.closeSync(fd); }
}

function unpackMask(packed) {
  if (packed.length !== MASK_BYTES) throw new Error(`expected 0x930 bytes, got 0x${packed.length.toString(16)}`);
  const pixels = new Uint8Array(WIDTH * HEIGHT);
  for (let index = 0; index < 588; index++) {
    const group = Math.floor(index / 196), column = index - group * 196, rowBase = group * 16;
    for (let wordIndex = 0; wordIndex < 2; wordIndex++) {
      let value = packed.readUInt16BE(index * 4 + wordIndex * 2);
      for (let pair = 0; pair < 8; pair++) {
        const y = rowBase + wordIndex * 8 + (7 - pair);
        pixels[y * WIDTH + column] = value & 3;
        value >>>= 2;
      }
    }
  }
  return pixels;
}

function packMask(pixels) {
  if (pixels.length !== WIDTH * HEIGHT) throw new Error(`expected ${WIDTH}x${HEIGHT} pixels`);
  const packed = Buffer.alloc(MASK_BYTES);
  for (let index = 0; index < 588; index++) {
    const group = Math.floor(index / 196), column = index - group * 196, rowBase = group * 16;
    for (let wordIndex = 0; wordIndex < 2; wordIndex++) {
      let value = 0;
      for (let pair = 0; pair < 8; pair++) {
        const color = pixels[(rowBase + wordIndex * 8 + (7 - pair)) * WIDTH + column];
        if (color > 3) throw new Error(`pixel value ${color} outside 0..3`);
        value |= color << (pair * 2);
      }
      packed.writeUInt16BE(value, index * 4 + wordIndex * 2);
    }
  }
  return packed;
}

function visibleRenderLimit(pixels) {
  let maxIndex = -1;
  for (let index = 0; index < 588; index++) {
    const group = Math.floor(index / 196), column = index - group * 196, rowBase = group * 16;
    for (let y = rowBase; y < rowBase + 16; y++) {
      if (pixels[y * WIDTH + column] !== 0) { maxIndex = index; break; }
    }
  }
  return maxIndex + 1;
}

function inspectReveal(prefix) {
  if (prefix.length < MASK_BYTES + REVEAL_COUNT_BYTES) throw new Error('message prefix is too short for reveal header');
  const count = prefix.readUInt32BE(MASK_BYTES);
  if (count < 1 || count > MAX_REVEAL_COUNT) throw new Error(`unsupported reveal count ${count}`);
  const boundaryBytes = (count + 1) * 4;
  if (prefix.length < MASK_BYTES + 4 + boundaryBytes) throw new Error('message prefix is too short for reveal boundaries');
  const boundaries = [];
  for (let index = 0; index <= count; index++) boundaries.push(prefix.readUInt32BE(MASK_BYTES + 4 + index * 4));
  if (!boundaries.every((value, index) => index === 0 || value >= boundaries[index - 1])) {
    throw new Error('reveal boundaries are not monotonic');
  }
  return { count, capacity: Math.min(588, count * REVEAL_STEP), boundaries };
}

function writePgm(outPath, pixels) {
  const lines = ['P2', '# SS Farland Saga 2 dialogue mask', `${WIDTH} ${HEIGHT}`, '3'];
  for (let y = 0; y < HEIGHT; y++) {
    const row = [];
    for (let x = 0; x < WIDTH; x++) row.push(String(pixels[y * WIDTH + x]));
    lines.push(row.join(' '));
  }
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
}

function readPgm(pgmPath) {
  const tokens = fs.readFileSync(pgmPath, 'utf8').split(/\r?\n/)
    .flatMap((line) => line.replace(/#.*/, '').trim().split(/\s+/).filter(Boolean));
  if (tokens.shift() !== 'P2') throw new Error('PGM must use P2 format');
  const width = Number(tokens.shift()), height = Number(tokens.shift()), max = Number(tokens.shift());
  if (width !== WIDTH || height !== HEIGHT || max !== 3) throw new Error(`PGM must be ${WIDTH}x${HEIGHT}, max 3`);
  if (tokens.length < WIDTH * HEIGHT) throw new Error('PGM has too few pixels');
  const pixels = new Uint8Array(WIDTH * HEIGHT);
  for (let i = 0; i < pixels.length; i++) {
    const value = Number(tokens[i]);
    if (!Number.isInteger(value) || value < 0 || value > 3) throw new Error(`invalid pixel ${tokens[i]} at ${i}`);
    pixels[i] = value;
  }
  return pixels;
}

function patchRawMask(outputPath, mapped, packed) {
  const fd = fs.openSync(outputPath, 'r+');
  const touched = [];
  try {
    for (let pos = 0; pos < packed.length;) {
      const sectorIndex = Math.floor(pos / USER), within = pos % USER;
      const count = Math.min(USER - within, packed.length - pos);
      const lba = mapped.trackLba + sectorIndex, rawOffset = lba * RAW;
      const sector = Buffer.alloc(RAW);
      if (fs.readSync(fd, sector, 0, RAW, rawOffset) !== RAW) throw new Error(`short raw read at LBA ${lba}`);
      if (!isMode1(sector)) throw new Error(`LBA ${lba} is not Mode 1`);
      packed.copy(sector, USER_OFFSET + within, pos, pos + count);
      recomputeMode1Sector(sector);
      fs.writeSync(fd, sector, 0, RAW, rawOffset);
      touched.push(lba);
      pos += count;
    }
  } finally { fs.closeSync(fd); }
  return touched;
}

const map = loadMap(imagePath);
if (mode === 'export') {
  const ids = rest.map((value) => Number.parseInt(value, 0));
  if (!ids.length || ids.some((value) => !Number.isInteger(value))) usage();
  fs.mkdirSync(thirdArg, { recursive: true });
  const manifest = [];
  for (const id of ids) {
    const mapped = mapMessage(map, id);
    const prefix = readMessagePrefix(imagePath, mapped, MASK_BYTES + 4 + (MAX_REVEAL_COUNT + 1) * 4);
    const pixels = unpackMask(prefix.subarray(0, MASK_BYTES));
    const reveal = inspectReveal(prefix);
    const outPath = path.join(thirdArg, `message-mask-${id}.pgm`);
    writePgm(outPath, pixels);
    manifest.push({ ...mapped, maskBytes: MASK_BYTES, width: WIDTH, height: HEIGHT,
      visibleEntries: visibleRenderLimit(pixels), revealCount: reveal.count,
      revealCapacity: reveal.capacity, outPath });
    console.log(`${id}: ${mapped.startSector}..${mapped.endSector} -> ${outPath}`);
  }
  fs.writeFileSync(path.join(thirdArg, 'message-mask-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
} else if (mode === 'verify') {
  const ids = [thirdArg, ...rest].map((value) => Number.parseInt(value, 0));
  if (ids.some((value) => !Number.isInteger(value))) usage();
  let failures = 0;
  for (const id of ids) {
    const mapped = mapMessage(map, id);
    const prefix = readMessagePrefix(imagePath, mapped, MASK_BYTES + 4 + (MAX_REVEAL_COUNT + 1) * 4);
    const original = prefix.subarray(0, MASK_BYTES), pixels = unpackMask(original), reveal = inspectReveal(prefix);
    const rebuilt = packMask(pixels), same = original.equals(rebuilt);
    const visible = visibleRenderLimit(pixels), fits = visible <= reveal.capacity;
    console.log(`${same && fits ? 'OK' : 'FAIL'} ${id}: mask round-trip, reveal ${visible}/${reveal.capacity}, sectors ${mapped.startSector}..${mapped.endSector}`);
    if (!same) failures++;
    if (!fits) failures++;
  }
  if (failures) process.exitCode = 1;
} else if (mode === 'patch') {
  const messageId = Number.parseInt(rest[0] || '', 0), pgmPath = rest[1];
  if (!Number.isInteger(messageId) || !pgmPath) usage();
  if (path.resolve(imagePath) === path.resolve(thirdArg)) throw new Error('output BIN must differ from input BIN');
  fs.mkdirSync(path.dirname(thirdArg), { recursive: true });
  const mapped = mapMessage(map, messageId), pixels = readPgm(pgmPath), packed = packMask(pixels);
  const prefix = readMessagePrefix(imagePath, mapped, MASK_BYTES + 4 + (MAX_REVEAL_COUNT + 1) * 4);
  const reveal = inspectReveal(prefix), visible = visibleRenderLimit(pixels);
  if (visible > reveal.capacity) {
    throw new Error(`message ${messageId} uses ${visible} reveal entries, exceeding original capacity ${reveal.capacity} (${reveal.count} x ${REVEAL_STEP})`);
  }
  fs.copyFileSync(imagePath, thirdArg);
  const touched = patchRawMask(thirdArg, mapped, packed);
  console.log(`${messageId}: patched 0x930 bytes; reveal ${visible}/${reveal.capacity}; processed Mode 1 EDC/ECC at LBA ${touched.join(', ')}`);
  console.log(`wrote ${thirdArg}`);
} else usage();
