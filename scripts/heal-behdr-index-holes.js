#!/usr/bin/env node

const fs = require("fs");

function usage() {
  console.error(
    "usage: node scripts/heal-behdr-index-holes.js <FS2_FILE.DAT> <SLPS_019.03> <outDat> <resourceId> <regions> --indexes N[,N-M] [--radius N] [--keep-pbm mask.pbm] [--keep-value 0|1]"
  );
  process.exit(1);
}

const [datPath, exePath, outDat, idText, regionText, ...args] = process.argv.slice(2);
if (!datPath || !exePath || !outDat || !idText || !regionText) usage();

let indexText = "";
let radius = 16;
let keepPbmPath = "";
let keepValue = 0;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--indexes") indexText = args[++i] || "";
  else if (args[i] === "--radius") radius = Number.parseInt(args[++i] || "", 0);
  else if (args[i] === "--keep-pbm") keepPbmPath = args[++i] || "";
  else if (args[i] === "--keep-value") keepValue = Number.parseInt(args[++i] || "", 0);
  else usage();
}
if (!indexText || !Number.isFinite(radius) || radius < 1) usage();
if (![0, 1].includes(keepValue)) usage();

const resourceId = Number.parseInt(idText, 0);
if (!Number.isFinite(resourceId)) usage();

function parseIndexes(text) {
  const indexes = [];
  for (const part of String(text || "").split(",")) {
    const item = part.trim();
    if (!item) continue;
    const m = item.match(/^(\d+)-(\d+)$/);
    if (m) {
      const a = Number.parseInt(m[1], 10);
      const b = Number.parseInt(m[2], 10);
      for (let value = Math.min(a, b); value <= Math.max(a, b); value += 1) indexes.push(value);
    } else {
      indexes.push(Number.parseInt(item, 0));
    }
  }
  if (!indexes.length || indexes.some((value) => !Number.isFinite(value) || value < 0 || value > 255)) {
    throw new Error("--indexes must be a comma-separated list of palette indexes/ranges");
  }
  return new Set(indexes);
}

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

function readPbm(pbmPath, expectedWidth, expectedHeight) {
  const tokens = fs
    .readFileSync(pbmPath, "utf8")
    .split(/\r?\n/)
    .flatMap((line) => line.replace(/#.*/, "").trim().split(/\s+/).filter(Boolean));
  if (tokens.shift() !== "P1") throw new Error(`${pbmPath} is not an ASCII PBM (P1) file`);
  const width = Number.parseInt(tokens.shift() || "", 10);
  const height = Number.parseInt(tokens.shift() || "", 10);
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(`${pbmPath} must be ${expectedWidth}x${expectedHeight}, got ${width}x${height}`);
  }
  const pixels = new Uint8Array(width * height);
  if (tokens.length < pixels.length) throw new Error(`${pbmPath} has too few pixels`);
  for (let i = 0; i < pixels.length; i += 1) {
    if (tokens[i] !== "0" && tokens[i] !== "1") throw new Error(`${pbmPath} has invalid PBM value '${tokens[i]}'`);
    pixels[i] = tokens[i] === "1" ? 1 : 0;
  }
  return pixels;
}

const targetIndexes = parseIndexes(indexText);
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

function inTarget(value) {
  return targetIndexes.has(value);
}

function nearestTargetOnRow(pixels, width, x, y, direction) {
  for (let step = 1; step <= radius; step += 1) {
    const xx = x + direction * step;
    if (xx < 0 || xx >= width) break;
    const value = pixels[y * width + xx];
    if (inTarget(value)) return value;
  }
  return -1;
}

function tileIntersectsRegion(tx, ty, region) {
  const x0 = tx * 8;
  const y0 = ty * 8;
  return x0 < region.x1 && x0 + 8 > region.x0 && y0 < region.y1 && y0 + 8 > region.y0;
}

const info = decodeHeader(resourceId);
const tileMap = readTileMap(info);
const pixels = unpackIndexed(info, tileMap);
const keepPixels = keepPbmPath ? readPbm(keepPbmPath, info.width, info.height) : null;
const healed = new Uint8Array(pixels);
let changedPixels = 0;

for (const region of regions) {
  for (let y = Math.max(0, region.y0); y < Math.min(info.height, region.y1); y += 1) {
    for (let x = Math.max(0, region.x0); x < Math.min(info.width, region.x1); x += 1) {
      const pos = y * info.width + x;
      if (inTarget(pixels[pos])) continue;
      if (keepPixels && keepPixels[pos] === keepValue) continue;
      const left = nearestTargetOnRow(pixels, info.width, x, y, -1);
      const right = nearestTargetOnRow(pixels, info.width, x, y, 1);
      if (left >= 0 && right >= 0) {
        healed[pos] = left;
        changedPixels += 1;
      }
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
          out[tileOff + py * 8 + px] = healed[y * info.width + x];
        }
      }
    }
  }
}

fs.mkdirSync(require("path").dirname(outDat), { recursive: true });
fs.writeFileSync(outDat, out);
console.log(
  `healed resource ${resourceId}: ${changedPixels} pixels, ${touchedTiles.size} tile patterns, shared cell touches ${sharedTouched} -> ${outDat}`
);
