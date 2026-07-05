#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const exePath = args.shift();
const datPath = args.shift();
const outPath = args.shift();

let page = 0;
let width = 60;
let height = 96;
let bpp = 4;
let columns = 7;
let count = 147;
let scale = 3;
let dataOffset = 0;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--page") page = Number(args[++i]);
  else if (arg === "--width") width = Number(args[++i]);
  else if (arg === "--height") height = Number(args[++i]);
  else if (arg === "--bpp") bpp = Number(args[++i]);
  else if (arg === "--columns") columns = Number(args[++i]);
  else if (arg === "--count") count = Number(args[++i]);
  else if (arg === "--scale") scale = Number(args[++i]);
  else if (arg === "--data-offset") dataOffset = Number(args[++i]);
  else {
    console.error(`unknown option: ${arg}`);
    process.exit(2);
  }
}

if (!exePath || !datPath || !outPath || ![4, 8, 16].includes(bpp)) {
  console.error(
    "usage: node scripts/export-fs2-extended-rect-html.js <SLPS_019.03> <FS2_FILE.DAT> <out.html> [--page N] [--width N] [--height N] [--bpp 4|8|16] [--data-offset N] [--columns N] [--count N] [--scale N]"
  );
  process.exit(2);
}

const exe = fs.readFileSync(exePath);
const dat = fs.readFileSync(datPath);
const load = exe.readUInt32LE(0x18);
const tableOff = 0x801c4f68 - load + 0x800;
const codeTableOff = 0x80169a08 - load + 0x800;

function hex(n, width = 0) {
  return "0x" + n.toString(16).padStart(width, "0");
}

function printable(byte) {
  return byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".";
}

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
    if (p === targetPage) return { off: startSector * 0x800, size: (endSector - startSector) * 0x800, startSector, endSector };
  }
  return null;
}

function codeFor(index) {
  const b0 = exe[codeTableOff + index * 2];
  const b1 = exe[codeTableOff + index * 2 + 1];
  return {
    code: printable(b0) + printable(b1),
    value: (b0 << 8) | b1,
  };
}

function pixelValue(buf, off, x) {
  if (bpp === 4) {
    const byte = buf[off + (x >> 1)];
    return x & 1 ? byte >> 4 : byte & 0x0f;
  }
  if (bpp === 8) return buf[off + x];
  const v = buf.readUInt16LE(off + x * 2);
  const r = v & 0x1f;
  const g = (v >> 5) & 0x1f;
  const bl = (v >> 10) & 0x1f;
  return Math.round((r + g + bl) / 3);
}

function maxValue() {
  if (bpp === 4) return 15;
  if (bpp === 8) return 255;
  return 31;
}

const range = extendedRange(page);
const bytesPerRow = bpp === 4 ? Math.ceil(width / 2) : bpp === 8 ? width : width * 2;
const needed = bytesPerRow * height + dataOffset;
if (!range || needed > 6 * 0x800) {
  console.error(`invalid range or rect too large: needed=${hex(needed)} chunk=${hex(6 * 0x800)}`);
  process.exit(1);
}

const cells = [];
for (let index = 0; index < count; index += 1) {
  const srcOff = range.off + index * 6 * 0x800 + dataOffset;
  const rows = [];
  const max = maxValue();
  for (let y = 0; y < height; y += 1) {
    const rowOff = srcOff + y * bytesPerRow;
    let row = "";
    for (let x = 0; x < width; x += 1) {
      const v = pixelValue(dat, rowOff, x);
      row += String.fromCharCode(65 + Math.min(25, Math.floor((v / max) * 25)));
    }
    rows.push(row);
  }
  const info = codeFor(index);
  cells.push({ index, code: info.code, value: hex(info.value, 4), rows });
}

const html = `<!doctype html>
<meta charset="utf-8">
<title>SLPS-01903 rect page ${page} bpp${bpp}</title>
<style>
body { margin: 16px; background: #f5f5f2; color: #202124; font-family: Consolas, "Courier New", monospace; }
h1 { font-size: 18px; margin: 0 0 6px; }
p { font-size: 12px; margin: 4px 0 14px; }
.grid { display: grid; grid-template-columns: repeat(${columns}, max-content); gap: 12px; }
.cell { background: white; border: 1px solid #c9c9c0; padding: 6px; }
.label { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; margin-bottom: 5px; }
canvas { image-rendering: pixelated; display: block; border: 1px solid #ddd; width: ${width * scale}px; height: ${height * scale}px; }
</style>
<h1>SLPS-01903 Extended Rect Page ${page}, ${bpp}bpp</h1>
<p>range sectors ${range.startSector}..${range.endSector}, chunk 6 sectors, rect ${width}x${height}, data offset ${hex(dataOffset)}</p>
<main class="grid">
${cells
  .map(
    (cell) => `<section class="cell"><div class="label"><b>${String(cell.index).padStart(3, "0")} ${cell.code}</b><span>${cell.value}</span></div><canvas id="c${cell.index}" width="${width}" height="${height}"></canvas></section>`
  )
  .join("\n")}
</main>
<script>
const cells = ${JSON.stringify(cells)};
for (const cell of cells) {
  const canvas = document.getElementById("c" + cell.index);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < cell.rows.length; y++) {
    const row = cell.rows[y];
    for (let x = 0; x < row.length; x++) {
      const p = (y * canvas.width + x) * 4;
      const v = 255 - Math.round(((row.charCodeAt(x) - 65) / 25) * 255);
      image.data[p] = v;
      image.data[p + 1] = v;
      image.data[p + 2] = v;
      image.data[p + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}
</script>
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);
console.log(`wrote ${outPath} page=${page} bpp=${bpp} rect=${width}x${height}`);
