#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const [datPath, exePath, outPath, ...idArgs] = process.argv.slice(2);

if (!datPath || !exePath || !outPath || idArgs.length === 0) {
  console.error(
    "usage: node scripts/export-behdr-palette-mask-probe-html.js <FS2_FILE.DAT> <SLPS_019.03> <out.html> <id...>"
  );
  process.exit(2);
}

const dat = fs.readFileSync(datPath);
const exe = fs.readFileSync(exePath);
const loadAddr = exe.readUInt32LE(0x18);
const resourceSectorTableOff = 0x801c4f68 - loadAddr + 0x800;
const ids = idArgs.map((arg) => Number.parseInt(arg, 0)).filter(Number.isFinite);

function infoFor(id) {
  const sectorStart = exe.readUInt16LE(resourceSectorTableOff + id * 2);
  const sectorEnd = exe.readUInt16LE(resourceSectorTableOff + id * 2 + 2);
  const byteStart = sectorStart * 0x800;
  const widthTiles = dat.readUInt32BE(byteStart);
  const heightTiles = dat.readUInt32BE(byteStart + 4);
  const payloadSize = dat.readUInt32BE(byteStart + 8);
  const tileDataOffset = dat.readUInt32BE(byteStart + 12);
  const tileMapOffset = tileDataOffset - widthTiles * heightTiles * 2;
  return {
    id,
    sectorStart,
    sectorEnd,
    byteStart,
    widthTiles,
    heightTiles,
    width: widthTiles * 8,
    height: heightTiles * 8,
    payloadSize,
    tileMapOffset,
    tileDataOffset,
    tileCount: Math.floor(((sectorEnd - sectorStart) * 0x800 - tileDataOffset) / 64),
  };
}

function tilePixel8bpp(info, tileIndex, x, y) {
  const tileOff = info.byteStart + info.tileDataOffset + tileIndex * 64;
  return dat[tileOff + y * 8 + x] || 0;
}

function renderMask(info, matcher) {
  const rows = [];
  let on = 0;
  for (let y = 0; y < info.height; y += 1) {
    let row = "";
    const ty = Math.floor(y / 8);
    const py = y & 7;
    for (let x = 0; x < info.width; x += 1) {
      const tx = Math.floor(x / 8);
      const px = x & 7;
      const raw = dat.readUInt16BE(info.byteStart + info.tileMapOffset + (ty * info.widthTiles + tx) * 2);
      const tileIndex = raw >> 1;
      const value = tileIndex < info.tileCount ? tilePixel8bpp(info, tileIndex, px, py) : 0;
      const bit = matcher(value);
      if (bit) on += 1;
      row += bit ? "1" : "0";
    }
    rows.push(row);
  }
  return { rows, on };
}

const maskSets = [
  ["224-232", (value) => value >= 224 && value <= 232],
  ["232", (value) => value === 232],
  [">=128", (value) => value >= 128],
  ["68+224-232", (value) => value === 68 || (value >= 224 && value <= 232)],
  ["nonzero", (value) => value !== 0],
];

const canvases = [];
const sections = ids
  .map((id) => {
    const info = infoFor(id);
    const views = maskSets
      .map(([name, matcher]) => {
        const mask = renderMask(info, matcher);
        const canvasIndex = canvases.push({ width: info.width, height: info.height, rows: mask.rows }) - 1;
        return `<div><div class="view-title">${name} on=${mask.on}</div><canvas id="c${canvasIndex}" width="${info.width}" height="${info.height}" style="width:${info.width * 4}px;height:${info.height * 4}px"></canvas></div>`;
      })
      .join("\n");
    return `<section class="resource">
  <h2>ID ${id}</h2>
  <div class="meta">sectors ${info.sectorStart}..${info.sectorEnd}, ${info.widthTiles}x${info.heightTiles} tiles (${info.width}x${info.height}px), payload 0x${info.payloadSize.toString(16)}, tileData 0x${info.tileDataOffset.toString(16)}, tileMap 0x${info.tileMapOffset.toString(16)}, tileCount ${info.tileCount}</div>
  <div class="views">${views}</div>
</section>`;
  })
  .join("\n");

const html = `<!doctype html>
<meta charset="utf-8">
<title>SLPS-01903 be-hdr palette mask probe</title>
<style>
body { margin: 16px; background: #f5f5f2; color: #202124; font-family: Consolas, "Courier New", monospace; }
h1 { font-size: 18px; margin: 0 0 8px; }
h2 { font-size: 16px; margin: 0 0 4px; }
p, .meta { font-size: 12px; color: #4a4a46; }
.resource { margin: 0 0 14px; padding: 10px; background: #fff; border: 1px solid #c9c9c0; }
.views { display: flex; flex-wrap: wrap; gap: 12px; align-items: start; margin-top: 8px; }
.view-title { font-size: 12px; margin-bottom: 4px; }
canvas { image-rendering: pixelated; display: block; background: #000; border: 1px solid #ddd; }
</style>
<h1>SLPS-01903 be-hdr Palette Mask Probe</h1>
<p>Each panel shows a binary mask extracted from selected 8bpp source palette values. For these menu resources, 224-232 is the useful white/highlight text range; nonzero is intentionally noisy.</p>
${sections}
<script>
const canvases = ${JSON.stringify(canvases)};
for (let i = 0; i < canvases.length; i += 1) {
  const data = canvases[i];
  const canvas = document.getElementById("c" + i);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(data.width, data.height);
  for (let y = 0; y < data.height; y += 1) {
    for (let x = 0; x < data.width; x += 1) {
      const p = (y * data.width + x) * 4;
      const v = data.rows[y][x] === "1" ? 255 : 0;
      image.data[p] = v;
      image.data[p + 1] = v;
      image.data[p + 2] = v;
      image.data[p + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}
</script>
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);
console.log(`wrote ${outPath} ids=${ids.join(",")}`);
