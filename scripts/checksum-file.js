#!/usr/bin/env node

const fs = require("fs");
const crypto = require("crypto");

const paths = process.argv.slice(2);

if (paths.length === 0) {
  console.error("usage: node scripts/checksum-file.js <file...>");
  process.exit(2);
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function md5(buf) {
  return crypto.createHash("md5").update(buf).digest("hex");
}

function sha1(buf) {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

let hadError = false;

for (const filePath of paths) {
  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch (err) {
    console.error(`${filePath}: ${err.message}`);
    hadError = true;
    continue;
  }

  const crc = crc32(buf).toString(16).padStart(8, "0").toUpperCase();
  const md = md5(buf);
  const sha = sha1(buf);

  console.log(filePath);
  console.log(`  size:  ${buf.length} bytes`);
  console.log(`  CRC32: ${crc}`);
  console.log(`  MD5:   ${md}`);
  console.log(`  SHA-1: ${sha}`);
}

if (hadError) process.exit(1);
