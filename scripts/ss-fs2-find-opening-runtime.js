#!/usr/bin/env node
'use strict';

const fs = require('fs');
const [binPath, ...pgmPaths] = process.argv.slice(2);
if (!binPath || !pgmPaths.length) {
  console.error('usage: node scripts/ss-fs2-find-opening-runtime.js <ss-track1.bin> <raw.pgm ...>');
  process.exit(1);
}
function pgm(path) {
  const t = fs.readFileSync(path, 'utf8').replace(/#[^\r\n]*/g, ' ').trim().split(/\s+/);
  if (t.shift() !== 'P2') throw new Error(`${path}: not P2`);
  const w = +t.shift(), h = +t.shift(), max = +t.shift(), pix = Buffer.from(t.map(Number));
  if (max !== 255 || pix.length !== w * h) throw new Error(`${path}: invalid PGM`);
  return { path, w, h, pix };
}
const patterns = [];
for (const image of pgmPaths.map(pgm)) {
  const scored = [];
  for (let y = 0; y < image.h; y++) {
    const row = image.pix.subarray(y * image.w, (y + 1) * image.w);
    scored.push({ y, row: Buffer.from(row), diversity: new Set(row).size, changes: [...row].slice(1).filter((v, x) => v !== row[x]).length });
  }
  scored.sort((a, b) => (b.diversity * 1000 + b.changes) - (a.diversity * 1000 + a.changes));
  for (const x of scored.slice(0, 4)) patterns.push({ image: image.path, width: image.w, y: x.y, bytes: x.row, hits: [] });
}
const fd = fs.openSync(binPath, 'r'), chunkSize = 16 * 1024 * 1024;
const overlap = Math.max(...patterns.map(p => p.bytes.length)) - 1;
let position = 0, tail = Buffer.alloc(0);
try {
  while (true) {
    const chunk = Buffer.alloc(chunkSize), count = fs.readSync(fd, chunk, 0, chunk.length, position);
    if (!count) break;
    const data = Buffer.concat([tail, chunk.subarray(0, count)]), base = position - tail.length;
    for (const p of patterns) {
      let at = -1;
      while ((at = data.indexOf(p.bytes, at + 1)) >= 0) {
        const absolute = base + at;
        if (absolute >= position - overlap) p.hits.push(absolute);
      }
    }
    tail = Buffer.from(data.subarray(Math.max(0, data.length - overlap)));
    position += count;
  }
} finally { fs.closeSync(fd); }
for (const p of patterns) console.log(JSON.stringify({ image: p.image, y: p.y, width: p.width, hits: p.hits.map(offset => ({ offset, hex: `0x${offset.toString(16)}`, lba: Math.floor(offset / 2352), sectorOffset: offset % 2352 })) }));
