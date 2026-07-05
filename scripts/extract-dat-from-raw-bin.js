#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function usage() {
  console.error(
    'usage: node scripts/extract-dat-from-raw-bin.js <source.bin> <out-FS2_FILE.DAT> [--lba 223] [--sectors 119472] [--bytes N] [--sector-size 2352] [--user-offset 24] [--user-size 2048]'
  );
  process.exit(1);
}

const argv = process.argv.slice(2);
const sourceBinPath = argv.shift();
const outDatPath = argv.shift();
if (!sourceBinPath || !outDatPath) usage();

let lba = 223;
let sectors = 119472;
let bytes = null;
let sectorSize = 2352;
let userOffset = 24;
let userSize = 2048;

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--lba') {
    lba = Number.parseInt(argv[++i] || '', 0);
  } else if (arg === '--sectors') {
    sectors = Number.parseInt(argv[++i] || '', 0);
  } else if (arg === '--bytes') {
    bytes = Number.parseInt(argv[++i] || '', 0);
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

if (bytes !== null) {
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes % userSize !== 0) {
    throw new Error(`--bytes must be a positive multiple of user size ${userSize}`);
  }
  sectors = bytes / userSize;
}

if (![lba, sectors, sectorSize, userOffset, userSize].every(Number.isFinite)) usage();
if (lba < 0 || sectors <= 0 || sectorSize <= 0 || userOffset < 0 || userSize <= 0 || userOffset + userSize > sectorSize) {
  throw new Error('invalid raw sector layout');
}

const sourceBin = fs.readFileSync(sourceBinPath);
const expectedDatSize = sectors * userSize;
if (sourceBin.length === expectedDatSize) {
  fs.mkdirSync(path.dirname(outDatPath), { recursive: true });
  fs.writeFileSync(outDatPath, sourceBin);
  console.log(`source size is already ${expectedDatSize} bytes (${sectors} user-data sectors)`);
  console.log('treated source as an already-extracted FS2_FILE.DAT payload');
  console.log(`wrote ${outDatPath}`);
  process.exit(0);
}

const firstRead = lba * sectorSize + userOffset;
const lastReadEnd = (lba + sectors - 1) * sectorSize + userOffset + userSize;
if (lastReadEnd > sourceBin.length) {
  throw new Error(`DAT does not fit in BIN: read end 0x${lastReadEnd.toString(16)}, bin size 0x${sourceBin.length.toString(16)}`);
}

const outDat = Buffer.alloc(sectors * userSize);
for (let sector = 0; sector < sectors; sector++) {
  const binOff = (lba + sector) * sectorSize + userOffset;
  const datOff = sector * userSize;
  sourceBin.copy(outDat, datOff, binOff, binOff + userSize);
}

fs.mkdirSync(path.dirname(outDatPath), { recursive: true });
fs.writeFileSync(outDatPath, outDat);
console.log(`extracted ${outDat.length} bytes (${sectors} sectors) from LBA ${lba}`);
console.log(`first user-data read 0x${firstRead.toString(16)}, last end 0x${lastReadEnd.toString(16)}`);
console.log(`wrote ${outDatPath}`);
