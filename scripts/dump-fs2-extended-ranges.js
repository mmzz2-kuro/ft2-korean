#!/usr/bin/env node

const fs = require("fs");

const exePath = process.argv[2];
const datPath = process.argv[3];

if (!exePath || !datPath) {
  console.error("usage: node scripts/dump-fs2-extended-ranges.js <SLPS_019.03> <FS2_FILE.DAT>");
  process.exit(2);
}

const exe = fs.readFileSync(exePath);
const dat = fs.readFileSync(datPath);
const load = exe.readUInt32LE(0x18);
const tableOff = 0x801c4f68 - load + 0x800;

function hex(n, width = 0) {
  return "0x" + n.toString(16).padStart(width, "0");
}

function preview(off, size) {
  return [...dat.subarray(off, Math.min(off + 16, off + size))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}

let carry = 0;
let previous = exe.readUInt16LE(tableOff + 4449 * 2);

console.log(`table=0x801c4f68 fileOff=${hex(tableOff)} extendedPairs=17`);
console.log("page startSector endSector byteOff size rawStart rawEnd first16");

for (let page = 0; page < 17; page += 1) {
  const rawStart = exe.readUInt16LE(tableOff + (4450 + page * 2) * 2);
  const rawEnd = exe.readUInt16LE(tableOff + (4451 + page * 2) * 2);

  if (rawStart < previous) carry += 0x10000;
  const startSector = rawStart + carry;

  if (rawEnd < rawStart) carry += 0x10000;
  const endSector = rawEnd + carry;

  const byteOff = startSector * 0x800;
  const size = (endSector - startSector) * 0x800;
  const first = byteOff >= 0 && byteOff < dat.length && size > 0 ? preview(byteOff, size) : "outside";

  console.log(
    `${String(page).padStart(2)} ${String(startSector).padStart(6)} ${String(endSector).padStart(6)} ` +
      `${hex(byteOff, 7)} ${hex(size, 5)} ${String(rawStart).padStart(5)} ${String(rawEnd).padStart(5)} ${first}`
  );

  previous = rawEnd;
}
