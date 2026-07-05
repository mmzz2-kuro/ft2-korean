#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function usage() {
  console.error(
    'usage: node scripts/patch-dialogue-instant-display.js <input SLPS_019.03|raw.bin> <out file> [--restore] [--legacy] [--sector-size 2352] [--user-offset 24] [--user-size 2048]'
  );
  process.exit(1);
}

const argv = process.argv.slice(2);
const inputPath = argv.shift();
const outPath = argv.shift();
if (!inputPath || !outPath) usage();

let restore = false;
let legacy = false;
let sectorSize = 2352;
let userOffset = 24;
let userSize = 2048;

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--restore') {
    restore = true;
  } else if (arg === '--legacy') {
    legacy = true;
  } else if (arg === '--sector-size') {
    sectorSize = Number.parseInt(argv[++i] || '', 0);
  } else if (arg === '--user-offset') {
    userOffset = Number.parseInt(argv[++i] || '', 0);
  } else if (arg === '--user-size') {
    userSize = Number.parseInt(argv[++i] || '', 0);
  } else {
    usage();
  }
}

if (![sectorSize, userOffset, userSize].every(Number.isFinite)) usage();
if (sectorSize <= 0 || userOffset < 0 || userSize <= 0 || userOffset + userSize > sectorSize) {
  throw new Error('invalid raw sector layout');
}

const psxExeMagic = Buffer.from('PS-X EXE', 'ascii');
const patches = {
  branch: {
    off: 0x145f8,
    original: 0x10600008, // beq v1, zero, 0x8017ce1c
    legacy: 0x00000000, // nop, always continue into full render path
    voiceSafe: 0x10600008,
  },
  fullRenderReturnState: {
    off: 0x14618,
    original: 0x24020003, // addiu v0, zero, 3
    legacy: 0x24020003,
    voiceSafe: 0x24020002, // keep dialogue in the fully-rendered wait state
  },
  fullRenderVoiceGateClear: {
    off: 0x14610,
    original: 0xa78001dc, // sh zero, 476(gp)
    legacy: 0xa78001dc,
    voiceSafe: 0x00000000, // preserve the voice/dialogue gate set by the delayed path
  },
  delayedPathExit: {
    off: 0x14628,
    original: 0x24020001, // addiu v0, zero, 1
    legacy: 0x24020001,
    voiceSafe: 0x0805f382, // j 0x8017ce08, after jal 0x801958f0
  },
  delayedPathExitDelay: {
    off: 0x1462c,
    original: 0xa78201c0, // sh v0, 448(gp)
    legacy: 0xa78201c0,
    voiceSafe: 0x00000000, // nop delay slot before jumping to full render
  },
};

const patchMode = legacy ? 'legacy' : 'voiceSafe';

function patchWord(buffer, off, replacement, allowedCurrent, label) {
  const current = buffer.readUInt32LE(off);
  if (current === replacement) {
    console.log(`${label}: already target word at 0x${off.toString(16)}`);
    return false;
  }
  if (!allowedCurrent.includes(current)) {
    throw new Error(
      `${label}: unexpected word at 0x${off.toString(16)}: got 0x${current.toString(16).padStart(8, '0')}, expected one of ${allowedCurrent
        .map((word) => `0x${word.toString(16).padStart(8, '0')}`)
        .join(', ')}`
    );
  }
  buffer.writeUInt32LE(replacement, off);
  console.log(
    `${label}: 0x${off.toString(16)} 0x${current.toString(16).padStart(8, '0')} -> 0x${replacement.toString(16).padStart(8, '0')}`
  );
  return true;
}

function patchExe(buffer, mapExeOff, label) {
  const allowed = Object.values(patches).flatMap((patch) => [patch.original, patch.legacy, patch.voiceSafe]);
  for (const [name, patch] of Object.entries(patches)) {
    const replacement = restore ? patch.original : patch[patchMode];
    patchWord(buffer, mapExeOff(patch.off), replacement, [...new Set(allowed)], `${label} ${name}`);
  }
  console.log(
    `${label}: ${restore ? 'restored original dialogue display' : `applied ${patchMode} instant dialogue display`}`
  );
}

function findRawExeSector(buffer) {
  const sectorCount = Math.floor(buffer.length / sectorSize);
  for (let sector = 0; sector < sectorCount; sector++) {
    const off = sector * sectorSize + userOffset;
    if (buffer.subarray(off, off + psxExeMagic.length).equals(psxExeMagic)) return sector;
  }
  return -1;
}

function rawExeOffset(exeSector, exeOff) {
  const sectorDelta = Math.floor(exeOff / userSize);
  const inSector = exeOff % userSize;
  return (exeSector + sectorDelta) * sectorSize + userOffset + inSector;
}

const input = fs.readFileSync(inputPath);
const out = Buffer.from(input);

if (input.subarray(0, psxExeMagic.length).equals(psxExeMagic)) {
  patchExe(out, (exeOff) => exeOff, 'PS-X EXE');
} else {
  const exeSector = findRawExeSector(input);
  if (exeSector < 0) {
    throw new Error('input is neither a PS-X EXE nor a raw BIN containing a PS-X EXE sector');
  }
  patchExe(out, (exeOff) => rawExeOffset(exeSector, exeOff), `raw BIN sector ${exeSector}`);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out);
console.log(`wrote ${outPath}`);
