#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
SLPS-01903 리소스 829 고유명사(캐릭터/몬스터/NPC 이름) 테이블 export/patch 도구.

포맷 (라이브 디버깅으로 확인됨):
  리소스 829 payload 오프셋 0x55D0부터, ID 1..30까지 각 160바이트.
  각 160바이트 = 80x16 픽셀 1bpp 비트맵 (가로 10바이트 x 세로 16행).
  바이트의 MSB부터 순서대로 1픽셀씩: bit=0 -> 잉크(글자), bit=1 -> 배경.
  ID -> 화면 표시 주소는 런타임에 (basePointer + (ID-1)*160 + 21968)로 계산되며,
  21968(0x55D0)이 바로 이 표의 리소스 829 안 오프셋과 정확히 일치한다.

  ID 31 이후는 렌더링 시 노이즈만 나와 이름 테이블이 아닌 다른 데이터(리소스 829
  안의 다른 비트맵 섹션)로 확인되었다. 즉 유효한 이름 슬롯은 1..30 뿐이다.

usage:
  export FS2_FILE.DAT SLPS_019.03 out.tsv maskDir
  render FontPath out.tsv [--font-size N]
  patch FS2_FILE.DAT SLPS_019.03 out.tsv outDat
"""

import csv
import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

RESOURCE_ID = 829
TABLE_OFFSET = 0x55D0
ENTRY_SIZE = 160
ENTRY_COUNT = 30
WIDTH = 80
HEIGHT = 16
WIDTH_BYTES = WIDTH // 8
EXPORT_SCALE = 6

FS2_LBA = 223
FS2_SECTORS = 119472
SECTOR_SIZE = 2352
USER_OFFSET = 24
USER_SIZE = 2048


def unescape_tsv(value):
    marker = ""
    return (value or "").replace("\\\\", marker).replace("\\n", "\n").replace("\\t", "\t").replace(marker, "\\")


def escape_tsv(value):
    return (value or "").replace("\\", "\\\\").replace("\t", "\\t").replace("\r", "").replace("\n", "\\n")


def read_tsv_rows(tsv_path):
    with open(tsv_path, encoding="utf-8", newline="") as f:
        reader = csv.reader(f, delimiter="\t")
        rows = list(reader)
    if not rows:
        return [], []
    headers = rows[0]
    dict_rows = [{h: unescape_tsv(row[i] if i < len(row) else "") for i, h in enumerate(headers)} for row in rows[1:] if any(row)]
    return headers, dict_rows


def write_tsv_rows(tsv_path, headers, rows):
    Path(tsv_path).parent.mkdir(parents=True, exist_ok=True)
    with open(tsv_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, delimiter="\t", lineterminator="\n")
        writer.writerow(headers)
        for row in rows:
            writer.writerow([escape_tsv(row.get(h, "")) for h in headers])

# 라이브 디버깅 + 시각 확인으로 얻은 원문(참고용, TSV에 기본값으로 채워짐).
KNOWN_JP_TEXT = {
    1: "カリン", 2: "アル", 3: "アリス", 4: "サーラ", 5: "ラディッシュ",
    6: "ソフィア", 7: "ルル", 9: "???", 10: "T.T.", 11: "ソーン",
    12: "マクドガル", 13: "ガストン", 15: "マスター", 16: "まっする親父",
    17: "ショップ姉ちゃん", 18: "怒りのカリン", 19: "困ったアリス",
    20: "カトリーヌ", 21: "ベヒモス", 22: "デュマ", 23: "ジャン",
    24: "ドッペルゲンガー", 25: "アルヴィース", 26: "ソーン・ヴァイス",
    27: "ヒーちゃん", 28: "コカちゃん", 29: "ギルドマスター",
}


def read_dat_payload(path):
    data = Path(path).read_bytes()
    expected_size = FS2_SECTORS * USER_SIZE
    if len(data) == expected_size:
        return data
    last_read_end = (FS2_LBA + FS2_SECTORS - 1) * SECTOR_SIZE + USER_OFFSET + USER_SIZE
    if last_read_end > len(data):
        raise ValueError(f"{path} is neither FS2_FILE.DAT ({expected_size} bytes) nor a raw BIN containing FS2 at LBA {FS2_LBA}")
    out = bytearray(expected_size)
    for sector in range(FS2_SECTORS):
        src_off = (FS2_LBA + sector) * SECTOR_SIZE + USER_OFFSET
        dst_off = sector * USER_SIZE
        out[dst_off:dst_off + USER_SIZE] = data[src_off:src_off + USER_SIZE]
    print(f"extracted FS2 payload from raw BIN input {path} ({len(out)} bytes)")
    return bytes(out)


def resource_byte_start(exe_bytes, resource_id):
    load_addr = struct.unpack_from("<I", exe_bytes, 0x18)[0]
    table_off = 0x801C4F68 - load_addr + 0x800
    off = table_off + resource_id * 2
    start_sector = struct.unpack_from("<H", exe_bytes, off)[0]
    return start_sector * 0x800


def entry_offset(exe_bytes, entry_id):
    base = resource_byte_start(exe_bytes, RESOURCE_ID)
    return base + TABLE_OFFSET + (entry_id - 1) * ENTRY_SIZE


def unpack_bits(chunk):
    pixels = []
    for row in range(HEIGHT):
        for colbyte in range(WIDTH_BYTES):
            b = chunk[row * WIDTH_BYTES + colbyte]
            for bit in range(8):
                pixels.append((b >> (7 - bit)) & 1)
    return pixels


def pack_bits(pixels):
    out = bytearray(ENTRY_SIZE)
    for row in range(HEIGHT):
        for colbyte in range(WIDTH_BYTES):
            byte_val = 0
            for bit in range(8):
                idx = row * WIDTH + colbyte * 8 + bit
                byte_val |= (pixels[idx] & 1) << (7 - bit)
            out[row * WIDTH_BYTES + colbyte] = byte_val
    return bytes(out)


def chunk_to_image(chunk):
    pixels = unpack_bits(chunk)
    img = Image.new("L", (WIDTH, HEIGHT))
    img.putdata([0 if v == 0 else 255 for v in pixels])
    return img


def image_to_chunk(img):
    if img.size != (WIDTH, HEIGHT):
        img = img.convert("L").resize((WIDTH, HEIGHT), Image.NEAREST)
    else:
        img = img.convert("L")
    pixels = [0 if p < 128 else 1 for p in img.getdata()]
    return pack_bits(pixels)


def export_tsv(dat_path, exe_path, out_tsv, mask_dir):
    dat = read_dat_payload(dat_path)
    exe = Path(exe_path).read_bytes()
    mask_dir = Path(mask_dir)
    mask_dir.mkdir(parents=True, exist_ok=True)

    headers = ["enabled", "id", "jp_text", "source_png", "replacement_png", "ko_text", "font_size"]

    existing = {}
    if Path(out_tsv).exists():
        _, existing_rows = read_tsv_rows(out_tsv)
        for row in existing_rows:
            existing[row.get("id", "")] = row

    rows = []
    for entry_id in range(1, ENTRY_COUNT + 1):
        off = entry_offset(exe, entry_id)
        chunk = dat[off:off + ENTRY_SIZE]
        img = chunk_to_image(chunk)
        source_png = mask_dir / f"name-{entry_id:02d}.png"
        img.resize((WIDTH * EXPORT_SCALE, HEIGHT * EXPORT_SCALE), Image.NEAREST).save(source_png)
        old = existing.get(str(entry_id), {})
        rows.append({
            "enabled": old.get("enabled", "0"),
            "id": str(entry_id),
            "jp_text": KNOWN_JP_TEXT.get(entry_id, ""),
            "source_png": str(source_png),
            "replacement_png": old.get("replacement_png", ""),
            "ko_text": old.get("ko_text", ""),
            "font_size": old.get("font_size", ""),
        })

    write_tsv_rows(out_tsv, headers, rows)
    print(f"wrote {out_tsv} ({ENTRY_COUNT} rows) and source PNGs to {mask_dir}")


def fit_font(draw, text, font_path, max_width, max_height):
    for size in range(max_height, 5, -1):
        font = ImageFont.truetype(font_path, size, index=0)
        bbox = draw.textbbox((0, 0), text, font=font)
        if bbox[2] - bbox[0] <= max_width:
            return font, bbox
    font = ImageFont.truetype(font_path, 6, index=0)
    return font, draw.textbbox((0, 0), text, font=font)


def render_name_image(text, font_path, font_size=None):
    """Render text into an unscaled WIDTHxHEIGHT 'L' image (0=ink, 255=background)."""
    img = Image.new("L", (WIDTH, HEIGHT), color=255)
    draw = ImageDraw.Draw(img)
    if font_size:
        font = ImageFont.truetype(font_path, int(font_size), index=0)
        bbox = draw.textbbox((0, 0), text, font=font)
    else:
        font, bbox = fit_font(draw, text, font_path, WIDTH, HEIGHT)
    th = bbox[3] - bbox[1]
    x = -bbox[0]
    y = max(0, (HEIGHT - th) // 2 - bbox[1])
    draw.text((x, y), text, font=font, fill=0)
    return img


def render_name_png(text, font_path, out_path, font_size=None, scale=EXPORT_SCALE):
    img = render_name_image(text, font_path, font_size)
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    img.resize((WIDTH * scale, HEIGHT * scale), Image.NEAREST).save(out_path)
    return out_path


def render_replacement_pngs(font_path, tsv_path, font_size=None):
    headers, rows = read_tsv_rows(tsv_path)

    rendered = 0
    for row in rows:
        text = row.get("ko_text", "").strip()
        if not text:
            continue
        entry_id = int(row["id"])
        out_path = row.get("replacement_png", "").strip()
        if not out_path:
            source_png = Path(row["source_png"])
            out_path = str(source_png.with_name(f"name-{entry_id:02d}-ko.png"))
            row["replacement_png"] = out_path

        row_font_size = row.get("font_size", "").strip() or font_size
        render_name_png(text, font_path, out_path, row_font_size)
        rendered += 1
        print(f"id {entry_id}: rendered '{text}' -> {out_path}")

    write_tsv_rows(tsv_path, headers, rows)
    print(f"rendered {rendered} replacement PNGs, updated {tsv_path}")


def patch(dat_path, exe_path, tsv_path, out_dat):
    dat = bytearray(read_dat_payload(dat_path))
    exe = Path(exe_path).read_bytes()
    applied = 0
    _, rows = read_tsv_rows(tsv_path)
    for row in rows:
        if row.get("enabled", "0").strip() != "1":
            continue
        entry_id = int(row["id"])
        replacement_png = row.get("replacement_png", "").strip()
        if not replacement_png or not Path(replacement_png).exists():
            print(f"[skip] id {entry_id}: replacement_png missing or not found ({replacement_png})")
            continue
        off = entry_offset(exe, entry_id)
        img = Image.open(replacement_png)
        chunk = image_to_chunk(img)
        dat[off:off + ENTRY_SIZE] = chunk
        applied += 1
        print(f"patched id {entry_id}: {replacement_png}")

    Path(out_dat).parent.mkdir(parents=True, exist_ok=True)
    Path(out_dat).write_bytes(dat)
    print(f"applied {applied} entries, wrote {out_dat}")


def main(argv):
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        raise SystemExit(2)
    mode = argv[1]
    if mode == "export":
        if len(argv) < 6:
            print(__doc__, file=sys.stderr)
            raise SystemExit(2)
        export_tsv(argv[2], argv[3], argv[4], argv[5])
    elif mode == "render":
        if len(argv) < 4:
            print(__doc__, file=sys.stderr)
            raise SystemExit(2)
        font_size = None
        if "--font-size" in argv:
            font_size = int(argv[argv.index("--font-size") + 1])
        render_replacement_pngs(argv[2], argv[3], font_size)
    elif mode == "patch":
        if len(argv) < 6:
            print(__doc__, file=sys.stderr)
            raise SystemExit(2)
        patch(argv[2], argv[3], argv[4], argv[5])
    else:
        print(__doc__, file=sys.stderr)
        raise SystemExit(2)


if __name__ == "__main__":
    main(sys.argv)
