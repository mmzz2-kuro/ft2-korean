#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function usage() {
  console.error(
    'usage: node scripts/export-dialogue-script-preview-html.js <FS2_FILE.DAT> <SLPS_019.03> <out.html> [--ids 309-326] [--scale N] [--bg fe|00]'
  );
  process.exit(1);
}

const argv = process.argv.slice(2);
const datPath = argv.shift();
const exePath = argv.shift();
const outPath = argv.shift();
if (!datPath || !exePath || !outPath) usage();

let idStart = 309;
let idEnd = 326;
let scale = 4;
let bgMode = '00';

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--ids') {
    const [a, b] = (argv[++i] || '').split('-').map((value) => Number.parseInt(value, 10));
    if (!Number.isFinite(a) || !Number.isFinite(b)) usage();
    idStart = a;
    idEnd = b;
  } else if (arg === '--scale') {
    scale = Number.parseInt(argv[++i] || '', 10);
    if (!Number.isFinite(scale) || scale <= 0) usage();
  } else if (arg === '--bg') {
    bgMode = (argv[++i] || '').toLowerCase();
    if (!['00', 'fe'].includes(bgMode)) usage();
  } else {
    usage();
  }
}

const dat = fs.readFileSync(datPath);
const exe = fs.readFileSync(exePath);
const loadAddr = exe.readUInt32LE(0x18);

const fs2SectorTableOff = 0x5c768;
const dispatchTableOff = 0x5c54c;
const dispatchCount = 126;
const readerJal = 0x0c05f0d9; // jal 0x8017c364
const checkedReaderJal = 0x0c05f0e4; // jal 0x8017c390
const groupPointerTableAddr = 0x80169db0;
const colorTableAddr = 0x801cbb08;
const dialogueOpcode = 0x41;

function fileOffOfRam(addr) {
  return addr - loadAddr + 0x800;
}

function fs2Sector(index) {
  return exe.readUInt16LE(fs2SectorTableOff + index * 2);
}

function resourceBytes(id) {
  return dat.subarray(fs2Sector(id) * 2048, fs2Sector(id + 1) * 2048);
}

function groupInfo(group) {
  const pointerTableOff = fileOffOfRam(groupPointerTableAddr);
  const tableAddr = exe.readUInt32LE(pointerTableOff + group * 4);
  const nextTableAddr = exe.readUInt32LE(pointerTableOff + (group + 1) * 4);
  if (tableAddr < loadAddr || tableAddr >= loadAddr + exe.length) return null;
  if (nextTableAddr <= tableAddr || nextTableAddr > loadAddr + exe.length) return null;
  return {
    tableOff: fileOffOfRam(tableAddr),
    count: Math.floor((nextTableAddr - tableAddr) / 2),
    baseSector: fs2Sector(4451 + group * 2),
  };
}

function mapMessageId(messageId) {
  const n = messageId - 1001;
  if (n < 0) return null;
  const group = Math.floor(n / 1000);
  const index = n % 1000;
  const info = groupInfo(group);
  if (!info || index + 1 >= info.count) return null;

  const relStart = exe.readUInt16LE(info.tableOff + index * 2);
  const relEnd = exe.readUInt16LE(info.tableOff + (index + 1) * 2);
  if (relEnd <= relStart) return null;

  const sectorStart = info.baseSector + relStart;
  const sectorEnd = info.baseSector + relEnd;
  return {
    messageId,
    group,
    index,
    sectorStart,
    sectorEnd,
    byteStart: sectorStart * 2048,
    byteEnd: sectorEnd * 2048,
  };
}

function beHalfwords(buffer) {
  const words = [];
  for (let off = 0; off + 1 < buffer.length; off += 2) words.push(buffer.readUInt16BE(off));
  return words;
}

const handlers = [];
for (let i = 0; i < dispatchCount; i++) handlers.push(exe.readUInt32LE(dispatchTableOff + i * 4));

const uniqueHandlers = [...new Set(handlers)].sort((a, b) => a - b);
function nextHandler(addr) {
  return uniqueHandlers.find((candidate) => candidate > addr) || addr + 0x100;
}

function countDirectReaderCalls(addr) {
  const start = fileOffOfRam(addr);
  const end = Math.min(fileOffOfRam(nextHandler(addr)), exe.length);
  let count = 0;
  for (let off = start; off + 4 <= end; off += 4) {
    const word = exe.readUInt32LE(off);
    if (word === readerJal || word === checkedReaderJal) count++;
  }
  return count;
}

const argCounts = handlers.map(countDirectReaderCalls);
argCounts[0x3f] = 2;
argCounts[0x40] = 2;
argCounts[0x41] = 1;
argCounts[0x78] = 1;

function scanDialogueHits() {
  const hits = [];
  const skipped = [];

  for (let id = idStart; id <= idEnd; id++) {
    const words = beHalfwords(resourceBytes(id));
    const starts = [...new Set(
      words
        .slice(0, 192)
        .filter(Boolean)
        .map((value) => value >> 1)
        .filter((value) => value >= 192 && value < words.length)
    )].sort((a, b) => a - b);

    for (let entry = 0; entry < starts.length; entry++) {
      let pc = starts[entry];
      const end = starts[entry + 1] || words.length;
      let guard = 0;

      while (pc < end && guard++ < 2000) {
        const opcodePc = pc;
        const opcode = words[pc++];

        if (opcode === 0xffff || opcode === 0xfffe) break;
        if (opcode >= argCounts.length) break;

        const argc = argCounts[opcode] || 0;
        const opArgs = [];
        for (let i = 0; i < argc && pc < end; i++) opArgs.push(words[pc++]);

        if (opcode === dialogueOpcode) {
          const messageId = opArgs[0];
          const mapped = mapMessageId(messageId);
          const hit = {
            scriptId: id,
            entry,
            entryWord: starts[entry],
            opcodeWord: opcodePc,
            messageId,
            mapped,
          };
          if (mapped) hits.push(hit);
          else skipped.push(hit);
        }
      }
    }
  }

  return { hits, skipped };
}

function swap16Range(buffer, start, length) {
  for (let off = start; off < start + length; off += 2) {
    const a = buffer[off];
    buffer[off] = buffer[off + 1];
    buffer[off + 1] = a;
  }
}

function swap32Range(buffer, start, length) {
  for (let off = start; off < start + length; off += 4) {
    const a = buffer[off];
    const b = buffer[off + 1];
    buffer[off] = buffer[off + 3];
    buffer[off + 1] = buffer[off + 2];
    buffer[off + 2] = b;
    buffer[off + 3] = a;
  }
}

function preprocessCommon(block) {
  const common = Buffer.alloc(Math.max(0x4000, 0x1000 + block.length));
  block.copy(common, 0x1000);
  swap16Range(common, 0x1000, 0x930);
  swap32Range(common, 0x1930, 0xd0);
  buildRevealTable(common);
  return common;
}

function mulHiU32(a, b) {
  return Number((BigInt(a >>> 0) * BigInt(b >>> 0)) >> 32n) >>> 0;
}

function buildRevealTable(common) {
  const count = common.readUInt16LE(0x1930);
  const pointerBase = 0x1934;
  if (count === 0 || count > 52) {
    common.writeUInt16LE(0, 0);
    common.writeUInt16LE(0, 2);
    return { count: 0, marks: [] };
  }

  const last = common.readUInt32LE(pointerBase + (count - 1) * 4);
  common.writeUInt32LE(last, pointerBase + count * 4);
  common.writeUInt32LE(count * 14, 0);

  const marks = [];
  let out = 4;
  for (let seg = 0; seg < count; seg++) {
    let start = common.readUInt32LE(pointerBase + seg * 4);
    const end = common.readUInt32LE(pointerBase + (seg + 1) * 4);
    const deltaWords = (end - start) >>> 2;
    const div7 = mulHiU32(deltaWords, 0x24924925);

    for (let i = 0; i < 14; i++) {
      const mark = mulHiU32((start + div7) >>> 0, 0x59493e15) >>> 7;
      common.writeUInt32LE(mark >>> 0, out);
      marks.push(mark >>> 0);
      start = (start + div7) >>> 0;
      out += 4;
    }
  }
  return { count, marks };
}

function readPalette(bg) {
  const off = fileOffOfRam(colorTableAddr);
  const palette = [...exe.subarray(off, off + 4)];
  palette[0] = bg === 'fe' ? 0xfe : 0x00;
  return palette;
}

function renderCommon(common, bg, maxIndex = 588) {
  const palette = readPalette(bg);
  const outWidth = 200;
  const outHeight = 48;
  const pixels = new Uint8Array(outWidth * outHeight);
  pixels.fill(palette[0]);

  const limit = Math.max(0, Math.min(588, maxIndex));
  for (let index = 0; index < limit; index++) {
    const group = Math.floor(index / 196);
    const column = index - group * 196;
    const rowBase = group * 16;
    const sourceOff = 0x1000 + index * 4;
    const words = [common.readUInt16LE(sourceOff), common.readUInt16LE(sourceOff + 2)];

    for (let wordIndex = 0; wordIndex < 2; wordIndex++) {
      let value = words[wordIndex];
      for (let bitPair = 0; bitPair < 8; bitPair++) {
        const color = palette[value & 0x03];
        value >>>= 2;
        const y = rowBase + wordIndex * 8 + (7 - bitPair);
        pixels[y * outWidth + column] = color;
      }
    }
  }

  return { pixels, width: outWidth, height: outHeight };
}

function segmentInfo(common) {
  const count = common.readUInt16LE(0x1930);
  const pointers = [];
  const revealMarks = [];
  if (count > 0 && count <= 52) {
    for (let i = 0; i <= count; i++) pointers.push(common.readUInt32LE(0x1934 + i * 4));
  }
  const revealCount = common.readUInt32LE(0);
  if (revealCount > 0 && revealCount <= 0x400) {
    for (let i = 0; i < revealCount; i++) revealMarks.push(common.readUInt32LE(4 + i * 4));
  }
  return {
    count,
    revealCount,
    pointers,
    revealMarks,
  };
}

function pixelsToCanvasScript(canvasId, rendered) {
  const values = Array.from(rendered.pixels);
  return `
    {
      const canvas = document.getElementById('${canvasId}');
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(${rendered.width}, ${rendered.height});
      const values = [${values.join(',')}];
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        const o = i * 4;
        let shade;
        if (v === 0xfe) shade = 0;
        else if (v === 0x00) shade = 255;
        else if (v === 0x01) shade = 190;
        else if (v === 0x02) shade = 100;
        else if (v === 0x03) shade = 35;
        else shade = 255 - (v & 0xff);
        img.data[o] = shade;
        img.data[o + 1] = shade;
        img.data[o + 2] = shade;
        img.data[o + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }
  `;
}

const { hits, skipped } = scanDialogueHits();
const sections = [];
const scripts = [];
const manifest = [];

for (let i = 0; i < hits.length; i++) {
  const hit = hits[i];
  const block = dat.subarray(hit.mapped.byteStart, hit.mapped.byteEnd);
  const common = preprocessCommon(block);
  const rendered = renderCommon(common, bgMode);
  const info = segmentInfo(common);
  const canvasId = `canvas-${i}`;
  const pointerPreview = info.pointers.slice(0, 10).map((value) => `0x${value.toString(16)}`).join(' ');
  const markPreview = info.revealMarks.slice(0, 10).join(' ');

  sections.push(`
    <section class="card">
      <h2>${String(i + 1).padStart(2, '0')} / message ${hit.messageId}</h2>
      <p>script ${hit.scriptId}, entry ${hit.entry}, entryWord 0x${hit.entryWord.toString(16)}, opcodeWord 0x${hit.opcodeWord.toString(16)}</p>
      <p>group ${hit.mapped.group}, index ${hit.mapped.index}, sectors ${hit.mapped.sectorStart}..${hit.mapped.sectorEnd}, bytes 0x${(hit.mapped.byteEnd - hit.mapped.byteStart).toString(16)}</p>
      <p>segments ${info.count}, reveal entries ${info.revealCount}${markPreview ? `, marks ${markPreview}` : ''}${pointerPreview ? `, ptr ${pointerPreview}` : ''}</p>
      <canvas id="${canvasId}" width="${rendered.width}" height="${rendered.height}" style="width:${rendered.width * scale}px;height:${rendered.height * scale}px"></canvas>
    </section>
  `);
  scripts.push(pixelsToCanvasScript(canvasId, rendered));
  manifest.push({
    order: i + 1,
    scriptId: hit.scriptId,
    entry: hit.entry,
    entryWord: hit.entryWord,
    opcodeWord: hit.opcodeWord,
    messageId: hit.messageId,
    group: hit.mapped.group,
    index: hit.mapped.index,
    sectorStart: hit.mapped.sectorStart,
    sectorEnd: hit.mapped.sectorEnd,
    bytes: hit.mapped.byteEnd - hit.mapped.byteStart,
    segmentCount: info.count,
    revealEntries: info.revealCount,
    revealMarks: info.revealMarks,
    segmentPointers: info.pointers,
  });
}

const skippedText = skipped
  .map((hit) => `script ${hit.scriptId} entry ${hit.entry} word 0x${hit.opcodeWord.toString(16)} arg ${hit.messageId}`)
  .join('\n');

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>SLPS-01903 Dialogue Script Preview</title>
<style>
  body { margin: 16px; background: #f6f5f1; color: #1f252a; font: 14px/1.45 Consolas, Menlo, monospace; }
  h1 { font-size: 22px; margin: 0 0 12px; }
  h2 { font-size: 16px; margin: 0 0 4px; }
  p { margin: 0 0 8px; color: #4f5961; }
  pre { white-space: pre-wrap; background: #fff; border: 1px solid #d3d0c7; padding: 8px; }
  .card { border: 1px solid #cbc8bf; background: #fff; padding: 12px; margin: 0 0 14px; }
  canvas { image-rendering: pixelated; border: 1px solid #bbb; background: #fff; display: block; }
</style>
</head>
<body>
<h1>SLPS-01903 Dialogue Script Preview</h1>
<p>Opcode 0x41 hits from script resources ${idStart}..${idEnd}. Render uses the same full 200x48 mask path as the game. bg=${bgMode}, scale=${scale}.</p>
<p>Valid hits: ${hits.length}. Skipped parser-noise hits: ${skipped.length}.</p>
${skippedText ? `<pre>${skippedText}</pre>` : ''}
${sections.join('\n')}
<script>
${scripts.join('\n')}
</script>
</body>
</html>
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);
fs.writeFileSync(outPath.replace(/\.html?$/i, '.manifest.json'), JSON.stringify({ hits: manifest, skipped }, null, 2));
console.log(`valid hits ${hits.length}, skipped ${skipped.length}`);
console.log(`wrote ${outPath}`);
