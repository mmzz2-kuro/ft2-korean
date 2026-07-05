#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function usage() {
  console.error(
    'usage: node scripts/dialogue-candidate-scan.js <FS2_FILE.DAT> <SLPS_019.03> <out.json> [--script-ids 309-326] [--include 1001,3002,9001-9117] [--opcode 0x41]'
  );
  process.exit(1);
}

const argv = process.argv.slice(2);
const datPath = argv.shift();
const exePath = argv.shift();
const outPath = argv.shift();
if (!datPath || !exePath || !outPath) usage();

let scriptStart = 309;
let scriptEnd = 326;
let includeIds = [];
let targetOpcode = 0x41;

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--script-ids') {
    const [a, b] = (argv[++i] || '').split('-').map((value) => Number.parseInt(value, 10));
    if (!Number.isFinite(a) || !Number.isFinite(b)) usage();
    scriptStart = a;
    scriptEnd = b;
  } else if (arg === '--include') {
    const parts = (argv[++i] || '').split(',').filter(Boolean);
    includeIds = [];
    for (const part of parts) {
      if (part.includes('-')) {
        const [a, b] = part.split('-').map((value) => Number.parseInt(value, 10));
        if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) usage();
        for (let id = a; id <= b; id++) includeIds.push(id);
      } else {
        const value = Number.parseInt(part, 0);
        if (!Number.isFinite(value)) usage();
        includeIds.push(value);
      }
    }
  } else if (arg === '--opcode') {
    targetOpcode = Number.parseInt(argv[++i] || '', 0);
    if (!Number.isFinite(targetOpcode)) usage();
  } else {
    usage();
  }
}

const dat = fs.readFileSync(datPath);
const exe = fs.readFileSync(exePath);
const loadAddr = exe.readUInt32LE(0x18);

const fs2SectorTableOff = 0x5c768;
const dispatchTableOff = 0x5c54c;
const dispatchCount = 126;
const readerJal = 0x0c05f0d9; // jal 0x8017c364
const checkedReaderJal = 0x0c05f0e4; // jal 0x8017c390
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

function fs2Sector(index) {
  return exe.readUInt16LE(fs2SectorTableOff + index * 2);
}

function resourceBytes(id) {
  return dat.subarray(fs2Sector(id) * 2048, fs2Sector(id + 1) * 2048);
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
  const byteStart = sectorStart * 2048;
  const byteEnd = sectorEnd * 2048;
  if (byteEnd > dat.length || byteEnd - byteStart < 0x930) return null;

  return {
    messageId,
    group,
    index,
    sectorStart,
    sectorEnd,
    byteStart,
    byteEnd,
    byteLength: byteEnd - byteStart,
  };
}

function beHalfwords(buffer) {
  const words = [];
  for (let off = 0; off + 1 < buffer.length; off += 2) words.push(buffer.readUInt16BE(off));
  return words;
}

function readExistingManualIds(jsonPath) {
  if (!fs.existsSync(jsonPath)) return [];

  try {
    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    return (parsed.candidates || [])
      .filter((candidate) => String(candidate.source || '').includes('manual'))
      .map((candidate) => Number(candidate.messageId))
      .filter((messageId) => Number.isInteger(messageId));
  } catch (error) {
    console.warn(`warning: could not preserve existing manual candidates from ${jsonPath}: ${error.message}`);
    return [];
  }
}

const handlers = [];
for (let i = 0; i < dispatchCount; i++) handlers.push(exe.readUInt32LE(dispatchTableOff + i * 4));

const uniqueHandlers = [...new Set(handlers)].sort((a, b) => a - b);
function nextHandler(addr) {
  return uniqueHandlers.find((candidate) => candidate > addr) || addr + 0x100;
}

function countDirectReaderCalls(addr) {
  const start = fileOffOfRam(addr);
  const end = Math.min(fileOffOfRam(nextHandler(addr)), exe.length);
  let count = 0;
  for (let off = start; off + 4 <= end; off += 4) {
    const word = exe.readUInt32LE(off);
    if (word === readerJal || word === checkedReaderJal) count++;
  }
  return count;
}

const argCounts = handlers.map(countDirectReaderCalls);
argCounts[0x3f] = 2;
argCounts[0x40] = 2;
argCounts[0x41] = 1;
argCounts[0x78] = 1;

function scanRefs() {
  const refs = [];
  const rejected = [];

  for (let scriptId = scriptStart; scriptId <= scriptEnd; scriptId++) {
    const words = beHalfwords(resourceBytes(scriptId));
    const starts = [...new Set(
      words
        .slice(0, 192)
        .filter(Boolean)
        .map((value) => value >> 1)
        .filter((value) => value >= 192 && value < words.length)
    )].sort((a, b) => a - b);

    for (let entry = 0; entry < starts.length; entry++) {
      let pc = starts[entry];
      const end = starts[entry + 1] || words.length;
      let guard = 0;

      while (pc < end && guard++ < 2000) {
        const opcodeWord = pc;
        const opcode = words[pc++];
        if (opcode === 0xffff || opcode === 0xfffe) break;
        if (opcode >= argCounts.length) break;

        const argc = argCounts[opcode] || 0;
        const args = [];
        for (let i = 0; i < argc && pc < end; i++) args.push(words[pc++]);

        if (opcode === targetOpcode) {
          const messageId = args[0];
          const mapped = mapMessageId(messageId);
          const ref = { scriptId, entry, entryWord: starts[entry], opcodeWord, messageId };
          if (mapped) refs.push({ ...ref, mapped });
          else rejected.push({ ...ref, reason: 'not-in-message-bank' });
        }
      }
    }
  }

  return { refs, rejected };
}

const { refs, rejected } = scanRefs();
const candidatesById = new Map();

for (const ref of refs) {
  const existing = candidatesById.get(ref.messageId);
  if (existing) {
    existing.refs.push({
      scriptId: ref.scriptId,
      entry: ref.entry,
      entryWord: ref.entryWord,
      opcodeWord: ref.opcodeWord,
    });
  } else {
    candidatesById.set(ref.messageId, {
      ...ref.mapped,
      source: 'script-scan',
      refs: [{
        scriptId: ref.scriptId,
        entry: ref.entry,
        entryWord: ref.entryWord,
        opcodeWord: ref.opcodeWord,
      }],
    });
  }
}

const manual = [];
const manualIds = [...new Set([...readExistingManualIds(outPath), ...includeIds])].sort((a, b) => a - b);
const explicitIncludeIds = new Set(includeIds);

for (const messageId of manualIds) {
  const mapped = mapMessageId(messageId);
  if (!mapped) {
    manual.push({
      messageId,
      included: false,
      requested: explicitIncludeIds.has(messageId),
      reason: 'not-in-message-bank',
    });
    continue;
  }

  if (candidatesById.has(messageId)) {
    const candidate = candidatesById.get(messageId);
    if (!String(candidate.source).includes('manual')) candidate.source = `${candidate.source}+manual`;
    manual.push({
      messageId,
      included: true,
      requested: explicitIncludeIds.has(messageId),
      reason: 'already-present',
    });
  } else {
    candidatesById.set(messageId, { ...mapped, source: 'manual-validated', refs: [] });
    manual.push({
      messageId,
      included: true,
      requested: explicitIncludeIds.has(messageId),
      reason: explicitIncludeIds.has(messageId) ? 'mapped' : 'preserved-existing',
    });
  }
}

const candidates = [...candidatesById.values()].sort((a, b) => a.messageId - b.messageId);
const output = {
  generatedAt: new Date().toISOString(),
  datPath,
  exePath,
  scriptRange: `${scriptStart}-${scriptEnd}`,
  opcode: targetOpcode,
  requestedManualInclude: includeIds,
  preservedManualInclude: manualIds.filter((messageId) => !explicitIncludeIds.has(messageId)),
  candidates,
  manual,
  rejected,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`candidates ${candidates.length}, rejected ${rejected.length}`);
console.log(`wrote ${outPath}`);
