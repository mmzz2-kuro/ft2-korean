#!/usr/bin/env node

// SLPS-01903 "17일차 후반부/최종보스전" 추가 대사 영역 도구.
//
// 기존 message-mask-pgm-tool.js(그룹 0~15 메시지뱅크, messageId 기준
// 주소 계산)와 픽셀/리빌 헤더 포맷은 완전히 동일하지만, 이 영역은
// 그룹 테이블에 속하지 않는 직접 바이트 오프셋 주소를 쓴다. 발견 방법과
// 확인된 위치는 docs/projects/SLPS-01903/dialogue-route.md의 "라이브
// 디버깅으로 찾은 세 번째 대사 저장 영역" 섹션 참고.
//
// usage:
//   scan  <FS2_FILE.DAT> <outIndexJson> <startHex> <endHex> [--step 0x800] [--ink-min 80] [--ink-max 2200]
//   export <FS2_FILE.DAT> <outDir> <addrHex...>
//   patch  <FS2_FILE.DAT> <outDat> <addrHex> <mask.pgm> [--keep-reveal]

const fs = require('fs');
const path = require('path');

function usage() {
  console.error(`usage:
  scan:   node scripts/finale-text-pgm-tool.js scan <FS2_FILE.DAT> <outIndexJson> <startHex> <endHex> [--step 0x800] [--ink-min 80] [--ink-max 2200]
  export: node scripts/finale-text-pgm-tool.js export <FS2_FILE.DAT> <outDir> <addrHex...>
  patch:  node scripts/finale-text-pgm-tool.js patch <FS2_FILE.DAT> <outDat> <addrHex> <mask.pgm> [--keep-reveal]`);
  process.exit(1);
}

const [mode, datPath, ...rest] = process.argv.slice(2);
if (!mode || !datPath) usage();

const dat = fs.readFileSync(datPath);

function parseAddr(text) {
  const addr = Number.parseInt(text, text.trim().toLowerCase().startsWith('0x') ? 16 : 10);
  if (!Number.isFinite(addr)) throw new Error(`invalid address '${text}'`);
  return addr;
}

function mapAddress(addr) {
  return { addr, byteStart: addr, byteEnd: addr + 0x930 + 0xd0 };
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

function preprocessBlock(block) {
  const common = Buffer.alloc(Math.max(0x4000, 0x1000 + block.length));
  block.copy(common, 0x1000);
  swap16Range(common, 0x1000, 0x930);
  return common;
}

function preprocessHeader(block) {
  const common = Buffer.alloc(Math.max(0x4000, 0x1000 + block.length));
  block.copy(common, 0x1000);
  swap32Range(common, 0x1930, 0xd0);
  return common;
}

function unpackMaskIndices(common) {
  const pixels = new Uint8Array(200 * 48);

  for (let index = 0; index < 588; index++) {
    const group = Math.floor(index / 196);
    const column = index - group * 196;
    const rowBase = group * 16;
    const sourceOff = 0x1000 + index * 4;
    const words = [common.readUInt16LE(sourceOff), common.readUInt16LE(sourceOff + 2)];

    for (let wordIndex = 0; wordIndex < 2; wordIndex++) {
      let value = words[wordIndex];
      for (let bitPair = 0; bitPair < 8; bitPair++) {
        const y = rowBase + wordIndex * 8 + (7 - bitPair);
        pixels[y * 200 + column] = value & 0x03;
        value >>>= 2;
      }
    }
  }

  return pixels;
}

function packMaskIndices(pixels) {
  if (pixels.length !== 200 * 48) throw new Error(`expected 200x48 pixels, got ${pixels.length}`);

  const packed = Buffer.alloc(0x930);
  for (let index = 0; index < 588; index++) {
    const group = Math.floor(index / 196);
    const column = index - group * 196;
    const rowBase = group * 16;

    for (let wordIndex = 0; wordIndex < 2; wordIndex++) {
      let value = 0;
      for (let bitPair = 0; bitPair < 8; bitPair++) {
        const y = rowBase + wordIndex * 8 + (7 - bitPair);
        const color = pixels[y * 200 + column];
        if (color > 3) throw new Error(`pixel index ${color} at ${column},${y} is outside 0..3`);
        value |= color << (bitPair * 2);
      }
      packed.writeUInt16LE(value, index * 4 + wordIndex * 2);
    }
  }
  return packed;
}

function writePgm(outPath, pixels) {
  const lines = ['P2', '# SLPS-01903 finale-text mask, 200x48, values are palette indices 0..3', '200 48', '3'];

  for (let y = 0; y < 48; y++) {
    const row = [];
    for (let x = 0; x < 200; x++) row.push(String(pixels[y * 200 + x]));
    lines.push(row.join(' '));
  }

  fs.writeFileSync(outPath, `${lines.join('\n')}\n`);
}

function readPgm(pgmPath) {
  const text = fs.readFileSync(pgmPath, 'utf8');
  const tokens = text
    .split(/\r?\n/)
    .flatMap((line) => line.replace(/#.*/, '').trim().split(/\s+/).filter(Boolean));

  if (tokens.shift() !== 'P2') throw new Error(`${pgmPath} is not an ASCII PGM (P2) file`);
  const width = Number.parseInt(tokens.shift() || '', 10);
  const height = Number.parseInt(tokens.shift() || '', 10);
  const maxValue = Number.parseInt(tokens.shift() || '', 10);
  if (width !== 200 || height !== 48) throw new Error(`${pgmPath} must be 200x48, got ${width}x${height}`);
  if (!Number.isFinite(maxValue) || maxValue <= 0) throw new Error(`${pgmPath} has invalid max value`);

  if (tokens.length < width * height) {
    throw new Error(`${pgmPath} has ${tokens.length} pixels, expected ${width * height}`);
  }

  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i++) {
    const value = Number.parseInt(tokens[i], 10);
    if (!Number.isFinite(value) || value < 0 || value > maxValue) {
      throw new Error(`${pgmPath} has invalid pixel value '${tokens[i]}' at index ${i}`);
    }
    pixels[i] = maxValue === 3 ? value : Math.max(0, Math.min(3, Math.round((value / maxValue) * 3)));
  }
  return pixels;
}

function visibleRenderLimit(pixels) {
  let maxIndex = -1;
  for (let index = 0; index < 588; index++) {
    const group = Math.floor(index / 196);
    const column = index - group * 196;
    const rowBase = group * 16;

    for (let y = rowBase; y < rowBase + 16; y++) {
      if (pixels[y * 200 + column] !== 0) {
        maxIndex = index;
        break;
      }
    }
  }
  return maxIndex + 1;
}

function mulHiU32(a, b) {
  return Number((BigInt(a >>> 0) * BigInt(b >>> 0)) >> 32n) >>> 0;
}

function markFromPointer(pointer) {
  return (mulHiU32(pointer >>> 0, 0x59493e15) >>> 7) >>> 0;
}

function pointerForMark(targetMark) {
  let lo = 0;
  let hi = 0x400000;
  while (markFromPointer(hi) < targetMark && hi < 0x7fffffff) hi *= 2;

  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (markFromPointer(mid) >= targetMark) hi = mid;
    else lo = mid + 1;
  }
  return lo >>> 0;
}

function rebuildRevealHeader(block, pixels) {
  const common = preprocessHeader(block);
  const originalCount = common.readUInt16LE(0x1930);
  if (originalCount === 0 || originalCount > 52) {
    return { stored: null, reason: `unsupported original segment count ${originalCount}` };
  }

  const pointerBase = 0x1934;
  const originalFirstPointer = common.readUInt32LE(pointerBase);
  const originalLastPointer = common.readUInt32LE(pointerBase + (originalCount - 1) * 4);
  const originalLastMark = markFromPointer(originalLastPointer);
  const neededEntries = Math.max(1, Math.min(588, visibleRenderLimit(pixels)));
  const rebuiltCount = Math.max(originalCount, Math.min(52, Math.ceil(neededEntries / 14)));
  const revealEntries = rebuiltCount * 14;

  const scaledOriginalMark = Math.ceil((originalLastMark * rebuiltCount) / originalCount);
  const targetLastMark = Math.max(originalLastMark, scaledOriginalMark, revealEntries);
  const targetLastPointer = pointerForMark(targetLastMark);
  const startPointer = originalFirstPointer < targetLastPointer ? originalFirstPointer : 0;

  common.writeUInt16LE(rebuiltCount, 0x1930);
  common.writeUInt16LE(0, 0x1932);

  for (let i = 0; i < 52; i++) {
    let pointer = 0;
    if (i < rebuiltCount) {
      if (rebuiltCount === 1) {
        pointer = targetLastPointer;
      } else {
        pointer = Math.round(startPointer + ((targetLastPointer - startPointer) * i) / (rebuiltCount - 1));
      }
    }
    common.writeUInt32LE(pointer >>> 0, pointerBase + i * 4);
  }

  const stored = Buffer.from(common.subarray(0x1930, 0x1930 + 0xd0));
  swap32Range(stored, 0, stored.length);
  return { stored, originalCount, rebuiltCount, neededEntries, revealEntries, originalLastMark, targetLastMark };
}

function inkCount(pixels) {
  let ink = 0;
  for (const v of pixels) if (v >= 2) ink++;
  return ink;
}

// The pixel-density (ink count) filter alone lets through false positives:
// unrelated data can coincidentally look text-shaped, and some candidates
// are a real short line PLUS unrelated leftover bytes elsewhere in the same
// fixed-size block (looks like "noise mixed with real text"). The reveal
// header right after the pixel data (see rebuildRevealHeader) stores a
// segment count that a real message always keeps in 1..52; garbage/leftover
// data almost never does. Requiring both checks is dramatically more
// precise than ink count alone (verified against ~60 manually-reviewed
// candidates: 100% precision vs. frequent false positives with ink-only).
function segmentCount(addr) {
  const block = dat.subarray(addr, Math.min(addr + 0x930 + 0xd0, dat.length));
  const common = preprocessHeader(block);
  return common.readUInt16LE(0x1930);
}

function scanCandidates(startAddr, endAddr, step, inkMin, inkMax) {
  const results = [];
  for (let addr = startAddr; addr < endAddr; addr += step) {
    if (addr + 0x930 + 0xd0 > dat.length) break;
    const block = dat.subarray(addr, addr + 0x930);
    const pixels = unpackMaskIndices(preprocessBlock(block));
    const ink = inkCount(pixels);
    if (ink < inkMin || ink > inkMax) continue;
    const segCount = segmentCount(addr);
    if (segCount < 1 || segCount > 52) continue;
    results.push({ addr, ink, segCount });
  }
  return results;
}

function exportMasks(outDir, addrArgs) {
  if (addrArgs.length === 0) usage();
  fs.mkdirSync(outDir, { recursive: true });

  const manifest = [];
  for (const arg of addrArgs) {
    const addr = parseAddr(arg);
    const mapped = mapAddress(addr);
    const block = dat.subarray(mapped.byteStart, Math.min(mapped.byteEnd, dat.length));
    const pixels = unpackMaskIndices(preprocessBlock(block));
    const outPath = path.join(outDir, `finale-text-0x${addr.toString(16)}.pgm`);
    writePgm(outPath, pixels);
    manifest.push({ addr, outPath, width: 200, height: 48, maxValue: 3 });
    console.log(`0x${addr.toString(16)}: wrote ${outPath}`);
  }

  fs.writeFileSync(path.join(outDir, 'finale-text-manifest.json'), JSON.stringify(manifest, null, 2));
}

function patchMask(outDat, addrArg, pgmPath, options = {}) {
  const addr = parseAddr(addrArg || '');
  if (!pgmPath) usage();

  const mapped = mapAddress(addr);
  const patchedDat = Buffer.from(dat);
  const pixels = readPgm(pgmPath);
  const packed = packMaskIndices(pixels);

  const stored = Buffer.from(packed);
  swap16Range(stored, 0, stored.length);
  stored.copy(patchedDat, mapped.byteStart, 0, stored.length);

  let revealInfo = null;
  if (!options.keepReveal) {
    revealInfo = rebuildRevealHeader(dat.subarray(mapped.byteStart, Math.min(mapped.byteEnd, dat.length)), pixels);
    if (revealInfo.stored) {
      revealInfo.stored.copy(patchedDat, mapped.byteStart + 0x930, 0, revealInfo.stored.length);
    } else {
      console.warn(`0x${addr.toString(16)}: reveal header not rebuilt: ${revealInfo.reason}`);
    }
  }

  fs.mkdirSync(path.dirname(outDat), { recursive: true });
  fs.writeFileSync(outDat, patchedDat);
  let detail = 'mask 0x930';
  if (options.keepReveal) {
    detail += ', kept original reveal header';
  } else if (revealInfo && revealInfo.stored) {
    detail += `, reveal ${revealInfo.originalCount}->${revealInfo.rebuiltCount} segments`;
    detail += ` (${revealInfo.neededEntries}/${revealInfo.revealEntries} entries`;
    detail += `, mark ${revealInfo.originalLastMark}->${revealInfo.targetLastMark})`;
  }
  console.log(`0x${addr.toString(16)}: patched ${detail} at DAT 0x${mapped.byteStart.toString(16)} -> ${outDat}`);
}

if (mode === 'scan') {
  const [outIndexJson, startArg, endArg, ...opts] = rest;
  if (!outIndexJson || !startArg || !endArg) usage();
  let step = 0x800;
  let inkMin = 80;
  let inkMax = 2200;
  for (let i = 0; i < opts.length; i++) {
    if (opts[i] === '--step') step = parseAddr(opts[++i]);
    else if (opts[i] === '--ink-min') inkMin = Number.parseInt(opts[++i], 10);
    else if (opts[i] === '--ink-max') inkMax = Number.parseInt(opts[++i], 10);
    else usage();
  }
  const startAddr = parseAddr(startArg);
  const endAddr = parseAddr(endArg);
  const results = scanCandidates(startAddr, endAddr, step, inkMin, inkMax);
  fs.mkdirSync(path.dirname(outIndexJson), { recursive: true });
  fs.writeFileSync(outIndexJson, JSON.stringify(results, null, 2));
  console.log(`scanned 0x${startAddr.toString(16)}..0x${endAddr.toString(16)} step 0x${step.toString(16)}: ${results.length} candidates -> ${outIndexJson}`);
} else if (mode === 'export') {
  const [outDir, ...addrArgs] = rest;
  if (!outDir) usage();
  exportMasks(outDir, addrArgs);
} else if (mode === 'patch') {
  const [outDat, addrArg, pgmPath, ...flags] = rest;
  const options = { keepReveal: flags.includes('--keep-reveal') };
  patchMask(outDat, addrArg, pgmPath, options);
} else {
  usage();
}
