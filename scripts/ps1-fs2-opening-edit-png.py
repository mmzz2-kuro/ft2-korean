#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Convert a hand-edited grayscale PNG back to a PS1 raw-index PGM.

usage: python scripts/ps1-fs2-opening-edit-png.py <reference.pgm> <edited.png> <output.pgm>
       [--background background.pgm] [--ink-threshold 176]
"""

import sys
from collections import Counter
from pathlib import Path

from PIL import Image


def read_p2(path):
    tokens = []
    for line in Path(path).read_text(encoding="ascii").splitlines():
        tokens.extend(line.split("#", 1)[0].split())
    if not tokens or tokens.pop(0) != "P2":
        raise ValueError(f"{path} is not a P2 PGM")
    width, height, maximum = map(int, (tokens.pop(0), tokens.pop(0), tokens.pop(0)))
    pixels = list(map(int, tokens))
    if maximum != 255 or len(pixels) != width * height:
        raise ValueError(f"invalid PGM: {path}")
    return width, height, pixels


def write_p2(path, width, height, pixels):
    lines = ["P2", "# imported from a hand-edited opening profile PNG", f"{width} {height}", "255"]
    for y in range(height):
        lines.append(" ".join(map(str, pixels[y * width:(y + 1) * width])))
    Path(path).write_text("\n".join(lines) + "\n", encoding="ascii", newline="\n")


def fit_tiles(pixels, width, height, budget, protected_y=152):
    columns = width // 8
    changes = []
    while True:
        tiles = [tuple(pixels[(ty * 8 + y) * width + tx * 8 + x] for y in range(8) for x in range(8))
                 for ty in range(height // 8) for tx in range(columns)]
        counts = Counter(tiles)
        if len(counts) <= budget:
            return changes
        patterns = list(counts)
        candidates = []
        for pos, tile in enumerate(tiles):
            tx, ty = pos % columns, pos // columns
            if ty * 8 < protected_y or counts[tile] != 1:
                continue
            distance, replacement = min((sum(a != b for a, b in zip(tile, other)), other)
                                        for other in patterns if other != tile)
            candidates.append((distance, ty, tx, replacement))
        if not candidates:
            raise ValueError(f"cannot reduce {len(counts)} unique tiles to {budget} outside the text area")
        distance, ty, tx, replacement = min(candidates)
        for y in range(8):
            for x in range(8):
                pixels[(ty * 8 + y) * width + tx * 8 + x] = replacement[y * 8 + x]
        changes.append((tx * 8, ty * 8, distance))


def main(argv):
    if len(argv) < 4:
        print(__doc__, file=sys.stderr); raise SystemExit(2)
    reference, edited, output = map(Path, argv[1:4])
    background_path = None
    ink_threshold = 176
    tile_budget = None
    i = 4
    while i < len(argv):
        if argv[i] == "--background":
            background_path = Path(argv[i + 1]); i += 2
        elif argv[i] == "--ink-threshold":
            ink_threshold = int(argv[i + 1]); i += 2
        elif argv[i] == "--tile-budget":
            tile_budget = int(argv[i + 1]); i += 2
        else:
            raise ValueError(f"unknown option: {argv[i]}")
    width, height, reference_pixels = read_p2(reference)
    image = Image.open(edited).convert("L")
    if image.size != (width, height):
        raise ValueError(f"{edited}: expected {width}x{height}, got {image.size[0]}x{image.size[1]}")
    palette_values = sorted(set(reference_pixels))
    if background_path:
        bw, bh, background = read_p2(background_path)
        if (bw, bh) != (width, height):
            raise ValueError(f"{background_path}: background dimensions differ")
        ink_index = min(palette_values)
        mapped = [
            ink_index if gray <= ink_threshold and gray + 32 < base else base
            for gray, base in zip(image.getdata(), background)
        ]
    else:
        mapped = [min(palette_values, key=lambda value: abs(value - gray)) for gray in image.getdata()]
    changes = fit_tiles(mapped, width, height, tile_budget) if tile_budget else []
    write_p2(output, width, height, mapped)
    print(f"imported {edited} -> {output}; palette values={palette_values}; tile_budget_changes={changes}")


if __name__ == "__main__":
    main(sys.argv)
