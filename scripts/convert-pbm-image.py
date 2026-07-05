#!/usr/bin/env python
# -*- coding: utf-8 -*-

import sys
from pathlib import Path

from PIL import Image


def usage():
    print(
        "usage:\n"
        "  python scripts/convert-pbm-image.py pbm-to-png <in.pbm> <out.png>\n"
        "  python scripts/convert-pbm-image.py png-to-pbm <in.png> <out.pbm> [threshold] [black-on-white|white-on-dark|dark-region]\n"
        "  python scripts/convert-pbm-image.py clip-pbm <in.pbm> <out.pbm> <x,y,w,h[;x,y,w,h...]> [fill]\n"
        "  python scripts/convert-pbm-image.py diff-regions <source.png> <replacement.png> [threshold] [tile]",
        file=sys.stderr,
    )
    raise SystemExit(2)


def read_pbm(path):
    tokens = []
    with open(path, "r", encoding="ascii") as f:
        for line in f:
            line = line.split("#", 1)[0].strip()
            if line:
                tokens.extend(line.split())
    if not tokens or tokens.pop(0) != "P1":
        raise ValueError(f"{path} is not an ASCII PBM P1 file")
    width = int(tokens.pop(0))
    height = int(tokens.pop(0))
    if len(tokens) < width * height:
        raise ValueError(f"{path} has {len(tokens)} pixels, expected {width * height}")
    pixels = [1 if tokens[i] == "1" else 0 for i in range(width * height)]
    return width, height, pixels


def write_pbm(path, width, height, pixels):
    with open(path, "w", encoding="ascii", newline="\n") as f:
        f.write("P1\n")
        f.write(f"{width} {height}\n")
        for y in range(height):
            row = pixels[y * width : (y + 1) * width]
            f.write(" ".join("1" if v else "0" for v in row))
            f.write("\n")


def pbm_to_png(in_path, out_path):
    width, height, pixels = read_pbm(in_path)
    image = Image.new("L", (width, height), 255)
    image.putdata([0 if p else 255 for p in pixels])
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    image.save(out_path)


def has_dark_on_both_sides(values, width, height, x, y, threshold, radius=4):
    left = any(values[y * width + xx] < threshold for xx in range(max(0, x - radius), x))
    right = any(values[y * width + xx] < threshold for xx in range(x + 1, min(width, x + radius + 1)))
    up = any(values[yy * width + x] < threshold for yy in range(max(0, y - radius), y))
    down = any(values[yy * width + x] < threshold for yy in range(y + 1, min(height, y + radius + 1)))
    return (left and right) or (up and down)


def png_to_pbm(in_path, out_path, threshold, png_mode):
    image = Image.open(in_path).convert("L")
    width, height = image.size
    values = list(image.tobytes())
    if png_mode == "black-on-white":
        pixels = [1 if value < threshold else 0 for value in values]
    elif png_mode == "white-on-dark":
        bright = 255 - threshold
        pixels = [
            0 if values[y * width + x] > bright and has_dark_on_both_sides(values, width, height, x, y, threshold) else 1
            for y in range(height)
            for x in range(width)
        ]
    elif png_mode == "dark-region":
        pixels = [1 if value < threshold else 0 for value in values]
    else:
        raise ValueError(f"unknown png mode: {png_mode}")
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    write_pbm(out_path, width, height, pixels)


def parse_regions(text):
    regions = []
    for part in (text or "").split(";"):
        item = part.strip()
        if not item:
            continue
        values = [int(value.strip(), 0) for value in item.split(",")]
        if len(values) != 4:
            raise ValueError(f"invalid region '{item}', expected x,y,w,h")
        x, y, w, h = values
        if w <= 0 or h <= 0:
            raise ValueError(f"invalid region '{item}', width/height must be positive")
        regions.append((x, y, x + w, y + h))
    if not regions:
        raise ValueError("at least one clip region is required")
    return regions


def clip_pbm(in_path, out_path, region_text, fill=0):
    width, height, pixels = read_pbm(in_path)
    regions = parse_regions(region_text)
    clipped = [fill] * (width * height)
    for y in range(height):
        for x in range(width):
            if any(x0 <= x < x1 and y0 <= y < y1 for x0, y0, x1, y1 in regions):
                clipped[y * width + x] = pixels[y * width + x]
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    write_pbm(out_path, width, height, clipped)


def diff_regions(source_path, replacement_path, threshold=16, tile=8):
    source = Image.open(source_path).convert("L")
    replacement = Image.open(replacement_path).convert("L")
    if source.size != replacement.size:
        raise ValueError(f"image sizes differ: {source.size} vs {replacement.size}")
    width, height = source.size
    source_values = list(source.tobytes())
    replacement_values = list(replacement.tobytes())
    changed_tiles = set()
    for y in range(height):
        row = y * width
        for x in range(width):
            if abs(source_values[row + x] - replacement_values[row + x]) > threshold:
                changed_tiles.add((x // tile, y // tile))

    if not changed_tiles:
        return ""

    max_tx = (width + tile - 1) // tile
    max_ty = (height + tile - 1) // tile
    row_runs = []
    for ty in range(max_ty):
        tx = 0
        while tx < max_tx:
            if (tx, ty) not in changed_tiles:
                tx += 1
                continue
            start = tx
            while tx < max_tx and (tx, ty) in changed_tiles:
                tx += 1
            row_runs.append([start, ty, tx, ty + 1])

    merged = []
    for run in row_runs:
        match = next(
            (
                region
                for region in merged
                if region[0] == run[0] and region[2] == run[2] and region[3] == run[1]
            ),
            None,
        )
        if match is None:
            merged.append(run)
        else:
            match[3] = run[3]

    regions = []
    for x0, y0, x1, y1 in merged:
        px0 = x0 * tile
        py0 = y0 * tile
        px1 = min(width, x1 * tile)
        py1 = min(height, y1 * tile)
        regions.append(f"{px0},{py0},{px1 - px0},{py1 - py0}")
    return ";".join(regions)


def main(argv):
    if len(argv) < 4:
        usage()
    mode, in_path, out_path = argv[1:4]
    if mode == "pbm-to-png":
        pbm_to_png(in_path, out_path)
    elif mode == "png-to-pbm":
        threshold = int(argv[4]) if len(argv) > 4 else 128
        png_mode = argv[5] if len(argv) > 5 else "black-on-white"
        png_to_pbm(in_path, out_path, threshold, png_mode)
    elif mode == "clip-pbm":
        if len(argv) < 5:
            usage()
        fill = int(argv[5]) if len(argv) > 5 else 0
        if fill not in (0, 1):
            raise ValueError("clip-pbm fill must be 0 or 1")
        clip_pbm(in_path, out_path, argv[4], fill)
    elif mode == "diff-regions":
        threshold = int(argv[4]) if len(argv) > 4 else 16
        tile = int(argv[5]) if len(argv) > 5 else 8
        print(diff_regions(in_path, out_path, threshold, tile))
        return
    else:
        usage()
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main(sys.argv)
