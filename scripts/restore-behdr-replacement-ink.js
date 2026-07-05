#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function usage() {
  console.error(
    "usage: node scripts/restore-behdr-replacement-ink.js <FS2_FILE.DAT> <SLPS_019.03> <outDat> <resourceId> <replacement.pbm> <regions> --ink-index N [--invert]"
  );
  process.exit(1);
}

const [datPath, exePath, outDat, idText, pbmPath, regionText, ...args] = process.argv.slice(2);
if (!datPath || !exePath || !outDat || !idText || !pbmPath || !regionText) usage();

let inkIndex = 232;
let invert = false;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--ink-index") inkIndex = Number.parseInt(args[++i] || "", 0);
  else if (args[i] === "--invert") invert = true;
  else usage();
}
if (!Number.isFinite(inkIndex) || inkIndex < 0 || inkIndex > 255) usage();

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
  if (tokens.length < pixels.length) throw new Error(`${inputPath} has too few pixels`);
  for (let i = 0; i < pixels.length; i += 1) {
    if (tokens[i] !== "0" && tokens[i] !== "1") throw new Error(`${inputPath} has invalid PBM value '${tokens[i]}'`);
    pixels[i] = tokens[i] === "1" ? 1 : 0;
  }
  return pixels;
}

function replacementBit(rawBit) {
  let bit = rawBit ? 1 : 0;
  if (invert) bit = 1 - bit;
  return bit;
}

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
  return {
    ...range,
    widthTiles,
    heightTiles,
    width: widthTiles * 8,
    height: heightTiles * 8,
    tileMapOffset,
    tileDataOffset,
  };
}

function readTileMap(info) {
  const vals = [];
  const base = info.byteStart + info.tileMapOffset;
  for (let i = 0; i < info.widthTiles * info.heightTiles; i += 1) vals.push(dat.readUInt16BE(base + i * 2));
  return vals;
}

const info = decodeHeader(resourceId);
const regions = parseRegions(regionText);
const replacementPixels = readPbm(pbmPath, info.width, info.height);
const tileMap = readTileMap(info);
const tileUsage = new Map();
for (const raw of tileMap) tileUsage.set(raw >> 1, (tileUsage.get(raw >> 1) || 0) + 1);

let changedPixels = 0;
const touchedTiles = new Set();
let sharedTouches = 0;

for (const region of regions) {
  for (let y = Math.max(0, region.y0); y < Math.min(info.height, region.y1); y += 1) {
    for (let x = Math.max(0, region.x0); x < Math.min(info.width, region.x1); x += 1) {
      const pos = y * info.width + x;
      if (!replacementBit(replacementPixels[pos])) continue;
      const tx = Math.floor(x / 8);
      const ty = Math.floor(y / 8);
      const tileIndex = tileMap[ty * info.widthTiles + tx] >> 1;
      const px = x & 7;
      const py = y & 7;
      const tileOff = info.byteStart + info.tileDataOffset + tileIndex * 64;
      const pixelOff = tileOff + py * 8 + px;
      if (out[pixelOff] !== inkIndex) {
        out[pixelOff] = inkIndex;
        changedPixels += 1;
      }
      if (!touchedTiles.has(tileIndex) && (tileUsage.get(tileIndex) || 0) > 1) sharedTouches += 1;
      touchedTiles.add(tileIndex);
    }
  }
}

fs.mkdirSync(path.dirname(outDat), { recursive: true });
fs.writeFileSync(outDat, out);
console.log(
  `restored replacement ink for resource ${resourceId}: ${changedPixels} pixels, ${touchedTiles.size} tile patterns, shared tile touches ${sharedTouches} -> ${outDat}`
);
