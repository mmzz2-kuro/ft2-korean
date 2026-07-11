#!/usr/bin/env python3
import argparse
from pathlib import Path

from PIL import Image


def read_pgm(path):
    tokens = []
    with open(path, "r", encoding="ascii") as f:
        for line in f:
            line = line.split("#", 1)[0].strip()
            if line:
                tokens.extend(line.split())
    if not tokens or tokens.pop(0) != "P2":
        raise ValueError(f"{path} is not an ASCII P2 PGM")
    width = int(tokens.pop(0))
    height = int(tokens.pop(0))
    tokens.pop(0)
    pixels = bytes(int(v) & 0xFF for v in tokens)
    if len(pixels) != width * height:
        raise ValueError(f"{path} has {len(pixels)} pixels, expected {width * height}")
    return width, height, pixels


def write_pgm(path, width, height, pixels):
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="ascii", newline="\n") as f:
        f.write("P2\n")
        f.write("# converted from indexed PNG\n")
        f.write(f"{width} {height}\n255\n")
        for y in range(height):
            row = pixels[y * width : (y + 1) * width]
            f.write(" ".join(str(v) for v in row))
            f.write("\n")


def pgm_to_png(in_path, out_path):
    width, height, pixels = read_pgm(in_path)
    img = Image.frombytes("P", (width, height), pixels)
    palette = []
    for i in range(256):
        palette.extend([i, i, i])
    img.putpalette(palette)
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    print(out)


def png_to_pgm(in_path, out_path):
    img = Image.open(in_path)
    if img.mode != "P":
        img = img.convert("L")
    pixels = bytes(img.getdata())
    write_pgm(out_path, img.width, img.height, pixels)
    print(out_path)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="mode", required=True)
    to_png = sub.add_parser("to-png")
    to_png.add_argument("in_pgm")
    to_png.add_argument("out_png")
    to_pgm = sub.add_parser("to-pgm")
    to_pgm.add_argument("in_png")
    to_pgm.add_argument("out_pgm")
    args = ap.parse_args()

    if args.mode == "to-png":
        pgm_to_png(args.in_pgm, args.out_png)
    else:
        png_to_pgm(args.in_png, args.out_pgm)


if __name__ == "__main__":
    main()
