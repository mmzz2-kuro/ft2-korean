#!/usr/bin/env node

const fs = require("fs");

function usage() {
  console.error(
    "usage: node scripts/analyze-behdr-tile-budget.js <FS2_FILE.DAT> <SLPS_019.03> <resourceId> <replacement.pbm> [--erase-pbm mask.pbm] [--invert] [--source-ink-indexes N[,N-M]] [--ink-index N] [--bg-index N] [--regions x,y,w,h[;...]]"
  );
  process.exit(1);
}

const [datPath, exePath, idText, pbmPath, ...args] = process.argv.slice(2);
if (!datPath || !exePath || !idText || !pbmPath) usage();

let invert = false;
let sourceInkIndexes = parseIndexes("224-232");
let erasePbmPath = "";
let inkIndex = 232;
let bgIndex = 3;
let regionText = "";
let healRegionText = "";
let healIndexText = "";
let healRadius = 16;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--invert") invert = true;
  else if (arg === "--source-ink-indexes") sourceInkIndexes = parseIndexes(args[++i] || "");
  else if (arg === "--erase-pbm") erasePbmPath = args[++i] || "";
  else if (arg === "--ink-index") inkIndex = Number.parseInt(args[++i] || "", 0);
  else if (arg === "--bg-index") bgIndex = Number.parseInt(args[++i] || "", 0);
  else if (arg === "--regions") regionText = args[++i] || "";
  else if (arg === "--heal-regions") healRegionText = args[++i] || "";
  else if (arg === "--heal-indexes") healIndexText = args[++i] || "";
  else if (arg === "--heal-radius") healRadius = Number.parseInt(args[++i] || "", 0);
  else usage();
}

const resourceId = Number.parseInt(idText, 0);
if (!Number.isFinite(resourceId)) usage();

function parseIndexes(text) {
  const values = [];
  for (const part of String(text || "").split(",")) {
    const item = part.trim();
    if (!item) continue;
    const m = item.match(/^(\d+)-(\d+)$/);
    if (m) {
      const a = Number.parseInt(m[1], 10);
      const b = Number.parseInt(m[2], 10);
      for (let value = Math.min(a, b); value <= Math.max(a, b); value += 1) values.push(value);
    } else {
      values.push(Number.parseInt(item, 0));
    }
  }
  if (!values.length || values.some((value) => !Number.isFinite(value) || value < 0 || value > 255)) {
    throw new Error("invalid index list");
  }
  return new Set(values);
}

function parseRegions(text, width, height) {
  const raw = String(text || "").trim();
  if (!raw) return [{ name: "all", x0: 0, y0: 0, x1: width, y1: height }];
  return raw
    .split(";")
    .map((part, index) => {
      const values = part.split(",").map((value) => Number.parseInt(value.trim(), 0));
      if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) throw new Error(`invalid region '${part}'`);
      const [x, y, w, h] = values;
      if (w <= 0 || h <= 0) throw new Error(`invalid region '${part}'`);
      return { name: `region${index}`, x0: x, y0: y, x1: x + w, y1: y + h };
    });
}

function readPbm(inputPath, expectedWidth, expectedHeight) {
  const tokens = fs
    .readFileSync(inputPath, "utf8")
    .split(/\r?\n/)
    .flatMap((line) => line.replace(/#.*/, "").trim().split(/\s+/).filter(Boolean));
  if (tokens.shift() !== "P1") throw new Error(`${inputPath} is not an ASCII PBM (P1) file`);
  const width = Number.parseInt(tokens.shift() || "", 10);
  const height = Number.parseInt(tokens.shift() || "", 10);
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(`${inputPath} must be ${expectedWidth}x${expectedHeight}, got ${width}x${height}`);
  }
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = tokens[i] === "1" ? 1 : 0;
  return pixels;
}

const exe = fs.readFileSync(exePath);
const dat = fs.readFileSync(datPath);
const loadAddr = exe.readUInt32LE(0x18);
const tableOff = 0x801c4f68 - loadAddr + 0x800;

function resourceRange(id) {
  const startSector = exe.readUInt16LE(tableOff + id * 2);
  const endSector = exe.readUInt16LE(tableOff + id * 2 + 2);
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
    tileCapacity: Math.floor((range.byteEnd - range.byteStart - tileDataOffset) / 64),
  };
}

function readTileMap(info) {
  const base = info.byteStart + info.tileMapOffset;
  const tileMap = [];
  for (let i = 0; i < info.widthTiles * info.heightTiles; i += 1) tileMap.push(dat.readUInt16BE(base + i * 2));
  return tileMap;
}

function unpackIndexed(info, tileMap) {
  const pixels = new Uint8Array(info.width * info.height);
  for (let ty = 0; ty < info.heightTiles; ty += 1) {
    for (let tx = 0; tx < info.widthTiles; tx += 1) {
      const tileIndex = tileMap[ty * info.widthTiles + tx] >> 1;
      const tileOff = info.byteStart + info.tileDataOffset + tileIndex * 64;
      for (let py = 0; py < 8; py += 1) {
        for (let px = 0; px < 8; px += 1) {
          pixels[(ty * 8 + py) * info.width + tx * 8 + px] = dat[tileOff + py * 8 + px] || 0;
        }
      }
    }
  }
  return pixels;
}

function replacementBit(rawBit) {
  let bit = rawBit ? 1 : 0;
  if (invert) bit = 1 - bit;
  return bit;
}

function keyAt(pixels, width, tx, ty) {
  const tile = Buffer.alloc(64, 0);
  for (let py = 0; py < 8; py += 1) {
    for (let px = 0; px < 8; px += 1) tile[py * 8 + px] = pixels[(ty * 8 + py) * width + tx * 8 + px];
  }
  return tile.toString("latin1");
}

function tileIntersects(tx, ty, region) {
  const x0 = tx * 8;
  const y0 = ty * 8;
  return x0 < region.x1 && x0 + 8 > region.x0 && y0 < region.y1 && y0 + 8 > region.y0;
}

function nearestTargetOnRow(pixels, width, x, y, targetIndexes, radius, direction) {
  for (let step = 1; step <= radius; step += 1) {
    const xx = x + direction * step;
    if (xx < 0 || xx >= width) break;
    const value = pixels[y * width + xx];
    if (targetIndexes.has(value)) return value;
  }
  return -1;
}

const info = decodeHeader(resourceId);
const tileMap = readTileMap(info);
const original = unpackIndexed(info, tileMap);
const finalPixels = new Uint8Array(original);
const replacement = readPbm(pbmPath, info.width, info.height);
const erase = erasePbmPath ? readPbm(erasePbmPath, info.width, info.height) : null;

for (let i = 0; i < finalPixels.length; i += 1) {
  if (sourceInkIndexes.has(finalPixels[i]) && (!erase || erase[i])) finalPixels[i] = bgIndex;
  if (replacementBit(replacement[i])) finalPixels[i] = inkIndex;
}

if (healRegionText && healIndexText) {
  const healRegions = parseRegions(healRegionText, info.width, info.height);
  const healIndexes = parseIndexes(healIndexText);
  let healed = 0;
  for (const region of healRegions) {
    for (let y = Math.max(0, region.y0); y < Math.min(info.height, region.y1); y += 1) {
      for (let x = Math.max(0, region.x0); x < Math.min(info.width, region.x1); x += 1) {
        const pos = y * info.width + x;
        if (healIndexes.has(finalPixels[pos])) continue;
        if (replacementBit(replacement[pos])) continue;
        const left = nearestTargetOnRow(finalPixels, info.width, x, y, healIndexes, healRadius, -1);
        const right = nearestTargetOnRow(finalPixels, info.width, x, y, healIndexes, healRadius, 1);
        if (left >= 0 && right >= 0) {
          finalPixels[pos] = left;
          healed += 1;
        }
      }
    }
  }
  console.log(`pre-healed pixels ${healed}`);
}

const finalKeys = [];
const changedTiles = [];
for (let ty = 0; ty < info.heightTiles; ty += 1) {
  for (let tx = 0; tx < info.widthTiles; tx += 1) {
    const key = keyAt(finalPixels, info.width, tx, ty);
    const oldKey = keyAt(original, info.width, tx, ty);
    finalKeys.push(key);
    if (key !== oldKey) changedTiles.push({ tx, ty, key });
  }
}

const finalUnique = new Set(finalKeys).size;
const originalUnique = new Set(Array.from({ length: info.widthTiles * info.heightTiles }, (_, cell) => {
  const tx = cell % info.widthTiles;
  const ty = Math.floor(cell / info.widthTiles);
  return keyAt(original, info.width, tx, ty);
})).size;

console.log(`resource ${resourceId}`);
console.log(`size ${info.width}x${info.height}, tiles ${info.widthTiles}x${info.heightTiles}`);
console.log(`tileCount ${info.tileCount}, capacity ${info.tileCapacity}`);
console.log(`original unique cells ${originalUnique}`);
console.log(`final unique cells ${finalUnique}`);
console.log(`overflow ${Math.max(0, finalUnique - info.tileCapacity)}`);
console.log(`changed tile cells ${changedTiles.length}`);

const regions = parseRegions(regionText, info.width, info.height);
for (const region of regions) {
  const keys = new Set();
  let cells = 0;
  for (let ty = 0; ty < info.heightTiles; ty += 1) {
    for (let tx = 0; tx < info.widthTiles; tx += 1) {
      if (!tileIntersects(tx, ty, region)) continue;
      cells += 1;
      keys.add(finalKeys[ty * info.widthTiles + tx]);
    }
  }
  console.log(
    `${region.name} ${region.x0},${region.y0},${region.x1 - region.x0},${region.y1 - region.y0}: cells=${cells} unique=${keys.size}`
  );
}
