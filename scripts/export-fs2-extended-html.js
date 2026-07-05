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
let scale = 2;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--page") page = Number(args[++i]);
  else if (arg === "--chunk-width-bytes") chunkWidthBytes = Number(args[++i]);
  else if (arg === "--chunk-rows") chunkRows = Number(args[++i]);
  else if (arg === "--columns") columns = Number(args[++i]);
  else if (arg === "--count") count = Number(args[++i]);
  else if (arg === "--scale") scale = Number(args[++i]);
  else {
    console.error(`unknown option: ${arg}`);
    process.exit(2);
  }
}

if (!exePath || !datPath || !outPath) {
  console.error(
    "usage: node scripts/export-fs2-extended-html.js <SLPS_019.03> <FS2_FILE.DAT> <out.html> [--page N] [--chunk-width-bytes N] [--chunk-rows N] [--columns N] [--count N] [--scale N]"
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

function bit(byte, n) {
  return (byte >> (7 - n)) & 1;
}

function codeFor(index) {
  const b0 = exe[codeTableOff + index * 2];
  const b1 = exe[codeTableOff + index * 2 + 1];
  return {
    code: printable(b0) + printable(b1),
    value: (b0 << 8) | b1,
  };
}

const range = extendedRange(page);
if (!range) {
  console.error(`invalid page ${page}`);
  process.exit(1);
}

const chunkWidth = chunkWidthBytes * 8;
const cells = [];

for (let index = 0; index < count; index += 1) {
  const srcOff = range.off + index * 6 * 0x800;
  const rows = [];
  let nonZero = 0;
  let nonFF = 0;
  for (let y = 0; y < chunkRows; y += 1) {
    const rowOff = srcOff + y * chunkWidthBytes;
    let row = "";
    for (let x = 0; x < chunkWidth; x += 1) {
      const b = dat[rowOff + Math.floor(x / 8)];
      if (x % 8 === 0) {
        if (b !== 0) nonZero += 1;
        if (b !== 0xff) nonFF += 1;
      }
      row += bit(b, x & 7) === 0 ? "1" : "0";
    }
    rows.push(row);
  }
  const info = codeFor(index);
  cells.push({
    index,
    code: info.code,
    value: hex(info.value, 4),
    rel: hex(index * 6 * 0x800, 5),
    rows,
    nonZero,
    nonFF,
  });
}

const html = `<!doctype html>
<meta charset="utf-8">
<title>SLPS-01903 extended page ${page}</title>
<style>
  :root { color-scheme: light; font-family: Consolas, "Courier New", monospace; }
  body { margin: 16px; background: #f6f6f3; color: #1e1f21; }
  header { margin-bottom: 16px; }
  h1 { font-size: 18px; margin: 0 0 6px; }
  p { margin: 4px 0; font-size: 12px; }
  .grid { display: grid; grid-template-columns: repeat(${columns}, max-content); gap: 12px; align-items: start; }
  .cell { background: #fff; border: 1px solid #c8c8c0; padding: 6px; }
  .label { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; margin-bottom: 5px; }
  .meta { color: #696a6c; font-size: 10px; margin-top: 4px; }
  canvas { image-rendering: pixelated; display: block; background: #fff; border: 1px solid #e0e0da; }
</style>
<header>
  <h1>SLPS-01903 Extended Range Page ${page}</h1>
  <p>range sectors ${range.startSector}..${range.endSector}, DAT ${hex(range.off, 7)}, chunk ${chunkWidth}x${chunkRows} preview, 6 sectors per code</p>
  <p>Use labels like <b>000 AA</b> to map code-table indices back to script text candidates.</p>
</header>
<main class="grid">
${cells
  .map(
    (cell) => `  <section class="cell">
    <div class="label"><b>${String(cell.index).padStart(3, "0")} ${cell.code}</b><span>${cell.value}</span></div>
    <canvas id="c${cell.index}" width="${chunkWidth}" height="${chunkRows}" style="width:${chunkWidth * scale}px;height:${chunkRows * scale}px"></canvas>
    <div class="meta">rel ${cell.rel} nonZero ${cell.nonZero} nonFF ${cell.nonFF}</div>
  </section>`
  )
  .join("\n")}
</main>
<script>
const cells = ${JSON.stringify(cells.map(({ index, rows }) => ({ index, rows })))};
for (const cell of cells) {
  const canvas = document.getElementById("c" + cell.index);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < cell.rows.length; y++) {
    const row = cell.rows[y];
    for (let x = 0; x < row.length; x++) {
      const p = (y * canvas.width + x) * 4;
      const on = row[x] === "1";
      const v = on ? 20 : 255;
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
console.log(`wrote ${outPath} page=${page} cells=${cells.length}`);
