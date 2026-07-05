#!/usr/bin/env node

const fs = require("fs");

const args = process.argv.slice(2);
const datPath = args.shift();
const exePath = args.shift();
const id = Number(args.shift());

let entries = 192;
let entry = null;
let words = 96;
let from = null;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--entries") entries = Number(args[++i]);
  else if (arg === "--entry") entry = Number(args[++i]);
  else if (arg === "--from") from = Number(args[++i]);
  else if (arg === "--words") words = Number(args[++i]);
}

if (!datPath || !exePath || !Number.isFinite(id)) {
  console.error(
    "usage: node scripts/dump-fs2-script-resource.js <FS2_FILE.DAT> <SLPS_019.03> <id> [--entries N] [--entry N] [--from WORD_INDEX] [--words N]"
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

function rangeFor(resourceId) {
  const startSector = exe.readUInt16LE(tableOff + resourceId * 2);
  const endSector = exe.readUInt16LE(tableOff + (resourceId + 1) * 2);
  if (endSector <= startSector) return null;
  return { off: startSector * 0x800, size: (endSector - startSector) * 0x800 };
}

function beWord(range, index) {
  const off = range.off + index * 2;
  if (off + 2 > range.off + range.size) return null;
  return dat.readUInt16BE(off);
}

function signed16(v) {
  return v & 0x8000 ? v - 0x10000 : v;
}

const range = rangeFor(id);
if (!range) {
  console.error(`invalid resource id ${id}`);
  process.exit(1);
}

console.log(`id=${id} off=${hex(range.off, 7)} size=${hex(range.size, 5)} words=${Math.floor(range.size / 2)}`);

const entryRows = [];
for (let i = 0; i < entries && i * 2 + 2 <= range.size; i += 1) {
  const v = beWord(range, i);
  if (v !== 0) entryRows.push({ entry: i, raw: v, pc: v >> 1, odd: v & 1 });
}

console.log(`nonzeroEntries=${entryRows.length}/${entries}`);
for (const row of entryRows) {
  console.log(`entry=${row.entry.toString().padStart(3)} raw=${hex(row.raw, 4)} pc=${hex(row.pc, 4)} odd=${row.odd}`);
}

let start = from;
if (start == null && entry != null) {
  const raw = beWord(range, entry);
  start = raw ? raw >> 1 : 0;
}

if (start != null) {
  console.log(`\ndump startWord=${hex(start, 4)} byteRel=${hex(start * 2, 4)} words=${words}`);
  for (let i = 0; i < words; i += 8) {
    const parts = [];
    const ascii = [];
    for (let j = 0; j < 8 && i + j < words; j += 1) {
      const idx = start + i + j;
      const v = beWord(range, idx);
      if (v == null) {
        parts.push("----");
        continue;
      }
      parts.push(v.toString(16).padStart(4, "0"));
      const hi = v >> 8;
      const lo = v & 0xff;
      ascii.push(hi >= 0x20 && hi <= 0x7e ? String.fromCharCode(hi) : ".");
      ascii.push(lo >= 0x20 && lo <= 0x7e ? String.fromCharCode(lo) : ".");
    }
    console.log(`${hex(start + i, 4)}  ${parts.join(" ")}  ${ascii.join("")}`);
  }

  const counts = new Map();
  for (let i = 0; i < words; i += 1) {
    const v = beWord(range, start + i);
    if (v == null) break;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 16);
  console.log("\ntopWords=" + top.map(([v, count]) => `${hex(v, 4)}:${count}`).join(" "));
  const signed = [];
  for (let i = 0; i < Math.min(words, 32); i += 1) {
    const v = beWord(range, start + i);
    if (v == null) break;
    signed.push(signed16(v));
  }
  console.log("signedFirst32=" + signed.join(" "));
}
