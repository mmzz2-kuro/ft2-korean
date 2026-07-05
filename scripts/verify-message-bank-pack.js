#!/usr/bin/env node

const fs = require('fs');

function usage() {
  console.error(
    'usage: node scripts/verify-message-bank-pack.js <FS2_FILE.DAT> <SLPS_019.03> <messageId...>'
  );
  process.exit(1);
}

const [datPath, exePath, ...idArgs] = process.argv.slice(2);
if (!datPath || !exePath || idArgs.length === 0) usage();

const ids = idArgs.map((value) => Number.parseInt(value, 0));
if (ids.some((value) => !Number.isFinite(value))) usage();

const dat = fs.readFileSync(datPath);
const exe = fs.readFileSync(exePath);
const loadAddr = exe.readUInt32LE(0x18);

const fs2SectorTableOff = 0x5c768;
const groupPointerTableAddr = 0x80169db0;
const colorTableAddr = 0x801cbb08;

function fileOffOfRam(addr) {
  return addr - loadAddr + 0x800;
}

function fs2Sector(index) {
  return exe.readUInt16LE(fs2SectorTableOff + index * 2);
}

function groupInfo(group) {
  const pointerTableOff = fileOffOfRam(groupPointerTableAddr);
  const tableAddr = exe.readUInt32LE(pointerTableOff + group * 4);
  const nextTableAddr = exe.readUInt32LE(pointerTableOff + (group + 1) * 4);
  if (tableAddr < loadAddr || tableAddr >= loadAddr + exe.length) {
    throw new Error(`group ${group} table pointer out of EXE range: 0x${tableAddr.toString(16)}`);
  }
  if (nextTableAddr <= tableAddr || nextTableAddr > loadAddr + exe.length) {
    throw new Error(`group ${group} next table pointer is not usable: 0x${nextTableAddr.toString(16)}`);
  }
  return {
    tableOff: fileOffOfRam(tableAddr),
    count: Math.floor((nextTableAddr - tableAddr) / 2),
    baseSector: fs2Sector(4451 + group * 2),
  };
}

function mapMessageId(messageId) {
  const n = messageId - 1001;
  if (n < 0) throw new Error(`messageId ${messageId} is below 1001`);
  const group = Math.floor(n / 1000);
  const index = n % 1000;
  const info = groupInfo(group);
  if (index + 1 >= info.count) {
    throw new Error(`messageId ${messageId} index ${index} is outside group ${group} count ${info.count}`);
  }

  const relStart = exe.readUInt16LE(info.tableOff + index * 2);
  const relEnd = exe.readUInt16LE(info.tableOff + (index + 1) * 2);
  if (relEnd <= relStart) throw new Error(`messageId ${messageId} has empty or reversed sector span`);

  const sectorStart = info.baseSector + relStart;
  const sectorEnd = info.baseSector + relEnd;
  return {
    messageId,
    group,
    index,
    sectorStart,
    sectorEnd,
    byteStart: sectorStart * 2048,
    byteEnd: sectorEnd * 2048,
  };
}

function swap16Range(buffer, start, length) {
  for (let off = start; off < start + length; off += 2) {
    const a = buffer[off];
    buffer[off] = buffer[off + 1];
    buffer[off + 1] = a;
  }
}

function swap32Range(buffer, start, length) {
  for (let off = start; off < start + length; off += 4) {
    const a = buffer[off];
    const b = buffer[off + 1];
    buffer[off] = buffer[off + 3];
    buffer[off + 1] = buffer[off + 2];
    buffer[off + 2] = b;
    buffer[off + 3] = a;
  }
}

function preprocessCommon(block) {
  const common = Buffer.alloc(Math.max(0x4000, 0x1000 + block.length));
  block.copy(common, 0x1000);
  swap16Range(common, 0x1000, 0x930);
  swap32Range(common, 0x1930, 0xd0);
  return common;
}

function readPalette() {
  const off = fileOffOfRam(colorTableAddr);
  return [...exe.subarray(off, off + 4)];
}

function renderMask(common) {
  const palette = readPalette();
  const pixels = new Uint8Array(200 * 48);
  pixels.fill(palette[0]);

  for (let index = 0; index < 588; index++) {
    const group = Math.floor(index / 196);
    const column = index - group * 196;
    const rowBase = group * 16;
    const sourceOff = 0x1000 + index * 4;
    const words = [common.readUInt16LE(sourceOff), common.readUInt16LE(sourceOff + 2)];

    for (let wordIndex = 0; wordIndex < 2; wordIndex++) {
      let value = words[wordIndex];
      for (let bitPair = 0; bitPair < 8; bitPair++) {
        const y = rowBase + wordIndex * 8 + (7 - bitPair);
        pixels[y * 200 + column] = palette[value & 0x03];
        value >>>= 2;
      }
    }
  }

  return pixels;
}

function paletteIndexOf(value, palette) {
  const index = palette.indexOf(value);
  if (index < 0) throw new Error(`pixel value 0x${value.toString(16)} is not in the dialogue palette`);
  return index;
}

function packMask(pixels) {
  if (pixels.length !== 200 * 48) throw new Error(`expected 200x48 pixels, got ${pixels.length}`);

  const palette = readPalette();
  const packed = Buffer.alloc(0x930);

  for (let index = 0; index < 588; index++) {
    const group = Math.floor(index / 196);
    const column = index - group * 196;
    const rowBase = group * 16;

    for (let wordIndex = 0; wordIndex < 2; wordIndex++) {
      let value = 0;
      for (let bitPair = 0; bitPair < 8; bitPair++) {
        const y = rowBase + wordIndex * 8 + (7 - bitPair);
        const color = paletteIndexOf(pixels[y * 200 + column], palette);
        value |= color << (bitPair * 2);
      }
      packed.writeUInt16LE(value, index * 4 + wordIndex * 2);
    }
  }

  return packed;
}

let failures = 0;
for (const id of ids) {
  const mapped = mapMessageId(id);
  const block = dat.subarray(mapped.byteStart, mapped.byteEnd);
  const common = preprocessCommon(block);
  const pixels = renderMask(common);
  const repacked = packMask(pixels);
  const original = common.subarray(0x1000, 0x1930);

  let mismatch = -1;
  for (let i = 0; i < original.length; i++) {
    if (original[i] !== repacked[i]) {
      mismatch = i;
      break;
    }
  }

  if (mismatch >= 0) {
    failures++;
    console.log(
      `FAIL ${id}: first mismatch at 0x${mismatch.toString(16)} original=0x${original[mismatch].toString(16)} repacked=0x${repacked[mismatch].toString(16)}`
    );
  } else {
    console.log(
      `OK ${id}: mask 0x930 bytes round-trips, sectors ${mapped.sectorStart}..${mapped.sectorEnd}`
    );
  }
}

if (failures > 0) process.exit(1);
