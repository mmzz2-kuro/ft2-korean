#!/usr/bin/env node

const fs = require("fs");

const datPath = process.argv[2];
const exePath = process.argv[3];
const ids = process.argv.slice(4).map((arg) => Number(arg)).filter((id) => Number.isFinite(id));

if (!datPath || !exePath || ids.length === 0) {
  console.error("usage: node scripts/scan-fs2-text-candidates.js <FS2_FILE.DAT> <SLPS_019.03> <id...>");
  process.exit(2);
}

const dat = fs.readFileSync(datPath);
const exe = fs.readFileSync(exePath);
const dec = new TextDecoder("shift_jis", { fatal: false });
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

function sjisCharLen(buf, pos, end) {
  const b = buf[pos];
  if (b === 0x00 || b === 0xff) return 0;
  if (b === 0x09 || b === 0x0a || b === 0x0d) return 1;
  if (b >= 0x20 && b <= 0x7e) return 1;
  if (b >= 0xa1 && b <= 0xdf) return 1;
  if (((b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc)) && pos + 1 < end) {
    const c = buf[pos + 1];
    if ((c >= 0x40 && c <= 0x7e) || (c >= 0x80 && c <= 0xfc)) return 2;
  }
  return 0;
}

function scoreText(text) {
  let jp = 0;
  let ascii = 0;
  let bad = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (
      (cp >= 0x3040 && cp <= 0x30ff) ||
      (cp >= 0x3400 && cp <= 0x9fff) ||
      cp === 0x3000 ||
      (cp >= 0x3001 && cp <= 0x303f)
    ) {
      jp += 1;
    } else if (cp >= 0x20 && cp <= 0x7e) {
      ascii += 1;
    } else if (cp !== 0x0a && cp !== 0x0d && cp !== 0x09) {
      bad += 1;
    }
  }
  return jp * 4 + ascii - bad * 5;
}

function scanRange(off, size) {
  const hits = [];
  const end = off + size;
  let pos = off;
  while (pos < end) {
    const start = pos;
    const bytes = [];
    while (pos < end) {
      const len = sjisCharLen(dat, pos, end);
      if (len === 0) break;
      for (let i = 0; i < len; i += 1) bytes.push(dat[pos + i]);
      pos += len;
      if (bytes.length >= 240) break;
    }

    if (bytes.length >= 12) {
      const text = dec.decode(Uint8Array.from(bytes)).replace(/\s+/g, " ").trim();
      const score = scoreText(text);
      const hasJapanese = /[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
      if (hasJapanese && score >= 12) {
        hits.push({ off: start, bytes: bytes.length, score, text });
      }
    }
    pos = Math.max(pos + 1, start + 1);
  }
  return hits.sort((a, b) => b.score - a.score || b.bytes - a.bytes);
}

for (const id of ids) {
  const range = resourceRange(id);
  if (!range) {
    console.log(`\nid=${id} invalid/wrap`);
    continue;
  }
  const hits = scanRange(range.off, range.size).slice(0, 8);
  console.log(`\nid=${id} off=${hex(range.off, 7)} size=${hex(range.size, 5)} hits=${hits.length}`);
  for (const hit of hits) {
    console.log(`  at=${hex(hit.off)} rel=${hex(hit.off - range.off)} bytes=${hit.bytes} score=${hit.score} ${hit.text.slice(0, 120)}`);
  }
}
