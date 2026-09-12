#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const [imageArg, idArg, outputArg] = process.argv.slice(2);
const id = Number.parseInt(idArg || '', 0);
if (!imageArg || !Number.isSafeInteger(id) || !outputArg) {
  console.error('usage: node scripts/ss-fs2-export-ending-screen.js <track1.bin> <resource-id> <output.pgm>');
  process.exit(1);
}

const RAW = 2352, USER = 2048, UOFF = 0x10;
const EXE_LBA = 21, DATA_LBA = 178, TABLE = 0x1ae9c;
const fd = fs.openSync(path.resolve(imageArg), 'r');

function readUser(lba, bytes) {
  const out = Buffer.alloc(bytes);
  for (let pos = 0; pos < bytes;) {
    const sector = Math.floor(pos / USER), within = pos % USER;
    const take = Math.min(USER - within, bytes - pos);
    if (fs.readSync(fd, out, pos, take, (lba + sector) * RAW + UOFF + within) !== take) {
      throw new Error(`short read at LBA ${lba + sector}`);
    }
    pos += take;
  }
  return out;
}

try {
  const exe = readUser(EXE_LBA, 319524);
  const first = exe.readUInt16BE(TABLE + id * 2);
  const last = exe.readUInt16BE(TABLE + (id + 1) * 2);
  if (last <= first) throw new Error(`empty resource ${id}`);
  const data = readUser(DATA_LBA + first, (last - first) * USER);
  const wt = data.readUInt32BE(0), ht = data.readUInt32BE(4);
  const payloadBytes = data.readUInt32BE(8), tileDataOffset = data.readUInt32BE(12);
  const tileCount = Math.floor(payloadBytes / 64);
  const tileMapOffset = tileDataOffset - wt * ht * 2;
  if (tileMapOffset < 0x10 || tileMapOffset + wt * ht * 2 !== tileDataOffset) {
    throw new Error(`invalid tilemap layout: offset=0x${tileMapOffset.toString(16)}`);
  }
  const width = wt * 8, height = ht * 8;
  if (wt < 1 || ht < 1 || width > 1024 || height > 1024) throw new Error('implausible dimensions');

  const pixels = new Uint8Array(width * height);
  for (let ty = 0; ty < ht; ty++) for (let tx = 0; tx < wt; tx++) {
    const pnt = data.readUInt16BE(tileMapOffset + (ty * wt + tx) * 2);
    // These ending resources use the same halfword-addressed 8bpp tile number
    // as the ordinary BE-HDR images.  Bit 0 is the horizontal flip flag.
    // Values at 0x0200 and above reference tiles outside this resource; they
    // must remain blank instead of being folded back onto local tile 0.
    const tileIndex = pnt >>> 1;
    const hflip = Boolean(pnt & 0x0001);
    const tileOffset = tileDataOffset + tileIndex * 64;
    for (let py = 0; py < 8; py++) for (let px = 0; px < 8; px++) {
      const sx = hflip ? 7 - px : px, sy = py;
      const source = tileOffset + sy * 8 + sx;
      pixels[(ty * 8 + py) * width + tx * 8 + px] = tileIndex < tileCount && data[source] ? 255 : 0;
    }
  }

  const lines = ['P2', `# SS FS2 ending screen resource ${id}`, `${width} ${height}`, '255'];
  for (let y = 0; y < height; y++) {
    lines.push(Array.from(pixels.subarray(y * width, (y + 1) * width)).join(' '));
  }
  const output = path.resolve(outputArg);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${lines.join('\n')}\n`, 'ascii');
  console.log(`resource=${id} size=${width}x${height} output=${output}`);
} finally {
  fs.closeSync(fd);
}
