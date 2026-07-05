#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function usage() {
  console.error(`usage:
  export: node scripts/ui-1bpp-mask-tool.js export <FS2_FILE.DAT> <SLPS_019.03> <outDir> <id...> [--bytes-per-row N] [--rows N] [--data-offset N]
  patch:  node scripts/ui-1bpp-mask-tool.js patch <FS2_FILE.DAT> <SLPS_019.03> <outDat> <id> <mask.pbm> [--bytes-per-row N] [--rows N] [--data-offset N]`);
  process.exit(1);
}

const [mode, datPath, exePath, thirdArg, ...rest] = process.argv.slice(2);
if (!mode || !datPath || !exePath || !thirdArg) usage();

let bytesPerRow = 32;
let rows = 64;
let dataOffset = 0;
const positional = [];

for (let i = 0; i < rest.length; i += 1) {
  const arg = rest[i];
  if (arg === '--bytes-per-row') {
    bytesPerRow = Number.parseInt(rest[++i] || '', 0);
  } else if (arg === '--rows') {
    rows = Number.parseInt(rest[++i] || '', 0);
  } else if (arg === '--data-offset') {
    dataOffset = Number.parseInt(rest[++i] || '', 0);
  } else if (arg.startsWith('--')) {
    usage();
  } else {
    positional.push(arg);
  }
}

if (![bytesPerRow, rows, dataOffset].every(Number.isFinite) || bytesPerRow <= 0 || rows <= 0 || dataOffset < 0) {
  throw new Error('invalid 1bpp layout');
}

const dat = fs.readFileSync(datPath);
const exe = fs.readFileSync(exePath);
const loadAddr = exe.readUInt32LE(0x18);
const resourceSectorTableAddr = 0x801c4f68;
const resourceSectorTableOff = resourceSectorTableAddr - loadAddr + 0x800;

function hex(n, width = 0) {
  return `0x${n.toString(16).padStart(width, '0')}`;
}

function resourceRange(id) {
  const tableOff = resourceSectorTableOff + id * 2;
  if (tableOff < 0 || tableOff + 4 > exe.length) {
    throw new Error(`resource ${id} sector table offset is outside EXE`);
  }
  const startSector = exe.readUInt16LE(tableOff);
  const endSector = exe.readUInt16LE(tableOff + 2);
  if (endSector <= startSector) {
    throw new Error(`resource ${id} has empty/reversed sector span ${startSector}..${endSector}`);
  }
  return {
    resourceId: id,
    sectorStart: startSector,
    sectorEnd: endSector,
    byteStart: startSector * 0x800,
    byteEnd: endSector * 0x800,
  };
}

function bitAt(buf, off, bit) {
  return (buf[off] >> (7 - bit)) & 1;
}

function unpackGame1bpp(buf, start, width, height, stride) {
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const rowOff = start + y * stride;
    for (let x = 0; x < width; x += 1) {
      // Game storage uses 0 as ink and 1 as background. PBM uses 1 as black/ink.
      pixels[y * width + x] = bitAt(buf, rowOff + Math.floor(x / 8), x & 7) === 0 ? 1 : 0;
    }
  }
  return pixels;
}

function packGame1bpp(pixels, width, height, stride) {
  if (pixels.length < width * height) throw new Error(`mask has ${pixels.length} pixels, expected ${width * height}`);
  const packed = Buffer.alloc(stride * height, 0xff);
  for (let y = 0; y < height; y += 1) {
    const rowOff = y * stride;
    for (let x = 0; x < width; x += 1) {
      if (pixels[y * width + x]) {
        packed[rowOff + Math.floor(x / 8)] &= ~(1 << (7 - (x & 7)));
      }
    }
  }
  return packed;
}

function writePbm(outPath, width, height, pixels, comment) {
  const lines = ['P1'];
  if (comment) lines.push(`# ${comment}`);
  lines.push(`${width} ${height}`);
  for (let y = 0; y < height; y += 1) {
    const row = [];
    for (let x = 0; x < width; x += 1) row.push(String(pixels[y * width + x] ? 1 : 0));
    lines.push(row.join(' '));
  }
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'ascii');
}

function readPbm(pbmPath, expectedWidth, expectedHeight) {
  const text = fs.readFileSync(pbmPath, 'utf8');
  const tokens = text
    .split(/\r?\n/)
    .flatMap((line) => line.replace(/#.*/, '').trim().split(/\s+/).filter(Boolean));
  if (tokens.shift() !== 'P1') throw new Error(`${pbmPath} is not an ASCII PBM (P1) file`);
  const width = Number.parseInt(tokens.shift() || '', 10);
  const height = Number.parseInt(tokens.shift() || '', 10);
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(`${pbmPath} must be ${expectedWidth}x${expectedHeight}, got ${width}x${height}`);
  }
  if (tokens.length < width * height) {
    throw new Error(`${pbmPath} has ${tokens.length} pixels, expected ${width * height}`);
  }
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i += 1) {
    const value = tokens[i];
    if (value !== '0' && value !== '1') throw new Error(`${pbmPath} has invalid PBM value '${value}'`);
    pixels[i] = value === '1' ? 1 : 0;
  }
  return pixels;
}

function exportMasks(outDir, ids) {
  if (ids.length === 0) usage();
  fs.mkdirSync(outDir, { recursive: true });

  const width = bytesPerRow * 8;
  const maskSize = bytesPerRow * rows;
  const manifest = [];
  for (const id of ids) {
    const range = resourceRange(id);
    const maskStart = range.byteStart + dataOffset;
    const maskEnd = maskStart + maskSize;
    if (maskEnd > range.byteEnd || maskEnd > dat.length) {
      throw new Error(`resource ${id} does not contain ${hex(maskSize)} mask bytes at data offset ${hex(dataOffset)}`);
    }
    const pixels = unpackGame1bpp(dat, maskStart, width, rows, bytesPerRow);
    const outPath = path.join(outDir, `ui-mask-${id}.pbm`);
    writePbm(outPath, width, rows, pixels, `SLPS-01903 1bpp UI mask resource ${id}`);
    manifest.push({
      ...range,
      outPath,
      width,
      height: rows,
      bytesPerRow,
      dataOffset,
      maskSize,
    });
    console.log(`${id}: wrote ${outPath}`);
  }
  fs.writeFileSync(path.join(outDir, 'ui-mask-manifest.json'), JSON.stringify(manifest, null, 2));
}

function patchMask(outDat, idArg, pbmPath) {
  const id = Number.parseInt(idArg || '', 0);
  if (!Number.isFinite(id) || !pbmPath) usage();

  const range = resourceRange(id);
  const width = bytesPerRow * 8;
  const maskSize = bytesPerRow * rows;
  const maskStart = range.byteStart + dataOffset;
  const maskEnd = maskStart + maskSize;
  if (maskEnd > range.byteEnd || maskEnd > dat.length) {
    throw new Error(`resource ${id} does not contain ${hex(maskSize)} mask bytes at data offset ${hex(dataOffset)}`);
  }

  const patched = Buffer.from(dat);
  const packed = packGame1bpp(readPbm(pbmPath, width, rows), width, rows, bytesPerRow);
  packed.copy(patched, maskStart);
  fs.mkdirSync(path.dirname(outDat), { recursive: true });
  fs.writeFileSync(outDat, patched);
  console.log(`${id}: patched ${hex(maskSize)} bytes at DAT ${hex(maskStart)} -> ${outDat}`);
}

if (mode === 'export') {
  const ids = positional.map((arg) => Number.parseInt(arg, 0));
  if (ids.some((id) => !Number.isFinite(id))) usage();
  exportMasks(thirdArg, ids);
} else if (mode === 'patch') {
  patchMask(thirdArg, positional[0], positional[1]);
} else {
  usage();
}
