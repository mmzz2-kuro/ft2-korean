#!/usr/bin/env node

'use strict';

const fs = require('fs');
const { TextDecoder } = require('util');

const RAW_SECTOR_SIZE = 2352;
const USER_DATA_OFFSET = 16;
const USER_DATA_SIZE = 2048;
const CONTAINER_LBA = 178;
const CONTAINER_SECTORS = 219235;
const EXE_LBA = 21;
const TABLE_OFFSET = 0x1ae9c;
const RESOURCE_COUNT = 4335;

function usage() {
  console.error(
    'usage: node scripts/ss-fs2-scan-sjis.js <track1.bin> ' +
      '[--limit 100] [--min-japanese 4] [--min-kana 3]'
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const imagePath = args.shift();
if (!imagePath) usage();

let limit = 100;
let minJapanese = 4;
let minKana = 3;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit') limit = Number.parseInt(args[++i] || '', 0);
  else if (args[i] === '--min-japanese') minJapanese = Number.parseInt(args[++i] || '', 0);
  else if (args[i] === '--min-kana') minKana = Number.parseInt(args[++i] || '', 0);
  else usage();
}

if (
  !Number.isSafeInteger(limit) ||
  limit <= 0 ||
  !Number.isSafeInteger(minJapanese) ||
  minJapanese <= 0 ||
  !Number.isSafeInteger(minKana) ||
  minKana < 0
) {
  throw new Error('invalid option');
}

const fd = fs.openSync(imagePath, 'r');
const decoder = new TextDecoder('shift_jis', { fatal: true });

function readIsoFileBytes(isoLba, logicalOffset, count) {
  const output = Buffer.alloc(count);
  for (let position = 0; position < count; ) {
    const absolute = logicalOffset + position;
    const sector = Math.floor(absolute / USER_DATA_SIZE);
    const within = absolute % USER_DATA_SIZE;
    const take = Math.min(USER_DATA_SIZE - within, count - position);
    const rawOffset = (isoLba + sector) * RAW_SECTOR_SIZE + USER_DATA_OFFSET + within;
    const got = fs.readSync(fd, output, position, take, rawOffset);
    if (got !== take) throw new Error(`short read at LBA ${isoLba + sector}`);
    position += take;
  }
  return output;
}

const tableBytes = readIsoFileBytes(EXE_LBA, TABLE_OFFSET, (RESOURCE_COUNT + 1) * 2);
const boundaries = [];
for (let i = 0; i <= RESOURCE_COUNT; i++) boundaries.push(tableBytes.readUInt16BE(i * 2));

function resourceIdForSector(sector) {
  if (sector < boundaries[0] || sector >= boundaries[RESOURCE_COUNT]) return null;
  let low = 0;
  let high = RESOURCE_COUNT;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (boundaries[middle] <= sector) low = middle;
    else high = middle;
  }
  return low;
}

function isLead(value) {
  return (value >= 0x81 && value <= 0x9f) || (value >= 0xe0 && value <= 0xef);
}

function isTrail(value) {
  return (value >= 0x40 && value <= 0x7e) || (value >= 0x80 && value <= 0xfc);
}

function isAscii(value) {
  return value >= 0x20 && value <= 0x7e;
}

function japaneseCount(text) {
  return [...text].filter((char) => /[\u3000-\u30ff\u3400-\u9fff]/u.test(char)).length;
}

function kanaCount(text) {
  return [...text].filter((char) => /[\u3040-\u30ff]/u.test(char)).length;
}

function cleanText(text) {
  return text.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

try {
  const data = Buffer.alloc(USER_DATA_SIZE);
  let hits = 0;
  for (let sector = 0; sector < CONTAINER_SECTORS && hits < limit; sector++) {
    const rawOffset = (CONTAINER_LBA + sector) * RAW_SECTOR_SIZE + USER_DATA_OFFSET;
    const got = fs.readSync(fd, data, 0, USER_DATA_SIZE, rawOffset);
    if (got !== USER_DATA_SIZE) throw new Error(`short container read at sector ${sector}`);

    for (let start = 0; start < data.length && hits < limit; ) {
      let cursor = start;
      let pairs = 0;
      while (cursor < data.length) {
        const value = data[cursor];
        if (isLead(value) && cursor + 1 < data.length && isTrail(data[cursor + 1])) {
          pairs++;
          cursor += 2;
        } else if (isAscii(value)) {
          cursor++;
        } else {
          break;
        }
      }

      if (pairs >= minJapanese) {
        const candidate = data.subarray(start, cursor);
        try {
          const text = cleanText(decoder.decode(candidate));
          const jpCount = japaneseCount(text);
          const kana = kanaCount(text);
          if (jpCount >= minJapanese && kana >= minKana && text.length <= 240) {
            const logicalOffset = sector * USER_DATA_SIZE + start;
            const resourceId = resourceIdForSector(sector);
            console.log(
              `off=0x${logicalOffset.toString(16)} sector=${sector} within=0x${start.toString(16)} ` +
                `resource=${resourceId === null ? 'range/tail' : resourceId} jp=${jpCount} kana=${kana} ` +
                `text=${JSON.stringify(text)}`
            );
            hits++;
          }
        } catch {
          // Invalid Shift-JIS byte sequence; ignore this candidate.
        }
      }
      start = cursor > start ? cursor + 1 : start + 1;
    }
  }
  console.log(`hits=${hits}`);
} finally {
  fs.closeSync(fd);
}
