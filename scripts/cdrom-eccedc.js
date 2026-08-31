// CD-ROM Mode 1 and XA Mode 2 Form 1 EDC/ECC recompute -- same algorithm structure as
// the well-known public-domain reference implementations (Neill Corlett's
// ECM tool, cdrdao's eccedc.c). See references/platforms/ps1.md and
// references/strategy/build-and-verify.md's "CD 매체의 EDC/ECC" section:
// any sector whose user data is edited in place must have its EDC/ECC
// recomputed, or strict emulator cores / real hardware / ODEs will refuse to
// read it (loose emulators only read the 2048-byte user data and don't
// check, which is why a bad build can look fine there and still fail
// elsewhere).
//
// Validated (see scripts/fix-bin-edc-ecc.js's --self-test) by recomputing
// every Mode 2 Form 1 sector on the untouched original disc and confirming
// the result matches the disc's own stored EDC/ECC bytes exactly.

const EDC_TABLE = new Uint32Array(256);
const ECC_F_LUT = new Uint8Array(256);
const ECC_B_LUT = new Uint8Array(256);

for (let i = 0; i < 256; i++) {
  let edc = i;
  for (let j = 0; j < 8; j++) {
    edc = (edc & 1) ? ((edc >>> 1) ^ 0xd8018001) : (edc >>> 1);
  }
  EDC_TABLE[i] = edc >>> 0;

  const j = (i << 1) ^ (i & 0x80 ? 0x11d : 0);
  ECC_F_LUT[i] = j & 0xff;
  ECC_B_LUT[(i ^ j) & 0xff] = i;
}

function computeEdc(buf, offset, size) {
  let edc = 0;
  for (let i = 0; i < size; i++) {
    edc = (edc >>> 8) ^ EDC_TABLE[(edc ^ buf[offset + i]) & 0xff];
  }
  return edc >>> 0;
}

// address: 4 bytes (Mode 2 Form 1 always uses a zeroed pseudo-address here,
// which is why its sectors can be freely relocated without breaking ECC).
// data: subheader(8) + userdata(2048) + edc(4) = 2060 bytes for the P pass;
// the Q pass additionally covers the just-computed P parity (see below).
function eccWritePQ(address, data, majorCount, minorCount, majorMult, minorInc, ecc, eccOff) {
  const size = majorCount * minorCount;
  for (let major = 0; major < majorCount; major++) {
    let index = ((major >> 1) * majorMult + (major & 1)) % size;
    let eccA = 0;
    let eccB = 0;
    for (let minor = 0; minor < minorCount; minor++) {
      const temp = index < 4 ? address[index] : data[index - 4];
      index += minorInc;
      if (index >= size) index -= size;
      eccA ^= temp;
      eccB ^= temp;
      eccA = ECC_F_LUT[eccA];
    }
    eccA = ECC_B_LUT[ECC_F_LUT[eccA] ^ eccB];
    ecc[eccOff + major] = eccA;
    ecc[eccOff + major + majorCount] = eccA ^ eccB;
  }
}

// data: 2060 bytes (subheader(8) + userdata(2048) + edc(4))
function computeEccPQ(address, data) {
  const ecc = Buffer.alloc(172 + 104);
  eccWritePQ(address, data, 86, 24, 2, 86, ecc, 0); // P parity, covers address+data (2064 bytes)

  // Q parity covers address + data + the just-computed P parity (2236 bytes total)
  const qData = Buffer.alloc(2060 + 172);
  data.copy(qData, 0);
  ecc.copy(qData, 2060, 0, 172);
  eccWritePQ(address, qData, 52, 43, 86, 88, ecc, 172);
  return ecc;
}

const ZERO_ADDRESS = Buffer.from([0, 0, 0, 0]);

function isMode2Form1(sector) {
  if (sector[15] !== 2) return false; // mode byte
  return (sector[18] & 0x20) === 0; // submode form2 bit
}

function isMode1(sector) {
  return sector.length >= 2352 && sector[15] === 1;
}

// Recomputes a raw CD-ROM Mode 1 sector in place. Layout:
// sync+header 0..15, user data 16..2063, EDC 2064..2067,
// reserved zeroes 2068..2075, ECC P/Q 2076..2351.
function recomputeMode1Sector(sector) {
  const edc = computeEdc(sector, 0, 2064);
  sector.writeUInt32LE(edc, 2064);
  sector.fill(0, 2068, 2076);

  const address = Buffer.from(sector.subarray(12, 16));
  const data = Buffer.from(sector.subarray(16, 2076));
  const ecc = computeEccPQ(address, data);
  ecc.copy(sector, 2076);
  return sector;
}

// Recomputes EDC (offset 2072..2075) and ECC (offset 2076..2351) in place
// for a Mode 2 Form 1 sector buffer (2352 bytes: sync+header 0..15,
// subheader 16..23, user data 24..2071).
function recomputeMode2Form1Sector(sector) {
  const edc = computeEdc(sector, 16, 8 + 2048);
  sector.writeUInt32LE(edc, 2072);

  const data = Buffer.alloc(2060);
  sector.copy(data, 0, 16, 16 + 8 + 2048 + 4); // subheader+userdata+edc(freshly written)
  const ecc = computeEccPQ(ZERO_ADDRESS, data);
  ecc.copy(sector, 2076);
  return sector;
}

module.exports = {
  computeEdc, computeEccPQ,
  recomputeMode1Sector, recomputeMode2Form1Sector,
  isMode1, isMode2Form1, ZERO_ADDRESS
};
