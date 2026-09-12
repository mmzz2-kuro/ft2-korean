#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Convert the Windows Korean opening-profile BMPs into PS1 raw-index PGMs.

The Windows artwork is exactly twice the PS1 dimensions, but its palette is
not the PS1 palette.  This converter keeps the Windows layout, reduces it by
2, and maps its background/text/decorative ramps onto palette indices already
used by the corresponding original PS1 resource.

usage:
  python scripts/ps1-fs2-import-windows-opening-profiles.py \
    <win-bmp-dir> <ps1-raw-pgm-dir> <out-dir> [--preview-dir DIR]
"""

from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


RESOURCE_IDS = (255, 257, 263, 265, 268, 269, 286)
# Resource 269 is three patterns over its fixed PS1 allocation after the
# Windows conversion.  Reuse three nearest background/decorative tiles below
# the text block; each selected pair differs by only one pixel.
TILE_BUDGETS = {269: 389}
PROFILE_TEXT = {
    255: ("아리스", ["성별 : 여자아이", "연령 : 17세", "클래스 : 치유의 손", "좋아하는 것 : 예쁜 드레스", "싫어하는 것 : 뱀·개구리"]),
    257: ("라디슈", ["성별 : 여자", "연령 : 39(외모는 20세 전후)", "클래스 : 세이렌", "좋아하는 것 : 독서", "싫어하는 것 : 노래"]),
    263: ("알", ["성별 : 남자", "연령 : 16세(?)", "클래스 : 검사", "좋아하는 것 : 카린", "싫어하는 것 : 악마"]),
    265: ("사라", ["성별 : 여자", "연령 : 16세", "클래스 : 권투 선수", "좋아하는 것 : 강한 녀석", "싫어하는 것 : 약한 녀석"]),
    268: ("루루", ["성별 : 여자아이", "연령 : 7세", "클래스 : 하펠루프", "좋아하는 것 : 엄마", "싫어하는 것 : 당근"]),
    269: ("소피아", ["성별 : 여성", "연령 : 미상", "클래스 : 엘프", "좋아하는 것 : 루루", "싫어하는 것 : 남자"]),
    286: ("카린", ["성별 : 여자아이", "연령 : 16세", "클래스 : 아주 귀여운 마법사", "좋아하는 것 : 쇼핑", "싫어하는 것 : 어둡고 좁은 곳"]),
}


def read_p2(path: Path):
    tokens = []
    for line in path.read_text(encoding="ascii").splitlines():
        tokens.extend(line.split("#", 1)[0].split())
    if not tokens or tokens.pop(0) != "P2":
        raise ValueError(f"{path} is not a P2 PGM")
    width, height, maxval = map(int, (tokens.pop(0), tokens.pop(0), tokens.pop(0)))
    pixels = list(map(int, tokens))
    if maxval != 255 or len(pixels) != width * height:
        raise ValueError(f"invalid PGM dimensions/data in {path}")
    return width, height, pixels


def write_p2(path: Path, width: int, height: int, pixels):
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = ["P2", "# converted from the Windows Korean opening profile", f"{width} {height}", "255"]
    for y in range(height):
        lines.append(" ".join(map(str, pixels[y * width : (y + 1) * width])))
    path.write_text("\n".join(lines) + "\n", encoding="ascii", newline="\n")


def nearest(value: float, choices):
    return min(choices, key=lambda item: abs(item - value))


def fit_tile_budget(pixels, width, height, budget, protected_y=120):
    columns = width // 8

    def unpack_tiles():
        return [
            tuple(pixels[(ty * 8 + y) * width + tx * 8 + x] for y in range(8) for x in range(8))
            for ty in range(height // 8)
            for tx in range(columns)
        ]

    changes = []
    while True:
        tiles = unpack_tiles()
        counts = Counter(tiles)
        if len(counts) <= budget:
            return changes
        patterns = list(counts)
        candidates = []
        for pos, tile in enumerate(tiles):
            tx, ty = pos % columns, pos // columns
            if ty * 8 < protected_y or counts[tile] != 1:
                continue
            distance, replacement = min(
                (sum(a != b for a, b in zip(tile, other)), other)
                for other in patterns
                if other != tile
            )
            candidates.append((distance, ty, tx, replacement))
        if not candidates:
            raise ValueError(f"cannot reduce {len(counts)} tiles to budget {budget}")
        distance, ty, tx, replacement = min(candidates)
        for y in range(8):
            for x in range(8):
                pixels[(ty * 8 + y) * width + tx * 8 + x] = replacement[y * 8 + x]
        changes.append((tx * 8, ty * 8, distance))


def render_text(pixels, width, height, resource_id, text_index, font_path):
    name, lines = PROFILE_TEXT[resource_id]
    mask = Image.new("1", (width, height), 0)
    draw = ImageDraw.Draw(mask)

    def font(size):
        return ImageFont.truetype(str(font_path), size=size)

    def centered(text, center_x, y, size):
        fnt = font(size); box = draw.textbbox((0, 0), text, font=fnt)
        draw.text((center_x - (box[2] - box[0]) // 2, y - box[1]), text, font=fnt, fill=1)

    def fitted(text, x, y, maximum_width, preferred=12, minimum=9):
        for size in range(preferred, minimum - 1, -1):
            fnt = font(size); box = draw.textbbox((0, 0), text, font=fnt)
            if box[2] - box[0] <= maximum_width:
                draw.text((x, y - box[1]), text, font=fnt, fill=1)
                return
        draw.text((x, y), text, font=font(minimum), fill=1)

    if resource_id == 257:
        centered(name, 106, 8, 30)
        for text, y in zip(lines[:3], (48, 67, 86)):
            fitted(text, 12, y, 150)
        for text, y in zip(lines[3:], (48, 67)):
            fitted(text, 174, y, 142)
    else:
        centered(name, width // 2, 10, 30)
        for text, y in zip(lines, (55, 73, 91, 112, 132)):
            fitted(text, 6, y, width - 10)

    rendered = list(mask.getdata())
    for pos, ink in enumerate(rendered):
        if ink:
            pixels[pos] = text_index


def convert_one(bmp_path: Path, raw_path: Path, resource_id: int, font_path: Path):
    width, height, original = read_p2(raw_path)
    bmp = Image.open(bmp_path)
    if bmp.mode != "P":
        raise ValueError(f"{bmp_path} must be an indexed BMP")
    if bmp.size != (width * 2, height * 2):
        raise ValueError(f"{bmp_path}: expected {(width * 2, height * 2)}, got {bmp.size}")

    used_win = Counter(bmp.getdata())
    palette = bmp.getpalette()
    colors = {idx: tuple(palette[idx * 3 : idx * 3 + 3]) for idx in used_win}
    bg_win = used_win.most_common(1)[0][0]
    text_win = max(used_win, key=lambda idx: sum(colors[idx]) / 3)
    saturated = [idx for idx in used_win if max(colors[idx]) - min(colors[idx]) >= 24]
    decor_win = max(saturated, key=lambda idx: used_win[idx]) if saturated else None

    used_ps = Counter(original)
    bg_ps = used_ps.most_common(1)[0][0]
    # The solid Japanese glyph interior is index 1 in these resources.
    text_ps = 1 if 1 in used_ps else min(used_ps)
    decor_candidates = [(n, idx) for idx, n in used_ps.items() if idx not in (bg_ps, text_ps)]
    decor_ps = max(decor_candidates)[1] if decor_candidates else bg_ps
    ps_values = sorted(used_ps)

    bg_rgb = colors[bg_win]
    text_rgb = colors[text_win]
    decor_rgb = colors[decor_win] if decor_win is not None else bg_rgb

    def distance(a, b):
        return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5

    def map_rgb(rgb):
        saturation = max(rgb) - min(rgb)
        if decor_win is not None and saturation >= 20:
            total = max(1.0, distance(bg_rgb, decor_rgb))
            amount = min(1.0, distance(rgb, bg_rgb) / total)
            target = bg_ps + amount * (decor_ps - bg_ps)
        else:
            total = max(1.0, distance(bg_rgb, text_rgb))
            amount = min(1.0, distance(rgb, bg_rgb) / total)
            target = bg_ps + amount * (text_ps - bg_ps)
        return nearest(target, ps_values)

    index_map = {idx: map_rgb(rgb) for idx, rgb in colors.items()}
    # Lock the three semantic anchors so rounding cannot move them.
    index_map[bg_win] = bg_ps
    index_map[text_win] = text_ps
    if decor_win is not None:
        index_map[decor_win] = decor_ps

    # A few BMPs contain isolated palette specks (typically 1-9 source
    # pixels).  Keeping those as separate PS1 values creates otherwise unique
    # 8x8 tiles without adding visible detail.  Fold them into the closest
    # established Windows colour before reducing the image.
    stable = [idx for idx, count in used_win.items() if count >= 16]
    for idx, count in used_win.items():
        if count < 16 and stable:
            replacement = min(stable, key=lambda other: distance(colors[idx], colors[other]))
            index_map[idx] = index_map[replacement]

    def is_text_pixel(index):
        rgb = colors[index]
        # Windows uses a nearly neutral white/gray ramp for the foreground
        # lettering and saturated ramps for each card's watermark artwork.
        return max(rgb) - min(rgb) <= 16 and sum(rgb) / 3 >= 48

    # Reduce only the Windows background/watermark. The Windows glyphs are not
    # scaled: they are reconstructed below with one consistently hinted PS1-size
    # font, which avoids the uneven half-pixel strokes of a 50% bitmap reduction.
    src = bmp.load()
    output = []
    for y in range(height):
        for x in range(width):
            block = [src[x * 2 + dx, y * 2 + dy] for dy in (0, 1) for dx in (0, 1)]
            background = [index for index in block if not is_text_pixel(index)]
            chosen = Counter(background or [bg_win]).most_common(1)[0][0]

            output.append(index_map[chosen])

    background = output.copy()
    render_text(output, width, height, resource_id, text_ps, font_path)

    meta = {
        "background": (bg_win, bg_ps),
        "text": (text_win, text_ps),
        "decoration": (decor_win, decor_ps),
        "map": index_map,
    }
    return width, height, output, background, meta


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("win_bmp_dir", type=Path)
    parser.add_argument("ps1_raw_pgm_dir", type=Path)
    parser.add_argument("out_dir", type=Path)
    parser.add_argument("--preview-dir", type=Path)
    parser.add_argument("--background-dir", type=Path)
    parser.add_argument("--font", type=Path, default=Path("font/NanumSquareRoundB.ttf"))
    args = parser.parse_args()

    for rid in RESOURCE_IDS:
        bmp = args.win_bmp_dir / f"be-hdr-ui-{rid}.BMP"
        raw = args.ps1_raw_pgm_dir / f"be-hdr-ui-{rid}-raw.pgm"
        width, height, pixels, background, meta = convert_one(bmp, raw, rid, args.font)
        budget_changes = []
        if rid in TILE_BUDGETS:
            budget_changes = fit_tile_budget(pixels, width, height, TILE_BUDGETS[rid])
        out = args.out_dir / f"be-hdr-ui-{rid}-windows-ko.pgm"
        write_p2(out, width, height, pixels)
        if args.background_dir:
            write_p2(args.background_dir / f"be-hdr-ui-{rid}-background.pgm", width, height, background)
        if args.preview_dir:
            args.preview_dir.mkdir(parents=True, exist_ok=True)
            preview = Image.new("L", (width, height)); preview.putdata(pixels)
            preview.save(args.preview_dir / f"be-hdr-ui-{rid}-windows-ko.png")
        print(f"{rid}: {width}x{height} {meta} tile_budget_changes={budget_changes}")


if __name__ == "__main__":
    main()
