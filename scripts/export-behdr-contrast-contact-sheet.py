#!/usr/bin/env python3
import argparse
import math
import struct
from pathlib import Path

from PIL import Image, ImageDraw


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


def resource_info(dat, exe, table_off, rid):
    if table_off + rid * 2 + 4 > len(exe):
        return None
    start = struct.unpack_from("<H", exe, table_off + rid * 2)[0]
    end = struct.unpack_from("<H", exe, table_off + rid * 2 + 2)[0]
    if end <= start:
        return None
    base = start * 0x800
    size = (end - start) * 0x800
    if base + size > len(dat) or size < 0x10:
        return None
    width_tiles, height_tiles, payload_size, tile_data_off = struct.unpack_from(">IIII", dat, base)
    if width_tiles <= 0 or height_tiles <= 0 or width_tiles > 512 or height_tiles > 512:
        return None
    tile_map_off = tile_data_off - width_tiles * height_tiles * 2
    if tile_map_off < 0x10 or tile_data_off > payload_size or payload_size > size:
        return None
    return {
        "id": rid,
        "base": base,
        "size": size,
        "width_tiles": width_tiles,
        "height_tiles": height_tiles,
        "width": width_tiles * 8,
        "height": height_tiles * 8,
        "tile_map_off": tile_map_off,
        "tile_data_off": tile_data_off,
        "tile_capacity": (size - tile_data_off) // 64,
    }


def render_raw(dat, info):
    width = info["width"]
    height = info["height"]
    pixels = [0] * (width * height)
    for ty in range(info["height_tiles"]):
        for tx in range(info["width_tiles"]):
            raw = struct.unpack_from(
                ">H",
                dat,
                info["base"] + info["tile_map_off"] + (ty * info["width_tiles"] + tx) * 2,
            )[0]
            tile_index = raw >> 1
            if tile_index >= info["tile_capacity"]:
                continue
            tile_off = info["base"] + info["tile_data_off"] + tile_index * 64
            for py in range(8):
                row = (ty * 8 + py) * width + tx * 8
                src = tile_off + py * 8
                for px in range(8):
                    pixels[row + px] = dat[src + px]
    return Image.frombytes("L", (width, height), bytes(pixels))


def stretch_contrast(img):
    values = list(img.getdata())
    mn = min(values)
    mx = max(values)
    if mx <= mn:
        return img
    scale = 255.0 / (mx - mn)
    return Image.frombytes("L", img.size, bytes(max(0, min(255, int((v - mn) * scale))) for v in values))


def fit_thumb(img, max_w, max_h):
    scale = min(max_w / img.width, max_h / img.height, 1.0)
    if scale <= 0:
        scale = 1.0
    size = (max(1, int(img.width * scale)), max(1, int(img.height * scale)))
    return img.resize(size, Image.Resampling.NEAREST)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dat")
    ap.add_argument("exe")
    ap.add_argument("out_png")
    ap.add_argument("ids", nargs="+")
    ap.add_argument("--thumb-width", type=int, default=240)
    ap.add_argument("--thumb-height", type=int, default=160)
    ap.add_argument("--cols", type=int, default=4)
    args = ap.parse_args()

    dat = Path(args.dat).read_bytes()
    exe = Path(args.exe).read_bytes()
    load_addr = struct.unpack_from("<I", exe, 0x18)[0]
    table_off = 0x801C4F68 - load_addr + 0x800

    entries = []
    for rid in parse_ids(args.ids):
        info = resource_info(dat, exe, table_off, rid)
        if not info:
            continue
        img = stretch_contrast(render_raw(dat, info)).convert("RGB")
        entries.append((rid, info, fit_thumb(img, args.thumb_width, args.thumb_height)))

    cols = max(1, args.cols)
    label_h = 18
    cell_w = args.thumb_width
    cell_h = args.thumb_height + label_h
    rows = max(1, math.ceil(len(entries) / cols))
    sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), "white")
    draw = ImageDraw.Draw(sheet)

    for i, (rid, info, img) in enumerate(entries):
        ox = (i % cols) * cell_w
        oy = (i // cols) * cell_h
        draw.text((ox + 2, oy + 2), f"{rid} {info['width']}x{info['height']}", fill=(0, 0, 0))
        sheet.paste(img, (ox, oy + label_h))

    out = Path(args.out_png)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    print(out)


if __name__ == "__main__":
    main()
