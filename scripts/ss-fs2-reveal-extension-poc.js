#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { recomputeMode1Sector, isMode1 } = require('./cdrom-eccedc.js');

const [inputBin, outputBin, ...patchArgs] = process.argv.slice(2);
if (!inputBin || !outputBin || patchArgs.length < 2) {
  console.error('usage: node scripts/ss-fs2-reveal-extension-poc.js <input-track1.bin> <output-track1.bin> <messageId> <ko.pgm> [...]');
  console.error('   or: node scripts/ss-fs2-reveal-extension-poc.js <input-track1.bin> <output-track1.bin> --overflow-preflight <preflight.json> <pgm-directory>');
  console.error('   or: node scripts/ss-fs2-reveal-extension-poc.js <input-track1.bin> <output-track1.bin> --finale-map <finale-map.json> <pgm-directory>');
  process.exit(1);
}
let patchSpecs = [];
if (patchArgs[0] === '--overflow-preflight') {
  if (patchArgs.length !== 3) throw new Error('--overflow-preflight requires <preflight.json> <pgm-directory>');
  const preflight = JSON.parse(fs.readFileSync(patchArgs[1], 'utf8'));
  if (!Array.isArray(preflight.rejectedEntries)) throw new Error('preflight rejectedEntries is missing');
  patchSpecs = preflight.rejectedEntries
    .filter((item) => item.category === 'reveal-overflow')
    .map((item) => ({
      messageId: item.messageId,
      pgmPath: path.join(patchArgs[2], `message-mask-${item.messageId}-ko.pgm`),
    }));
  if (patchSpecs.length === 0) throw new Error('preflight has no reveal-overflow entries');
} else if (patchArgs[0] === '--finale-map') {
  if (patchArgs.length !== 3) throw new Error('--finale-map requires <finale-map.json> <pgm-directory>');
  const finaleMap = JSON.parse(fs.readFileSync(patchArgs[1], 'utf8'));
  if (!Array.isArray(finaleMap.entries)) throw new Error('finale map entries are missing');
  for (let messageId = 17001; messageId <= 17220; messageId++) {
    const source = finaleMap.entries.find((entry) => entry.koText.trim() &&
      entry.matches.some((match) => match.messageIdsAtStart.includes(messageId)));
    if (!source) throw new Error(`no translated finale mapping for message ${messageId}`);
    patchSpecs.push({
      messageId,
      pgmPath: path.join(patchArgs[2], `finale-text-${source.address.replace(/^0x/, '')}-ko.pgm`),
      sourceAddress: source.address,
    });
  }
} else {
  if (patchArgs.length % 2 !== 0) throw new Error('message patch arguments must be <messageId> <ko.pgm> pairs');
  for (let index = 0; index < patchArgs.length; index += 2) {
    const messageId = Number.parseInt(patchArgs[index], 0);
    if (!Number.isInteger(messageId)) throw new Error(`invalid message ID: ${patchArgs[index]}`);
    patchSpecs.push({ messageId, pgmPath: patchArgs[index + 1] });
  }
}
if (new Set(patchSpecs.map((item) => item.messageId)).size !== patchSpecs.length) throw new Error('duplicate message ID');
if (path.resolve(inputBin) === path.resolve(outputBin)) throw new Error('input and output BIN must differ');

const RAW = 2352, USER = 2048, UOFF = 16, EXE_LBA = 21, DATA_LBA = 178, EXE_BYTES = 319524;
const BASE = 0x06010000, TABLE = 0x1ae9c, ZERO_INDEX = 4336, GROUP_TABLE = 0x0602e5ac;
const MASK_BYTES = 0x930, WIDTH = 200, HEIGHT = 48;
const CAVE_OFF = 0x4dd40, CAVE_ADDR = BASE + CAVE_OFF, SCRATCH_ADDR = 0x0607b800;
const ORIGINAL_REVEAL = 0x060202a0, SOURCE_LITERAL_OFF = 0x10314, CALL_LITERAL_OFF = 0x103fc;

function readUser(fd, lba, bytes) {
  const out = Buffer.alloc(bytes);
  for (let pos = 0; pos < bytes;) {
    const sector = Math.floor(pos / USER), within = pos % USER, count = Math.min(USER - within, bytes - pos);
    if (fs.readSync(fd, out, pos, count, (lba + sector) * RAW + UOFF + within) !== count) throw new Error(`short read LBA ${lba + sector}`);
    pos += count;
  }
  return out;
}

function loadMap(fd) {
  const exe = readUser(fd, EXE_LBA, EXE_BYTES);
  let previous = exe.readUInt16BE(TABLE + (ZERO_INDEX - 1) * 2), carry = 0;
  const bases = [];
  for (let group = 0; group < 17; group++) {
    const start = exe.readUInt16BE(TABLE + (ZERO_INDEX + group * 2) * 2);
    const end = exe.readUInt16BE(TABLE + (ZERO_INDEX + group * 2 + 1) * 2);
    if (start < previous) carry += 0x10000;
    if (end < start) carry += 0x10000;
    bases.push(end + carry); previous = end;
  }
  return { exe, bases };
}

function mapMessage(map, id) {
  const n = id - 1001, group = Math.floor(n / 1000), index = n % 1000;
  if (group < 0 || group >= 17 || index < 0) throw new Error('invalid message ID');
  const table = map.exe.readUInt32BE(GROUP_TABLE - BASE + group * 4) - BASE;
  const first = map.exe.readUInt16BE(table + index * 2), last = map.exe.readUInt16BE(table + (index + 1) * 2);
  if (last <= first) throw new Error('empty/reversed message slot');
  return { group, index, startSector: map.bases[group] + first, endSector: map.bases[group] + last,
    trackLba: DATA_LBA + map.bases[group] + first };
}

function readPgm(filePath) {
  const tokens = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
    .flatMap((line) => line.replace(/#.*/, '').trim().split(/\s+/).filter(Boolean));
  if (tokens.shift() !== 'P2' || Number(tokens.shift()) !== WIDTH || Number(tokens.shift()) !== HEIGHT || Number(tokens.shift()) !== 3) {
    throw new Error('PGM must be P2 200x48 max 3');
  }
  const pixels = new Uint8Array(WIDTH * HEIGHT);
  if (tokens.length < pixels.length) throw new Error('PGM has too few pixels');
  for (let i = 0; i < pixels.length; i++) {
    const value = Number(tokens[i]);
    if (!Number.isInteger(value) || value < 0 || value > 3) throw new Error(`invalid pixel ${i}`);
    pixels[i] = value;
  }
  return pixels;
}

function visibleLimit(pixels) {
  let last = -1;
  for (let index = 0; index < 588; index++) {
    const band = Math.floor(index / 196), x = index % 196, y0 = band * 16;
    for (let y = y0; y < y0 + 16; y++) if (pixels[y * WIDTH + x]) { last = index; break; }
  }
  return last + 1;
}

function packMask(pixels) {
  const out = Buffer.alloc(MASK_BYTES);
  for (let index = 0; index < 588; index++) {
    const band = Math.floor(index / 196), x = index % 196, y0 = band * 16;
    for (let word = 0; word < 2; word++) {
      let value = 0;
      for (let pair = 0; pair < 8; pair++) value |= pixels[(y0 + word * 8 + 7 - pair) * WIDTH + x] << (pair * 2);
      out.writeUInt16BE(value, index * 4 + word * 2);
    }
  }
  return out;
}

class Asm {
  constructor(address) { this.address = address; this.words = []; this.labels = new Map(); this.branches = []; this.literals = []; }
  op(word) { this.words.push(word & 0xffff); }
  label(name) { this.labels.set(name, this.words.length); }
  branch(base, label) { this.branches.push({ index: this.words.length, base, label }); this.op(base); }
  literal(reg, value) { this.literals.push({ index: this.words.length, reg, value }); this.op(0xd000 | (reg << 8)); }
  finish() {
    if (this.words.length & 1) this.op(0x0009);
    const literalStart = this.words.length * 2;
    for (const item of this.literals) {
      const pc = this.address + item.index * 2;
      const literalAddress = this.address + literalStart + this.literals.indexOf(item) * 4;
      const disp = (literalAddress - ((pc & ~3) + 4)) / 4;
      if (!Number.isInteger(disp) || disp < 0 || disp > 255) throw new Error('literal out of range');
      this.words[item.index] = 0xd000 | (item.reg << 8) | disp;
    }
    for (const item of this.branches) {
      const target = this.labels.get(item.label);
      if (target === undefined) throw new Error(`missing label ${item.label}`);
      const disp = target - item.index - 2;
      if (disp < -128 || disp > 127) throw new Error('branch out of range');
      this.words[item.index] = item.base | (disp & 0xff);
    }
    const out = Buffer.alloc(literalStart + this.literals.length * 4);
    this.words.forEach((word, index) => out.writeUInt16BE(word, index * 2));
    this.literals.forEach((item, index) => out.writeUInt32BE(item.value, literalStart + index * 4));
    return out;
  }
}

function buildTrampoline() {
  const a = new Asm(CAVE_ADDR);
  const mov = (m, n) => a.op(0x6003 | (n << 8) | (m << 4));
  const extuw = (m, n) => a.op(0x600d | (n << 8) | (m << 4));
  a.literal(6, 0x0607c560);           // original header
  mov(6, 1); a.op(0x7102);            // R1=header+2
  a.op(0x6211); extuw(2, 2);          // R2=original count
  a.op(0x6361); extuw(3, 3);          // R3=extension count (high u16)
  a.op(0x2338);                       // TST R3,R3
  a.branch(0x8900, 'use_original');
  a.op(0x3322);                       // CMP/HS R2,R3
  a.branch(0x8900, 'desired_ok');
  a.label('use_original'); mov(2, 3);
  a.label('desired_ok');
  a.literal(7, SCRATCH_ADDR);
  a.op(0x2732);                       // MOV.L R3,@R7
  a.op(0x7704); a.op(0x7604);         // dest/source +=4
  mov(2, 0); a.op(0x7001);            // copy originalCount+1 boundaries
  a.label('copy_loop');
  a.op(0x6466);                       // MOV.L @R6+,R4
  a.op(0x2742); a.op(0x7704);         // MOV.L R4,@R7; dest+=4
  a.op(0x4010); a.branch(0x8b00, 'copy_loop');
  mov(3, 5); a.op(0x3528);            // R5=desired-original
  a.op(0x2558); a.branch(0x8900, 'jump_original');
  a.label('fill_loop');
  a.op(0x2742); a.op(0x7704);         // repeat terminal boundary
  a.op(0x4510); a.branch(0x8b00, 'fill_loop');
  a.label('jump_original');
  a.literal(0, ORIGINAL_REVEAL);
  a.op(0x402b); a.op(0x0009);         // JMP @R0; NOP
  return a.finish();
}

function patchLogical(fd, logicalLba, logicalOffset, data, touched) {
  for (let pos = 0; pos < data.length;) {
    const absolute = logicalOffset + pos, sectorIndex = Math.floor(absolute / USER), within = absolute % USER;
    const count = Math.min(USER - within, data.length - pos), lba = logicalLba + sectorIndex;
    const sector = Buffer.alloc(RAW), rawOffset = lba * RAW;
    if (fs.readSync(fd, sector, 0, RAW, rawOffset) !== RAW || !isMode1(sector)) throw new Error(`invalid Mode 1 LBA ${lba}`);
    data.copy(sector, UOFF + within, pos, pos + count); recomputeMode1Sector(sector);
    fs.writeSync(fd, sector, 0, RAW, rawOffset); touched.add(lba); pos += count;
  }
}

const inFd = fs.openSync(inputBin, 'r'), map = loadMap(inFd);
const patches = patchSpecs.map(({ messageId, pgmPath }) => {
  const mapped = mapMessage(map, messageId);
  const prefix = readUser(inFd, mapped.trackLba, MASK_BYTES + 8);
  const originalCount = prefix.readUInt16BE(MASK_BYTES + 2), pixels = readPgm(pgmPath), visible = visibleLimit(pixels);
  const desiredCount = Math.ceil(visible / 14);
  if (desiredCount > 42) throw new Error(`message ${messageId} desired count ${desiredCount} exceeds 42`);
  return { messageId, mapped, originalCount, pixels, visible, desiredCount,
    extensionCount: desiredCount > originalCount ? desiredCount : 0 };
});
fs.closeSync(inFd);
const trampoline = buildTrampoline();
const originalExecutable = map.exe.readUInt32BE(SOURCE_LITERAL_OFF) === 0x0607c560 &&
  map.exe.readUInt32BE(CALL_LITERAL_OFF) === ORIGINAL_REVEAL &&
  map.exe.subarray(CAVE_OFF, CAVE_OFF + 0x200).every((value) => value === 0);
const patchedExecutable = map.exe.readUInt32BE(SOURCE_LITERAL_OFF) === SCRATCH_ADDR &&
  map.exe.readUInt32BE(CALL_LITERAL_OFF) === CAVE_ADDR &&
  map.exe.subarray(CAVE_OFF, CAVE_OFF + trampoline.length).equals(trampoline);
if (!originalExecutable && !patchedExecutable) throw new Error('input executable is neither original nor recognized reveal-extension build');

fs.mkdirSync(path.dirname(outputBin), { recursive: true }); fs.copyFileSync(inputBin, outputBin);
const outFd = fs.openSync(outputBin, 'r+'), touched = new Set();
try {
  for (const patch of patches) {
    patchLogical(outFd, patch.mapped.trackLba, 0, packMask(patch.pixels), touched);
    const extendedWord = Buffer.alloc(2); extendedWord.writeUInt16BE(patch.extensionCount);
    patchLogical(outFd, patch.mapped.trackLba, MASK_BYTES, extendedWord, touched);
  }
  if (originalExecutable) {
    patchLogical(outFd, EXE_LBA, CAVE_OFF, trampoline, touched);
    const scratchLiteral = Buffer.alloc(4); scratchLiteral.writeUInt32BE(SCRATCH_ADDR);
    patchLogical(outFd, EXE_LBA, SOURCE_LITERAL_OFF, scratchLiteral, touched);
    const callLiteral = Buffer.alloc(4); callLiteral.writeUInt32BE(CAVE_ADDR);
    patchLogical(outFd, EXE_LBA, CALL_LITERAL_OFF, callLiteral, touched);
  }

  for (const patch of patches) {
    const patchedHeader = readUser(outFd, patch.mapped.trackLba, MASK_BYTES + 4);
    if (patchedHeader.readUInt16BE(MASK_BYTES) !== patch.extensionCount ||
        patchedHeader.readUInt16BE(MASK_BYTES + 2) !== patch.originalCount) {
      throw new Error(`message ${patch.messageId} post-write reveal count verification failed`);
    }
    console.log(`message=${patch.messageId} visible=${patch.visible} originalCount=${patch.originalCount} desiredCount=${patch.desiredCount} extension=${patch.extensionCount}`);
    console.log(`headerHigh=${patchedHeader.readUInt16BE(MASK_BYTES)} headerLow=${patchedHeader.readUInt16BE(MASK_BYTES + 2)}`);
  }
  const patchedExe = readUser(outFd, EXE_LBA, EXE_BYTES);
  if (patchedExe.readUInt32BE(SOURCE_LITERAL_OFF) !== SCRATCH_ADDR ||
      patchedExe.readUInt32BE(CALL_LITERAL_OFF) !== CAVE_ADDR) {
    throw new Error('post-write executable literal verification failed');
  }
  if (!patchedExe.subarray(CAVE_OFF, CAVE_OFF + trampoline.length).equals(trampoline)) {
    throw new Error('post-write trampoline verification failed');
  }
  console.log(`trampoline=0x${CAVE_ADDR.toString(16)} bytes=${trampoline.length} scratch=0x${SCRATCH_ADDR.toString(16)}`);
  console.log(`executable=${originalExecutable ? 'injected' : 'already-patched'}`);
  console.log(`summary patches=${patches.length} fitted=${patches.filter((patch) => patch.extensionCount === 0).length} extended=${patches.filter((patch) => patch.extensionCount > 0).length}`);
  console.log(`touchedLbas=${[...touched].sort((a,b)=>a-b).join(',')}`);
  console.log(`wrote ${outputBin}`);
} finally { fs.closeSync(outFd); }
