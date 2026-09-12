#!/usr/bin/env node
'use strict';

const fs = require('fs');
const [datPath, exePath, targetText, xText, yText, wText, hText] = process.argv.slice(2);
if (!hText) throw new Error('usage: node scripts/find-behdr-subimage-duplicates.js <DAT> <EXE> <targetId> <x> <y> <w> <h>');
const dat = fs.readFileSync(datPath), exe = fs.readFileSync(exePath);
const load = exe.readUInt32LE(0x18), table = 0x801c4f68 - load + 0x800;
const max = Math.min(4336, Math.floor((exe.length - table) / 2) - 2), starts = [];
let carry = 0, previous = exe.readUInt16LE(table);
for (let id = 0; id <= max + 1; id++) {
  const raw = exe.readUInt16LE(table + id * 2);
  if (id && raw < previous) carry += 0x10000;
  starts[id] = raw + carry; previous = raw;
}
function decode(id) {
  const begin = starts[id] * 2048, end = starts[id + 1] * 2048;
  if (begin + 16 > end || end > dat.length) return null;
  const wt = dat.readUInt32BE(begin), ht = dat.readUInt32BE(begin + 4), td = dat.readUInt32BE(begin + 12);
  if (wt < 1 || ht < 1 || wt > 512 || ht > 512) return null;
  const mapBytes = wt * ht * 2, align4 = value => (value + 3) & ~3;
  let mo = td - mapBytes;
  if (align4(0x210 + mapBytes) === td) mo = 0x210;
  else if (align4(0x10 + mapBytes) === td) mo = 0x10;
  const cap = Math.floor((end - begin - td) / 64), width = wt * 8, height = ht * 8;
  if (mo < 0x10 || td < mo + mapBytes || cap < 1 || width * height > 16777216) return null;
  const pixels = Buffer.alloc(width * height);
  for (let cell = 0; cell < wt * ht; cell++) {
    const tile = dat.readUInt16BE(begin + mo + cell * 2) >> 1;
    if (tile >= cap) return null;
    const tx = cell % wt, ty = Math.floor(cell / wt), tileOff = begin + td + tile * 64;
    for (let py = 0; py < 8; py++) dat.copy(pixels, (ty * 8 + py) * width + tx * 8, tileOff + py * 8, tileOff + py * 8 + 8);
  }
  return {id, width, height, pixels};
}
const targetId = Number(targetText), x = Number(xText), y = Number(yText), cw = Number(wText), ch = Number(hText);
const target = decode(targetId); if (!target) throw new Error(`cannot decode target ${targetId}`);
const rows = []; for (let py = 0; py < ch; py++) rows.push(target.pixels.subarray((y + py) * target.width + x, (y + py) * target.width + x + cw));
const hits = [];
for (let id = 0; id <= max; id++) {
  const candidate = decode(id); if (!candidate || candidate.width < cw || candidate.height < ch) continue;
  for (let cy = 0; cy <= candidate.height - ch; cy++) for (let cx = 0; cx <= candidate.width - cw; cx++) {
    let same = true;
    for (let py = 0; py < ch && same; py++) same = rows[py].equals(candidate.pixels.subarray((cy + py) * candidate.width + cx, (cy + py) * candidate.width + cx + cw));
    if (same) hits.push({id, x:cx, y:cy, width:candidate.width, height:candidate.height});
  }
}
console.log(JSON.stringify({target:{id:targetId,x,y,width:cw,height:ch},hits},null,2));
