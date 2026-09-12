#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""Convert SS FS2 ending resource raw-index PGM files to/from editable PNG."""

import argparse
from pathlib import Path

from PIL import Image


RAW_SECTOR = 2352
USER_SIZE = 2048
USER_OFFSET = 16
EXE_LBA = 21
DATA_LBA = 178
TABLE_OFFSET = 0x1AE9C
EXE_BYTES = 319524
EMBEDDED_PALETTE_IDS = {0, 1, 2, 11}
SPECIAL_PALETTE = [(0, 0, 0), (128, 128, 128), (255, 255, 255)]


def read_user(fp, lba, size):
    result = bytearray(size)
    pos = 0
    while pos < size:
        sector, within = divmod(pos, USER_SIZE)
        take = min(USER_SIZE - within, size - pos)
        fp.seek((lba + sector) * RAW_SECTOR + USER_OFFSET + within)
        chunk = fp.read(take)
        if len(chunk) != take:
            raise ValueError(f"short read at LBA {lba + sector}")
        result[pos:pos + take] = chunk
        pos += take
    return bytes(result)


def resource_bytes(bin_path, resource_id):
    with open(bin_path, "rb") as fp:
        exe = read_user(fp, EXE_LBA, EXE_BYTES)
        first = int.from_bytes(exe[TABLE_OFFSET + resource_id * 2:TABLE_OFFSET + resource_id * 2 + 2], "big")
        last = int.from_bytes(exe[TABLE_OFFSET + (resource_id + 1) * 2:TABLE_OFFSET + (resource_id + 1) * 2 + 2], "big")
        if last <= first:
            raise ValueError(f"empty resource {resource_id}")
        return read_user(fp, DATA_LBA + first, (last - first) * USER_SIZE)


def read_pgm(path):
    tokens = []
    for line in Path(path).read_text(encoding="ascii").splitlines():
        tokens.extend(line.split("#", 1)[0].split())
    if not tokens or tokens.pop(0) != "P2":
        raise ValueError("expected ASCII P2 PGM")
    width, height, maximum = map(int, (tokens.pop(0), tokens.pop(0), tokens.pop(0)))
    pixels = list(map(int, tokens))
    if maximum != 255 or len(pixels) != width * height:
        raise ValueError("invalid raw-index PGM")
    return width, height, pixels


def write_pgm(path, width, height, pixels):
    lines = ["P2", "# SS FS2 ending PNG round-trip", f"{width} {height}", "255"]
    for y in range(height):
        lines.append(" ".join(map(str, pixels[y * width:(y + 1) * width])))
    Path(path).write_text("\n".join(lines) + "\n", encoding="ascii")


def rgb555(value):
    r = (value & 31) * 255 // 31
    g = ((value >> 5) & 31) * 255 // 31
    b = ((value >> 10) & 31) * 255 // 31
    return r, g, b


def palette(bin_path, resource_id):
    if resource_id not in EMBEDDED_PALETTE_IDS:
        return SPECIAL_PALETTE
    data = resource_bytes(bin_path, resource_id)
    return [rgb555(int.from_bytes(data[0x10 + i * 2:0x12 + i * 2], "big")) for i in range(256)]


def export_png(args):
    width, height, indexes = read_pgm(args.raw_pgm)
    colors = palette(args.bin, args.resource_id)
    if max(indexes, default=0) >= len(colors):
        raise ValueError(f"resource {args.resource_id}: palette index outside available colors")
    image = Image.new("RGB", (width, height))
    image.putdata([colors[index] for index in indexes])
    Path(args.output_png).parent.mkdir(parents=True, exist_ok=True)
    image.save(args.output_png)
    print(f"wrote {args.output_png} ({width}x{height})")


def import_png(args):
    width, height, original = read_pgm(args.raw_pgm)
    image = Image.open(args.edited_png).convert("RGB")
    if image.size != (width, height):
        raise ValueError(f"edited PNG is {image.size}, expected {(width, height)}")
    colors = palette(args.bin, args.resource_id)
    allowed = range(len(colors)) if args.resource_id in EMBEDDED_PALETTE_IDS else range(3)
    result = []
    changed = 0
    for old_index, rgb in zip(original, image.getdata()):
        if old_index < len(colors) and rgb == colors[old_index]:
            result.append(old_index)
            continue
        index = min(allowed, key=lambda value: sum((rgb[n] - colors[value][n]) ** 2 for n in range(3)))
        result.append(index)
        changed += index != old_index
    write_pgm(args.output_pgm, width, height, result)
    print(f"wrote {args.output_pgm}: changedPixels={changed}")


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    exp = sub.add_parser("export")
    exp.add_argument("bin")
    exp.add_argument("resource_id", type=int)
    exp.add_argument("raw_pgm")
    exp.add_argument("output_png")
    exp.set_defaults(func=export_png)
    imp = sub.add_parser("import")
    imp.add_argument("bin")
    imp.add_argument("resource_id", type=int)
    imp.add_argument("raw_pgm")
    imp.add_argument("edited_png")
    imp.add_argument("output_pgm")
    imp.set_defaults(func=import_png)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
