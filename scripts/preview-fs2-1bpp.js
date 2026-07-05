#!/usr/bin/env node

const fs = require("fs");

const args = process.argv.slice(2);
const datPath = args.shift();
const exePath = args.shift();

let bytesPerRow = 16;
let rows = 64;
let xScale = 2;
let yScale = 1;
const ids = [];

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--bytes-per-row") {
    bytesPerRow = Number(args[++i]);
  } else if (arg === "--rows") {
    rows = Number(args[++i]);
  } else if (arg === "--xscale") {
    xScale = Number(args[++i]);
  } else if (arg === "--yscale") {
    yScale = Number(args[++i]);
  } else if (arg.startsWith("--")) {
    console.error(`unknown option: ${arg}`);
    process.exit(2);
  } else {
    const id = Number(arg);
    if (Number.isFinite(id)) ids.push(id);
  }
}

if (!datPath || !exePath || ids.length === 0 || !Number.isFinite(bytesPerRow) || bytesPerRow <= 0) {
  console.error(
    "usage: node scripts/preview-fs2-1bpp.js <FS2_FILE.DAT> <SLPS_019.03> <id...> [--bytes-per-row N] [--rows N] [--xscale N] [--yscale N]"
  );
  process.exit(2);
}

const dat = fs.readFileSync(datPath);
const exe = fs.readFileSync(exePath);
const load = exe.readUInt32LE(0x18);
const tableOff = 0x801c4f68 - load + 0x800;

function hex(n, width = 0) {
  return "0x" + n.toString(16).padStart(width, "0");
}

function resourceRange(id) {
  const startSector = exe.readUInt16LE(tableOff + id * 2);
  const endSector = exe.readUInt16LE(tableOff + (id + 1) * 2);
  if (endSector <= startSector) return null;
  return { off: startSector * 0x800, size: (endSector - startSector) * 0x800 };
}

function bitAt(buf, pos, bit) {
  return (buf[pos] >> (7 - bit)) & 1;
}

function renderRow(buf, off, widthBytes) {
  let line = "";
  for (let x = 0; x < widthBytes * 8; x += xScale) {
    let ink = 0;
    for (let sx = 0; sx < xScale && x + sx < widthBytes * 8; sx += 1) {
      const b = bitAt(buf, off + Math.floor((x + sx) / 8), (x + sx) & 7);
      if (b === 0) ink += 1;
    }
    line += ink > 0 ? "#" : ".";
  }
  return line.replace(/\.+$/g, "");
}

function stats(buf, off, size) {
  let zeroBits = 0;
  let oneBits = 0;
  let nonFillBytes = 0;
  for (let i = 0; i < size; i += 1) {
    const b = buf[off + i];
    if (b !== 0xff) nonFillBytes += 1;
    for (let bit = 0; bit < 8; bit += 1) {
      if (bitAt(buf, off + i, bit) === 0) zeroBits += 1;
      else oneBits += 1;
    }
  }
  return { zeroBits, oneBits, nonFillBytes };
}

for (const id of ids) {
  const range = resourceRange(id);
  if (!range) {
    console.log(`\nid=${id} invalid/wrap`);
    continue;
  }

  const maxRows = Math.floor(range.size / bytesPerRow);
  const showRows = Math.min(rows, maxRows);
  const st = stats(dat, range.off, range.size);
  console.log(
    `\nid=${id} off=${hex(range.off, 7)} size=${hex(range.size, 5)} bytesPerRow=${bytesPerRow} rows=${maxRows} ` +
      `inkBits=${st.zeroBits} oneBits=${st.oneBits} nonFF=${st.nonFillBytes}`
  );

  for (let y = 0; y < showRows; y += yScale) {
    let line = "";
    for (let sy = 0; sy < yScale && y + sy < showRows; sy += 1) {
      const row = renderRow(dat, range.off + (y + sy) * bytesPerRow, bytesPerRow);
      if (row.length > line.length) line = row;
    }
    console.log(line.length === 0 ? "." : line);
  }
}
