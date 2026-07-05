#!/usr/bin/env node

const fs = require("fs");

const args = process.argv.slice(2);
const datPath = args.shift();
const exePath = args.shift();

let ids = "309-326";
let tableAddr = 0x80169a08;
let count = 148;
let skipWords = 192;
let top = 64;
let mode = "pairs";

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--ids") ids = args[++i];
  else if (arg === "--table") tableAddr = Number(args[++i]);
  else if (arg === "--count") count = Number(args[++i]);
  else if (arg === "--skip-words") skipWords = Number(args[++i]);
  else if (arg === "--top") top = Number(args[++i]);
  else if (arg === "--mode") mode = args[++i];
}

if (!datPath || !exePath) {
  console.error(
    "usage: node scripts/scan-script-code-table-refs.js <FS2_FILE.DAT> <SLPS_019.03> [--ids 309-326] [--table 0x80169a08] [--count 148] [--skip-words 192] [--top 64] [--mode pairs|words]"
  );
  process.exit(2);
}

const dat = fs.readFileSync(datPath);
const exe = fs.readFileSync(exePath);
const load = exe.readUInt32LE(0x18);
const sectorTableOff = 0x801c4f68 - load + 0x800;
const codeTableOff = tableAddr - load + 0x800;

function hex(n, width = 0) {
  return "0x" + (n >>> 0).toString(16).padStart(width, "0");
}

function parseIds(spec) {
  const out = [];
  for (const part of spec.split(",")) {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) {
      const start = Number(m[1]);
      const end = Number(m[2]);
      for (let id = start; id <= end; id += 1) out.push(id);
    } else if (part.trim()) {
      out.push(Number(part));
    }
  }
  return out.filter(Number.isFinite);
}

function printable(byte) {
  return byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".";
}

function rangeFor(resourceId) {
  const startSector = exe.readUInt16LE(sectorTableOff + resourceId * 2);
  const endSector = exe.readUInt16LE(sectorTableOff + (resourceId + 1) * 2);
  if (endSector <= startSector) return null;
  return { off: startSector * 0x800, size: (endSector - startSector) * 0x800 };
}

const codeInfo = new Map();
for (let i = 0; i < count; i += 1) {
  const b0 = exe[codeTableOff + i * 2];
  const b1 = exe[codeTableOff + i * 2 + 1];
  const value = (b0 << 8) | b1;
  if (value === 0) continue;
  codeInfo.set(value, { index: i, code: printable(b0) + printable(b1) });
}

const resourceIds = parseIds(ids);
const totals = new Map();
const perResource = [];
const examples = new Map();

for (const id of resourceIds) {
  const range = rangeFor(id);
  if (!range) continue;
  const counts = new Map();
  const startWord = Math.max(0, skipWords);
  const words = Math.floor(range.size / 2);

  const limit = mode === "pairs" ? words - 1 : words;
  for (let wordIndex = startWord; wordIndex < limit; wordIndex += 1) {
    let value;
    if (mode === "pairs") {
      const first = dat.readUInt16BE(range.off + wordIndex * 2);
      const second = dat.readUInt16BE(range.off + wordIndex * 2 + 2);
      if (first <= 0 || first > 0xff || second < 0 || second > 0xff) continue;
      value = (((first + 64) & 0xff) << 8) | second;
    } else {
      value = dat.readUInt16BE(range.off + wordIndex * 2);
    }
    if (!codeInfo.has(value)) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
    totals.set(value, (totals.get(value) || 0) + 1);
    if (!examples.has(value)) examples.set(value, { id, wordIndex });
  }

  const hitCount = [...counts.values()].reduce((a, b) => a + b, 0);
  const unique = counts.size;
  perResource.push({ id, off: range.off, size: range.size, hitCount, unique, counts });
}

console.log(
  `ids=${ids} table=${hex(tableAddr, 8)} count=${count} skipWords=${skipWords} mode=${mode} resources=${perResource.length}`
);
console.log("\nresources:");
for (const row of perResource) {
  const topCodes = [...row.counts.entries()]
    .sort((a, b) => b[1] - a[1] || codeInfo.get(a[0]).index - codeInfo.get(b[0]).index)
    .slice(0, 8)
    .map(([value, hits]) => `${codeInfo.get(value).code}:${hits}`)
    .join(" ");
  console.log(
    `id=${row.id} off=${hex(row.off, 7)} size=${hex(row.size, 5)} hits=${row.hitCount} unique=${row.unique}` +
      (topCodes ? ` top=${topCodes}` : "")
  );
}

console.log("\ntop codes:");
for (const [value, hits] of [...totals.entries()]
  .sort((a, b) => b[1] - a[1] || codeInfo.get(a[0]).index - codeInfo.get(b[0]).index)
  .slice(0, top)) {
  const info = codeInfo.get(value);
  const ex = examples.get(value);
  console.log(
    `${String(info.index).padStart(3)} ${hex(value, 4)} ${info.code} hits=${String(hits).padStart(4)} ` +
      `first=id${ex.id}@word${hex(ex.wordIndex, 4)}`
  );
}
