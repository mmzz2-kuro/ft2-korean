#!/usr/bin/env python
# -*- coding: utf-8 -*-

import argparse
from pathlib import Path

from PIL import Image, ImageDraw


INDEX_COLORS = {
    # Index 0 is exported as a binary mask: white means palette index 0 and
    # black remains the universal "leave unchanged" sentinel.
    0: (255, 255, 255),
    1: (255, 96, 180),
    2: (255, 255, 255),
    3: (90, 170, 255),
    4: (30, 70, 255),
    5: (120, 90, 24),
    6: (165, 115, 28),
    7: (210, 145, 36),
    8: (255, 190, 64),
    9: (255, 220, 96),
    10: (255, 245, 150),
    14: (255, 130, 32),
    18: (200, 170, 95),
    24: (170, 120, 45),
    29: (120, 85, 35),
    68: (80, 120, 180),
    224: (120, 0, 24),
    225: (150, 0, 32),
    226: (180, 20, 42),
    227: (205, 40, 54),
    228: (225, 70, 70),
    229: (238, 100, 94),
    230: (248, 130, 118),
    231: (255, 170, 150),
}


def parse_indexes(text):
    indexes = []
    for part in (text or "").split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start_text, end_text = part.split("-", 1)
            start, end = int(start_text.strip()), int(end_text.strip())
            indexes.extend(range(min(start, end), max(start, end) + 1))
        else:
            indexes.append(int(part))
    return sorted(set(indexes))


def read_pgm(path):
    tokens = []
    with open(path, "r", encoding="ascii") as f:
        for line in f:
            line = line.split("#", 1)[0].strip()
            if line:
                tokens.extend(line.split())
    if not tokens or tokens.pop(0) != "P2":
        raise ValueError(f"{path} is not an ASCII P2 PGM")
    width, height = int(tokens.pop(0)), int(tokens.pop(0))
    tokens.pop(0)
    pixels = [int(t) for t in tokens]
    if len(pixels) < width * height:
        raise ValueError(f"{path} has {len(pixels)} pixels, expected {width * height}")
    return width, height, pixels[: width * height]


def write_pgm(path, width, height, pixels):
    lines = ["P2", "# be-hdr palette-layer patched raw palette indices", f"{width} {height}", "255"]
    for y in range(height):
        row = pixels[y * width : (y + 1) * width]
        lines.append(" ".join(str(v) for v in row))
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="ascii", newline="\n") as f:
        f.write("\n".join(lines) + "\n")


def color_for_index(index):
    if index in INDEX_COLORS:
        return INDEX_COLORS[index]
    return ((index * 47) % 256, (index * 91) % 256, (index * 139) % 256)


def context_color(index, target_indexes):
    if index in target_indexes:
        return color_for_index(index)
    if index == 0:
        return (0, 0, 0)
    if index == 1:
        return (80, 24, 56)
    if index == 2:
        return (90, 90, 90)
    if index in (3, 4):
        return (18, 42, 70)
    return (34, 34, 34)


def nearest_target_index(rgb, indexes):
    best_index, best_dist = None, None
    for index in indexes:
        color = color_for_index(index)
        dist = sum((a - b) ** 2 for a, b in zip(rgb, color))
        if best_dist is None or dist < best_dist:
            best_index, best_dist = index, dist
    return best_index, best_dist


def export_layers(args):
    width, height, pixels = read_pgm(args.raw_pgm)
    indexes = parse_indexes(args.indexes)
    if 0 in indexes and len(indexes) != 1:
        raise ValueError("palette index 0 must be exported alone (white=index 0, black=unchanged)")
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    prefix = args.prefix or Path(args.raw_pgm).stem.replace("-raw", "")
    label = args.label or "red"

    edit = Image.new("RGB", (width, height), (0, 0, 0))
    context = Image.new("RGB", (width, height), (24, 24, 24))
    edit_data = []
    context_data = []
    counts = {index: 0 for index in indexes}
    for value in pixels:
        if value in indexes:
            color = color_for_index(value)
            edit_data.append(color)
            counts[value] += 1
        else:
            edit_data.append((0, 0, 0))
        context_data.append(context_color(value, indexes))
    edit.putdata(edit_data)
    context.putdata(context_data)

    edit_path = out_dir / f"{prefix}-{label}-edit.png"
    context_path = out_dir / f"{prefix}-{label}-context.png"
    edit.save(edit_path)
    context.save(context_path)

    cell_w, cell_h = 176, 56
    legend = Image.new("RGB", (cell_w * 2, cell_h * ((len(indexes) + 1) // 2)), (24, 24, 24))
    draw = ImageDraw.Draw(legend)
    for n, index in enumerate(indexes):
        x = (n % 2) * cell_w
        y = (n // 2) * cell_h
        color = color_for_index(index)
        draw.rectangle((x + 8, y + 8, x + 48, y + 40), fill=color)
        draw.text((x + 58, y + 12), f"{index}  count {counts[index]}", fill=(240, 240, 240))
    legend_path = out_dir / f"{prefix}-{label}-legend.png"
    legend.save(legend_path)

    tsv_path = out_dir / f"{prefix}-{label}-legend.tsv"
    with tsv_path.open("w", encoding="utf-8", newline="") as f:
        f.write("index\tcount\trgb\n")
        for index in indexes:
            r, g, b = color_for_index(index)
            f.write(f"{index}\t{counts[index]}\t{r},{g},{b}\n")

    print(f"wrote {edit_path}")
    print(f"wrote {context_path}")
    print(f"wrote {legend_path}")
    print(f"wrote {tsv_path}")


def apply_layer(args):
    width, height, pixels = read_pgm(args.raw_pgm)
    indexes = parse_indexes(args.indexes)
    if 0 in indexes and len(indexes) != 1:
        raise ValueError("palette index 0 must be applied alone (white=index 0, black=unchanged)")
    edited = Image.open(args.edited_png).convert("RGB")
    if edited.size != (width, height):
        raise ValueError(f"{args.edited_png} is {edited.size}, expected {(width, height)}")

    threshold_sq = args.threshold * args.threshold
    result = list(pixels)
    changed = 0
    ignored = 0
    raw_rgb = edited.tobytes()
    for i in range(width * height):
        base = i * 3
        rgb = (raw_rgb[base], raw_rgb[base + 1], raw_rgb[base + 2])
        index, dist = nearest_target_index(rgb, indexes)
        if dist <= threshold_sq:
            if result[i] != index:
                result[i] = index
                changed += 1
        else:
            ignored += 1

    write_pgm(args.out_pgm, width, height, result)
    print(f"wrote {args.out_pgm}: {changed} palette-layer pixels changed, {ignored} pixels left unchanged")


def main():
    parser = argparse.ArgumentParser(description="Export/apply selected be-hdr palette-index layer images.")
    sub = parser.add_subparsers(dest="command", required=True)

    p_export = sub.add_parser("export")
    p_export.add_argument("raw_pgm")
    p_export.add_argument("out_dir")
    p_export.add_argument("--prefix", default="")
    p_export.add_argument("--indexes", default="224-231")
    p_export.add_argument("--label", default="red")
    p_export.set_defaults(func=export_layers)

    p_apply = sub.add_parser("apply")
    p_apply.add_argument("raw_pgm")
    p_apply.add_argument("edited_png")
    p_apply.add_argument("out_pgm")
    p_apply.add_argument("--indexes", default="224-231")
    p_apply.add_argument("--threshold", type=int, default=38)
    p_apply.set_defaults(func=apply_layer)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
