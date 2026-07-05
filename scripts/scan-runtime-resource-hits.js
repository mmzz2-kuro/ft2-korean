#!/usr/bin/env node

const fs = require("fs");
const zlib = require("zlib");

function usage() {
  console.error(
    [
      "usage: node scripts/scan-runtime-resource-hits.js <FS2_FILE.DAT> <SLPS_019.03> <after-state-or-ram> [--before file] [--ids A-B,C] [--sig-len N] [--min-size N]",
      "",
      "Scans an emulator savestate/RAM dump for byte signatures from FS2 resources.",
      "Use a before/after pair around a menu/status/config screen transition to find newly loaded IDs.",
    ].join("\n")
  );
  process.exit(2);
}

const datPath = process.argv[2];
const exePath = process.argv[3];
const afterPath = process.argv[4];
if (!datPath || !exePath || !afterPath) usage();

let beforePath = null;
let idsArg = null;
let sigLen = 64;
let minSize = 0x400;

for (let i = 5; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg === "--before") beforePath = process.argv[++i];
  else if (arg === "--ids") idsArg = process.argv[++i];
  else if (arg === "--sig-len") sigLen = Number(process.argv[++i]);
  else if (arg === "--min-size") minSize = Number(process.argv[++i]);
  else usage();
}

if (!Number.isFinite(sigLen) || sigLen < 16) throw new Error("--sig-len must be >= 16");
if (!Number.isFinite(minSize) || minSize < 0) throw new Error("--min-size must be >= 0");

const dat = fs.readFileSync(datPath);
const exe = fs.readFileSync(exePath);
const load = exe.readUInt32LE(0x18);
const tableOff = 0x801c4f68 - load + 0x800;

function hex(n, width = 0) {
  return "0x" + n.toString(16).padStart(width, "0");
}

function readMaybeCompressed(path) {
  const raw = fs.readFileSync(path);
  if (raw.length >= 0x1a && raw.subarray(0, 5).toString("ascii") === "#RZIP") {
    const chunks = [];
    let off = 0x14;
    while (off + 4 <= raw.length) {
      const compressedSize = raw.readUInt32LE(off);
      off += 4;
      if (compressedSize === 0 || off + compressedSize > raw.length) {
        throw new Error(`invalid RZIP chunk size ${compressedSize} at ${hex(off - 4)}`);
      }
      chunks.push(zlib.inflateSync(raw.subarray(off, off + compressedSize)));
      off += compressedSize;
    }
    return Buffer.concat(chunks);
  }
  if (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
    return zlib.gunzipSync(raw);
  }
  if (raw.length >= 2 && raw[0] === 0x78) {
    try {
      return zlib.inflateSync(raw);
    } catch (_) {
      return raw;
    }
  }
  return raw;
}

function parseIds(arg) {
  if (!arg) return null;
  const out = [];
  for (const part of arg.split(",")) {
    if (!part.trim()) continue;
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      for (let id = Math.min(a, b); id <= Math.max(a, b); id += 1) out.push(id);
    } else {
      out.push(Number(part));
    }
  }
  return [...new Set(out.filter((id) => Number.isInteger(id) && id >= 0))].sort((a, b) => a - b);
}

function maxResourceId() {
  let last = 0;
  const max = Math.floor((exe.length - tableOff) / 2) - 2;
  for (let id = 0; id < max; id += 1) {
    const a = exe.readUInt16LE(tableOff + id * 2);
    const b = exe.readUInt16LE(tableOff + (id + 1) * 2);
    if (id > 0 && a === 0 && b === 0) break;
    if (b > a && b * 0x800 <= dat.length) last = id;
  }
  return last;
}

function resourceRange(id) {
  const off = tableOff + id * 2;
  if (off < 0 || off + 4 > exe.length) return null;
  const startSector = exe.readUInt16LE(off);
  const endSector = exe.readUInt16LE(off + 2);
  if (endSector <= startSector) return null;
  const start = startSector * 0x800;
  const size = (endSector - startSector) * 0x800;
  if (start < 0 || start + size > dat.length) return null;
  return { id, startSector, endSector, off: start, size };
}

function isTrivial(buf) {
  if (buf.length === 0) return true;
  let same = true;
  let zero = 0;
  let ff = 0;
  for (const b of buf) {
    if (b !== buf[0]) same = false;
    if (b === 0) zero += 1;
    if (b === 0xff) ff += 1;
  }
  return same || zero / buf.length > 0.85 || ff / buf.length > 0.85;
}

function swap16(buf, start, end) {
  for (let i = start; i + 1 < end; i += 2) {
    const a = buf[i];
    buf[i] = buf[i + 1];
    buf[i + 1] = a;
  }
}

function swap32(buf, start, end) {
  for (let i = start; i + 3 < end; i += 4) {
    const a = buf[i];
    const b = buf[i + 1];
    buf[i] = buf[i + 3];
    buf[i + 1] = buf[i + 2];
    buf[i + 2] = b;
    buf[i + 3] = a;
  }
}

function classify(raw) {
  if (raw.length >= 16) {
    const w = raw.readUInt32BE(0);
    const h = raw.readUInt32BE(4);
    const payload = raw.readUInt32BE(8);
    const dataOff = raw.readUInt32BE(12);
    if (
      w > 0 &&
      h > 0 &&
      w < 10000 &&
      h < 10000 &&
      payload > 0 &&
      payload <= raw.length &&
      dataOff >= 0x10 &&
      dataOff <= payload
    ) {
      return `be-hdr(${w},${h},${hex(payload)},${hex(dataOff)})`;
    }
  }
  if (raw.length >= 4 && raw.readUInt32BE(0) === 0x400) return "raw-0x400";
  if (raw.length >= 4 && raw.readUInt32BE(0) === 0x56414770) return "VAGp";
  return "other";
}

function variants(raw) {
  const out = [{ name: "raw", bytes: raw }];
  const all16 = Buffer.from(raw);
  swap16(all16, 0, all16.length);
  out.push({ name: "swap16-all", bytes: all16 });

  if (raw.length >= 16) {
    const dataOff = raw.readUInt32BE(12);
    if (dataOff >= 0x10 && dataOff <= raw.length) {
      const be = Buffer.from(raw);
      swap32(be, 0, 0x10);
      swap16(be, 0x10, dataOff);
      out.push({ name: "be-hdr-post", bytes: be });
    }
  }
  return out;
}

function candidateSignatures(range) {
  const raw = dat.subarray(range.off, range.off + range.size);
  const offsets = [0, 0x10, 0x20, 0x40, 0x80, 0x100, 0x200, 0x210, 0x400, 0x800];
  const sigs = [];
  for (const variant of variants(raw)) {
    for (const rel of offsets) {
      if (rel + sigLen > variant.bytes.length) continue;
      const sig = variant.bytes.subarray(rel, rel + sigLen);
      if (isTrivial(sig)) continue;
      sigs.push({ id: range.id, rel, variant: variant.name, sig });
    }
  }
  return sigs;
}

function scanBuffer(target, idList) {
  const hits = new Map();
  for (const id of idList) {
    const range = resourceRange(id);
    if (!range || range.size < minSize) continue;
    for (const rec of candidateSignatures(range)) {
      const at = target.indexOf(rec.sig);
      if (at < 0) continue;
      const existing = hits.get(id);
      if (!existing) {
        hits.set(id, { ...range, at, rel: rec.rel, variant: rec.variant, classify: classify(dat.subarray(range.off, range.off + range.size)), count: 1 });
      } else {
        existing.count += 1;
      }
    }
  }
  return hits;
}

const ids = parseIds(idsArg) || Array.from({ length: maxResourceId() + 1 }, (_, i) => i);
const after = readMaybeCompressed(afterPath);
const before = beforePath ? readMaybeCompressed(beforePath) : null;

console.log(`after=${afterPath} bytes=${after.length}`);
if (beforePath) console.log(`before=${beforePath} bytes=${before.length}`);
console.log(`ids=${ids[0]}..${ids[ids.length - 1]} count=${ids.length} sigLen=${sigLen} minSize=${hex(minSize)}`);

const afterHits = scanBuffer(after, ids);
const beforeHits = before ? scanBuffer(before, ids) : new Map();
const rows = [...afterHits.values()]
  .filter((row) => !beforeHits.has(row.id))
  .sort((a, b) => a.id - b.id);

console.log(`newHits=${rows.length} afterHits=${afterHits.size} beforeHits=${beforeHits.size}`);
console.log(["id", "stateOffset", "datOffset", "size", "variant", "sigRel", "sigMatches", "class"].join("\t"));
for (const row of rows) {
  console.log(
    [
      row.id,
      hex(row.at),
      hex(row.off, 7),
      hex(row.size, 5),
      row.variant,
      hex(row.rel),
      row.count,
      row.classify,
    ].join("\t")
  );
}
