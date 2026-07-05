#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const exePath = args.shift();
const datPath = args.shift();
const outPath = args.shift();

let page = 0;
let chunkWidthBytes = 16;
let chunkRows = 24;
let columns = 7;
let count = 147;
let invert = false;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--page") page = Number(args[++i]);
  else if (arg === "--chunk-width-bytes") chunkWidthBytes = Number(args[++i]);
  else if (arg === "--chunk-rows") chunkRows = Number(args[++i]);
  else if (arg === "--columns") columns = Number(args[++i]);
  else if (arg === "--count") count = Number(args[++i]);
  else if (arg === "--invert") invert = true;
  else {
    console.error(`unknown option: ${arg}`);
    process.exit(2);
  }
}

if (!exePath || !datPath || !outPath) {
  console.error(
    "usage: node scripts/export-fs2-extended-atlas.js <SLPS_019.03> <FS2_FILE.DAT> <out.pbm> [--page N] [--chunk-width-bytes N] [--chunk-rows N] [--columns N] [--count N] [--invert]"
  );
  process.exit(2);
}

const exe = fs.readFileSync(exePath);
const dat = fs.readFileSync(datPath);
const load = exe.readUInt32LE(0x18);
const tableOff = 0x801c4f68 - load + 0x800;

function extendedRange(targetPage) {
  let carry = 0;
  let previous = exe.readUInt16LE(tableOff + 4449 * 2);
  for (let p = 0; p < 17; p += 1) {
    const rawStart = exe.readUInt16LE(tableOff + (4450 + p * 2) * 2);
    const rawEnd = exe.readUInt16LE(tableOff + (4451 + p * 2) * 2);
    if (rawStart < previous) carry += 0x10000;
    const startSector = rawStart + carry;
    if (rawEnd < rawStart) carry += 0x10000;
    const endSector = rawEnd + carry;
    previous = rawEnd;
    if (p === targetPage) return { off: startSector * 0x800, size: (endSector - startSector) * 0x800 };
  }
  return null;
}

function bit(byte, n) {
  return (byte >> (7 - n)) & 1;
}

const range = extendedRange(page);
if (!range) {
  console.error(`invalid page ${page}`);
  process.exit(1);
}

const chunkWidth = chunkWidthBytes * 8;
const rows = Math.ceil(count / columns);
const gap = 2;
const atlasWidth = columns * chunkWidth + (columns - 1) * gap;
const atlasHeight = rows * chunkRows + (rows - 1) * gap;
const pixels = Array.from({ length: atlasHeight }, () => Array(atlasWidth).fill(0));

for (let index = 0; index < count; index += 1) {
  const col = index % columns;
  const row = Math.floor(index / columns);
  const dstX = col * (chunkWidth + gap);
  const dstY = row * (chunkRows + gap);
  const srcOff = range.off + index * 6 * 0x800;
  for (let y = 0; y < chunkRows; y += 1) {
    const lineOff = srcOff + y * chunkWidthBytes;
    for (let x = 0; x < chunkWidth; x += 1) {
      const b = dat[lineOff + Math.floor(x / 8)];
      const on = bit(b, x & 7) === 0 ? 1 : 0;
      pixels[dstY + y][dstX + x] = invert ? 1 - on : on;
    }
  }
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const body = pixels.map((row) => row.join(" ")).join("\n");
fs.writeFileSync(outPath, `P1\n# page=${page} count=${count} chunk=${chunkWidth}x${chunkRows}\n${atlasWidth} ${atlasHeight}\n${body}\n`);
console.log(`wrote ${outPath} page=${page} ${atlasWidth}x${atlasHeight}`);
