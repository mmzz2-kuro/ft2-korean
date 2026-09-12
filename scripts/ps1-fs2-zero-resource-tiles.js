#!/usr/bin/env node
'use strict';

const fs = require('fs'), path = require('path');
const [datPath, exePath, outputPath, idText] = process.argv.slice(2);
if (!idText) throw new Error('usage: node scripts/ps1-fs2-zero-resource-tiles.js <DAT> <EXE> <output.DAT> <resource-id>');
const dat = fs.readFileSync(datPath), exe = fs.readFileSync(exePath), id = Number(idText);
const load = exe.readUInt32LE(0x18), table = 0x801c4f68 - load + 0x800;
const startSector = exe.readUInt16LE(table + id * 2), endSector = exe.readUInt16LE(table + (id + 1) * 2);
if (endSector <= startSector) throw new Error(`invalid resource ${id}`);
const begin = startSector * 2048, end = endSector * 2048, tileDataOffset = dat.readUInt32BE(begin + 12);
if (tileDataOffset < 0x10 || begin + tileDataOffset > end) throw new Error(`invalid tile data offset for resource ${id}`);
const out = Buffer.from(dat);
out.fill(0, begin + tileDataOffset, end);
fs.mkdirSync(path.dirname(outputPath), {recursive: true});
fs.writeFileSync(outputPath, out);
console.log(`resource ${id}: zeroed tile bytes 0x${(begin + tileDataOffset).toString(16)}..0x${end.toString(16)}`);
console.log(`wrote ${outputPath}`);
