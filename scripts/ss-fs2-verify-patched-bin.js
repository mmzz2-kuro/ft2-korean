#!/usr/bin/env node

'use strict';

const fs = require('fs');
const { recomputeMode1Sector, isMode1 } = require('./cdrom-eccedc.js');

const [originalPath, patchedPath] = process.argv.slice(2);
if (!originalPath || !patchedPath) {
  console.error('usage: node scripts/ss-fs2-verify-patched-bin.js <original.bin> <patched.bin>');
  process.exit(1);
}

const RAW = 2352, USER_OFFSET = 16, USER_END = 2064;
const originalFd = fs.openSync(originalPath, 'r'), patchedFd = fs.openSync(patchedPath, 'r');
const originalStat = fs.fstatSync(originalFd), patchedStat = fs.fstatSync(patchedFd);
if (originalStat.size !== patchedStat.size || originalStat.size % RAW !== 0) throw new Error('BIN sizes differ or are not raw-sector aligned');

const original = Buffer.alloc(RAW), patched = Buffer.alloc(RAW);
const changed = [];
let userDiffBytes = 0, firstLogical = null, lastLogical = null, invalidParity = 0;
try {
  const sectors = originalStat.size / RAW;
  for (let lba = 0; lba < sectors; lba++) {
    fs.readSync(originalFd, original, 0, RAW, lba * RAW);
    fs.readSync(patchedFd, patched, 0, RAW, lba * RAW);
    if (original.equals(patched)) continue;
    changed.push(lba);
    for (let offset = USER_OFFSET; offset < USER_END; offset++) if (original[offset] !== patched[offset]) {
      const logical = lba * 2048 + offset - USER_OFFSET;
      userDiffBytes++;
      if (firstLogical === null) firstLogical = logical;
      lastLogical = logical;
    }
    if (!isMode1(patched)) {
      invalidParity++;
    } else {
      const rebuilt = Buffer.from(patched);
      recomputeMode1Sector(rebuilt);
      if (!rebuilt.subarray(2064).equals(patched.subarray(2064))) invalidParity++;
    }
  }
} finally {
  fs.closeSync(originalFd); fs.closeSync(patchedFd);
}

console.log(`changedLbas=${changed.join(',')}`);
console.log(`changedSectorCount=${changed.length}`);
console.log(`userDiffBytes=${userDiffBytes}`);
console.log(`logicalFirst=${firstLogical === null ? '-' : `0x${firstLogical.toString(16)}`}`);
console.log(`logicalLast=${lastLogical === null ? '-' : `0x${lastLogical.toString(16)}`}`);
console.log(`invalidMode1Parity=${invalidParity}`);
if (invalidParity) process.exitCode = 1;
