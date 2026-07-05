#!/usr/bin/env python3
import argparse
import struct
from pathlib import Path

from PIL import Image, ImageDraw


def parse_indices(text):
    values = []
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = [int(x, 0) for x in part.split("-", 1)]
            values.extend(range(min(a, b), max(a, b) + 1))
        else:
            values.append(int(part, 0))
    return list(dict.fromkeys(values))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dat")
    ap.add_argument("exe")
    ap.add_argument("out_png")
    ap.add_argument("resource_id", type=lambda s: int(s, 0))
    ap.add_argument("--crop", default="0,0,0,0", help="x,y,w,h; 0 w/h means full image")
    ap.add_argument("--indices", default="0-15,33,68,208,219,224-232")
    ap.add_argument("--scale", type=int, default=2)
    ap.add_argument("--cols", type=int, default=4)
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

    pixels = [[0] * width for _ in range(height)]
    for ty in range(height_tiles):
        for tx in range(width_tiles):
            raw = struct.unpack_from(">H", dat, base + tile_map_off + (ty * width_tiles + tx) * 2)[0]
            tile_index = raw >> 1
            for py in range(8):
                for px in range(8):
                    value = 0
                    if tile_index < tile_capacity:
                        value = dat[base + tile_data_off + tile_index * 64 + py * 8 + px]
                    pixels[ty * 8 + py][tx * 8 + px] = value

    x, y, w, h = [int(v, 0) for v in args.crop.split(",")]
    if w <= 0 or h <= 0:
        x, y, w, h = 0, 0, width, height
    indices = parse_indices(args.indices)
    scale = max(1, args.scale)
    cols = max(1, args.cols)
    cell_w = w * scale
    cell_h = h * scale + 18
    rows = (len(indices) + cols - 1) // cols
    out = Image.new("RGB", (cols * cell_w, rows * cell_h), "white")
    draw = ImageDraw.Draw(out)

    for n, index in enumerate(indices):
        ox = (n % cols) * cell_w
        oy = (n // cols) * cell_h
        draw.text((ox + 2, oy + 2), str(index), fill=(0, 0, 0))
        img = Image.new("1", (w, h), 0)
        for yy in range(h):
            sy = y + yy
            if sy < 0 or sy >= height:
                continue
            for xx in range(w):
                sx = x + xx
                if 0 <= sx < width and pixels[sy][sx] == index:
                    img.putpixel((xx, yy), 1)
        img = img.resize((w * scale, h * scale), Image.Resampling.NEAREST).convert("RGB")
        out.paste(img, (ox, oy + 18))

    out_path = Path(args.out_png)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out.save(out_path)
    print(out_path)


if __name__ == "__main__":
    main()
