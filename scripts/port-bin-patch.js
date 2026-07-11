#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function usage() {
  console.error(
    "usage: node scripts/port-bin-patch.js <base-original.bin> <target-original.bin> <base-patched.bin> <out.bin> [--cue out.cue] [--allow-conflicts] [--report out.json]"
  );
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 4) usage();

const baseOriginalPath = args[0];
const targetOriginalPath = args[1];
const basePatchedPath = args[2];
const outPath = args[3];
let cuePath = "";
let allowConflicts = false;
let reportPath = "";

for (let i = 4; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--cue") cuePath = args[++i] || "";
  else if (arg === "--allow-conflicts") allowConflicts = true;
  else if (arg === "--report") reportPath = args[++i] || "";
  else usage();
}

function readFile(filePath) {
  if (!filePath) usage();
  if (!fs.existsSync(filePath)) throw new Error(`file not found: ${filePath}`);
  return fs.readFileSync(filePath);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function pushRange(ranges, offset) {
  const last = ranges[ranges.length - 1];
  if (last && last.end === offset) last.end = offset + 1;
  else ranges.push({ start: offset, end: offset + 1 });
}

function summarizeRanges(ranges, limit = 16) {
  return ranges.slice(0, limit).map((range) => ({
    start: `0x${range.start.toString(16)}`,
    end: `0x${range.end.toString(16)}`,
    length: range.end - range.start,
  }));
}

function writeCue(cueFile, binFile) {
  const binName = path.basename(binFile).replace(/"/g, '\\"');
  const cue = `FILE "${binName}" BINARY\r\n  TRACK 01 MODE2/2352\r\n    INDEX 01 00:00:00\r\n`;
  fs.writeFileSync(cueFile, cue, "ascii");
}

function main() {
  const baseOriginal = readFile(baseOriginalPath);
  const targetOriginal = readFile(targetOriginalPath);
  const basePatched = readFile(basePatchedPath);

  if (baseOriginal.length !== targetOriginal.length || baseOriginal.length !== basePatched.length) {
    throw new Error(
      `size mismatch: baseOriginal=${baseOriginal.length}, targetOriginal=${targetOriginal.length}, basePatched=${basePatched.length}`
    );
  }

  const out = Buffer.from(targetOriginal);
  let patchBytes = 0;
  let targetVersionBytes = 0;
  let conflicts = 0;
  const patchRanges = [];
  const targetVersionRanges = [];
  const conflictRanges = [];

  for (let offset = 0; offset < baseOriginal.length; offset++) {
    const patchChanged = baseOriginal[offset] !== basePatched[offset];
    const targetChanged = baseOriginal[offset] !== targetOriginal[offset];

    if (targetChanged) {
      targetVersionBytes++;
      pushRange(targetVersionRanges, offset);
    }

    if (!patchChanged) continue;

    patchBytes++;
    pushRange(patchRanges, offset);

    if (targetChanged && basePatched[offset] !== targetOriginal[offset]) {
      conflicts++;
      pushRange(conflictRanges, offset);
      if (!allowConflicts) continue;
    }

    out[offset] = basePatched[offset];
  }

  if (conflicts && !allowConflicts) {
    const report = {
      ok: false,
      reason: "conflicts",
      size: baseOriginal.length,
      patchBytes,
      targetVersionBytes,
      conflicts,
      conflictRanges: summarizeRanges(conflictRanges, 64),
      baseOriginalSha256: sha256(baseOriginal),
      targetOriginalSha256: sha256(targetOriginal),
      basePatchedSha256: sha256(basePatched),
    };
    if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
    console.error(`conflict bytes: ${conflicts}`);
    console.error("first conflicts:", JSON.stringify(report.conflictRanges.slice(0, 8)));
    console.error("rerun with --allow-conflicts only if overwriting target-version differences is intended.");
    process.exit(2);
  }

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, out);
  if (cuePath) {
    fs.mkdirSync(path.dirname(path.resolve(cuePath)), { recursive: true });
    writeCue(cuePath, outPath);
  }

  const report = {
    ok: true,
    size: out.length,
    patchBytes,
    targetVersionBytes,
    conflicts,
    allowConflicts,
    patchRanges: summarizeRanges(patchRanges),
    targetVersionRanges: summarizeRanges(targetVersionRanges),
    conflictRanges: summarizeRanges(conflictRanges),
    baseOriginalSha256: sha256(baseOriginal),
    targetOriginalSha256: sha256(targetOriginal),
    basePatchedSha256: sha256(basePatched),
    outSha256: sha256(out),
    outPath,
    cuePath,
  };
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`wrote ${outPath}`);
  console.log(`size ${out.length}`);
  console.log(`patch bytes applied ${patchBytes}`);
  console.log(`target version bytes preserved ${targetVersionBytes}`);
  console.log(`conflict bytes ${conflicts}`);
  if (cuePath) console.log(`wrote ${cuePath}`);
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
