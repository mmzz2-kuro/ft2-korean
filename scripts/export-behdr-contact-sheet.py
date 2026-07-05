#!/usr/bin/env python3
import argparse
import math
import struct
from pathlib import Path

from PIL import Image, ImageDraw


def resource_info(dat, exe, table_off, rid):
    start = struct.unpack_from("<H", exe, table_off + rid * 2)[0]
    end = struct.unpack_from("<H", exe, table_off + rid * 2 + 2)[0]
    if end <= start:
        return None
    base = start * 0x800
    width_tiles, height_tiles, payload_size, tile_data_off = struct.unpack_from(">IIII", dat, base)
    tile_map_off = tile_data_off - width_tiles * height_tiles * 2
    if width_tiles <= 0 or height_tiles <= 0 or width_tiles > 512 or height_tiles > 512:
        return None
    if tile_map_off < 0x10 or payload_size <= tile_data_off:
        return None
    tile_capacity = ((end - start) * 0x800 - tile_data_off) // 64
    return {
        "id": rid,
        "base": base,
        "width_tiles": width_tiles,
        "height_tiles": height_tiles,
        "width": width_tiles * 8,
        "height": height_tiles * 8,
        "tile_map_off": tile_map_off,
        "tile_data_off": tile_data_off,
        "tile_capacity": tile_capacity,
    }


def render_mask(dat, info, indexes):
    width = info["width"]
    height = info["height"]
    img = Image.new("1", (width, height), 0)
    for ty in range(info["height_tiles"]):
        for tx in range(info["width_tiles"]):
            raw = struct.unpack_from(">H", dat, info["base"] + info["tile_map_off"] + (ty * info["width_tiles"] + tx) * 2)[0]
            tile_index = raw >> 1
            if tile_index >= info["tile_capacity"]:
                continue
            tile_off = info["base"] + info["tile_data_off"] + tile_index * 64
            for py in range(8):
                for px in range(8):
                    if dat[tile_off + py * 8 + px] in indexes:
                        img.putpixel((tx * 8 + px, ty * 8 + py), 1)
    return img


def parse_ids(parts):
    ids = []
    for part in parts:
        for item in part.split(","):
            item = item.strip()
            if not item:
                continue
            if "-" in item:
                a, b = [int(v, 0) for v in item.split("-", 1)]
                ids.extend(range(min(a, b), max(a, b) + 1))
            else:
                ids.append(int(item, 0))
    return list(dict.fromkeys(ids))


def parse_indexes(text):
    return parse_ids([text])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dat")
    ap.add_argument("exe")
    ap.add_argument("out_png")
    ap.add_argument("ids", nargs="+")
    ap.add_argument("--indexes", default="1,2,224-231")
    ap.add_argument("--scale", type=int, default=2)
    ap.add_argument("--cols", type=int, default=4)
    args = ap.parse_args()

    dat = Path(args.dat).read_bytes()
    exe = Path(args.exe).read_bytes()
    load_addr = struct.unpack_from("<I", exe, 0x18)[0]
    table_off = 0x801C4F68 - load_addr + 0x800
    ids = parse_ids(args.ids)
    indexes = set(parse_indexes(args.indexes))

    entries = []
    max_w = 1
    max_h = 1
    for rid in ids:
        info = resource_info(dat, exe, table_off, rid)
        if not info:
            continue
        img = render_mask(dat, info, indexes).convert("RGB")
        entries.append((rid, info, img))
        max_w = max(max_w, info["width"])
        max_h = max(max_h, info["height"])

    scale = max(1, args.scale)
    cols = max(1, args.cols)
    label_h = 18
    cell_w = max_w * scale
    cell_h = max_h * scale + label_h
    rows = max(1, math.ceil(len(entries) / cols))
    sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), "white")
    draw = ImageDraw.Draw(sheet)
    for i, (rid, info, img) in enumerate(entries):
        ox = (i % cols) * cell_w
        oy = (i // cols) * cell_h
        draw.text((ox + 2, oy + 2), f"{rid} {info['width']}x{info['height']}", fill=(0, 0, 0))
        scaled = img.resize((info["width"] * scale, info["height"] * scale), Image.Resampling.NEAREST)
        sheet.paste(scaled, (ox, oy + label_h))

    out = Path(args.out_png)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    print(out)


if __name__ == "__main__":
    main()
