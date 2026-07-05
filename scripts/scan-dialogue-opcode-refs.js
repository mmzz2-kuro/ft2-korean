#!/usr/bin/env node

const fs = require('fs');

function usage() {
  console.error(
    'usage: node scripts/scan-dialogue-opcode-refs.js <FS2_FILE.DAT> <SLPS_019.03> [--ids 309-326] [--opcode 0x41]'
  );
  process.exit(1);
}

const [datPath, exePath, ...args] = process.argv.slice(2);
if (!datPath || !exePath) usage();

let idStart = 309;
let idEnd = 326;
let targetOpcode = 0x41;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--ids') {
    const [a, b] = (args[++i] || '').split('-').map((v) => Number.parseInt(v, 10));
    if (!Number.isFinite(a) || !Number.isFinite(b)) usage();
    idStart = a;
    idEnd = b;
  } else if (arg === '--opcode') {
    targetOpcode = Number.parseInt(args[++i] || '', 0);
    if (!Number.isFinite(targetOpcode)) usage();
  } else {
    usage();
  }
}

const dat = fs.readFileSync(datPath);
const exe = fs.readFileSync(exePath);

const loadAddr = exe.readUInt32LE(0x18);
const sectorTableOff = 0x5c768;
const dispatchTableOff = 0x5c54c;
const dispatchCount = 126;
const readerJal = 0x0c05f0d9; // jal 0x8017c364
const checkedReaderJal = 0x0c05f0e4; // jal 0x8017c390

function fileOffOfRam(addr) {
  return addr - loadAddr + 0x800;
}

function sectorOf(id) {
  return exe.readUInt16LE(sectorTableOff + id * 2);
}

function resourceBytes(id) {
  const start = sectorOf(id) * 2048;
  const end = sectorOf(id + 1) * 2048;
  return dat.subarray(start, end);
}

const handlers = [];
for (let i = 0; i < dispatchCount; i++) {
  handlers.push(exe.readUInt32LE(dispatchTableOff + i * 4));
}

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

// Known wrappers whose real consumption differs from direct jal count.
argCounts[0x3f] = 2; // portrait/expression slot 0 via 0x8017c6f4
argCounts[0x40] = 2; // portrait/expression slot 1 via 0x8017c6f4
argCounts[0x41] = 1; // dialogue/message id
argCounts[0x78] = 1; // 4277+n display work block

function beHalfwords(buffer) {
  const words = [];
  for (let off = 0; off + 1 < buffer.length; off += 2) {
    words.push(buffer.readUInt16BE(off));
  }
  return words;
}

const hits = [];
let parsedOps = 0;
let abortedSegments = 0;

for (let id = idStart; id <= idEnd; id++) {
  const words = beHalfwords(resourceBytes(id));
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
      const opcodePc = pc;
      const opcode = words[pc++];
      parsedOps++;

      if (opcode === 0xffff || opcode === 0xfffe) break;
      if (opcode >= argCounts.length) {
        abortedSegments++;
        break;
      }

      const argc = argCounts[opcode] || 0;
      const opArgs = [];
      for (let i = 0; i < argc && pc < end; i++) opArgs.push(words[pc++]);

      if (opcode === targetOpcode) {
        hits.push({
          scriptId: id,
          entry,
          entryStart: starts[entry],
          word: opcodePc,
          args: opArgs,
        });
      }
    }
  }
}

console.log(`dispatchTable=0x801c4d4c entries=${dispatchCount}`);
console.log(`opcode=0x${targetOpcode.toString(16)} handler=0x${handlers[targetOpcode].toString(16)}`);
console.log(`parsedOps=${parsedOps} abortedSegments=${abortedSegments} hits=${hits.length}`);

const freq = new Map();
for (const hit of hits) {
  const value = hit.args[0];
  freq.set(value, (freq.get(value) || 0) + 1);
}

console.log('\narg0 frequency:');
for (const [value, count] of [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])) {
  console.log(`${String(value).padStart(5)} ${count}`);
}

console.log('\nhits:');
for (const hit of hits) {
  const argText = hit.args.map((value) => `0x${value.toString(16)}`).join(',');
  console.log(
    `id=${hit.scriptId} entry=${hit.entry} entryWord=0x${hit.entryStart.toString(16)} word=0x${hit.word.toString(16)} args=${hit.args.join(',')} (${argText})`
  );
}
