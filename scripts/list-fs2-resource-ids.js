#!/usr/bin/env node

const fs = require("fs");

const datPath = process.argv[2];
const exePath = process.argv[3];
const ids = process.argv.slice(4).map((arg) => Number(arg)).filter((id) => Number.isFinite(id));

if (!datPath || !exePath || ids.length === 0) {
  console.error("usage: node scripts/list-fs2-resource-ids.js <FS2_FILE.DAT> <SLPS_019.03> <id...>");
  process.exit(2);
}

const dat = fs.readFileSync(datPath);
const exe = fs.readFileSync(exePath);
const load = exe.readUInt32LE(0x18);
const tableOff = 0x801c4f68 - load + 0x800;

function hex(n, width = 0) {
  return "0x" + n.toString(16).padStart(width, "0");
}

function classify(off, size) {
  let zero = true;
  let ff = true;
  for (let i = 0; i < Math.min(size, 0x400); i += 1) {
    const b = dat[off + i];
    if (b !== 0) zero = false;
    if (b !== 0xff) ff = false;
  }
  if (zero) return "zero";
  if (ff) return "ff-fill";

  if (size >= 16) {
    const a = dat.readUInt32BE(off);
    const b = dat.readUInt32BE(off + 4);
    const payload = dat.readUInt32BE(off + 8);
    const d = dat.readUInt32BE(off + 12);
    const next = Math.ceil((16 + payload) / 0x800) * 0x800;
    if (payload > 0 && payload <= size && a < 10000 && b < 10000 && d < 0x1000000 && next <= size) {
      return `be-hdr(${a},${b},${hex(payload)},${hex(d)})`;
    }
  }

  if (size >= 4 && dat.readUInt32BE(off) === 0x400) return "raw-0x400";
  if (size >= 4 && dat.readUInt32LE(off) === 0x10) return "tim?";
  return "other";
}

function firstBytes(off, size) {
  return [...dat.subarray(off, Math.min(off + 16, off + size))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}

for (const id of ids) {
  const startSector = exe.readUInt16LE(tableOff + id * 2);
  const endSector = exe.readUInt16LE(tableOff + (id + 1) * 2);
  if (endSector <= startSector) {
    console.log(`${id}\twrap/check\tstart=${startSector}\tend=${endSector}`);
    continue;
  }

  const off = startSector * 0x800;
  const size = (endSector - startSector) * 0x800;
  console.log(
    [
      id,
      `off=${hex(off, 7)}`,
      `size=${hex(size, 5)}`,
      classify(off, size),
      firstBytes(off, size),
    ].join("\t")
  );
}
