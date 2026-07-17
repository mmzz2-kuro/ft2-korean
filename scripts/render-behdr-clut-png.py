#!/usr/bin/env python3
"""Render a raw be-hdr palette-index PGM with its embedded PS1 BGR555 CLUT."""

from __future__ import annotations

import argparse
from pathlib import Path
import struct

from PIL import Image


def read_p2(path: Path) -> tuple[int, int, bytes]:
    tokens: list[str] = []
    for line in path.read_text(encoding="ascii").splitlines():
        tokens.extend(line.split("#", 1)[0].split())
    if len(tokens) < 4 or tokens[0] != "P2":
        raise ValueError(f"{path} is not an ASCII P2 PGM")
    width, height, maximum = map(int, tokens[1:4])
    if maximum != 255:
        raise ValueError(f"{path} must have maxval 255, got {maximum}")
    pixels = bytes(int(value) for value in tokens[4:])
    if len(pixels) != width * height:
        raise ValueError(f"{path} has {len(pixels)} pixels, expected {width * height}")
    return width, height, pixels


def read_clut(dat_path: Path, exe_path: Path, resource_id: int) -> list[tuple[int, int, int]]:
    exe = exe_path.read_bytes()
    dat = dat_path.read_bytes()
    load_address = struct.unpack_from("<I", exe, 0x18)[0]
    table_offset = 0x801C4F68 - load_address + 0x800
    sector = struct.unpack_from("<H", exe, table_offset + resource_id * 2)[0]
    resource_offset = sector * 0x800
    width_tiles, height_tiles, _, tile_data_offset = struct.unpack_from(">IIII", dat, resource_offset)
    tile_map_offset = tile_data_offset - width_tiles * height_tiles * 2
    if tile_map_offset < 0x210:
        raise ValueError(f"resource {resource_id} has no embedded 256-entry CLUT")
    values = struct.unpack_from(">256H", dat, resource_offset + 0x10)
    return [
        (
            round((value & 0x1F) * 255 / 31),
            round(((value >> 5) & 0x1F) * 255 / 31),
            round(((value >> 10) & 0x1F) * 255 / 31),
        )
        for value in values
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("raw_pgm", type=Path)
    parser.add_argument("dat", type=Path)
    parser.add_argument("exe", type=Path)
    parser.add_argument("resource_id", type=int)
    parser.add_argument("output_png", type=Path)
    args = parser.parse_args()

    width, height, indexes = read_p2(args.raw_pgm)
    clut = read_clut(args.dat, args.exe, args.resource_id)
    image = Image.new("RGB", (width, height))
    image.putdata([clut[index] for index in indexes])
    args.output_png.parent.mkdir(parents=True, exist_ok=True)
    image.save(args.output_png)
    print(f"{args.resource_id}: wrote {args.output_png} ({width}x{height}, embedded BGR555 CLUT)")


if __name__ == "__main__":
    main()
