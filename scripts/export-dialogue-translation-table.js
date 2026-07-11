#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function usage() {
  console.error(
    'usage: node scripts/export-dialogue-translation-table.js <FS2_FILE.DAT> <SLPS_019.03> <candidates.json> <out.tsv> <maskOutDir>'
  );
  process.exit(1);
}

const [datPath, exePath, candidatesPath, outTsv, maskOutDir] = process.argv.slice(2);
if (!datPath || !exePath || !candidatesPath || !outTsv || !maskOutDir) usage();

const dat = fs.readFileSync(datPath);
const exe = fs.readFileSync(exePath);
const candidatesJson = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));
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
  if (group >= GROUP_BASE_SECTORS.length) return null;
  const pointerTableOff = fileOffOfRam(groupPointerTableAddr);
  const tableAddr = exe.readUInt32LE(pointerTableOff + group * 4);
  const nextTableAddr = exe.readUInt32LE(pointerTableOff + (group + 1) * 4);
  if (tableAddr < loadAddr || tableAddr >= loadAddr + exe.length) return null;
  if (nextTableAddr <= tableAddr || nextTableAddr > loadAddr + exe.length) return null;
  return {
    tableOff: fileOffOfRam(tableAddr),
    count: Math.floor((nextTableAddr - tableAddr) / 2),
    baseSector: GROUP_BASE_SECTORS[group],
  };
}

function mapMessageId(messageId) {
  const n = messageId - 1001;
  if (n < 0) return null;
  const group = Math.floor(n / 1000);
  const index = n % 1000;
  const info = groupInfo(group);
  if (!info || index + 1 >= info.count) return null;

  const relStart = exe.readUInt16LE(info.tableOff + index * 2);
  const relEnd = exe.readUInt16LE(info.tableOff + (index + 1) * 2);
  if (relEnd <= relStart) return null;

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
    byteLength: (sectorEnd - sectorStart) * 2048,
  };
}

function swap16Range(buffer, start, length) {
  for (let off = start; off < start + length; off += 2) {
    const a = buffer[off];
    buffer[off] = buffer[off + 1];
    buffer[off + 1] = a;
  }
}

function preprocessBlock(block) {
  const common = Buffer.alloc(Math.max(0x4000, 0x1000 + block.length));
  block.copy(common, 0x1000);
  swap16Range(common, 0x1000, 0x930);
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

function escapeTsv(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n');
}

function unescapeTsv(value) {
  const marker = '\uE000';
  return String(value ?? '')
    .replace(/\\\\/g, marker)
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(new RegExp(marker, 'g'), '\\');
}

function readExistingTsv(tsvPath) {
  if (!fs.existsSync(tsvPath)) return new Map();

  const lines = fs.readFileSync(tsvPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  if (!lines[0]) return new Map();

  const headers = lines[0].split('\t');
  const result = new Map();
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const values = line.split('\t');
    const row = {};
    for (let index = 0; index < headers.length; index++) {
      row[headers[index]] = unescapeTsv(values[index] ?? '');
    }
    const messageId = Number(row.message_id);
    if (Number.isInteger(messageId)) result.set(messageId, row);
  }
  return result;
}

fs.mkdirSync(maskOutDir, { recursive: true });
fs.mkdirSync(path.dirname(outTsv), { recursive: true });

const rows = [];
const maskManifest = [];
const candidates = candidatesJson.candidates || [];
const existingRows = readExistingTsv(outTsv);
const preservedColumns = [
  'enabled',
  'source_note',
  'ko_text',
  'font_size',
  'line_height',
  'pad',
  'ink_max',
  'threshold',
  'bright_threshold',
  'bold',
  'shadow',
  'shadow_x',
  'shadow_y',
  'shadow_ink',
];

for (const candidate of candidates) {
  const mapped = mapMessageId(candidate.messageId);
  if (!mapped) continue;

  const block = dat.subarray(mapped.byteStart, mapped.byteEnd);
  const pixels = unpackMaskIndices(preprocessBlock(block));
  const maskPath = path.join(maskOutDir, `message-mask-${candidate.messageId}.pgm`);
  writePgm(maskPath, pixels);

  const refs = (candidate.refs || [])
    .map((ref) => `${ref.scriptId}:${ref.entry}:0x${ref.opcodeWord.toString(16)}`)
    .join(',');

  const previous = existingRows.get(candidate.messageId) || {};
  const preserved = Object.fromEntries(preservedColumns.map((key) => [key, previous[key]]));

  rows.push([
    preserved.enabled ?? 1,
    candidate.messageId,
    candidate.source || '',
    refs,
    maskPath.replace(/\\/g, '/'),
    preserved.source_note ?? '',
    preserved.ko_text ?? '',
    preserved.font_size || 16,
    preserved.line_height || 15,
    preserved.pad || 1,
    preserved.ink_max || 2,
    preserved.threshold || 32,
    preserved.bright_threshold || 96,
    preserved.bold || 0,
    preserved.shadow || 0,
    preserved.shadow_x || 1,
    preserved.shadow_y || 1,
    preserved.shadow_ink || 1,
  ]);

  maskManifest.push({ ...mapped, source: candidate.source, refs: candidate.refs || [], maskPath });
}

const header = [
  'enabled',
  'message_id',
  'source',
  'refs',
  'mask_pgm',
  'source_note',
  'ko_text',
  'font_size',
  'line_height',
  'pad',
  'ink_max',
  'threshold',
  'bright_threshold',
  'bold',
  'shadow',
  'shadow_x',
  'shadow_y',
  'shadow_ink',
];

const tsv = [
  header.join('\t'),
  ...rows.map((row) => row.map(escapeTsv).join('\t')),
].join('\n');

fs.writeFileSync(outTsv, `${tsv}\n`, 'utf8');
fs.writeFileSync(path.join(maskOutDir, 'message-mask-manifest.json'), JSON.stringify(maskManifest, null, 2));
console.log(`rows ${rows.length}`);
console.log(`wrote ${outTsv}`);
console.log(`wrote masks ${maskOutDir}`);
