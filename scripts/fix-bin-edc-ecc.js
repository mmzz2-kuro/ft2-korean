#!/usr/bin/env node

// Recomputes EDC/ECC for every sector whose user data was changed between an
// original BIN and a patched/target BIN, and writes a corrected copy of the
// target BIN. Sectors whose user data is unchanged are copied through
// byte-for-byte (including their original EDC/ECC), so anything unusual in
// the original disc outside the edited resources is left alone -- see
// references/platforms/ps1.md's note that some games intentionally carry
// bad EDC as copy protection and a blanket recompute would break that.
//
// usage:
//   node scripts/fix-bin-edc-ecc.js <original.bin> <target.bin> <out.bin> [--exe SLPS_019.03] [--fs2-lba 223]
//   node scripts/fix-bin-edc-ecc.js --self-test <original.bin>
//     recomputes EDC/ECC for every Mode 2 Form 1 sector in <original.bin> and
//     reports any mismatch against the disc's own stored bytes -- use this to
//     independently re-verify the algorithm (scripts/cdrom-eccedc.js) against
//     your own known-good dump before trusting it on a real fix.

const fs = require("fs");
const path = require("path");
const { recomputeMode2Form1Sector, isMode2Form1 } = require("./cdrom-eccedc.js");

const SECTOR_SIZE = 2352;
const USER_OFFSET = 24;
const USER_SIZE = 2048;

function usage() {
  console.error(
    "usage: node scripts/fix-bin-edc-ecc.js <original.bin> <target.bin> <out.bin> [--exe SLPS_019.03] [--fs2-lba 223]\n" +
      "       node scripts/fix-bin-edc-ecc.js --self-test <original.bin>"
  );
  process.exit(1);
}

function resourceIdsForLba(exePath, fs2Lba, lba) {
  const exe = fs.readFileSync(exePath);
  const load = exe.readUInt32LE(0x18);
  const tableOff = 0x801c4f68 - load + 0x800;
  const datSector = lba - fs2Lba;
  if (datSector < 0) return null;
  for (let id = 0; id * 2 + 4 <= exe.length - tableOff; id++) {
    const off0 = tableOff + id * 2;
    const s = exe.readUInt16LE(off0);
    const e = exe.readUInt16LE(off0 + 2);
    if (e > s && datSector >= s && datSector < e) return id;
  }
  return null;
}

function selfTest(originalPath) {
  const buf = fs.readFileSync(originalPath);
  const numSectors = Math.floor(buf.length / SECTOR_SIZE);
  let checked = 0;
  let mismatches = 0;
  for (let lba = 0; lba < numSectors; lba++) {
    const base = lba * SECTOR_SIZE;
    const sector = buf.subarray(base, base + SECTOR_SIZE);
    if (!isMode2Form1(sector)) continue;
    checked++;
    const original = Buffer.from(sector);
    const recomputed = Buffer.from(sector);
    recomputeMode2Form1Sector(recomputed);
    if (!recomputed.subarray(2072, 2352).equals(original.subarray(2072, 2352))) {
      mismatches++;
      if (mismatches <= 10) console.log(`  mismatch at LBA ${lba}`);
    }
  }
  console.log(`checked ${checked} Mode2Form1 sectors, ${mismatches} EDC/ECC mismatches`);
  console.log(mismatches === 0 ? "self-test PASSED" : "self-test FAILED -- do not trust this on a real fix");
  process.exit(mismatches === 0 ? 0 : 1);
}

const argv = process.argv.slice(2);
if (argv[0] === "--self-test") {
  if (!argv[1]) usage();
  selfTest(argv[1]);
} else {
  let exePath = null;
  let fs2Lba = 223;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--exe") exePath = argv[++i];
    else if (argv[i] === "--fs2-lba") fs2Lba = Number.parseInt(argv[++i], 10);
    else positional.push(argv[i]);
  }
  const [originalPath, targetPath, outPath] = positional;
  if (!originalPath || !targetPath || !outPath) usage();

  const original = fs.readFileSync(originalPath);
  const target = fs.readFileSync(targetPath);
  if (original.length !== target.length) {
    throw new Error(`size mismatch: original is ${original.length} bytes, target is ${target.length} bytes`);
  }

  const out = Buffer.from(target);
  const numSectors = Math.floor(target.length / SECTOR_SIZE);
  const fixedLbas = [];

  for (let lba = 0; lba < numSectors; lba++) {
    const base = lba * SECTOR_SIZE;
    const targetSector = target.subarray(base, base + SECTOR_SIZE);
    if (!isMode2Form1(targetSector)) continue;

    const userChanged = !original
      .subarray(base + USER_OFFSET, base + USER_OFFSET + USER_SIZE)
      .equals(target.subarray(base + USER_OFFSET, base + USER_OFFSET + USER_SIZE));
    if (!userChanged) continue;

    const sectorCopy = Buffer.from(targetSector);
    recomputeMode2Form1Sector(sectorCopy);
    sectorCopy.copy(out, base);
    fixedLbas.push(lba);
  }

  console.log(`scanned ${numSectors} sectors, ${fixedLbas.length} had changed user data and got EDC/ECC recomputed`);
  if (fixedLbas.length > 0) {
    console.log(`first fixed LBA: ${fixedLbas[0]}, last fixed LBA: ${fixedLbas[fixedLbas.length - 1]}`);
  }

  if (exePath) {
    const ids = new Set();
    for (const lba of fixedLbas) {
      const id = resourceIdsForLba(exePath, fs2Lba, lba);
      if (id !== null) ids.add(id);
    }
    console.log(`affected resource IDs (${ids.size}): ${[...ids].sort((a, b) => a - b).join(",")}`);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, out);
  console.log(`wrote ${outPath}`);
}
