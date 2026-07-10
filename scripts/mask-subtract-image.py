#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Wherever image B is white, blacken that same pixel position in image A.

A and B must be the same size. Every other pixel in A is copied through
unchanged. Think of B as a mask: its white pixels mark positions to erase
(to black) in A.

usage: python scripts/mask-subtract-image.py <a.png> <b.png> <out.png>
       [--white-threshold N]

--white-threshold N (default 250): a B pixel counts as "white" when every
channel is >= N (0-255).
"""

import sys
from pathlib import Path

from PIL import Image


def main(argv):
    if len(argv) < 4:
        print(__doc__, file=sys.stderr)
        raise SystemExit(2)
    a_path, b_path, out_path = argv[1], argv[2], argv[3]
    white_threshold = 250
    for i in range(4, len(argv)):
        if argv[i] == "--white-threshold":
            white_threshold = int(argv[i + 1])

    a = Image.open(a_path).convert("RGB")
    b = Image.open(b_path).convert("RGB")
    if a.size != b.size:
        raise ValueError(f"{a_path} is {a.size} but {b_path} is {b.size}; sizes must match")

    width, height = a.size
    a_pixels = list(a.getdata())
    b_pixels = list(b.getdata())

    result = list(a_pixels)
    blackened = 0
    for i in range(width * height):
        r, g, bch = b_pixels[i]
        if r >= white_threshold and g >= white_threshold and bch >= white_threshold:
            result[i] = (0, 0, 0)
            blackened += 1

    out = Image.new("RGB", (width, height))
    out.putdata(result)
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    out.save(out_path)
    print(f"wrote {out_path}: {blackened} pixel(s) blackened (white in {Path(b_path).name})")


if __name__ == "__main__":
    main(sys.argv)
