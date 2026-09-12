#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""Convert PS1 FS2 ending-resource raw-index PGM files to/from editable PNG."""

import argparse
from pathlib import Path

from PIL import Image


EMBEDDED_PALETTE_IDS = {0, 1, 2, 11}
SPECIAL_PALETTE = [(0, 0, 0), (128, 128, 128), (255, 255, 255)]


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
    lines = ["P2", "# PS1 FS2 ending PNG round-trip", f"{width} {height}", "255"]
    for y in range(height):
        lines.append(" ".join(map(str, pixels[y * width:(y + 1) * width])))
    Path(path).write_text("\n".join(lines) + "\n", encoding="ascii")


def rgb555(value):
    return ((value & 31) * 255 // 31,
            ((value >> 5) & 31) * 255 // 31,
            ((value >> 10) & 31) * 255 // 31)


def resource_span(exe_path, resource_id):
    exe = Path(exe_path).read_bytes()
    load = int.from_bytes(exe[0x18:0x1C], "little")
    table = 0x801C4F68 - load + 0x800
    first = int.from_bytes(exe[table + resource_id * 2:table + resource_id * 2 + 2], "little")
    last = int.from_bytes(exe[table + (resource_id + 1) * 2:table + (resource_id + 1) * 2 + 2], "little")
    if last <= first:
        raise ValueError(f"empty resource {resource_id}")
    return first * 2048, last * 2048


def palette(dat_path, exe_path, resource_id):
    if resource_id not in EMBEDDED_PALETTE_IDS:
        return SPECIAL_PALETTE
    first, last = resource_span(exe_path, resource_id)
    data = Path(dat_path).read_bytes()[first:last]
    return [rgb555(int.from_bytes(data[0x10 + i * 2:0x12 + i * 2], "big")) for i in range(256)]


def export_png(args):
    width, height, indexes = read_pgm(args.raw_pgm)
    colors = palette(args.dat, args.exe, args.resource_id)
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
    colors = palette(args.dat, args.exe, args.resource_id)
    allowed = range(len(colors)) if args.resource_id in EMBEDDED_PALETTE_IDS else range(3)
    result, changed = [], 0
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
    for name, func in (("export", export_png), ("import", import_png)):
        cmd = sub.add_parser(name)
        cmd.add_argument("dat")
        cmd.add_argument("exe")
        cmd.add_argument("resource_id", type=int)
        cmd.add_argument("raw_pgm")
        if name == "export":
            cmd.add_argument("output_png")
        else:
            cmd.add_argument("edited_png")
            cmd.add_argument("output_pgm")
        cmd.set_defaults(func=func)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
