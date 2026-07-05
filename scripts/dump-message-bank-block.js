#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function usage() {
  console.error(
    'usage: node scripts/dump-message-bank-block.js <FS2_FILE.DAT> <SLPS_019.03> <outDir> <messageId...>'
  );
  process.exit(1);
}

const [datPath, exePath, outDir, ...idArgs] = process.argv.slice(2);
if (!datPath || !exePath || !outDir || idArgs.length === 0) usage();

const dat = fs.readFileSync(datPath);
const exe = fs.readFileSync(exePath);
const loadAddr = exe.readUInt32LE(0x18);

const fs2SectorTableOff = 0x5c768;
const groupPointerTableAddr = 0x80169db0;

function fileOffOfRam(addr) {
  return addr - loadAddr + 0x800;
}

function fs2Sector(index) {
  return exe.readUInt16LE(fs2SectorTableOff + index * 2);
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

  return {
    tableAddr,
    tableOff: fileOffOfRam(tableAddr),
    count: Math.floor((nextTableAddr - tableAddr) / 2),
    baseSector: fs2Sector(4451 + group * 2),
    nextRangeSector: fs2Sector(4452 + group * 2),
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
  const sectorStart = info.baseSector + relStart;
  const sectorEnd = info.baseSector + relEnd;
  const byteStart = sectorStart * 2048;
  const byteEnd = sectorEnd * 2048;

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

fs.mkdirSync(outDir, { recursive: true });

const manifest = [];
for (const arg of idArgs) {
  const messageId = Number.parseInt(arg, 0);
  if (!Number.isFinite(messageId)) usage();

  const mapped = mapMessageId(messageId);
  const bytes = dat.subarray(mapped.byteStart, mapped.byteEnd);
  const outPath = path.join(outDir, `message-bank-${messageId}.bin`);
  fs.writeFileSync(outPath, bytes);
  manifest.push({ ...mapped, outPath });
  console.log(
    `${messageId}: group=${mapped.group} index=${mapped.index} sectors=${mapped.sectorStart}..${mapped.sectorEnd} bytes=0x${mapped.byteLength.toString(16)} -> ${outPath}`
  );
}

fs.writeFileSync(path.join(outDir, 'message-bank-manifest.json'), JSON.stringify(manifest, null, 2));
