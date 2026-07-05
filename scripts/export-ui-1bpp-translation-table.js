#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function usage() {
  console.error(
    'usage: node scripts/export-ui-1bpp-translation-table.js <FS2_FILE.DAT> <SLPS_019.03> <out.tsv> <maskDir> --ids 1151-1169 --bytes-per-row 32 --rows 64 [--data-offset 0] [--font-size N] [--line-height N] [--pad N] [--threshold N] [--bold N]'
  );
  process.exit(1);
}

const argv = process.argv.slice(2);
const datPath = argv.shift();
const exePath = argv.shift();
const outTsv = argv.shift();
const maskDir = argv.shift();
if (!datPath || !exePath || !outTsv || !maskDir) usage();

let idsArg = '';
let bytesPerRow = 32;
let rows = 64;
let dataOffset = 0;
let fontSize = 24;
let lineHeight = 24;
let pad = 1;
let threshold = 64;
let bold = 0;

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--ids') idsArg = argv[++i] || '';
  else if (arg === '--bytes-per-row') bytesPerRow = Number.parseInt(argv[++i] || '', 0);
  else if (arg === '--rows') rows = Number.parseInt(argv[++i] || '', 0);
  else if (arg === '--data-offset') dataOffset = Number.parseInt(argv[++i] || '', 0);
  else if (arg === '--font-size') fontSize = Number.parseInt(argv[++i] || '', 0);
  else if (arg === '--line-height') lineHeight = Number.parseInt(argv[++i] || '', 0);
  else if (arg === '--pad') pad = Number.parseInt(argv[++i] || '', 0);
  else if (arg === '--threshold') threshold = Number.parseInt(argv[++i] || '', 0);
  else if (arg === '--bold') bold = Number.parseInt(argv[++i] || '', 0);
  else usage();
}

function parseIds(text) {
  const ids = [];
  for (const part of String(text || '').split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const m = /^(\d+)-(\d+)$/.exec(trimmed);
    if (m) {
      const start = Number(m[1]);
      const end = Number(m[2]);
      const step = start <= end ? 1 : -1;
      for (let id = start; id !== end + step; id += step) ids.push(id);
    } else {
      const id = Number.parseInt(trimmed, 0);
      if (!Number.isFinite(id)) throw new Error(`invalid id '${trimmed}'`);
      ids.push(id);
    }
  }
  return [...new Set(ids)];
}

function unescapeTsv(value) {
  const marker = '\uE000';
  return String(value || '')
    .replace(/\\\\/g, marker)
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(new RegExp(marker, 'g'), '\\');
}

function escapeTsv(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\r/g, '').replace(/\n/g, '\\n');
}

function readExisting(tsvPath) {
  const result = new Map();
  if (!fs.existsSync(tsvPath)) return result;
  const lines = fs.readFileSync(tsvPath, 'utf8').split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return result;
  const headers = lines[0].split('\t');
  for (const line of lines.slice(1)) {
    const values = line.split('\t');
    const row = {};
    headers.forEach((header, i) => {
      row[header] = unescapeTsv(values[i] || '');
    });
    const id = Number(row.resource_id);
    if (Number.isInteger(id)) result.set(id, row);
  }
  return result;
}

const ids = parseIds(idsArg);
if (ids.length === 0) usage();

fs.mkdirSync(maskDir, { recursive: true });
fs.mkdirSync(path.dirname(outTsv), { recursive: true });

const tool = path.join(__dirname, 'ui-1bpp-mask-tool.js');
const exportResult = spawnSync(
  process.execPath,
  [
    tool,
    'export',
    datPath,
    exePath,
    maskDir,
    ...ids.map(String),
    '--bytes-per-row',
    String(bytesPerRow),
    '--rows',
    String(rows),
    '--data-offset',
    String(dataOffset),
  ],
  { stdio: 'inherit' }
);
if (exportResult.status !== 0) process.exit(exportResult.status || 1);

const manifestPath = path.join(maskDir, 'ui-mask-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const existing = readExisting(outTsv);
const manifestById = new Map(manifest.map((entry) => [entry.resourceId, entry]));

const headers = [
  'enabled',
  'resource_id',
  'mask_pbm',
  'source_note',
  'ko_text',
  'width',
  'height',
  'bytes_per_row',
  'rows',
  'data_offset',
  'font_size',
  'line_height',
  'pad',
  'threshold',
  'bold',
];

const lines = [headers.join('\t')];
for (const id of ids) {
  const previous = existing.get(id) || {};
  const info = manifestById.get(id);
  const width = bytesPerRow * 8;
  const row = {
    enabled: previous.enabled || '1',
    resource_id: String(id),
    mask_pbm: info ? info.outPath : path.join(maskDir, `ui-mask-${id}.pbm`),
    source_note:
      previous.source_note ||
      `1bpp UI mask resource ${id}, ${width}x${rows}, ${bytesPerRow} bytes/row, DAT ${info ? '0x' + info.byteStart.toString(16) : ''}`,
    ko_text: previous.ko_text || '',
    width: String(width),
    height: String(rows),
    bytes_per_row: String(bytesPerRow),
    rows: String(rows),
    data_offset: String(dataOffset),
    font_size: previous.font_size || String(fontSize),
    line_height: previous.line_height || String(lineHeight),
    pad: previous.pad || String(pad),
    threshold: previous.threshold || String(threshold),
    bold: previous.bold || String(bold),
  };
  lines.push(headers.map((header) => escapeTsv(row[header])).join('\t'));
}

fs.writeFileSync(outTsv, `${lines.join('\n')}\n`, 'utf8');
console.log(`wrote ${outTsv}`);
