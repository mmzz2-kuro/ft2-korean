#!/usr/bin/env node

const fs = require("fs");

const exePath = process.argv[2];
const tableAddr = Number(process.argv[3] || 0x80169a08);
const count = Number(process.argv[4] || 148);

if (!exePath || !Number.isFinite(tableAddr) || !Number.isFinite(count)) {
  console.error("usage: node scripts/dump-exe-code-table.js <SLPS_019.03> [table-addr] [count]");
  process.exit(2);
}

const exe = fs.readFileSync(exePath);
const load = exe.readUInt32LE(0x18);
const off = tableAddr - load + 0x800;

function hex(n, width = 0) {
  return "0x" + (n >>> 0).toString(16).padStart(width, "0");
}

function printable(byte) {
  return byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".";
}

if (off < 0 || off + count * 2 > exe.length) {
  console.error(`table range outside exe: addr=${hex(tableAddr, 8)} off=${hex(off)}`);
  process.exit(1);
}

console.log(`addr=${hex(tableAddr, 8)} fileOff=${hex(off)} count=${count}`);
console.log("index value bytes code");

for (let i = 0; i < count; i += 1) {
  const b0 = exe[off + i * 2];
  const b1 = exe[off + i * 2 + 1];
  const value = (b0 << 8) | b1;
  const code = printable(b0) + printable(b1);
  console.log(`${String(i).padStart(3)} ${hex(value, 4)} ${hex(b0, 2)} ${hex(b1, 2)} ${code}`);
}
