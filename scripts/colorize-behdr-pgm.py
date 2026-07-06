#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Renders a P2 (ASCII) PGM raw 8bpp-palette-index dump (as produced by
be-hdr-ui-tile-tool.js dump-raw / --debug-dump-dir) into a viewable color PNG,
using a fixed, documented legend instead of the resource's real in-game CLUT
(which this toolchain does not decode). This is for debugging pixel *identity*
(is this pixel ink? gradient-family? a border-trim marker? an erase remnant?)
-- not for judging final in-game color accuracy.

usage: python scripts/colorize-behdr-pgm.py <in.pgm> <out.png> [scale]
       python scripts/colorize-behdr-pgm.py batch <dir> <id1,id2,...>
         reads <dir>/be-hdr-ui-<id>-raw.pgm and writes <dir>/be-hdr-ui-<id>.png
         for each id (matches be-hdr-ui-tile-tool.js dump-raw's naming), so it
         can drop straight into a workflow's existing editable_png path.
"""

import sys
from pathlib import Path

from PIL import Image

LEGEND = {
    "black (0)": (0, 0, 0),
    "pink: text OUTLINE ink (1)": (255, 90, 180),
    "white: text FILL ink (2)": (255, 255, 255),
    "green: erase remnant / stray unfixed pixel (3)": (0, 255, 0),
    "blue: normal background (4)": (60, 90, 200),
    "red: animated glow-gradient family (224-232)": (200, 30, 30),
    "orange: border/frame trim marker (5,6,7,8,9,14,18,24,68)": (255, 190, 80),
    "gray: anything else (unexpected index)": (120, 120, 120),
}

# Every glyph (Japanese source AND your Korean replacement) is drawn as TWO
# layers: index 1 is a slightly wider OUTLINE stroke, index 2 is the FILL on
# top of it. They render almost identically once packed (both end up light),
# which is why an earlier version of this legend collapsed them into one
# "white ink" color -- that hid the outline layer, so edits only touched the
# fill and left the OLD character's outline shape behind. Keep them visually
# distinct here so both layers get edited together.
TRIM_VALUES = {5, 6, 7, 8, 9, 14, 18, 24, 68}


def colorize(v):
    if v == 0:
        return (0, 0, 0)
    if v == 1:
        return (255, 90, 180)
    if v == 2:
        return (255, 255, 255)
    if v == 3:
        return (0, 255, 0)
    if v == 4:
        return (60, 90, 200)
    if 224 <= v <= 232:
        return (200, 30, 30)
    if v in TRIM_VALUES:
        return (255, 190, 80)
    return (120, 120, 120)


def read_pgm(path):
    with open(path, "r", encoding="ascii") as f:
        tokens = []
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


def colorize_one(in_path, out_path, scale=1):
    width, height, pixels = read_pgm(in_path)
    image = Image.new("RGB", (width, height))
    image.putdata([colorize(v) for v in pixels])
    if scale > 1:
        image = image.resize((width * scale, height * scale), Image.NEAREST)
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    image.save(out_path)
    print(f"wrote {out_path} ({width}x{height}, scale {scale})")


def main(argv):
    if len(argv) < 3:
        print("usage: python scripts/colorize-behdr-pgm.py <in.pgm> <out.png> [scale]", file=sys.stderr)
        raise SystemExit(2)
    if argv[1] == "batch":
        if len(argv) < 4:
            print("usage: python scripts/colorize-behdr-pgm.py batch <dir> <id1,id2,...>", file=sys.stderr)
            raise SystemExit(2)
        directory, ids_text = Path(argv[2]), argv[3]
        for resource_id in (part.strip() for part in ids_text.split(",") if part.strip()):
            colorize_one(
                directory / f"be-hdr-ui-{resource_id}-raw.pgm",
                directory / f"be-hdr-ui-{resource_id}.png",
            )
        return
    in_path, out_path = argv[1], argv[2]
    scale = int(argv[3]) if len(argv) > 3 else 1
    colorize_one(in_path, out_path, scale)


if __name__ == "__main__":
    main(sys.argv)
