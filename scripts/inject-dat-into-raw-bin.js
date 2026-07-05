#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function usage() {
  console.error(
    'usage: node scripts/inject-dat-into-raw-bin.js <source.bin> <patched-FS2_FILE.DAT> <out.bin> [--lba 223] [--sector-size 2352] [--user-offset 24] [--user-size 2048]'
  );
  process.exit(1);
}

const argv = process.argv.slice(2);
const sourceBinPath = argv.shift();
const datPath = argv.shift();
const outBinPath = argv.shift();
if (!sourceBinPath || !datPath || !outBinPath) usage();

let lba = 223;
let sectorSize = 2352;
let userOffset = 24;
let userSize = 2048;

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--lba') {
    lba = Number.parseInt(argv[++i] || '', 0);
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

if (![lba, sectorSize, userOffset, userSize].every(Number.isFinite)) usage();
if (lba < 0 || sectorSize <= 0 || userOffset < 0 || userSize <= 0 || userOffset + userSize > sectorSize) {
  throw new Error('invalid raw sector layout');
}

const sourceBin = fs.readFileSync(sourceBinPath);
const dat = fs.readFileSync(datPath);
if (dat.length % userSize !== 0) {
  throw new Error(`DAT size ${dat.length} is not aligned to user size ${userSize}`);
}

const sectors = dat.length / userSize;
const firstWrite = lba * sectorSize + userOffset;
const lastWriteEnd = (lba + sectors - 1) * sectorSize + userOffset + userSize;
if (lastWriteEnd > sourceBin.length) {
  throw new Error(`DAT does not fit in BIN: write end 0x${lastWriteEnd.toString(16)}, bin size 0x${sourceBin.length.toString(16)}`);
}

const outBin = Buffer.from(sourceBin);
for (let sector = 0; sector < sectors; sector++) {
  const datOff = sector * userSize;
  const binOff = (lba + sector) * sectorSize + userOffset;
  dat.copy(outBin, binOff, datOff, datOff + userSize);
}

fs.mkdirSync(path.dirname(outBinPath), { recursive: true });
fs.writeFileSync(outBinPath, outBin);
console.log(`injected ${dat.length} bytes (${sectors} sectors) at LBA ${lba}`);
console.log(`first user-data write 0x${firstWrite.toString(16)}, last end 0x${lastWriteEnd.toString(16)}`);
console.log(`wrote ${outBinPath}`);
