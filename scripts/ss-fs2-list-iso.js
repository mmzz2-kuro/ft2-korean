#!/usr/bin/env node

'use strict';

const fs = require('fs');

const RAW_SECTOR_SIZE = 2352;
const USER_DATA_OFFSET = 16;
const USER_DATA_SIZE = 2048;

function usage() {
  console.error('usage: node scripts/ss-fs2-list-iso.js <track1.bin> [--json]');
  process.exit(1);
}

const args = process.argv.slice(2);
const imagePath = args.shift();
if (!imagePath) usage();

let json = false;
for (const arg of args) {
  if (arg === '--json') json = true;
  else usage();
}

function readBothEndian32(buffer, offset, label) {
  const little = buffer.readUInt32LE(offset);
  const big = buffer.readUInt32BE(offset + 4);
  if (little !== big) {
    throw new Error(`${label}: ISO9660 both-endian values disagree (${little} != ${big})`);
  }
  return little;
}

function trimAscii(buffer, start, length) {
  return buffer.toString('ascii', start, start + length).replace(/[\0 ]+$/g, '');
}

const fd = fs.openSync(imagePath, 'r');
const imageSize = fs.fstatSync(fd).size;
if (imageSize % RAW_SECTOR_SIZE !== 0) {
  throw new Error(`image size ${imageSize} is not a multiple of ${RAW_SECTOR_SIZE}`);
}

function readUserData(lba, byteLength = USER_DATA_SIZE) {
  if (!Number.isSafeInteger(lba) || lba < 0 || byteLength < 0) {
    throw new Error(`invalid read request: LBA ${lba}, length ${byteLength}`);
  }
  const sectorCount = Math.ceil(byteLength / USER_DATA_SIZE);
  const output = Buffer.alloc(sectorCount * USER_DATA_SIZE);
  const sector = Buffer.alloc(USER_DATA_SIZE);
  for (let i = 0; i < sectorCount; i++) {
    const rawOffset = (lba + i) * RAW_SECTOR_SIZE + USER_DATA_OFFSET;
    if (rawOffset + USER_DATA_SIZE > imageSize) {
      throw new Error(`read outside image at LBA ${lba + i}`);
    }
    const bytesRead = fs.readSync(fd, sector, 0, USER_DATA_SIZE, rawOffset);
    if (bytesRead !== USER_DATA_SIZE) throw new Error(`short read at LBA ${lba + i}`);
    sector.copy(output, i * USER_DATA_SIZE);
  }
  return output.subarray(0, byteLength);
}

function parseRecord(buffer, offset) {
  const recordLength = buffer[offset];
  if (recordLength === 0) return null;
  if (offset + recordLength > buffer.length || recordLength < 34) {
    throw new Error(`invalid directory record at directory offset 0x${offset.toString(16)}`);
  }
  const extentLba = readBothEndian32(buffer, offset + 2, 'extent LBA');
  const size = readBothEndian32(buffer, offset + 10, 'data length');
  const flags = buffer[offset + 25];
  const nameLength = buffer[offset + 32];
  if (33 + nameLength > recordLength) throw new Error('directory record name exceeds record');
  const rawName = buffer.subarray(offset + 33, offset + 33 + nameLength);
  let name;
  if (nameLength === 1 && rawName[0] === 0) name = '.';
  else if (nameLength === 1 && rawName[0] === 1) name = '..';
  else name = rawName.toString('ascii');
  return {
    recordLength,
    extentLba,
    size,
    flags,
    isDirectory: Boolean(flags & 0x02),
    name,
  };
}

try {
  const pvd = readUserData(16);
  if (pvd[0] !== 1 || pvd.toString('ascii', 1, 6) !== 'CD001' || pvd[6] !== 1) {
    throw new Error('LBA 16 is not an ISO9660 primary volume descriptor');
  }

  const volumeSpaceSectors = readBothEndian32(pvd, 80, 'volume space size');
  const logicalBlockSize = pvd.readUInt16LE(128);
  const logicalBlockSizeBe = pvd.readUInt16BE(130);
  if (logicalBlockSize !== logicalBlockSizeBe || logicalBlockSize !== USER_DATA_SIZE) {
    throw new Error(`unsupported logical block size ${logicalBlockSize}/${logicalBlockSizeBe}`);
  }

  const root = parseRecord(pvd, 156);
  if (!root || !root.isDirectory) throw new Error('PVD root record is missing or not a directory');

  const entries = [];
  const visitedDirectories = new Set();

  function walkDirectory(directory, parentPath) {
    const key = `${directory.extentLba}:${directory.size}`;
    if (visitedDirectories.has(key)) return;
    visitedDirectories.add(key);

    const data = readUserData(directory.extentLba, directory.size);
    let offset = 0;
    while (offset < data.length) {
      if (data[offset] === 0) {
        offset = Math.ceil((offset + 1) / USER_DATA_SIZE) * USER_DATA_SIZE;
        continue;
      }
      const record = parseRecord(data, offset);
      offset += record.recordLength;
      if (record.name === '.' || record.name === '..') continue;

      const cleanName = record.name.replace(/;\d+$/, '');
      const fullPath = parentPath ? `${parentPath}/${cleanName}` : cleanName;
      entries.push({
        path: fullPath,
        isoName: record.name,
        type: record.isDirectory ? 'dir' : 'file',
        lba: record.extentLba,
        rawOffset: record.extentLba * RAW_SECTOR_SIZE + USER_DATA_OFFSET,
        size: record.size,
        sectors: Math.ceil(record.size / USER_DATA_SIZE),
        flags: record.flags,
      });
      if (record.isDirectory) walkDirectory(record, fullPath);
    }
  }

  walkDirectory(root, '');

  const result = {
    image: imagePath,
    imageSize,
    rawSectorSize: RAW_SECTOR_SIZE,
    userDataOffset: USER_DATA_OFFSET,
    userDataSize: USER_DATA_SIZE,
    systemId: trimAscii(pvd, 8, 32),
    volumeId: trimAscii(pvd, 40, 32),
    volumeSpaceSectors,
    root: { lba: root.extentLba, size: root.size },
    entries,
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    console.log(`image: ${imagePath}`);
    console.log(`system: ${result.systemId}`);
    console.log(`volume: ${result.volumeId}`);
    console.log(`volume sectors: ${volumeSpaceSectors}`);
    console.log(`root: LBA ${root.extentLba}, ${root.size} bytes`);
    console.log('TYPE       LBA       SIZE SECTORS RAW_OFFSET PATH');
    for (const entry of entries) {
      console.log(
        `${entry.type.padEnd(5)} ${String(entry.lba).padStart(9)} ${String(entry.size).padStart(10)} ` +
          `${String(entry.sectors).padStart(7)} 0x${entry.rawOffset.toString(16).padStart(8, '0')} ${entry.path}`
      );
    }
  }
} finally {
  fs.closeSync(fd);
}
