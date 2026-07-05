#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const datPath = args.shift();
const exePath = args.shift();
const outPath = args.shift();

let scale = 2;
const ids = [];

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--scale") scale = Number(args[++i]);
  else if (arg.startsWith("--")) {
    console.error(`unknown option: ${arg}`);
    process.exit(2);
  } else {
    const id = Number(arg);
    if (Number.isFinite(id)) ids.push(id);
  }
}

if (!datPath || !exePath || !outPath || ids.length === 0) {
  console.error(
    "usage: node scripts/export-fs2-behdr-tilemap-html.js <FS2_FILE.DAT> <SLPS_019.03> <out.html> <id...> [--scale N]"
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

function resourceRange(id) {
  const startSector = exe.readUInt16LE(tableOff + id * 2);
  const endSector = exe.readUInt16LE(tableOff + (id + 1) * 2);
  if (endSector <= startSector) return null;
  return {
    off: startSector * 0x800,
    size: (endSector - startSector) * 0x800,
    startSector,
    endSector,
  };
}

function swap32(buf, start, size) {
  for (let i = 0; i + 3 < size; i += 4) {
    const off = start + i;
    const a = buf[off];
    const b = buf[off + 1];
    const c = buf[off + 2];
    const d = buf[off + 3];
    buf[off] = d;
    buf[off + 1] = c;
    buf[off + 2] = b;
    buf[off + 3] = a;
  }
}

function swap16(buf, start, size) {
  for (let i = 0; i + 1 < size; i += 2) {
    const off = start + i;
    const a = buf[off];
    buf[off] = buf[off + 1];
    buf[off + 1] = a;
  }
}

function decodeResource(id) {
  const range = resourceRange(id);
  if (!range) return { id, invalid: true };

  const raw = dat.subarray(range.off, range.off + range.size);
  if (raw.length < 0x210) return { id, invalid: true, range };

  const buf = Buffer.from(raw);
  swap32(buf, 0, 16);
  const widthTiles = buf.readUInt32LE(0);
  const heightTiles = buf.readUInt32LE(4);
  const payloadSize = buf.readUInt32LE(8);
  const tileDataOffset = buf.readUInt32LE(12);

  if (
    widthTiles <= 0 ||
    heightTiles <= 0 ||
    widthTiles > 512 ||
    heightTiles > 512 ||
    payloadSize > buf.length ||
    tileDataOffset < 0x10 ||
    tileDataOffset > payloadSize
  ) {
    return { id, invalid: true, range, header: { widthTiles, heightTiles, payloadSize, tileDataOffset } };
  }

  // 0x801881C4 swaps the header as 32-bit words, then only swaps the
  // tilemap/record area up to header[0x0c]. The tile pixel payload stays raw.
  swap16(buf, 16, tileDataOffset - 16);
  const tileMapCount = widthTiles * heightTiles;
  const tileMapBytes = tileMapCount * 2;
  const tileMapOffset = tileDataOffset - tileMapBytes;
  const tileMapEnd = tileMapOffset + tileMapCount * 2;
  const tileCount = Math.floor((payloadSize - tileDataOffset) / 64);

  if (tileMapOffset < 0x10 || tileMapEnd > tileDataOffset || tileCount <= 0) {
    return { id, invalid: true, range, header: { widthTiles, heightTiles, payloadSize, tileDataOffset, tileMapOffset, tileCount } };
  }

  const tileMap = [];
  for (let i = 0; i < tileMapCount; i += 1) {
    tileMap.push(buf.readUInt16LE(tileMapOffset + i * 2));
  }

  const modes = [
    { name: "raw>>1", fn: (v) => v >> 1 },
    { name: "low10", fn: (v) => v & 0x03ff },
    { name: "low11>>1", fn: (v) => (v & 0x07ff) >> 1 },
  ];

  const canvases = modes.map((mode) => renderMode(buf, widthTiles, heightTiles, tileDataOffset, tileCount, tileMap, mode));
  const minTile = Math.min(...tileMap);
  const maxTile = Math.max(...tileMap);
  const uniqueTile = new Set(tileMap).size;

  return {
    id,
    range,
    header: { widthTiles, heightTiles, payloadSize, tileDataOffset, tileMapOffset, tileCount, minTile, maxTile, uniqueTile },
    canvases,
  };
}

function tilePixel(buf, tileDataOffset, tileIndex, x, y) {
  const tileOff = tileDataOffset + tileIndex * 64;
  return buf[tileOff + y * 8 + x] || 0;
}

function renderMode(buf, widthTiles, heightTiles, tileDataOffset, tileCount, tileMap, mode) {
  const width = widthTiles * 8;
  const height = heightTiles * 8;
  const rows = [];
  let missing = 0;

  for (let y = 0; y < height; y += 1) {
    let row = "";
    const ty = Math.floor(y / 8);
    const py = y & 7;
    for (let x = 0; x < width; x += 1) {
      const tx = Math.floor(x / 8);
      const px = x & 7;
      const rawTile = tileMap[ty * widthTiles + tx];
      const tileIndex = mode.fn(rawTile);
      let value = 0;
      if (tileIndex >= 0 && tileIndex < tileCount) value = tilePixel(buf, tileDataOffset, tileIndex, px, py);
      else missing += 1;
      row += String.fromCharCode(65 + Math.min(25, Math.floor((value / 255) * 25)));
    }
    rows.push(row);
  }

  return { name: mode.name, width, height, rows, missing };
}

const resources = ids.map(decodeResource);
const html = `<!doctype html>
<meta charset="utf-8">
<title>SLPS-01903 BE header tilemap candidates</title>
<style>
body { margin: 16px; background: #f5f5f2; color: #202124; font-family: Consolas, "Courier New", monospace; }
h1 { font-size: 18px; margin: 0 0 8px; }
p { font-size: 12px; margin: 4px 0 14px; max-width: 1120px; line-height: 1.45; }
.resource { margin: 0 0 18px; padding: 10px; background: #fff; border: 1px solid #c9c9c0; }
.head { display: flex; gap: 20px; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
.head h2 { font-size: 16px; margin: 0; }
.meta { font-size: 11px; color: #4b4b47; overflow-wrap: anywhere; }
.views { display: grid; grid-template-columns: repeat(3, max-content); gap: 10px; align-items: start; }
.view-title { font-size: 12px; margin-bottom: 4px; }
canvas { image-rendering: pixelated; display: block; background: #fff; border: 1px solid #ddd; }
</style>
<h1>SLPS-01903 BE Header Tilemap Candidates</h1>
<p>These resources are processed by 0x801881C4, then consumed as a tilemap ending at header[0x0c] plus 64-byte 8bpp tiles. Large scene graphics usually have a 0x210 tilemap offset; small menu labels often start the tilemap at 0x10. Because tile attributes include VRAM/page bits, each resource is rendered with three candidate tile-index interpretations.</p>
${resources.map((res, i) => resourceHtml(res, i)).join("\n")}
<script>
const resources = ${JSON.stringify(resources)};
function draw(canvas, rows) {
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const p = (y * canvas.width + x) * 4;
      const v = Math.round(((row.charCodeAt(x) - 65) / 25) * 255);
      image.data[p] = v;
      image.data[p + 1] = v;
      image.data[p + 2] = v;
      image.data[p + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}
for (let i = 0; i < resources.length; i++) {
  const res = resources[i];
  if (!res.canvases) continue;
  for (let j = 0; j < res.canvases.length; j++) {
    draw(document.getElementById("c" + i + "_" + j), res.canvases[j].rows);
  }
}
</script>
`;

function resourceHtml(res, resourceIndex) {
  if (res.invalid) {
    return `<section class="resource"><div class="head"><h2>ID ${res.id}</h2><span>invalid</span></div><div class="meta">${JSON.stringify(res.header || {})}</div></section>`;
  }
  const h = res.header;
  const meta = [
    `DAT ${hex(res.range.off, 7)}`,
    `sectors ${res.range.startSector}..${res.range.endSector}`,
    `${h.widthTiles}x${h.heightTiles} tiles (${h.widthTiles * 8}x${h.heightTiles * 8}px)`,
    `payload ${hex(h.payloadSize)}`,
    `tileMap ${hex(h.tileMapOffset)}`,
    `tileData ${hex(h.tileDataOffset)}`,
    `tiles ${h.tileCount}`,
    `tilemap min/max ${h.minTile}/${h.maxTile}`,
    `unique ${h.uniqueTile}`,
  ].join(", ");
  return `<section class="resource">
  <div class="head"><h2>ID ${res.id}</h2><span class="meta">${meta}</span></div>
  <div class="views">
    ${res.canvases.map((canvas, viewIndex) => `<div><div class="view-title">${canvas.name}, missing pixels ${canvas.missing}</div><canvas id="c${resourceIndex}_${viewIndex}" width="${canvas.width}" height="${canvas.height}" style="width:${canvas.width * scale}px;height:${canvas.height * scale}px"></canvas></div>`).join("\n")}
  </div>
</section>`;
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);
console.log(`wrote ${outPath} ids=${ids.join(",")} scale=${scale}`);
