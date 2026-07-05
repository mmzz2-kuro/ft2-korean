#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function usage() {
  console.error(`usage:
  export: node scripts/be-hdr-ui-tile-tool.js export <FS2_FILE.DAT> <SLPS_019.03> <outDir> <id...> [--invert]
  patch:  node scripts/be-hdr-ui-tile-tool.js patch <FS2_FILE.DAT> <SLPS_019.03> <outDat> <id> <mask.pbm> [--invert] [--ink-index N] [--bg-index N] [--erase-pbm mask.pbm]

options:
  --source-ink-indexes N[,N...]  source 8bpp palette index mask for export; ranges like 224-232 are allowed
  --lossy-protect-regions R      semicolon-separated x,y,w,h regions whose final tiles must not be lossy-merged
  --pre-heal-regions R           semicolon-separated x,y,w,h regions to heal before tile packing
  --pre-heal-indexes N[,N...]    palette indexes used as the background fill source for pre-heal
  --pre-heal-radius N            horizontal search radius for pre-heal, default 32
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
  const tileMapOffset = tileDataOffset - widthTiles * heightTiles * 2;
  if (
    widthTiles <= 0 ||
    heightTiles <= 0 ||
    widthTiles > 512 ||
    heightTiles > 512 ||
    payloadSize <= tileDataOffset ||
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

function preHealIndexedPixels(pixels, width, height, replacementPixels) {
  if (!preHealRegions.length || !preHealIndexes || !preHealIndexes.length) return 0;
  let changed = 0;
  for (const region of preHealRegions) {
    for (let y = Math.max(0, region.y0); y < Math.min(height, region.y1); y += 1) {
      for (let x = Math.max(0, region.x0); x < Math.min(width, region.x1); x += 1) {
        const pos = y * width + x;
        if (preHealIndexes.includes(pixels[pos])) continue;
        if (replacementBit(replacementPixels[pos])) continue;
        const left = nearestTargetOnRow(pixels, width, x, y, preHealIndexes, preHealRadius, -1);
        const right = nearestTargetOnRow(pixels, width, x, y, preHealIndexes, preHealRadius, 1);
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

    for (const [targetKey, targetCount] of counts.entries()) {
      if (targetKey === sourceKey) continue;
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

function patchMask(outDat, idArg, pbmPath) {
  const id = Number.parseInt(idArg || "", 0);
  if (!Number.isFinite(id) || !pbmPath) usage();
  const info = decodeHeader(id);
  const replacementPixels = readPbm(pbmPath, info.width, info.height);
  const erasePixels = erasePbmPath ? readPbm(erasePbmPath, info.width, info.height) : null;
  const indexedPixels = unpackIndexedResource(info);
  for (let i = 0; i < indexedPixels.length; i += 1) {
    if (isSourceInk(indexedPixels[i]) && (!erasePixels || erasePixels[i])) indexedPixels[i] = bgIndex;
    if (replacementBit(replacementPixels[i])) indexedPixels[i] = inkIndex;
  }
  const preHealedPixels = preHealIndexedPixels(indexedPixels, info.width, info.height, replacementPixels);
  if (preHealedPixels) console.log(`${id}: pre-healed ${preHealedPixels} pixels before tile packing`);
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

  const tileBase = info.byteStart + info.tileDataOffset;
  for (const [tileIndex, key] of overwrittenIndexes.entries()) {
    Buffer.from(key, "latin1").copy(patched, tileBase + tileIndex * 64);
  }

  fs.mkdirSync(path.dirname(outDat), { recursive: true });
  fs.writeFileSync(outDat, patched);
  console.log(`${id}: patched ${overwrittenIndexes.size} tile slots, capacity ${info.tileCapacity}, at DAT ${hex(info.byteStart)} -> ${outDat}`);
}

if (mode === "export") {
  const ids = positional.map((arg) => Number.parseInt(arg, 0));
  if (ids.length === 0 || ids.some((id) => !Number.isFinite(id))) usage();
  exportMasks(thirdArg, ids);
} else if (mode === "patch") {
  patchMask(thirdArg, positional[0], positional[1]);
} else {
  usage();
}
