#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function usage() {
  console.error(
    "usage: node scripts/copy-behdr-region-offset.js <FS2_FILE.DAT> <SLPS_019.03> <outDat> <resourceId> <regions> --dy N"
  );
  console.error(
    "  copies pixels from (x, y + dy) to (x, y) within each region, inside the same resource, before repacking tiles"
  );
  process.exit(1);
}

const [datPath, exePath, outDat, idText, regionText, ...args] = process.argv.slice(2);
if (!datPath || !exePath || !outDat || !idText || !regionText) usage();

let dy = 0;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--dy") dy = Number.parseInt(args[++i] || "", 10);
  else usage();
}
if (!Number.isFinite(dy) || dy === 0) usage();

const resourceId = Number.parseInt(idText, 0);
if (!Number.isFinite(resourceId)) usage();

function parseRegions(text) {
  return String(text || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const values = part.split(",").map((value) => Number.parseInt(value.trim(), 0));
      if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
        throw new Error(`invalid region '${part}', expected x,y,w,h`);
      }
      const [x, y, w, h] = values;
      if (w <= 0 || h <= 0) throw new Error(`invalid region '${part}', width/height must be positive`);
      return { x0: x, y0: y, x1: x + w, y1: y + h };
    });
}

const regions = parseRegions(regionText);
const exe = fs.readFileSync(exePath);
const dat = fs.readFileSync(datPath);
const out = Buffer.from(dat);
const loadAddr = exe.readUInt32LE(0x18);
const resourceSectorTableOff = 0x801c4f68 - loadAddr + 0x800;

function resourceRange(id) {
  const tableOff = resourceSectorTableOff + id * 2;
  const startSector = exe.readUInt16LE(tableOff);
  const endSector = exe.readUInt16LE(tableOff + 2);
  if (endSector <= startSector) throw new Error(`resource ${id} has invalid sector span`);
  return { byteStart: startSector * 0x800, byteEnd: endSector * 0x800 };
}

function decodeHeader(id) {
  const range = resourceRange(id);
  const off = range.byteStart;
  const widthTiles = dat.readUInt32BE(off);
  const heightTiles = dat.readUInt32BE(off + 4);
  const payloadSize = dat.readUInt32BE(off + 8);
  const tileDataOffset = dat.readUInt32BE(off + 12);
  const tileMapOffset = tileDataOffset - widthTiles * heightTiles * 2;
  if (widthTiles <= 0 || heightTiles <= 0 || payloadSize <= tileDataOffset || tileMapOffset < 0x10) {
    throw new Error(`resource ${id} is not a supported be-hdr 8bpp resource`);
  }
  let maxTileIndex = -1;
  for (let i = 0; i < widthTiles * heightTiles; i += 1) {
    maxTileIndex = Math.max(maxTileIndex, dat.readUInt16BE(off + tileMapOffset + i * 2) >> 1);
  }
  return {
    ...range,
    widthTiles,
    heightTiles,
    width: widthTiles * 8,
    height: heightTiles * 8,
    tileMapOffset,
    tileDataOffset,
    tileCount: maxTileIndex + 1,
  };
}

function readTileMap(info) {
  const vals = [];
  const base = info.byteStart + info.tileMapOffset;
  for (let i = 0; i < info.widthTiles * info.heightTiles; i += 1) vals.push(dat.readUInt16BE(base + i * 2));
  return vals;
}

function unpackIndexed(info, tileMap) {
  const pixels = new Uint8Array(info.width * info.height);
  for (let ty = 0; ty < info.heightTiles; ty += 1) {
    for (let tx = 0; tx < info.widthTiles; tx += 1) {
      const tileIndex = tileMap[ty * info.widthTiles + tx] >> 1;
      const tileOff = info.byteStart + info.tileDataOffset + tileIndex * 64;
      for (let py = 0; py < 8; py += 1) {
        for (let px = 0; px < 8; px += 1) {
          pixels[(ty * 8 + py) * info.width + tx * 8 + px] = dat[tileOff + py * 8 + px];
        }
      }
    }
  }
  return pixels;
}

function tileIntersectsRegion(tx, ty, region) {
  const x0 = tx * 8;
  const y0 = ty * 8;
  return x0 < region.x1 && x0 + 8 > region.x0 && y0 < region.y1 && y0 + 8 > region.y0;
}

const info = decodeHeader(resourceId);
const tileMap = readTileMap(info);
const pixels = unpackIndexed(info, tileMap);
const copied = new Uint8Array(pixels);
let changedPixels = 0;

for (const region of regions) {
  for (let y = Math.max(0, region.y0); y < Math.min(info.height, region.y1); y += 1) {
    const sy = y + dy;
    if (sy < 0 || sy >= info.height) continue;
    for (let x = Math.max(0, region.x0); x < Math.min(info.width, region.x1); x += 1) {
      copied[y * info.width + x] = pixels[sy * info.width + x];
      changedPixels += 1;
    }
  }
}

const touchedTiles = new Set();
let sharedTouched = 0;
const tileUsage = new Map();
for (const raw of tileMap) tileUsage.set(raw >> 1, (tileUsage.get(raw >> 1) || 0) + 1);

for (const region of regions) {
  const tx0 = Math.max(0, Math.floor(region.x0 / 8));
  const ty0 = Math.max(0, Math.floor(region.y0 / 8));
  const tx1 = Math.min(info.widthTiles, Math.ceil(region.x1 / 8));
  const ty1 = Math.min(info.heightTiles, Math.ceil(region.y1 / 8));
  for (let ty = ty0; ty < ty1; ty += 1) {
    for (let tx = tx0; tx < tx1; tx += 1) {
      if (!tileIntersectsRegion(tx, ty, region)) continue;
      const tileIndex = tileMap[ty * info.widthTiles + tx] >> 1;
      touchedTiles.add(tileIndex);
      if ((tileUsage.get(tileIndex) || 0) > 1) sharedTouched += 1;
      const tileOff = info.byteStart + info.tileDataOffset + tileIndex * 64;
      for (let py = 0; py < 8; py += 1) {
        for (let px = 0; px < 8; px += 1) {
          const x = tx * 8 + px;
          const y = ty * 8 + py;
          out[tileOff + py * 8 + px] = copied[y * info.width + x];
        }
      }
    }
  }
}

fs.mkdirSync(path.dirname(outDat), { recursive: true });
fs.writeFileSync(outDat, out);
console.log(
  `copied resource ${resourceId}: ${changedPixels} pixels (dy=${dy}), ${touchedTiles.size} tile patterns, shared cell touches ${sharedTouched} -> ${outDat}`
);
