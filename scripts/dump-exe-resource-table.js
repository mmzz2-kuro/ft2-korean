#!/usr/bin/env node

const fs = require("fs");

const exePath = process.argv[2];
const datPath = process.argv[3];
const addrArg = process.argv[4];
const count = Number(process.argv[5] || 32);

if (!exePath || !datPath || !addrArg) {
  console.error("usage: node scripts/dump-exe-resource-table.js <SLPS_019.03> <FS2_FILE.DAT> <ram-addr> [count]");
  process.exit(2);
}

const exe = fs.readFileSync(exePath);
const dat = fs.readFileSync(datPath);
const load = exe.readUInt32LE(0x18);
const tableOff = 0x801c4f68 - load + 0x800;
const addr = Number(addrArg);
const off = addr - load + 0x800;

function hex(n, width = 0) {
  return "0x" + n.toString(16).padStart(width, "0");
}

function classifyResource(id) {
  if (id < 0 || tableOff + (id + 1) * 2 + 2 > exe.length) return "id-out-of-range";
  const startSector = exe.readUInt16LE(tableOff + id * 2);
  const endSector = exe.readUInt16LE(tableOff + (id + 1) * 2);
  if (endSector <= startSector) return `wrap/check ${startSector}->${endSector}`;

  const resOff = startSector * 0x800;
  const size = (endSector - startSector) * 0x800;
  if (resOff + size > dat.length) return `outside-dat off=${hex(resOff)} size=${hex(size)}`;

  if (size >= 16) {
    const magic = dat.subarray(resOff, resOff + 4).toString("ascii");
    if (magic === "VAGp") return `VAGp off=${hex(resOff, 7)} size=${hex(size, 5)}`;

    const a = dat.readUInt32BE(resOff);
    const b = dat.readUInt32BE(resOff + 4);
    const payload = dat.readUInt32BE(resOff + 8);
    const d = dat.readUInt32BE(resOff + 12);
    const next = Math.ceil((16 + payload) / 0x800) * 0x800;
    if (payload > 0 && payload <= size && a < 10000 && b < 10000 && d < 0x1000000 && next <= size) {
      return `be-hdr(${a},${b},${hex(payload)},${hex(d)}) off=${hex(resOff, 7)} size=${hex(size, 5)}`;
    }
  }

  let zero = true;
  let ff = true;
  for (let i = 0; i < Math.min(size, 0x400); i += 1) {
    if (dat[resOff + i] !== 0) zero = false;
    if (dat[resOff + i] !== 0xff) ff = false;
  }
  if (zero) return `zero off=${hex(resOff, 7)} size=${hex(size, 5)}`;
  if (ff) return `ff-fill off=${hex(resOff, 7)} size=${hex(size, 5)}`;
  return `other off=${hex(resOff, 7)} size=${hex(size, 5)}`;
}

console.log(`addr=${hex(addr, 8)} fileOff=${hex(off)} count=${count}`);
if (off < 0 || off + count * 2 > exe.length) {
  console.error("address is outside EXE file");
  process.exit(1);
}

for (let i = 0; i < count; i += 1) {
  const id = exe.readUInt16LE(off + i * 2);
  console.log(`${i}\tid=${id}\t${classifyResource(id)}`);
}
