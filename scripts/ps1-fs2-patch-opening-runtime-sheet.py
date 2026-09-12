#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Patch the unpacked Lulu/Sophia profile copies in PS1 resource 306.

usage: python scripts/ps1-fs2-patch-opening-runtime-sheet.py \
  <input.dat> <SLPS_019.03> <pgm-dir> <output.dat>
"""

import shutil
import sys
from pathlib import Path


RESOURCE_ID = 306
PLACEMENTS = {268: 0x480, 269: 0x520}
ROW_STRIDE = 0x400
WIDTH = 160
HEIGHT = 240


def read_p2(path):
    tokens = []
    for line in Path(path).read_text(encoding="ascii").splitlines():
        tokens.extend(line.split("#", 1)[0].split())
    if not tokens or tokens.pop(0) != "P2":
        raise ValueError(f"{path} is not a P2 PGM")
    width, height, maximum = map(int, (tokens.pop(0), tokens.pop(0), tokens.pop(0)))
    pixels = bytes(map(int, tokens))
    if (width, height, maximum, len(pixels)) != (WIDTH, HEIGHT, 255, WIDTH * HEIGHT):
        raise ValueError(f"{path}: expected P2 {WIDTH}x{HEIGHT} maxval 255")
    return pixels


def main(argv):
    if len(argv) != 5:
        print(__doc__, file=sys.stderr); raise SystemExit(2)
    input_dat, exe_path, pgm_dir, output_dat = map(Path, argv[1:])
    dat = bytearray(input_dat.read_bytes())
    exe = exe_path.read_bytes()
    load_address = int.from_bytes(exe[0x18:0x1C], "little")
    table = 0x801C4F68 - load_address + 0x800
    start_sector = int.from_bytes(exe[table + RESOURCE_ID * 2:table + RESOURCE_ID * 2 + 2], "little")
    end_sector = int.from_bytes(exe[table + (RESOURCE_ID + 1) * 2:table + (RESOURCE_ID + 1) * 2 + 2], "little")
    base, end = start_sector * 0x800, end_sector * 0x800
    if end - base < 0x40800:
        raise ValueError(f"resource 306 is unexpectedly small: {end - base:#x}")

    for resource_id, relative in PLACEMENTS.items():
        pixels = read_p2(pgm_dir / f"be-hdr-ui-{resource_id}-windows-ko.pgm")
        last = base + relative + (HEIGHT - 1) * ROW_STRIDE + WIDTH
        if last > end:
            raise ValueError(f"resource {resource_id} runtime placement exceeds resource 306")
        for y in range(HEIGHT):
            source = y * WIDTH
            target = base + relative + y * ROW_STRIDE
            dat[target:target + WIDTH] = pixels[source:source + WIDTH]
        print(f"{resource_id}: patched resource 306 +{relative:#x}, {WIDTH}x{HEIGHT}, stride {ROW_STRIDE:#x}")

    output_dat.parent.mkdir(parents=True, exist_ok=True)
    output_dat.write_bytes(dat)
    print(f"wrote {output_dat}")


if __name__ == "__main__":
    main(sys.argv)
