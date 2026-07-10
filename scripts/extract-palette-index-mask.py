#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Extract a single palette index out of a raw 8bpp palette-index PGM (the kind
written by `node scripts/be-hdr-ui-tile-tool.js dump-raw`) as a plain black/
white PNG: white wherever that pixel's index matches, black everywhere else.

Useful on its own to eyeball exactly which pixels a given index covers (e.g.
index 1, the outline-ink index used throughout the be-hdr UI workflow), and
its output is a ready-made mask for scripts/mask-subtract-image.py.

usage: python scripts/extract-palette-index-mask.py <raw.pgm> <out.png> [--index N]
"""

import sys
from pathlib import Path

from PIL import Image


def read_pgm(path):
    tokens = []
    with open(path, "r", encoding="ascii") as f:
        for line in f:
            line = line.split("#", 1)[0].strip()
            if line:
                tokens.extend(line.split())
    if tokens.pop(0) != "P2":
        raise ValueError(f"{path} is not an ASCII P2 PGM")
    width = int(tokens.pop(0))
    height = int(tokens.pop(0))
    tokens.pop(0)  # maxval
    pixels = [int(t) for t in tokens]
    return width, height, pixels


def main(argv):
    if len(argv) < 3:
        print(__doc__, file=sys.stderr)
        raise SystemExit(2)
    raw_pgm_path, out_path = argv[1], argv[2]
    index = 1
    for i in range(3, len(argv)):
        if argv[i] == "--index":
            index = int(argv[i + 1])

    width, height, pixels = read_pgm(raw_pgm_path)
    out = Image.new("L", (width, height))
    out.putdata([255 if v == index else 0 for v in pixels])
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    out.convert("RGB").save(out_path)
    matched = sum(1 for v in pixels if v == index)
    print(f"wrote {out_path}: {matched}/{len(pixels)} pixel(s) matched index {index}")


if __name__ == "__main__":
    main(sys.argv)
