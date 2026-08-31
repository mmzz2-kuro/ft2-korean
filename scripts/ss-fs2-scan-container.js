#!/usr/bin/env node

'use strict';

const fs = require('fs');

const RAW_SECTOR_SIZE = 2352;
const USER_DATA_OFFSET = 16;
const USER_DATA_SIZE = 2048;

function usage() {
  console.error(
    'usage: node scripts/ss-fs2-scan-container.js <track1.bin> ' +
      '[--lba 178] [--bytes 448993280] [--limit 40] [--compare-flat FILE] [--ids 0-30,309]'
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const imagePath = args.shift();
if (!imagePath) usage();

let lba = 178;
let byteLength = 448993280;
let limit = 40;
let compareFlatPath = null;
let idsSpec = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--lba') lba = Number.parseInt(args[++i] || '', 0);
  else if (arg === '--bytes') byteLength = Number.parseInt(args[++i] || '', 0);
  else if (arg === '--limit') limit = Number.parseInt(args[++i] || '', 0);
  else if (arg === '--compare-flat') compareFlatPath = args[++i] || null;
  else if (arg === '--ids') idsSpec = args[++i] || null;
  else usage();
}

if (![lba, byteLength, limit].every(Number.isSafeInteger) || lba < 0 || byteLength <= 0 || limit <= 0) {
  throw new Error('invalid numeric option');
}

const imageFd = fs.openSync(imagePath, 'r');
const imageSize = fs.fstatSync(imageFd).size;
const sector = Buffer.alloc(USER_DATA_SIZE);

function readSector(relativeSector) {
  const rawOffset = (lba + relativeSector) * RAW_SECTOR_SIZE + USER_DATA_OFFSET;
  if (rawOffset + USER_DATA_SIZE > imageSize) {
    throw new Error(`container sector ${relativeSector} is outside the track image`);
  }
  const got = fs.readSync(imageFd, sector, 0, USER_DATA_SIZE, rawOffset);
  if (got !== USER_DATA_SIZE) throw new Error(`short read at container sector ${relativeSector}`);
  return sector;
}

function readIsoFileBytes(isoFileLba, logicalOffset, count) {
  const output = Buffer.alloc(count);
  for (let position = 0; position < count; ) {
    const absolute = logicalOffset + position;
    const relativeSector = Math.floor(absolute / USER_DATA_SIZE);
    const withinSector = absolute % USER_DATA_SIZE;
    const take = Math.min(USER_DATA_SIZE - withinSector, count - position);
    const rawOffset = (isoFileLba + relativeSector) * RAW_SECTOR_SIZE + USER_DATA_OFFSET + withinSector;
    if (rawOffset + take > imageSize) throw new Error('ISO file read exceeds track image');
    const got = fs.readSync(imageFd, output, position, take, rawOffset);
    if (got !== take) throw new Error(`short ISO file read at logical offset ${absolute}`);
    position += take;
  }
  return output;
}

function headerAtSector(relativeSector) {
  const data = readSector(relativeSector);
  const a = data.readUInt32BE(0);
  const b = data.readUInt32BE(4);
  const payloadSize = data.readUInt32BE(8);
  const d = data.readUInt32BE(12);
  const offset = relativeSector * USER_DATA_SIZE;
  const payloadEnd = offset + 16 + payloadSize;
  const next = Math.ceil(payloadEnd / USER_DATA_SIZE) * USER_DATA_SIZE;
  const plausible =
    payloadSize > 0 &&
    payloadSize <= 0x400000 &&
    payloadEnd <= byteLength &&
    a <= 10000 &&
    b <= 10000 &&
    d <= 0x1000000;
  return { relativeSector, offset, a, b, payloadSize, d, next, plausible };
}

function hex(value, width = 0) {
  return `0x${value.toString(16).padStart(width, '0')}`;
}

function parseIds(spec) {
  if (!spec) return [];
  const ids = [];
  for (const part of spec.split(',')) {
    const match = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!match) throw new Error(`invalid --ids item: ${part}`);
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (end < start) throw new Error(`descending --ids range: ${part}`);
    for (let id = start; id <= end; id++) ids.push(id);
  }
  return [...new Set(ids)];
}

function classifyResource(data, allocatedBytes) {
  let zero = true;
  let ff = true;
  for (let i = 0; i < Math.min(data.length, 0x400); i++) {
    if (data[i] !== 0) zero = false;
    if (data[i] !== 0xff) ff = false;
  }
  if (zero) return 'zero-prefix';
  if (ff) return 'ff-prefix';
  if (data.length >= 16) {
    const a = data.readUInt32BE(0);
    const b = data.readUInt32BE(4);
    const payload = data.readUInt32BE(8);
    const d = data.readUInt32BE(12);
    const padded = Math.ceil((16 + payload) / USER_DATA_SIZE) * USER_DATA_SIZE;
    if (payload > 0 && payload <= allocatedBytes && a < 10000 && b < 10000 && d < 0x1000000 && padded <= allocatedBytes) {
      return `be-hdr(${a},${b},${hex(payload)},${hex(d)})`;
    }
  }
  if (data.length >= 4 && data.readUInt32BE(0) === 0x400) return 'raw-0x400';
  if (data.length >= 4 && data.readUInt32LE(0) === 0x10) return 'tim?';
  return 'other';
}

try {
  const sectors = Math.ceil(byteLength / USER_DATA_SIZE);
  console.log(`image=${imagePath}`);
  console.log(`containerLba=${lba} bytes=${byteLength} sectors=${sectors}`);
  console.log('sector-aligned plausible block headers:');
  let hits = 0;
  for (let relativeSector = 0; relativeSector < sectors && hits < limit; relativeSector++) {
    const header = headerAtSector(relativeSector);
    if (!header.plausible) continue;
    console.log(
      [
        `sector=${header.relativeSector}`,
        `off=${hex(header.offset, 8)}`,
        `a=${header.a}`,
        `b=${header.b}`,
        `payload=${hex(header.payloadSize)}`,
        `d=${hex(header.d)}`,
        `next=${hex(header.next, 8)}`,
      ].join(' ')
    );
    hits++;
  }

  if (compareFlatPath) {
    const flatFd = fs.openSync(compareFlatPath, 'r');
    const flatSize = fs.fstatSync(flatFd).size;
    const flatSector = Buffer.alloc(USER_DATA_SIZE);
    const comparableSectors = Math.min(sectors, Math.floor(flatSize / USER_DATA_SIZE));
    let firstMismatchSector = -1;
    let firstMismatchByte = -1;
    try {
      for (let i = 0; i < comparableSectors; i++) {
        const rawData = readSector(i);
        const got = fs.readSync(flatFd, flatSector, 0, USER_DATA_SIZE, i * USER_DATA_SIZE);
        if (got !== USER_DATA_SIZE) throw new Error(`short flat-file read at sector ${i}`);
        if (!rawData.equals(flatSector)) {
          firstMismatchSector = i;
          for (let j = 0; j < USER_DATA_SIZE; j++) {
            if (rawData[j] !== flatSector[j]) {
              firstMismatchByte = j;
              break;
            }
          }
          break;
        }
      }
    } finally {
      fs.closeSync(flatFd);
    }

    console.log('comparison:');
    console.log(`flat=${compareFlatPath} bytes=${flatSize} sectors=${flatSize / USER_DATA_SIZE}`);
    if (firstMismatchSector < 0) {
      console.log(`commonPrefix=${comparableSectors * USER_DATA_SIZE} (all comparable full sectors)`);
    } else {
      const mismatchOffset = firstMismatchSector * USER_DATA_SIZE + firstMismatchByte;
      console.log(`firstMismatchSector=${firstMismatchSector}`);
      console.log(`firstMismatchByte=${firstMismatchByte}`);
      console.log(`commonPrefix=${mismatchOffset} (${hex(mismatchOffset)})`);
    }
  }

  const ids = parseIds(idsSpec);
  if (ids.length > 0) {
    const tableOffset = 0x1ae9c;
    const table = readIsoFileBytes(21, tableOffset, (Math.max(...ids) + 2) * 2);
    console.log('resources:');
    for (const id of ids) {
      const startSector = table.readUInt16BE(id * 2);
      const endSector = table.readUInt16BE(id * 2 + 2);
      if (endSector <= startSector) {
        console.log(`id=${id} start=${startSector} end=${endSector} wrap/check`);
        continue;
      }
      const allocatedBytes = (endSector - startSector) * USER_DATA_SIZE;
      const sample = readIsoFileBytes(lba, startSector * USER_DATA_SIZE, Math.min(0x400, allocatedBytes));
      const first = sample.subarray(0, Math.min(32, allocatedBytes));
      console.log(
        `id=${id} sector=${startSector}..${endSector} off=${hex(startSector * USER_DATA_SIZE, 8)} ` +
          `bytes=${hex(allocatedBytes)} type=${classifyResource(sample, allocatedBytes)} ` +
          `first=${first.toString('hex').match(/../g).join(' ')}`
      );
    }
  }
} finally {
  fs.closeSync(imageFd);
}
