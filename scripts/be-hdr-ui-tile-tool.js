#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function usage() {
  console.error(`usage:
  export: node scripts/be-hdr-ui-tile-tool.js export <FS2_FILE.DAT> <SLPS_019.03> <outDir> <id...> [--invert]
  dump-raw: node scripts/be-hdr-ui-tile-tool.js dump-raw <FS2_FILE.DAT> <SLPS_019.03> <outDir> <id...>
            writes a P2 (ASCII grayscale) PGM with the raw 8bpp palette index per
            pixel (0-255), for debugging exact index values instead of the
            binary isSourceInk view that "export" produces
  patch:  node scripts/be-hdr-ui-tile-tool.js patch <FS2_FILE.DAT> <SLPS_019.03> <outDat> <id> <mask.pbm> [--invert] [--ink-index N] [--bg-index N] [--erase-pbm mask.pbm]
  pack-raw: node scripts/be-hdr-ui-tile-tool.js pack-raw <FS2_FILE.DAT> <SLPS_019.03> <outDat> <id> <raw.pgm>
            takes a FULLY RESOLVED P2 PGM of raw 8bpp palette indices (same format as
            dump-raw/--debug-dump-dir output) and packs it straight into tiles --
            no erase, ink-draw, or heal passes at all. Use this when you've hand-edited
            a debug-dump PGM/PNG (e.g. via scripts/decode-behdr-edited-image.py) and want
            it applied exactly as-is.

options:
  --source-ink-indexes N[,N...]  source 8bpp palette index mask for export; ranges like 224-232 are allowed
  --lossy-protect-regions R      semicolon-separated x,y,w,h regions whose final tiles must not be lossy-merged
  --pre-heal-regions R           semicolon-separated x,y,w,h regions to heal before tile packing
  --pre-heal-indexes N[,N...]    palette indexes used as the background fill source for pre-heal
  --pre-heal-radius N            horizontal search radius for pre-heal, default 32
  --pre-heal-from-indexes N[,N...]  only heal pixels currently at these indexes (default: any
                                 pixel not already a target index), e.g. limit to the erase fill
                                 color so unrelated background/decoration pixels in the same
                                 region are left untouched
  --pre-heal-regions-2 R         second independent pre-heal pass: regions (runs after the first pass)
  --pre-heal-indexes-2 N[,N...]  second independent pre-heal pass: background fill source indexes
  --pre-heal-radius-2 N          second independent pre-heal pass: search radius, default 32
  --pre-heal-from-indexes-2 N[,N...]  second pass: only heal pixels currently at these indexes
                                 (default: any pixel not already a target index), e.g. limit to
                                 the erase fill color so decorative pixels using other indexes
                                 in the same region are left untouched
  --pre-heal-regions-3 R         third independent pre-heal pass: regions (runs after the second pass)
  --pre-heal-indexes-3 N[,N...]  third independent pre-heal pass: background fill source indexes
                                 (first value is used directly when radius-3 is 0)
  --pre-heal-radius-3 N          third independent pre-heal pass: search radius, default 32;
                                 use 0 to force-fill matched pixels with indexes-3[0] directly
                                 instead of searching left/right (needed when the region itself
                                 is the only remaining sample of the correct background on its row)
  --pre-heal-from-indexes-3 N[,N...]  third pass: only heal pixels currently at these indexes
  --reference-dat PATH          an unpatched FS2_FILE.DAT/BIN to heal stray pixels from directly:
                                 wherever this file has a --reference-family value at a pixel but the
                                 current (post-erase/pre-heal) data does not, copy the reference's exact
                                 value in. Runs before tile packing, so no tile-sharing risk.
  --reference-family N[,N...]   palette index family that --reference-dat is trusted for (e.g. a
                                 resource's animated glow-gradient range)
  --debug-dump-dir DIR          write a numbered P2 PGM (raw 8bpp index) snapshot after every internal
                                 patch stage (unpack, erase, ink-draw, each pre-heal pass, reference-heal,
                                 pre-pack) for step-by-step inspection
  --allow-overflow              write a patched file even when final tiles exceed resource capacity`);
  process.exit(1);
}

const [mode, datPath, exePath, thirdArg, ...rest] = process.argv.slice(2);
if (!mode || !datPath || !exePath || !thirdArg) usage();

let invert = false;
let inkIndex = 232;
let bgIndex = 3;
let sourceInkIndexes = parseSourceInkIndexes("224-232");
let erasePbmPath = "";
let fs2Lba = 223;
let fs2Sectors = 119472;
let allowOverflow = false;
let lossyFit = false;
let lossyProtectRegions = [];
let preHealRegions = [];
let preHealIndexes = null;
let preHealRadius = 32;
let preHealFromIndexes = null;
let preHealRegions2 = [];
let preHealIndexes2 = null;
let preHealRadius2 = 32;
let preHealFromIndexes2 = null;
let preHealRegions3 = [];
let preHealIndexes3 = null;
let preHealRadius3 = 32;
let preHealFromIndexes3 = null;
let referenceDatPath = "";
let referenceFamily = null;
let debugDumpDir = "";
const positional = [];

for (let i = 0; i < rest.length; i += 1) {
  const arg = rest[i];
  if (arg === "--invert") invert = true;
  else if (arg === "--ink-index") inkIndex = Number.parseInt(rest[++i] || "", 0);
  else if (arg === "--bg-index") bgIndex = Number.parseInt(rest[++i] || "", 0);
  else if (arg === "--source-ink-indexes") sourceInkIndexes = parseSourceInkIndexes(rest[++i] || "");
  else if (arg === "--erase-pbm") erasePbmPath = rest[++i] || "";
  else if (arg === "--lba") fs2Lba = Number.parseInt(rest[++i] || "", 0);
  else if (arg === "--sectors") fs2Sectors = Number.parseInt(rest[++i] || "", 0);
  else if (arg === "--allow-overflow") allowOverflow = true;
  else if (arg === "--lossy-fit") lossyFit = true;
  else if (arg === "--lossy-protect-regions") lossyProtectRegions = parseRegions(rest[++i] || "");
  else if (arg === "--pre-heal-regions") preHealRegions = parseRegions(rest[++i] || "");
  else if (arg === "--pre-heal-indexes") preHealIndexes = parseSourceInkIndexes(rest[++i] || "");
  else if (arg === "--pre-heal-radius") preHealRadius = Number.parseInt(rest[++i] || "", 0);
  else if (arg === "--pre-heal-from-indexes") preHealFromIndexes = parseSourceInkIndexes(rest[++i] || "");
  else if (arg === "--pre-heal-regions-2") preHealRegions2 = parseRegions(rest[++i] || "");
  else if (arg === "--pre-heal-indexes-2") preHealIndexes2 = parseSourceInkIndexes(rest[++i] || "");
  else if (arg === "--pre-heal-radius-2") preHealRadius2 = Number.parseInt(rest[++i] || "", 0);
  else if (arg === "--pre-heal-from-indexes-2") preHealFromIndexes2 = parseSourceInkIndexes(rest[++i] || "");
  else if (arg === "--pre-heal-regions-3") preHealRegions3 = parseRegions(rest[++i] || "");
  else if (arg === "--pre-heal-indexes-3") preHealIndexes3 = parseSourceInkIndexes(rest[++i] || "");
  else if (arg === "--pre-heal-radius-3") preHealRadius3 = Number.parseInt(rest[++i] || "", 0);
  else if (arg === "--pre-heal-from-indexes-3") preHealFromIndexes3 = parseSourceInkIndexes(rest[++i] || "");
  else if (arg === "--reference-dat") referenceDatPath = rest[++i] || "";
  else if (arg === "--reference-family") referenceFamily = parseSourceInkIndexes(rest[++i] || "");
  else if (arg === "--debug-dump-dir") debugDumpDir = rest[++i] || "";
  else if (arg.startsWith("--")) usage();
  else positional.push(arg);
}

if (![inkIndex, bgIndex].every(Number.isFinite) || inkIndex < 0 || inkIndex > 255 || bgIndex < 0 || bgIndex > 255) {
  throw new Error("8bpp palette indices must be 0..255");
}
if (!Number.isFinite(preHealRadius) || preHealRadius < 1) throw new Error("--pre-heal-radius must be a positive integer");
if (preHealIndexes === "nonzero") throw new Error("--pre-heal-indexes does not support nonzero");

function parseSourceInkIndexes(text) {
  const trimmed = String(text || "").trim().toLowerCase();
  if (trimmed === "nonzero") return "nonzero";
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
  if (values.length === 0 || values.some((value) => !Number.isFinite(value) || value < 0 || value > 255)) {
    throw new Error("--source-ink-indexes must be a comma-separated list of 8bpp palette indices/ranges, or nonzero");
  }
  return [...new Set(values)];
}

const exe = fs.readFileSync(exePath);
const loadAddr = exe.readUInt32LE(0x18);
const resourceSectorTableOff = 0x801c4f68 - loadAddr + 0x800;
const dat = readDatPayload(datPath);

function hex(n, width = 0) {
  return `0x${n.toString(16).padStart(width, "0")}`;
}

function resourceRange(id) {
  const tableOff = resourceSectorTableOff + id * 2;
  if (tableOff < 0 || tableOff + 4 > exe.length) throw new Error(`resource ${id} sector table offset is outside EXE`);
  const startSector = exe.readUInt16LE(tableOff);
  const endSector = exe.readUInt16LE(tableOff + 2);
  if (endSector <= startSector) throw new Error(`resource ${id} has empty/reversed sector span ${startSector}..${endSector}`);
  return {
    resourceId: id,
    sectorStart: startSector,
    sectorEnd: endSector,
    byteStart: startSector * 0x800,
    byteEnd: endSector * 0x800,
  };
}

function readDatPayload(inputPath) {
  const source = fs.readFileSync(inputPath);
  const userSize = 2048;
  const sectorSize = 2352;
  const userOffset = 24;
  const expectedDatSize = fs2Sectors * userSize;
  if (source.length === expectedDatSize) return source;

  const firstRead = fs2Lba * sectorSize + userOffset;
  const lastReadEnd = (fs2Lba + fs2Sectors - 1) * sectorSize + userOffset + userSize;
  if (lastReadEnd > source.length) {
    throw new Error(
      `${inputPath} is neither FS2_FILE.DAT (${expectedDatSize} bytes) nor a raw BIN containing FS2 at LBA ${fs2Lba}`
    );
  }

  const out = Buffer.alloc(expectedDatSize);
  for (let sector = 0; sector < fs2Sectors; sector += 1) {
    const binOff = (fs2Lba + sector) * sectorSize + userOffset;
    const datOff = sector * userSize;
    source.copy(out, datOff, binOff, binOff + userSize);
  }
  console.log(`extracted FS2 payload from raw BIN input ${inputPath} (${out.length} bytes)`);
  return out;
}

function decodeHeader(id) {
  const range = resourceRange(id);
  const off = range.byteStart;
  const widthTiles = dat.readUInt32BE(off);
  const heightTiles = dat.readUInt32BE(off + 4);
  const payloadSize = dat.readUInt32BE(off + 8);
  const tileDataOffset = dat.readUInt32BE(off + 12);
  const tileMapBytes = widthTiles * heightTiles * 2;
  const align4 = (value) => (value + 3) & ~3;
  // Small maps can have two bytes of alignment padding between the PNT and
  // tile data. Resource 0 is one such case: its map starts at 0x210, while
  // subtracting the map bytes from tileDataOffset incorrectly yields 0x212.
  let tileMapOffset = tileDataOffset - tileMapBytes;
  if (align4(0x210 + tileMapBytes) === tileDataOffset) tileMapOffset = 0x210;
  else if (align4(0x10 + tileMapBytes) === tileDataOffset) tileMapOffset = 0x10;
  if (
    widthTiles <= 0 ||
    heightTiles <= 0 ||
    widthTiles > 512 ||
    heightTiles > 512 ||
    payloadSize <= 0 ||
    payloadSize > range.byteEnd - range.byteStart ||
    tileMapOffset < 0x10
  ) {
    throw new Error(
      `resource ${id} is not a supported 8bpp be-hdr UI resource: ${JSON.stringify({
        widthTiles,
        heightTiles,
        payloadSize,
        tileDataOffset,
        tileMapOffset,
      })}`
    );
  }
  const tileMapCount = widthTiles * heightTiles;
  let maxTileIndex = -1;
  for (let i = 0; i < tileMapCount; i += 1) {
    maxTileIndex = Math.max(maxTileIndex, dat.readUInt16BE(off + tileMapOffset + i * 2) >> 1);
  }
  const tileCapacity = Math.floor((range.byteEnd - range.byteStart - tileDataOffset) / 64);
  const tileCount = maxTileIndex + 1;
  if (tileCount <= 0 || tileCount > tileCapacity) {
    throw new Error(
      `resource ${id} tilemap references tiles outside the resource range: ${JSON.stringify({
        widthTiles,
        heightTiles,
        payloadSize,
        tileDataOffset,
        tileMapOffset,
        maxTileIndex,
        tileCapacity,
      })}`
    );
  }
  return { ...range, widthTiles, heightTiles, width: widthTiles * 8, height: heightTiles * 8, payloadSize, tileMapOffset, tileDataOffset, tileCount, tileCapacity };
}

function readTileMap(info, buf = dat) {
  const base = info.byteStart + info.tileMapOffset;
  const vals = [];
  for (let i = 0; i < info.widthTiles * info.heightTiles; i += 1) {
    vals.push(buf.readUInt16BE(base + i * 2));
  }
  return vals;
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

function tileIntersectsRegions(tx, ty, regions) {
  const x0 = tx * 8;
  const y0 = ty * 8;
  const x1 = x0 + 8;
  const y1 = y0 + 8;
  return regions.some((region) => x0 < region.x1 && x1 > region.x0 && y0 < region.y1 && y1 > region.y0);
}

function tilePixel8bpp(buf, tileOff, x, y) {
  return buf[tileOff + y * 8 + x] || 0;
}

function isSourceInk(value) {
  if (sourceInkIndexes === "nonzero") return value !== 0;
  return sourceInkIndexes.includes(value);
}

function setTilePixel8bpp(buf, tileOff, x, y, value) {
  buf[tileOff + y * 8 + x] = value & 0xff;
}

function unpackResource(info) {
  const pixels = new Uint8Array(info.width * info.height);
  const indexed = unpackIndexedResource(info);
  for (let i = 0; i < indexed.length; i += 1) {
    const ink = isSourceInk(indexed[i]) ? 1 : 0;
    pixels[i] = invert ? 1 - ink : ink;
  }
  return pixels;
}

function unpackIndexedResource(info) {
  const pixels = new Uint8Array(info.width * info.height);
  const tileMap = readTileMap(info);
  for (let ty = 0; ty < info.heightTiles; ty += 1) {
    for (let tx = 0; tx < info.widthTiles; tx += 1) {
      const rawTile = tileMap[ty * info.widthTiles + tx];
      const tileIndex = rawTile >> 1;
      for (let py = 0; py < 8; py += 1) {
        for (let px = 0; px < 8; px += 1) {
          let value = 0;
          if (tileIndex >= 0 && tileIndex < info.tileCount) {
            value = tilePixel8bpp(dat, info.byteStart + info.tileDataOffset + tileIndex * 64, px, py);
          }
          pixels[(ty * 8 + py) * info.width + (tx * 8 + px)] = value;
        }
      }
    }
  }
  return pixels;
}

function writePbm(outPath, width, height, pixels, comment) {
  const lines = ["P1"];
  if (comment) lines.push(`# ${comment}`);
  lines.push(`${width} ${height}`);
  for (let y = 0; y < height; y += 1) {
    const row = [];
    for (let x = 0; x < width; x += 1) row.push(String(pixels[y * width + x] ? 1 : 0));
    lines.push(row.join(" "));
  }
  fs.writeFileSync(outPath, `${lines.join("\n")}\n`, "ascii");
}

function readPbm(pbmPath, expectedWidth, expectedHeight) {
  const text = fs.readFileSync(pbmPath, "utf8");
  const tokens = text
    .split(/\r?\n/)
    .flatMap((line) => line.replace(/#.*/, "").trim().split(/\s+/).filter(Boolean));
  if (tokens.shift() !== "P1") throw new Error(`${pbmPath} is not an ASCII PBM (P1) file`);
  const width = Number.parseInt(tokens.shift() || "", 10);
  const height = Number.parseInt(tokens.shift() || "", 10);
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(`${pbmPath} must be ${expectedWidth}x${expectedHeight}, got ${width}x${height}`);
  }
  const pixels = new Uint8Array(width * height);
  if (tokens.length < pixels.length) throw new Error(`${pbmPath} has ${tokens.length} pixels, expected ${pixels.length}`);
  for (let i = 0; i < pixels.length; i += 1) {
    if (tokens[i] !== "0" && tokens[i] !== "1") throw new Error(`${pbmPath} has invalid PBM value '${tokens[i]}'`);
    pixels[i] = tokens[i] === "1" ? 1 : 0;
  }
  return pixels;
}

function readRawIndexPgm(pgmPath, expectedWidth, expectedHeight) {
  const text = fs.readFileSync(pgmPath, "utf8");
  const tokens = text
    .split(/\r?\n/)
    .flatMap((line) => line.replace(/#.*/, "").trim().split(/\s+/).filter(Boolean));
  if (tokens.shift() !== "P2") throw new Error(`${pgmPath} is not an ASCII PGM (P2) file`);
  const width = Number.parseInt(tokens.shift() || "", 10);
  const height = Number.parseInt(tokens.shift() || "", 10);
  tokens.shift(); // maxval
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(`${pgmPath} must be ${expectedWidth}x${expectedHeight}, got ${width}x${height}`);
  }
  const pixels = new Uint8Array(width * height);
  if (tokens.length < pixels.length) throw new Error(`${pgmPath} has ${tokens.length} pixels, expected ${pixels.length}`);
  for (let i = 0; i < pixels.length; i += 1) {
    const value = Number.parseInt(tokens[i], 10);
    if (!Number.isFinite(value) || value < 0 || value > 255) throw new Error(`${pgmPath} has invalid pixel value '${tokens[i]}'`);
    pixels[i] = value;
  }
  return pixels;
}

function patchFromRawPgm(outDat, idArg, pgmPath) {
  const id = Number.parseInt(idArg || "", 0);
  if (!Number.isFinite(id) || !pgmPath) usage();
  const info = decodeHeader(id);
  const indexedPixels = readRawIndexPgm(pgmPath, info.width, info.height);
  packIndexedPixelsIntoTiles(id, info, indexedPixels, outDat);
}

function tileKeyFromPixels(pixels, width, tx, ty) {
  let key = "";
  for (let py = 0; py < 8; py += 1) {
    for (let px = 0; px < 8; px += 1) {
      let bit = pixels[(ty * 8 + py) * width + (tx * 8 + px)] ? 1 : 0;
      if (invert) bit = 1 - bit;
      key += bit ? "1" : "0";
    }
  }
  return key;
}

function packTileFromKey(key) {
  const tile = Buffer.alloc(64, 0);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const bit = key[y * 8 + x] === "1";
      setTilePixel8bpp(tile, 0, x, y, bit ? inkIndex : bgIndex);
    }
  }
  return tile;
}

function replacementBit(rawBit) {
  let bit = rawBit ? 1 : 0;
  if (invert) bit = 1 - bit;
  return bit;
}

function nearestTargetOnRow(pixels, width, x, y, targetIndexes, radius, direction) {
  for (let step = 1; step <= radius; step += 1) {
    const xx = x + direction * step;
    if (xx < 0 || xx >= width) break;
    const value = pixels[y * width + xx];
    if (targetIndexes.includes(value)) return value;
  }
  return -1;
}

function preHealIndexedPixels(pixels, width, height, replacementPixels, regions = preHealRegions, indexes = preHealIndexes, radius = preHealRadius, fromIndexes = null) {
  if (!regions.length || !indexes || !indexes.length) return 0;
  let changed = 0;
  for (const region of regions) {
    for (let y = Math.max(0, region.y0); y < Math.min(height, region.y1); y += 1) {
      for (let x = Math.max(0, region.x0); x < Math.min(width, region.x1); x += 1) {
        const pos = y * width + x;
        if (indexes.includes(pixels[pos])) continue;
        if (fromIndexes && !fromIndexes.includes(pixels[pos])) continue;
        if (replacementBit(replacementPixels[pos])) continue;
        if (radius === 0) {
          // radius=0 means "force fill": the caller already knows these pixels
          // must become indexes[0] (e.g. restoring a known-background strip),
          // so skip the left/right search entirely instead of failing when no
          // sample of the target color remains anywhere on the row.
          pixels[pos] = indexes[0];
          changed += 1;
          continue;
        }
        const left = nearestTargetOnRow(pixels, width, x, y, indexes, radius, -1);
        const right = nearestTargetOnRow(pixels, width, x, y, indexes, radius, 1);
        if (left >= 0 && right >= 0) {
          pixels[pos] = left;
          changed += 1;
        }
      }
    }
  }
  return changed;
}

function tileKeyFromIndexedPixels(pixels, width, tx, ty) {
  const tile = Buffer.alloc(64, 0);
  for (let py = 0; py < 8; py += 1) {
    for (let px = 0; px < 8; px += 1) {
      tile[py * 8 + px] = pixels[(ty * 8 + py) * width + (tx * 8 + px)];
    }
  }
  return tile.toString("latin1");
}

function packTileFromIndexedPixels(pixels, width, tx, ty) {
  const tile = Buffer.alloc(64, 0);
  for (let py = 0; py < 8; py += 1) {
    for (let px = 0; px < 8; px += 1) {
      tile[py * 8 + px] = pixels[(ty * 8 + py) * width + (tx * 8 + px)];
    }
  }
  return tile;
}

function tileDistance(a, b) {
  let distance = 0;
  for (let i = 0; i < 64; i += 1) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) distance += 1;
  }
  return distance;
}

function countKeys(keys) {
  const counts = new Map();
  for (const key of keys) counts.set(key, (counts.get(key) || 0) + 1);
  return counts;
}

function lossyFitTileKeys(cellFinalKeys, protectedKeys, capacity) {
  let counts = countKeys(cellFinalKeys);
  let merged = 0;
  let totalDistance = 0;

  while (counts.size > capacity) {
    const mergeCandidates = [...counts.entries()]
      .filter(([key]) => !protectedKeys.has(key))
      .sort((a, b) => a[1] - b[1]);
    if (mergeCandidates.length === 0) break;

    const [sourceKey, sourceCount] = mergeCandidates[0];
    let bestTarget = "";
    let bestScore = Number.POSITIVE_INFINITY;
    let bestDistance = Number.POSITIVE_INFINITY;

    // Targets must also be non-protected: protected keys already point at an
    // existing, untouched tile slot, so merging a new/changed pattern onto one
    // just re-links that cell back to the OLD tile data with no bytes written --
    // silently discarding the edit while still reporting the fit as "successful".
    for (const [targetKey, targetCount] of counts.entries()) {
      if (targetKey === sourceKey) continue;
      if (protectedKeys.has(targetKey)) continue;
      const distance = tileDistance(sourceKey, targetKey);
      const score = distance * Math.max(1, sourceCount) - Math.min(targetCount, 32) * 0.01;
      if (score < bestScore) {
        bestScore = score;
        bestDistance = distance;
        bestTarget = targetKey;
      }
    }

    if (!bestTarget) break;

    for (let i = 0; i < cellFinalKeys.length; i += 1) {
      if (cellFinalKeys[i] === sourceKey) cellFinalKeys[i] = bestTarget;
    }
    counts.set(bestTarget, (counts.get(bestTarget) || 0) + sourceCount);
    counts.delete(sourceKey);
    merged += 1;
    totalDistance += bestDistance * sourceCount;
  }

  return { unique: counts.size, merged, totalDistance };
}

function originalTileKey(info, tileIndex) {
  return dat.subarray(info.byteStart + info.tileDataOffset + tileIndex * 64, info.byteStart + info.tileDataOffset + tileIndex * 64 + 64).toString("latin1");
}

function exportMasks(outDir, ids) {
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = [];
  for (const id of ids) {
    const info = decodeHeader(id);
    const pixels = unpackResource(info);
    const outPath = path.join(outDir, `be-hdr-ui-${id}.pbm`);
    writePbm(outPath, info.width, info.height, pixels, `SLPS-01903 be-hdr 8bpp UI resource ${id}`);
    manifest.push({ ...info, outPath, invert, sourceInkIndexes });
    console.log(`${id}: wrote ${outPath} ${info.width}x${info.height} tileCount=${info.tileCount}`);
  }
  fs.writeFileSync(path.join(outDir, "be-hdr-ui-manifest.json"), JSON.stringify(manifest, null, 2));
}

function dumpRawIndexes(outDir, ids) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const id of ids) {
    const info = decodeHeader(id);
    const pixels = unpackIndexedResource(info);
    const outPath = path.join(outDir, `be-hdr-ui-${id}-raw.pgm`);
    const lines = ["P2", `# raw 8bpp palette indices for resource ${id}`, `${info.width} ${info.height}`, "255"];
    for (let y = 0; y < info.height; y += 1) {
      const row = [];
      for (let x = 0; x < info.width; x += 1) row.push(pixels[y * info.width + x]);
      lines.push(row.join(" "));
    }
    fs.writeFileSync(outPath, `${lines.join("\n")}\n`);
    console.log(`${id}: wrote raw index dump ${outPath} ${info.width}x${info.height}`);
  }
}

function writeDebugPgm(id, stageName, pixels, width, height) {
  if (!debugDumpDir) return;
  fs.mkdirSync(debugDumpDir, { recursive: true });
  const outPath = path.join(debugDumpDir, `${stageName}-${id}.pgm`);
  const lines = ["P2", `# ${stageName} for resource ${id}`, `${width} ${height}`, "255"];
  for (let y = 0; y < height; y += 1) {
    const row = [];
    for (let x = 0; x < width; x += 1) row.push(pixels[y * width + x]);
    lines.push(row.join(" "));
  }
  fs.writeFileSync(outPath, `${lines.join("\n")}\n`);
  console.log(`${id}: wrote debug dump ${outPath}`);
}

function patchMask(outDat, idArg, pbmPath) {
  const id = Number.parseInt(idArg || "", 0);
  if (!Number.isFinite(id) || !pbmPath) usage();
  const info = decodeHeader(id);
  const replacementPixels = readPbm(pbmPath, info.width, info.height);
  const erasePixels = erasePbmPath ? readPbm(erasePbmPath, info.width, info.height) : null;
  const indexedPixels = unpackIndexedResource(info);
  writeDebugPgm(id, "04-1-after-unpack", indexedPixels, info.width, info.height);
  for (let i = 0; i < indexedPixels.length; i += 1) {
    if (isSourceInk(indexedPixels[i]) && (!erasePixels || erasePixels[i])) indexedPixels[i] = bgIndex;
  }
  writeDebugPgm(id, "04-2-after-erase", indexedPixels, info.width, info.height);
  for (let i = 0; i < indexedPixels.length; i += 1) {
    if (replacementBit(replacementPixels[i])) indexedPixels[i] = inkIndex;
  }
  writeDebugPgm(id, "04-3-after-ink-draw", indexedPixels, info.width, info.height);
  const preHealedPixels = preHealIndexedPixels(
    indexedPixels,
    info.width,
    info.height,
    replacementPixels,
    preHealRegions,
    preHealIndexes,
    preHealRadius,
    preHealFromIndexes
  );
  if (preHealedPixels) console.log(`${id}: pre-healed ${preHealedPixels} pixels before tile packing`);
  writeDebugPgm(id, "04-4-after-pass1", indexedPixels, info.width, info.height);
  const preHealedPixels2 = preHealIndexedPixels(
    indexedPixels,
    info.width,
    info.height,
    replacementPixels,
    preHealRegions2,
    preHealIndexes2,
    preHealRadius2,
    preHealFromIndexes2
  );
  if (preHealedPixels2) console.log(`${id}: pre-healed (pass 2) ${preHealedPixels2} pixels before tile packing`);
  writeDebugPgm(id, "04-5-after-pass2", indexedPixels, info.width, info.height);
  const preHealedPixels3 = preHealIndexedPixels(
    indexedPixels,
    info.width,
    info.height,
    replacementPixels,
    preHealRegions3,
    preHealIndexes3,
    preHealRadius3,
    preHealFromIndexes3
  );
  if (preHealedPixels3) console.log(`${id}: pre-healed (pass 3) ${preHealedPixels3} pixels before tile packing`);
  writeDebugPgm(id, "04-6-after-pass3", indexedPixels, info.width, info.height);
  if (referenceDatPath && referenceFamily) {
    const refDat = readDatPayload(referenceDatPath);
    const refTileMap = readTileMap(info, refDat);
    const refPixels = new Uint8Array(info.width * info.height);
    for (let ty = 0; ty < info.heightTiles; ty += 1) {
      for (let tx = 0; tx < info.widthTiles; tx += 1) {
        const tileIndex = refTileMap[ty * info.widthTiles + tx] >> 1;
        for (let py = 0; py < 8; py += 1) {
          for (let px = 0; px < 8; px += 1) {
            let value = 0;
            if (tileIndex >= 0 && tileIndex < info.tileCount) {
              value = tilePixel8bpp(refDat, info.byteStart + info.tileDataOffset + tileIndex * 64, px, py);
            }
            refPixels[(ty * 8 + py) * info.width + (tx * 8 + px)] = value;
          }
        }
      }
    }
    let referenceHealed = 0;
    for (let i = 0; i < indexedPixels.length; i += 1) {
      if (!referenceFamily.includes(refPixels[i])) continue;
      if (referenceFamily.includes(indexedPixels[i])) continue;
      if (indexedPixels[i] === inkIndex || isSourceInk(indexedPixels[i])) continue;
      if (replacementBit(replacementPixels[i])) continue;
      indexedPixels[i] = refPixels[i];
      referenceHealed += 1;
    }
    if (referenceHealed) console.log(`${id}: reference-healed ${referenceHealed} pixels before tile packing`);
  }
  writeDebugPgm(id, "04-7-after-reference-heal", indexedPixels, info.width, info.height);
  packIndexedPixelsIntoTiles(id, info, indexedPixels, outDat);
}

function packIndexedPixelsIntoTiles(id, info, indexedPixels, outDat) {
  const patched = Buffer.from(dat);
  const oldMap = readTileMap(info);
  const originalKeys = [];
  for (let idx = 0; idx < info.tileCapacity; idx += 1) {
    originalKeys[idx] = idx < info.tileCount ? originalTileKey(info, idx) : "";
  }
  const unchangedKeyCandidates = new Map();
  const keyToIndex = new Map();
  const protectedIndexes = new Set();
  const overwrittenIndexes = new Map();
  const freeIndexes = [];
  const lossyProtectedKeys = new Set();

  const cellFinalKeys = [];
  const cellOldIndexes = [];
  for (let ty = 0; ty < info.heightTiles; ty += 1) {
    for (let tx = 0; tx < info.widthTiles; tx += 1) {
      const raw = oldMap[ty * info.widthTiles + tx];
      const oldIdx = raw >> 1;
      const finalKey = tileKeyFromIndexedPixels(indexedPixels, info.width, tx, ty);
      cellFinalKeys.push(finalKey);
      cellOldIndexes.push(oldIdx);
      if (lossyProtectRegions.length && tileIntersectsRegions(tx, ty, lossyProtectRegions)) {
        lossyProtectedKeys.add(finalKey);
      }
      if (finalKey === originalKeys[oldIdx]) {
        if (!unchangedKeyCandidates.has(finalKey)) unchangedKeyCandidates.set(finalKey, []);
        unchangedKeyCandidates.get(finalKey).push(oldIdx);
      }
    }
  }

  for (const [key, candidates] of unchangedKeyCandidates.entries()) {
    const tileIndex = candidates[0];
    keyToIndex.set(key, tileIndex);
    protectedIndexes.add(tileIndex);
  }

  let finalUniqueKeyCount = new Set(cellFinalKeys).size;
  console.log(
    `${id}: final unique tiles ${finalUniqueKeyCount}, protected existing tiles ${protectedIndexes.size}, capacity ${info.tileCapacity}`
  );
  if (finalUniqueKeyCount > info.tileCapacity && lossyFit) {
    const protectedKeys = new Set([...unchangedKeyCandidates.keys(), ...lossyProtectedKeys]);
    const fit = lossyFitTileKeys(cellFinalKeys, protectedKeys, info.tileCapacity);
    finalUniqueKeyCount = fit.unique;
    console.log(
      `${id}: lossy fit merged ${fit.merged} tile patterns, total distance ${fit.totalDistance}, final unique tiles ${finalUniqueKeyCount}`
    );
  }
  if (finalUniqueKeyCount > info.tileCapacity) {
    const claimedKeys = new Set(unchangedKeyCandidates.keys());
    const excessKeys = [...new Set(cellFinalKeys)].filter((k) => !claimedKeys.has(k));
    const freeSlotCount = info.tileCapacity - protectedIndexes.size;
    const pixelOf = (cell) => `(${(cell % info.widthTiles) * 8},${Math.floor(cell / info.widthTiles) * 8})`;
    console.log(`${id}: ${excessKeys.length} new tile pattern(s) need a slot, only ${freeSlotCount} free (unprotected) slot(s) available`);
    for (const key of excessKeys) {
      const cells = [];
      for (let i = 0; i < cellFinalKeys.length; i += 1) {
        if (cellFinalKeys[i] === key) cells.push(i);
      }
      console.log(`  new pattern needed at pixel ${cells.map(pixelOf).join(", ")}`);
      let nearestProtectedKey = "";
      let nearestProtectedDistance = Number.POSITIVE_INFINITY;
      for (const protectedKey of claimedKeys) {
        const distance = tileDistance(key, protectedKey);
        if (distance < nearestProtectedDistance) {
          nearestProtectedDistance = distance;
          nearestProtectedKey = protectedKey;
        }
      }
      const nearestProtectedIndex = keyToIndex.get(nearestProtectedKey);
      console.log(
        `    nearest EXISTING (protected) tile is #${nearestProtectedIndex}, ${nearestProtectedDistance}/64 bytes different -- snapping onto it instead of overflowing would look like that tile, not the new one`
      );
      for (const sacrificeCell of cells) {
        const sacrificeIndex = cellOldIndexes[sacrificeCell];
        const sharedWith = cellOldIndexes.reduce((acc, oldIdx, i) => {
          if (i !== sacrificeCell && oldIdx === sacrificeIndex) acc.push(i);
          return acc;
        }, []);
        console.log(
          `    donating pixel ${pixelOf(sacrificeCell)}'s old tile #${sacrificeIndex}` +
            (sharedWith.length
              ? ` -- ALSO still referenced at pixel ${sharedWith.map(pixelOf).join(", ")}, overwriting would corrupt those spots`
              : " -- no other cell references it, overwriting looks SAFE")
        );
      }
    }
  }
  if (finalUniqueKeyCount > info.tileCapacity && !allowOverflow) {
    throw new Error(
      `resource ${id} needs ${finalUniqueKeyCount} unique tiles but capacity is ${info.tileCapacity} ` +
        `(overflow ${finalUniqueKeyCount - info.tileCapacity}). ` +
        "Reduce unique 8x8 tiles in the replacement image, finish replacing repeated source text consistently, " +
        "or pass --allow-overflow to keep the old unsafe behavior."
    );
  }

  for (let idx = 0; idx < info.tileCapacity; idx += 1) {
    if (!protectedIndexes.has(idx)) freeIndexes.push(idx);
  }

  const cellOrder = [];
  const protectedCellOrder = [];
  const normalCellOrder = [];
  for (let ty = 0; ty < info.heightTiles; ty += 1) {
    for (let tx = 0; tx < info.widthTiles; tx += 1) {
      const cell = ty * info.widthTiles + tx;
      if (lossyProtectRegions.length && tileIntersectsRegions(tx, ty, lossyProtectRegions)) {
        protectedCellOrder.push(cell);
      } else {
        normalCellOrder.push(cell);
      }
    }
  }
  cellOrder.push(...protectedCellOrder, ...normalCellOrder);

  const newMap = new Array(oldMap.length);
  for (const cell of cellOrder) {
      const oldRaw = oldMap[cell];
      const oldIndex = oldRaw >> 1;
      const attr = oldRaw & 1;
      const key = cellFinalKeys[cell];
      let tileIndex;

      if (keyToIndex.has(key)) {
        tileIndex = keyToIndex.get(key);
      } else {
        if (freeIndexes.includes(oldIndex)) {
          tileIndex = oldIndex;
          freeIndexes.splice(freeIndexes.indexOf(oldIndex), 1);
        } else {
          tileIndex = freeIndexes.shift();
          if (tileIndex === undefined) {
            tileIndex = oldIndex;
            console.warn(`warning: resource ${id} ran out of free tile slots; overwriting shared tile ${tileIndex}`);
          }
        }
        keyToIndex.set(key, tileIndex);
        if (originalKeys[tileIndex] !== key) overwrittenIndexes.set(tileIndex, key);
      }
      newMap[cell] = (tileIndex << 1) | attr;
  }

  const mapBase = info.byteStart + info.tileMapOffset;
  for (let i = 0; i < newMap.length; i += 1) patched.writeUInt16BE(newMap[i], mapBase + i * 2);

  // header[8] is not the whole resource byte length. For this format it is
  // 0x10 plus the tile payload size used by the runtime loader. If new tiles
  // are allocated above the original highest index (resource 12 is a common
  // case), leaving this value unchanged makes the game ignore those tiles
  // even though they are present in the sector allocation.
  const highestReferencedIndex = newMap.reduce((max, raw) => Math.max(max, raw >> 1), -1);
  const requiredPayloadSize = 0x10 + (highestReferencedIndex + 1) * 64;
  if (requiredPayloadSize > info.payloadSize) {
    patched.writeUInt32BE(requiredPayloadSize, info.byteStart + 8);
    console.log(`${id}: expanded runtime tile payload ${hex(info.payloadSize)} -> ${hex(requiredPayloadSize)}`);
  }

  const tileBase = info.byteStart + info.tileDataOffset;
  for (const [tileIndex, key] of overwrittenIndexes.entries()) {
    Buffer.from(key, "latin1").copy(patched, tileBase + tileIndex * 64);
  }

  fs.mkdirSync(path.dirname(outDat), { recursive: true });
  fs.writeFileSync(outDat, patched);
  console.log(`${id}: patched ${overwrittenIndexes.size} tile slots, capacity ${info.tileCapacity}, at DAT ${hex(info.byteStart)} -> ${outDat}`);
}

function findNearDuplicateTiles(id, maxDistance) {
  const info = decodeHeader(id);
  const map = readTileMap(info);
  const usage = new Map();
  for (let cell = 0; cell < map.length; cell += 1) {
    const idx = map[cell] >> 1;
    if (!usage.has(idx)) usage.set(idx, []);
    usage.get(idx).push(cell);
  }
  const pixelOf = (cell) => `(${(cell % info.widthTiles) * 8},${Math.floor(cell / info.widthTiles) * 8})`;
  const usedIndexes = [...usage.keys()].sort((a, b) => a - b);
  const keys = new Map(usedIndexes.map((idx) => [idx, originalTileKey(info, idx)]));
  const pairs = [];
  for (let i = 0; i < usedIndexes.length; i += 1) {
    for (let j = i + 1; j < usedIndexes.length; j += 1) {
      const a = usedIndexes[i];
      const b = usedIndexes[j];
      const distance = tileDistance(keys.get(a), keys.get(b));
      if (distance <= maxDistance) pairs.push({ a, b, distance });
    }
  }
  pairs.sort((x, y) => x.distance - y.distance);
  console.log(`${id}: ${usedIndexes.length} tile indexes in use, capacity ${info.tileCapacity}, ${pairs.length} pair(s) within ${maxDistance}/64 bytes`);
  for (const { a, b, distance } of pairs) {
    console.log(
      `  #${a} (used at ${usage.get(a).map(pixelOf).join(", ")}) <-> #${b} (used at ${usage.get(b).map(pixelOf).join(", ")}) -- distance ${distance}`
    );
  }
}

if (mode === "export") {
  const ids = positional.map((arg) => Number.parseInt(arg, 0));
  if (ids.length === 0 || ids.some((id) => !Number.isFinite(id))) usage();
  exportMasks(thirdArg, ids);
} else if (mode === "dump-raw") {
  const ids = positional.map((arg) => Number.parseInt(arg, 0));
  if (ids.length === 0 || ids.some((id) => !Number.isFinite(id))) usage();
  dumpRawIndexes(thirdArg, ids);
} else if (mode === "patch") {
  patchMask(thirdArg, positional[0], positional[1]);
} else if (mode === "pack-raw") {
  patchFromRawPgm(thirdArg, positional[0], positional[1]);
} else if (mode === "tile-dupes") {
  findNearDuplicateTiles(Number.parseInt(thirdArg, 0), Number.parseInt(positional[0] || "4", 10));
} else {
  usage();
}
