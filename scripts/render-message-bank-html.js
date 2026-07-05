#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function usage() {
  console.error(
    'usage: node scripts/render-message-bank-html.js <FS2_FILE.DAT> <SLPS_019.03> <out.html> <messageId...> [--scale N] [--bg fe|00]'
  );
  process.exit(1);
}

const argv = process.argv.slice(2);
const datPath = argv.shift();
const exePath = argv.shift();
const outPath = argv.shift();
if (!datPath || !exePath || !outPath) usage();

let scale = 4;
let bgMode = '00';
const ids = [];

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--scale') {
    scale = Number.parseInt(argv[++i] || '', 10);
    if (!Number.isFinite(scale) || scale <= 0) usage();
  } else if (arg === '--bg') {
    bgMode = (argv[++i] || '').toLowerCase();
    if (!['00', 'fe'].includes(bgMode)) usage();
  } else {
    const id = Number.parseInt(arg, 0);
    if (!Number.isFinite(id)) usage();
    ids.push(id);
  }
}

if (ids.length === 0) usage();

const dat = fs.readFileSync(datPath);
const exe = fs.readFileSync(exePath);
const loadAddr = exe.readUInt32LE(0x18);

const fs2SectorTableOff = 0x5c768;
const groupPointerTableAddr = 0x80169db0;
const colorTableAddr = 0x801cbb08;

function fileOffOfRam(addr) {
  return addr - loadAddr + 0x800;
}

function fs2Sector(index) {
  return exe.readUInt16LE(fs2SectorTableOff + index * 2);
}

function groupInfo(group) {
  const pointerTableOff = fileOffOfRam(groupPointerTableAddr);
  const tableAddr = exe.readUInt32LE(pointerTableOff + group * 4);
  const nextTableAddr = exe.readUInt32LE(pointerTableOff + (group + 1) * 4);
  if (tableAddr < loadAddr || tableAddr >= loadAddr + exe.length) {
    throw new Error(`group ${group} table pointer out of EXE range: 0x${tableAddr.toString(16)}`);
  }
  if (nextTableAddr <= tableAddr || nextTableAddr > loadAddr + exe.length) {
    throw new Error(`group ${group} next table pointer is not usable: 0x${nextTableAddr.toString(16)}`);
  }
  return {
    tableOff: fileOffOfRam(tableAddr),
    count: Math.floor((nextTableAddr - tableAddr) / 2),
    baseSector: fs2Sector(4451 + group * 2),
  };
}

function mapMessageId(messageId) {
  const n = messageId - 1001;
  if (n < 0) throw new Error(`messageId ${messageId} is below 1001`);
  const group = Math.floor(n / 1000);
  const index = n % 1000;
  const info = groupInfo(group);
  if (index + 1 >= info.count) {
    throw new Error(`messageId ${messageId} index ${index} is outside group ${group} count ${info.count}`);
  }
  const relStart = exe.readUInt16LE(info.tableOff + index * 2);
  const relEnd = exe.readUInt16LE(info.tableOff + (index + 1) * 2);
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

  // 0x8017CC90 preprocessing used before the full render loop.
  swap16Range(common, 0x1000, 0x930);
  swap32Range(common, 0x1930, 0xd0);

  return common;
}

function readPalette(bg) {
  const off = fileOffOfRam(colorTableAddr);
  const palette = [...exe.subarray(off, off + 4)];
  palette[0] = bg === 'fe' ? 0xfe : 0x00;
  return palette;
}

function renderMessageBlock(block, bg) {
  const common = preprocessCommon(block);
  const palette = readPalette(bg);
  const outWidth = 200;
  const outHeight = 48;
  const pixels = new Uint8Array(outWidth * outHeight);
  pixels.fill(palette[0]);

  for (let index = 0; index < 588; index++) {
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

function pixelsToCanvasScript(id, rendered) {
  const values = Array.from(rendered.pixels);
  return `
    {
      const canvas = document.getElementById('canvas-${id}');
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

const sections = [];
const scripts = [];

for (const id of ids) {
  const mapped = mapMessageId(id);
  const block = dat.subarray(mapped.byteStart, mapped.byteEnd);
  const rendered = renderMessageBlock(block, bgMode);
  sections.push(`
    <section class="card">
      <h2>ID ${id}</h2>
      <p>group ${mapped.group}, index ${mapped.index}, sectors ${mapped.sectorStart}..${mapped.sectorEnd}, bytes 0x${(mapped.byteEnd - mapped.byteStart).toString(16)}</p>
      <canvas id="canvas-${id}" width="${rendered.width}" height="${rendered.height}" style="width:${rendered.width * scale}px;height:${rendered.height * scale}px"></canvas>
    </section>
  `);
  scripts.push(pixelsToCanvasScript(id, rendered));
}

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>SLPS-01903 Message Bank Render Preview</title>
<style>
  body { margin: 16px; background: #f6f5f1; color: #1f252a; font: 14px/1.45 Consolas, Menlo, monospace; }
  h1 { font-size: 22px; margin: 0 0 12px; }
  h2 { font-size: 16px; margin: 0 0 4px; }
  p { margin: 0 0 10px; color: #4f5961; }
  .card { border: 1px solid #cbc8bf; background: #fff; padding: 12px; margin: 0 0 14px; }
  canvas { image-rendering: pixelated; border: 1px solid #bbb; background: #fff; display: block; }
</style>
</head>
<body>
<h1>SLPS-01903 Message Bank Render Preview</h1>
<p>Offline reproduction of 0x8017CC90 preprocessing + 0x8017C7C0 full render loop. Canvas is 200x48 bytes, scaled ${scale}x, bg=${bgMode}.</p>
${sections.join('\n')}
<script>
${scripts.join('\n')}
</script>
</body>
</html>
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);
console.log(`wrote ${outPath}`);
