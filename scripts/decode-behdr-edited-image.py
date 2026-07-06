#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Inverse of colorize-behdr-pgm.py: takes the ORIGINAL raw-index PGM (e.g. a
04-1-after-unpack.pgm debug dump, which is just vanilla's own unpacked
pixels) and a PNG you hand-edited on top of colorize-behdr-pgm.py's rendering
of that same PGM, and reconstructs a full raw-index PGM:

  - any pixel whose color is UNCHANGED from the original's rendering keeps the
    EXACT original palette index (perfect fidelity -- this is the vast
    majority of the image, since you only touched the ink strokes)
  - any pixel you painted pink (the "outline ink" legend color) becomes
    --outline-index; any pixel you painted white (the "fill ink" legend
    color) becomes --fill-index. Every glyph is two layers -- a slightly
    wider outline stroke (index 1) with the fill (index 2) drawn on top --
    so when replacing a character you need to paint BOTH: erase the old
    character's outline+fill fully, then draw the new character's outline
    AND fill. Painting only fill leaves the old outline's shape behind.
  - any pixel you painted a different legend color (black/green/blue/red/
    orange/gray) is resolved by finding the nearest pixel in the ORIGINAL
    image that already rendered as that same category, and copying its exact
    value -- this correctly recovers e.g. "whatever red gradient shade this
    row actually uses" instead of guessing a single flat replacement index

Run scripts/be-hdr-ui-tile-tool.js pack-raw on the resulting PGM to apply it
directly, with no erase/heal passes at all.

Image editors routinely re-touch pixels outside the area you actually drew on
(recompression, color management, a "flatten" step). Always pass
--only-regions covering exactly what you meant to edit -- any change outside
it is dropped unconditionally, and unlike a pixel-size/connectivity
heuristic, this can't accidentally eat real edits (erasing old ink naturally
produces small, thin, disconnected patches that look identical to noise by
size alone, so --min-component-size defaults to 1/off).

usage: python scripts/decode-behdr-edited-image.py <original.pgm> <edited.png> <out.pgm>
       [--outline-index N] [--fill-index N] [--only-regions x,y,w,h[;x,y,w,h...]]
       [--min-component-size N]
"""

import sys
from pathlib import Path

from PIL import Image

CATEGORIES = {
    "black": (0, 0, 0),
    "outline": (255, 90, 180),
    "white": (255, 255, 255),
    "green": (0, 255, 0),
    "blue": (60, 90, 200),
    "red": (200, 30, 30),
    "orange": (255, 190, 80),
    "gray": (120, 120, 120),
}
TRIM_VALUES = {5, 6, 7, 8, 9, 14, 18, 24, 68}
DEFAULT_FOR_CATEGORY = {"black": 0, "green": 3, "blue": 4, "red": 224, "orange": 8, "gray": 120}


def colorize(v):
    if v == 0:
        return CATEGORIES["black"]
    if v == 1:
        return CATEGORIES["outline"]
    if v == 2:
        return CATEGORIES["white"]
    if v == 3:
        return CATEGORIES["green"]
    if v == 4:
        return CATEGORIES["blue"]
    if 224 <= v <= 232:
        return CATEGORIES["red"]
    if v in TRIM_VALUES:
        return CATEGORIES["orange"]
    return CATEGORIES["gray"]


def category_of(v):
    color = colorize(v)
    for name, c in CATEGORIES.items():
        if c == color:
            return name
    return "gray"


def nearest_category_name(rgb):
    best_name, best_dist = None, None
    for name, c in CATEGORIES.items():
        dist = sum((a - b) ** 2 for a, b in zip(rgb, c))
        if best_dist is None or dist < best_dist:
            best_name, best_dist = name, dist
    return best_name


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


def write_pgm(path, width, height, pixels):
    lines = ["P2", f"# decoded from hand-edited image", f"{width} {height}", "255"]
    for y in range(height):
        row = pixels[y * width : (y + 1) * width]
        lines.append(" ".join(str(v) for v in row))
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="ascii", newline="\n") as f:
        f.write("\n".join(lines) + "\n")


def filter_noise_components(changed_mask, width, height, min_size):
    """
    Image editors routinely re-touch pixels you never intended to change
    (recompression, color management, a "flatten" step) scattered as
    isolated 1-2px flips across the WHOLE canvas, not just where you drew.
    Treating every such flip as an intentional edit corrupts untouched text
    elsewhere. Real edits (drawn strokes) form sizeable connected blobs;
    incidental noise doesn't. Keep only components >= min_size.
    """
    n = width * height
    visited = bytearray(n)
    kept = bytearray(n)
    for start in range(n):
        if not changed_mask[start] or visited[start]:
            continue
        stack = [start]
        visited[start] = 1
        component = [start]
        while stack:
            pos = stack.pop()
            x, y = pos % width, pos // width
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                xx, yy = x + dx, y + dy
                if 0 <= xx < width and 0 <= yy < height:
                    npos = yy * width + xx
                    if changed_mask[npos] and not visited[npos]:
                        visited[npos] = 1
                        stack.append(npos)
                        component.append(npos)
        if len(component) >= min_size:
            for pos in component:
                kept[pos] = 1
    return kept


def find_nearest_of_category(original, width, height, x, y, category_name, max_radius=400):
    for radius in range(1, max_radius + 1):
        for dx in (-radius, radius):
            xx = x + dx
            if 0 <= xx < width and category_of(original[y * width + xx]) == category_name:
                return original[y * width + xx]
        for dy in (-radius, radius):
            yy = y + dy
            if 0 <= yy < height and category_of(original[yy * width + x]) == category_name:
                return original[yy * width + x]
    return None


def main(argv):
    if len(argv) < 4:
        print(__doc__, file=sys.stderr)
        raise SystemExit(2)
    original_path, edited_path, out_path = argv[1], argv[2], argv[3]
    outline_index = 1
    fill_index = 2
    # Off by default: erasing old ink naturally creates small, thin, disconnected
    # blobs (the shape of the erased strokes), which this heuristic can't tell
    # apart from incidental single-pixel editor noise. --only-regions is the
    # precise, reliable way to reject noise outside your intended edit; only
    # raise this above 1 if you've confirmed your tool scatters noise INSIDE
    # your edited region too and it's worth the risk of eating real edits.
    min_component_size = 1
    only_regions_text = ""
    protect_regions_text = ""
    for i in range(4, len(argv)):
        if argv[i] == "--outline-index":
            outline_index = int(argv[i + 1])
        elif argv[i] == "--fill-index":
            fill_index = int(argv[i + 1])
        elif argv[i] == "--min-component-size":
            min_component_size = int(argv[i + 1])
        elif argv[i] == "--only-regions":
            only_regions_text = argv[i + 1]
        elif argv[i] == "--protect-regions":
            protect_regions_text = argv[i + 1]

    width, height, original = read_pgm(original_path)
    edited = Image.open(edited_path).convert("RGB")
    if edited.size != (width, height):
        raise ValueError(f"{edited_path} is {edited.size}, expected {(width, height)}")
    edited_pixels = list(edited.getdata())

    changed_mask = bytearray(1 if edited_rgb != colorize(orig_value) else 0 for orig_value, edited_rgb in zip(original, edited_pixels))

    outside_ignored = 0
    if only_regions_text:
        regions = []
        for part in only_regions_text.split(";"):
            x, y, rw, rh = (int(v) for v in part.split(","))
            regions.append((x, y, x + rw, y + rh))
        for i in range(width * height):
            if not changed_mask[i]:
                continue
            x, y = i % width, i // width
            if not any(x0 <= x < x1 and y0 <= y < y1 for x0, y0, x1, y1 in regions):
                changed_mask[i] = 0
                outside_ignored += 1

    protected_ignored = 0
    if protect_regions_text:
        pregions = []
        for part in protect_regions_text.split(";"):
            x, y, rw, rh = (int(v) for v in part.split(","))
            pregions.append((x, y, x + rw, y + rh))
        for i in range(width * height):
            if not changed_mask[i]:
                continue
            x, y = i % width, i // width
            if any(x0 <= x < x1 and y0 <= y < y1 for x0, y0, x1, y1 in pregions):
                changed_mask[i] = 0
                protected_ignored += 1

    after_region_filter = sum(changed_mask)
    kept_mask = filter_noise_components(changed_mask, width, height, min_component_size)
    kept_changed = sum(kept_mask)
    ignored_as_noise = after_region_filter - kept_changed

    result = list(original)
    resolved_by_default = 0
    for i in range(len(original)):
        if not kept_mask[i]:
            continue
        nearest = nearest_category_name(edited_pixels[i])
        if nearest == "outline":
            result[i] = outline_index
            continue
        if nearest == "white":
            result[i] = fill_index
            continue
        x, y = i % width, i // width
        found = find_nearest_of_category(original, width, height, x, y, nearest)
        if found is None:
            found = DEFAULT_FOR_CATEGORY[nearest]
            resolved_by_default += 1
        result[i] = found

    write_pgm(out_path, width, height, result)
    print(
        f"wrote {out_path}: {kept_changed} pixels changed ({outside_ignored} outside --only-regions, "
        f"{protected_ignored} inside --protect-regions, {ignored_as_noise} isolated pixel(s) ignored as "
        f"editor noise, {resolved_by_default} used a default fallback value)"
    )


if __name__ == "__main__":
    main(sys.argv)
