#!/usr/bin/env node

const fs = require("fs");

const input = process.argv[2];
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : 80;
const exeArg = process.argv.indexOf("--exe");
const exePath = exeArg >= 0 ? process.argv[exeArg + 1] : null;
const tableArg = process.argv.indexOf("--table-addr");
const tableAddr = tableArg >= 0 ? Number(process.argv[tableArg + 1]) : 0x801c4f68;
const resourceCountArg = process.argv.indexOf("--resource-count");
const resourceCount = resourceCountArg >= 0 ? Number(process.argv[resourceCountArg + 1]) : 4450;

if (!input) {
  console.error("usage: node scripts/scan-fs2-file.js <FS2_FILE.DAT> [--limit N] [--exe SLPS_019.03] [--table-addr 0x801c4f68]");
  process.exit(2);
}

const data = fs.readFileSync(input);

function hex(n, width = 0) {
  return "0x" + n.toString(16).padStart(width, "0");
}

function alignUp(n, align) {
  return Math.ceil(n / align) * align;
}

function plausibleBlockAt(off) {
  if (off + 16 > data.length) return null;
  const a = data.readUInt32BE(off);
  const b = data.readUInt32BE(off + 4);
  const payloadSize = data.readUInt32BE(off + 8);
  const d = data.readUInt32BE(off + 12);
  if (a === 0 && b === 0 && payloadSize === 0 && d === 0) return null;

  const payloadStart = off + 16;
  const payloadEnd = payloadStart + payloadSize;
  const next = alignUp(payloadEnd, 0x800);
  if (payloadSize <= 0 || payloadSize > 0x400000) return null;
  if (payloadEnd > data.length) return null;
  if (a > 10000 || b > 10000 || d > 0x1000000) return null;

  let pixelLike = 0;
  const sampleEnd = Math.min(payloadEnd, payloadStart + 512);
  for (let p = payloadStart; p + 1 < sampleEnd; p += 2) {
    const v = data.readUInt16LE(p);
    const alphaBit = v & 0x8000;
    const rgb = v & 0x7fff;
    if (rgb === 0 || rgb === 0x7fff || alphaBit || (rgb >= 0x0400 && rgb <= 0x7bff)) {
      pixelLike += 1;
    }
  }

  return { off, a, b, payloadSize, d, next, pixelLike };
}

function blockHeaderAt(off) {
  if (off + 16 > data.length) return null;
  const a = data.readUInt32BE(off);
  const b = data.readUInt32BE(off + 4);
  const payloadSize = data.readUInt32BE(off + 8);
  const d = data.readUInt32BE(off + 12);
  const payloadStart = off + 16;
  const payloadEnd = payloadStart + payloadSize;
  const next = alignUp(payloadEnd, 0x800);
  const plausible =
    payloadSize > 0 &&
    payloadSize <= 0x400000 &&
    payloadEnd <= data.length &&
    a <= 10000 &&
    b <= 10000 &&
    d <= 0x1000000;
  return { off, a, b, payloadSize, d, payloadStart, payloadEnd, next, plausible };
}

function scanSectorBlocks() {
  const hits = [];
  for (let off = 0; off + 16 <= data.length; off += 0x800) {
    const hit = plausibleBlockAt(off);
    if (!hit) continue;
    hits.push(hit);
    if (hits.length >= limit) break;
  }
  return hits;
}

function scanTimCandidates() {
  const validFlags = new Set([0, 1, 2, 3, 8, 9, 10, 11]);
  const hits = [];
  for (let off = 0; off + 20 <= data.length; off += 4) {
    if (data.readUInt32LE(off) !== 0x10) continue;
    const flags = data.readUInt32LE(off + 4);
    if (!validFlags.has(flags)) continue;

    let p = off + 8;
    let ok = true;
    if ((flags & 8) !== 0) {
      const clutLen = data.readUInt32LE(p);
      ok = clutLen >= 12 && clutLen < 0x200000 && p + clutLen <= data.length;
      p += clutLen;
    }
    if (!ok || p + 12 > data.length) continue;

    const len = data.readUInt32LE(p);
    const x = data.readUInt16LE(p + 4);
    const y = data.readUInt16LE(p + 6);
    const w = data.readUInt16LE(p + 8);
    const h = data.readUInt16LE(p + 10);
    if (len >= 12 && len < 0x400000 && p + len <= data.length && w > 0 && h > 0 && w <= 1024 && h <= 512) {
      hits.push({ off, flags, len, x, y, w, h });
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

function readExeSectorRuns(exeFile, ramAddr) {
  const exe = fs.readFileSync(exeFile);
  const load = exe.readUInt32LE(0x18);
  const tableOff = ramAddr - load + 0x800;
  if (tableOff < 0 || tableOff >= exe.length) {
    throw new Error(`table address ${hex(ramAddr)} is outside EXE load range`);
  }

  const values = [];
  for (let off = tableOff; off + 2 <= exe.length; off += 2) {
    values.push(exe.readUInt16LE(off));
  }

  const runs = [];
  let start = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] <= values[i - 1]) {
      runs.push({ start, end: i - 1, values: values.slice(start, i) });
      start = i;
    }
  }
  runs.push({ start, end: values.length - 1, values: values.slice(start) });

  return { exe, load, tableOff, runs };
}

function readExeU16Table(exeFile, ramAddr) {
  const exe = fs.readFileSync(exeFile);
  const load = exe.readUInt32LE(0x18);
  const tableOff = ramAddr - load + 0x800;
  const values = [];
  for (let off = tableOff; off + 2 <= exe.length; off += 2) {
    values.push(exe.readUInt16LE(off));
  }
  return { exe, load, tableOff, values };
}

function unwrappedRangePairs(values, startIndex, count) {
  const pairs = [];
  let add = 0;
  let prev = values[startIndex - 1] ?? values[startIndex];
  for (let n = 0; n < count; n += 1) {
    const i = startIndex + n * 2;
    const aRaw = values[i];
    const bRaw = values[i + 1];
    if (aRaw < prev) add += 0x10000;
    const start = aRaw + add;
    if (bRaw < aRaw) add += 0x10000;
    const end = bRaw + add;
    pairs.push({ pair: n, index: i, aRaw, bRaw, start, end });
    prev = bRaw;
  }
  return pairs;
}

console.log(`file=${input}`);
console.log(`size=${data.length} sectors=${data.length / 2048} mod2048=${data.length % 2048}`);

console.log("\nsector-aligned BE block candidates:");
for (const hit of scanSectorBlocks()) {
  console.log(
    [
      `off=${hex(hit.off)}`,
      `a=${hit.a}`,
      `b=${hit.b}`,
      `payload=${hex(hit.payloadSize)}`,
      `d=${hex(hit.d)}`,
      `next=${hex(hit.next)}`,
      `pixelLike=${hit.pixelLike}`,
    ].join(" ")
  );
}

console.log("\nTIM-like candidates:");
for (const hit of scanTimCandidates()) {
  console.log(
    [
      `off=${hex(hit.off)}`,
      `flags=${hit.flags}`,
      `len=${hex(hit.len)}`,
      `rect=${hit.x},${hit.y},${hit.w},${hit.h}`,
    ].join(" ")
  );
}

if (exePath) {
  const { tableOff, runs } = readExeSectorRuns(exePath, tableAddr);
  const { values } = readExeU16Table(exePath, tableAddr);
  const meaningfulRuns = runs.filter((run) => run.values.length >= 8);
  console.log(`\nEXE sector table: ${exePath}`);
  console.log(`tableAddr=${hex(tableAddr)} tableFileOff=${hex(tableOff)} runs>=8=${meaningfulRuns.length}`);

  for (const run of meaningfulRuns.slice(0, limit)) {
    const first = run.values[0];
    const last = run.values[run.values.length - 1];
    console.log(
      [
        `run=${run.start}..${run.end}`,
        `len=${run.values.length}`,
        `sector=${first}..${last}`,
        `bytes=${hex(first * 0x800)}..${hex(last * 0x800)}`,
      ].join(" ")
    );
  }

  const primary = meaningfulRuns[0];
  if (primary) {
    console.log(`\ninterpreted primary resource table: ids=0..${resourceCount - 1}, boundary[${resourceCount}]=${values[resourceCount]}`);
    console.log(`resourceTableBytes=${hex(values[0] * 0x800)}..${hex(values[resourceCount] * 0x800)}`);

    console.log("\nlarge range pairs after resource table:");
    for (const pair of unwrappedRangePairs(values, resourceCount, 17)) {
      console.log(
        [
          `pair=${pair.pair}`,
          `index=${pair.index}/${pair.index + 1}`,
          `raw=${pair.aRaw},${pair.bRaw}`,
          `sector=${pair.start}..${pair.end}`,
          `bytes=${hex(pair.start * 0x800)}..${hex(pair.end * 0x800)}`,
          `span=${hex((pair.end - pair.start) * 0x800)}`,
        ].join(" ")
      );
    }

    console.log("\nprimary run resource map sample:");
    for (let i = 0; i < Math.min(resourceCount, limit); i += 1) {
      const sector = primary.values[i];
      const nextSector = primary.values[i + 1];
      const off = sector * 0x800;
      const nextOff = nextSector * 0x800;
      const header = blockHeaderAt(off);
      const span = nextOff - off;
      const alignedEnd = header ? header.next : null;
      const status = header && header.plausible && alignedEnd <= nextOff ? "ok" : "check";
      console.log(
        [
          `id=${i}`,
          `sector=${sector}`,
          `off=${hex(off)}`,
          `next=${hex(nextOff)}`,
          `span=${hex(span)}`,
          header ? `hdr=${header.a},${header.b},${hex(header.payloadSize)},${hex(header.d)}` : "hdr=(none)",
          header ? `hdrNext=${hex(header.next)}` : "",
          `status=${status}`,
        ].filter(Boolean).join(" ")
      );
    }
  }
}
