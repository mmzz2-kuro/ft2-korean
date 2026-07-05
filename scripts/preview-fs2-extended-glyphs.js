#!/usr/bin/env node

const fs = require("fs");

const args = process.argv.slice(2);
const exePath = args.shift();
const datPath = args.shift();

let page = 0;
let start = 0;
let count = 32;
let mode = "cols";
let unit = "sectors";
let bytesPerRow = 16;
let rows = 32;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--page") page = Number(args[++i]);
  else if (arg === "--start") start = Number(args[++i]);
  else if (arg === "--count") count = Number(args[++i]);
  else if (arg === "--mode") mode = args[++i];
  else if (arg === "--unit") unit = args[++i];
  else if (arg === "--bytes-per-row") bytesPerRow = Number(args[++i]);
  else if (arg === "--rows") rows = Number(args[++i]);
  else {
    console.error(`unknown option: ${arg}`);
    process.exit(2);
  }
}

if (!exePath || !datPath || !Number.isFinite(page) || page < 0 || page >= 17) {
  console.error(
    "usage: node scripts/preview-fs2-extended-glyphs.js <SLPS_019.03> <FS2_FILE.DAT> [--page N] [--start N] [--count N] [--unit sectors|bytes] [--mode cols|rows|bitmap] [--bytes-per-row N] [--rows N]"
  );
  process.exit(2);
}

const exe = fs.readFileSync(exePath);
const dat = fs.readFileSync(datPath);
const load = exe.readUInt32LE(0x18);
const tableOff = 0x801c4f68 - load + 0x800;

function hex(n, width = 0) {
  return "0x" + n.toString(16).padStart(width, "0");
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
    if (p === targetPage) {
      return { off: startSector * 0x800, size: (endSector - startSector) * 0x800, startSector, endSector };
    }
  }
  return null;
}

function bit(byte, n) {
  return (byte >> (7 - n)) & 1;
}

function renderCols(bytes) {
  const lines = [];
  for (let y = 0; y < 8; y += 1) {
    let line = "";
    for (let x = 0; x < 6; x += 1) line += bit(bytes[x], y) ? "." : "#";
    lines.push(line.replace(/\.+$/g, ""));
  }
  return lines;
}

function renderRows(bytes) {
  return bytes.map((b) => {
    let line = "";
    for (let x = 0; x < 8; x += 1) line += bit(b, x) ? "." : "#";
    return line.replace(/\.+$/g, "");
  });
}

const range = extendedRange(page);
console.log(
  `page=${page} startSector=${range.startSector} endSector=${range.endSector} off=${hex(range.off, 7)} size=${hex(range.size, 6)} unit=${unit} mode=${mode}`
);

for (let index = start; index < start + count; index += 1) {
  const rel = unit === "bytes" ? index * 6 : index * 6 * 0x800;
  const length = unit === "bytes" ? 6 : 6 * 0x800;
  const off = range.off + rel;
  if (off + length > range.off + range.size || off + length > dat.length) break;
  const bytes = [...dat.subarray(off, off + Math.min(6, length))];
  const raw = bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ");
  const sample = dat.subarray(off, off + length);
  const nonZero = sample.reduce((n, b) => n + (b !== 0 ? 1 : 0), 0);
  const nonFF = sample.reduce((n, b) => n + (b !== 0xff ? 1 : 0), 0);
  console.log(`\nindex=${String(index).padStart(3)} rel=${hex(rel, 5)} len=${hex(length)} raw=${raw} nonZero=${nonZero} nonFF=${nonFF}`);
  if (mode === "bitmap" || unit === "sectors") {
    const showRows = Math.min(rows, Math.floor(length / bytesPerRow));
    for (let y = 0; y < showRows; y += 1) {
      const rowOff = off + y * bytesPerRow;
      let line = "";
      for (let x = 0; x < bytesPerRow * 8; x += 1) {
        line += bit(dat[rowOff + Math.floor(x / 8)], x & 7) ? "." : "#";
      }
      console.log(line.replace(/\.+$/g, "") || ".");
    }
  } else {
    const lines = mode === "rows" ? renderRows(bytes) : renderCols(bytes);
    for (const line of lines) console.log(line || ".");
  }
}
