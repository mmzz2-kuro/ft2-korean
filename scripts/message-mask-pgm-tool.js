#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function usage() {
  console.error(`usage:
  export: node scripts/message-mask-pgm-tool.js export <FS2_FILE.DAT> <SLPS_019.03> <outDir> <messageId...>
  patch:  node scripts/message-mask-pgm-tool.js patch <FS2_FILE.DAT> <SLPS_019.03> <outDat> <messageId> <mask.pgm> [--keep-reveal]`);
  process.exit(1);
}

const [mode, datPath, exePath, thirdArg, ...rest] = process.argv.slice(2);
if (!mode || !datPath || !exePath || !thirdArg) usage();

const dat = fs.readFileSync(datPath);
const exe = fs.readFileSync(exePath);
const loadAddr = exe.readUInt32LE(0x18);

const groupPointerTableAddr = 0x80169db0;

// Group base sectors live in a runtime-built table at 0x801D0B90, outside the
// static EXE image (see docs/projects/SLPS-01903/dialogue-route.md). These
// values were read directly from PS1 RAM dumps (ram-dump/*.bin) and verified
// identical across every dump captured so far, so they are treated as fixed.
const GROUP_BASE_SECTORS = [
  30830, 35726, 42898, 47108, 51114, 56222, 59672, 62624,
  66214, 69504, 73180, 76776, 80436, 83408, 84966, 91324,
];

function fileOffOfRam(addr) {
  return addr - loadAddr + 0x800;
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
  if (group >= GROUP_BASE_SECTORS.length) {
    throw new Error(`group ${group} has no known base sector`);
  }
  return {
    tableOff: fileOffOfRam(tableAddr),
    count: Math.floor((nextTableAddr - tableAddr) / 2),
    baseSector: GROUP_BASE_SECTORS[group],
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
  if (relEnd <= relStart) throw new Error(`messageId ${messageId} has empty or reversed sector span`);

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
  const lines = [
    'P2',
    '# SLPS-01903 dialogue mask, 200x48, values are palette indices 0..3',
    '200 48',
    '3',
  ];

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
  const startPointer =
    originalFirstPointer < targetLastPointer ? originalFirstPointer : 0;

  common.writeUInt16LE(rebuiltCount, 0x1930);
  common.writeUInt16LE(0, 0x1932);

  for (let i = 0; i < 52; i++) {
    let pointer = 0;
    if (i < rebuiltCount) {
      if (rebuiltCount === 1) {
        pointer = targetLastPointer;
      } else {
        pointer = Math.round(
          startPointer + ((targetLastPointer - startPointer) * i) / (rebuiltCount - 1)
        );
      }
    }
    common.writeUInt32LE(pointer >>> 0, pointerBase + i * 4);
  }

  const stored = Buffer.from(common.subarray(0x1930, 0x1930 + 0xd0));
  swap32Range(stored, 0, stored.length);
  return {
    stored,
    originalCount,
    rebuiltCount,
    neededEntries,
    revealEntries,
    originalLastMark,
    targetLastMark,
  };
}

function exportMasks(outDir, idArgs) {
  if (idArgs.length === 0) usage();
  fs.mkdirSync(outDir, { recursive: true });

  const manifest = [];
  for (const arg of idArgs) {
    const messageId = Number.parseInt(arg, 0);
    if (!Number.isFinite(messageId)) usage();

    const mapped = mapMessageId(messageId);
    const block = dat.subarray(mapped.byteStart, mapped.byteEnd);
    const pixels = unpackMaskIndices(preprocessBlock(block));
    const outPath = path.join(outDir, `message-mask-${messageId}.pgm`);
    writePgm(outPath, pixels);
    manifest.push({ ...mapped, outPath, width: 200, height: 48, maxValue: 3 });
    console.log(`${messageId}: wrote ${outPath}`);
  }

  fs.writeFileSync(path.join(outDir, 'message-mask-manifest.json'), JSON.stringify(manifest, null, 2));
}

function patchMask(outDat, idArg, pgmPath, options = {}) {
  const messageId = Number.parseInt(idArg || '', 0);
  if (!Number.isFinite(messageId) || !pgmPath) usage();

  const mapped = mapMessageId(messageId);
  const patchedDat = Buffer.from(dat);
  const pixels = readPgm(pgmPath);
  const packed = packMaskIndices(pixels);

  // Stored bytes are swapped by 0x8017CC90 before rendering, so write the
  // inverse halfword byte order into the DAT block.
  const stored = Buffer.from(packed);
  swap16Range(stored, 0, stored.length);
  stored.copy(patchedDat, mapped.byteStart, 0, stored.length);

  let revealInfo = null;
  if (!options.keepReveal) {
    revealInfo = rebuildRevealHeader(dat.subarray(mapped.byteStart, mapped.byteEnd), pixels);
    if (revealInfo.stored) {
      revealInfo.stored.copy(patchedDat, mapped.byteStart + 0x930, 0, revealInfo.stored.length);
    } else {
      console.warn(`${messageId}: reveal header not rebuilt: ${revealInfo.reason}`);
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
  console.log(`${messageId}: patched ${detail} at DAT 0x${mapped.byteStart.toString(16)} -> ${outDat}`);
}

if (mode === 'export') {
  exportMasks(thirdArg, rest);
} else if (mode === 'patch') {
  const idArg = rest[0];
  const pgmPath = rest[1];
  const options = { keepReveal: false };
  for (const arg of rest.slice(2)) {
    if (arg === '--keep-reveal') options.keepReveal = true;
    else usage();
  }
  patchMask(thirdArg, idArg, pgmPath, options);
} else {
  usage();
}
