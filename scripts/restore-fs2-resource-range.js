#!/usr/bin/env node

// Copies the byte range for one or more FS2_FILE.DAT resource IDs from an
// "original" DAT into a copy of a "modified" DAT, leaving everything else in
// the modified DAT untouched. Uses the same EXE sector table as
// scripts/list-fs2-resource-ids.js and scripts/be-hdr-ui-tile-tool.js, so any
// resource ID addressable by those tools works here too.

const fs = require("fs");
const path = require("path");

function usage() {
  console.error(
    "usage: node scripts/restore-fs2-resource-range.js <original-FS2_FILE.DAT> <modified-FS2_FILE.DAT> <SLPS_019.03> <out-FS2_FILE.DAT> <id...> [--dry-run]"
  );
  process.exit(1);
}

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const positional = argv.filter((arg) => arg !== "--dry-run");

const originalDatPath = positional[0];
const modifiedDatPath = positional[1];
const exePath = positional[2];
const outDatPath = positional[3];
const ids = positional.slice(4).map((arg) => Number(arg)).filter((id) => Number.isFinite(id));

if (!originalDatPath || !modifiedDatPath || !exePath || !outDatPath || ids.length === 0) usage();

const originalDat = fs.readFileSync(originalDatPath);
const modifiedDat = fs.readFileSync(modifiedDatPath);
const exe = fs.readFileSync(exePath);

if (originalDat.length !== modifiedDat.length) {
  throw new Error(
    `DAT size mismatch: original is ${originalDat.length} bytes, modified is ${modifiedDat.length} bytes -- they must be the same FS2_FILE.DAT layout`
  );
}

const loadAddr = exe.readUInt32LE(0x18);
const tableOff = 0x801c4f68 - loadAddr + 0x800;

function resourceRange(id) {
  const entryOff = tableOff + id * 2;
  if (entryOff < 0 || entryOff + 4 > exe.length) {
    throw new Error(`resource ${id} sector table offset is outside EXE`);
  }
  const startSector = exe.readUInt16LE(entryOff);
  const endSector = exe.readUInt16LE(entryOff + 2);
  if (endSector <= startSector) {
    return null;
  }
  const off = startSector * 0x800;
  const size = (endSector - startSector) * 0x800;
  return { off, size };
}

const outDat = Buffer.from(modifiedDat);
let totalBytesChanged = 0;

for (const id of ids) {
  const range = resourceRange(id);
  if (!range) {
    console.log(`${id}\tskip (wrap/check -- endSector <= startSector)`);
    continue;
  }
  const { off, size } = range;
  if (off + size > originalDat.length) {
    throw new Error(`resource ${id} range 0x${off.toString(16)}+0x${size.toString(16)} is outside the DAT (size 0x${originalDat.length.toString(16)})`);
  }

  let bytesChanged = 0;
  for (let i = 0; i < size; i += 1) {
    if (originalDat[off + i] !== modifiedDat[off + i]) bytesChanged += 1;
  }
  totalBytesChanged += bytesChanged;

  if (!dryRun) {
    originalDat.copy(outDat, off, off, off + size);
  }
  console.log(`${id}\toff=0x${off.toString(16)}\tsize=0x${size.toString(16)}\tbytes_changed=${bytesChanged}`);
}

if (dryRun) {
  console.log(`[dry-run] would change ${totalBytesChanged} bytes total, no file written`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(outDatPath), { recursive: true });
fs.writeFileSync(outDatPath, outDat);
console.log(`changed ${totalBytesChanged} bytes total`);
console.log(`wrote ${outDatPath}`);
