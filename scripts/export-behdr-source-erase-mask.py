#!/usr/bin/env python3
import argparse
import struct
from pathlib import Path


def parse_values(text):
    values = []
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = [int(v, 0) for v in part.split("-", 1)]
            values.extend(range(min(a, b), max(a, b) + 1))
        else:
            values.append(int(part, 0))
    return set(values)


def write_pbm(path, width, height, pixels, comment):
    lines = ["P1", f"# {comment}", f"{width} {height}"]
    for y in range(height):
        row = pixels[y * width : (y + 1) * width]
        lines.append(" ".join("1" if v else "0" for v in row))
    Path(path).write_text("\n".join(lines) + "\n", encoding="ascii")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dat")
    ap.add_argument("exe")
    ap.add_argument("out_pbm")
    ap.add_argument("resource_id", type=lambda s: int(s, 0))
    ap.add_argument("--indexes", default="1,2,224-231")
    ap.add_argument("--drop-horizontal-run", type=int, default=24)
    args = ap.parse_args()

    dat = Path(args.dat).read_bytes()
    exe = Path(args.exe).read_bytes()
    load_addr = struct.unpack_from("<I", exe, 0x18)[0]
    table_off = 0x801C4F68 - load_addr + 0x800
    start_sector = struct.unpack_from("<H", exe, table_off + args.resource_id * 2)[0]
    end_sector = struct.unpack_from("<H", exe, table_off + args.resource_id * 2 + 2)[0]
    base = start_sector * 0x800
    width_tiles, height_tiles, _payload_size, tile_data_off = struct.unpack_from(">IIII", dat, base)
    tile_map_off = tile_data_off - width_tiles * height_tiles * 2
    tile_capacity = ((end_sector - start_sector) * 0x800 - tile_data_off) // 64
    width = width_tiles * 8
    height = height_tiles * 8
    indexes = parse_values(args.indexes)

    pixels = bytearray(width * height)
    for ty in range(height_tiles):
        for tx in range(width_tiles):
            raw = struct.unpack_from(">H", dat, base + tile_map_off + (ty * width_tiles + tx) * 2)[0]
            tile_index = raw >> 1
            if tile_index >= tile_capacity:
                continue
            tile_off = base + tile_data_off + tile_index * 64
            for py in range(8):
                for px in range(8):
                    if dat[tile_off + py * 8 + px] in indexes:
                        pixels[(ty * 8 + py) * width + (tx * 8 + px)] = 1

    # The selected-row red gradient shares some text-like palette indexes.
    # Long continuous horizontal runs are background, not glyph strokes.
    limit = max(1, args.drop_horizontal_run)
    for y in range(height):
        x = 0
        while x < width:
            if not pixels[y * width + x]:
                x += 1
                continue
            start = x
            while x < width and pixels[y * width + x]:
                x += 1
            if x - start >= limit:
                for xx in range(start, x):
                    pixels[y * width + xx] = 0

    out = Path(args.out_pbm)
    out.parent.mkdir(parents=True, exist_ok=True)
    write_pbm(out, width, height, pixels, f"be-hdr source erase mask resource {args.resource_id}")
    print(out)


if __name__ == "__main__":
    main()
