#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ft2-win-data/item.dat + itemcom.dat 에서 한글 아이템 이름/설명을 뽑아낸다.

item.dat    : 56바이트 고정 레코드. 레코드 앞부분에 NUL로 끝나는 CP949 이름 문자열,
              뒤에 스탯으로 보이는 수치 필드가 이어진다.
itemcom.dat : 256개(4바이트) 오프셋 테이블(헤더 1024바이트) + 가변 텍스트 블록.
              offsets[i] ~ offsets[i+1] 구간이 아이템 i의 설명 텍스트(NUL 종료, CP949).
              오프셋이 0인 슬롯은 미사용.
"""

import json
import struct
import sys
from pathlib import Path

ITEM_RECORD_SIZE = 56
ITEMCOM_HEADER_ENTRIES = 256


def decode_cstr(chunk, encoding="cp949"):
    nul = chunk.find(b"\x00")
    raw = chunk[:nul] if nul >= 0 else chunk
    return raw.decode(encoding, errors="replace")


def strip_trailing_line_whitespace(text):
    """줄 끝 공백만 제거한다. 강제 개행(\\n)과 줄 내부 공백은 그대로 둔다."""
    return "\n".join(line.rstrip(" \t\r") for line in text.split("\n"))


def read_item_dat(path):
    data = path.read_bytes()
    count = len(data) // ITEM_RECORD_SIZE
    names = {}
    for i in range(count):
        chunk = data[i * ITEM_RECORD_SIZE : (i + 1) * ITEM_RECORD_SIZE]
        name = decode_cstr(chunk)
        if name:
            names[i] = name
    return names


def read_itemcom_dat(path):
    data = path.read_bytes()
    offsets = [
        struct.unpack_from("<I", data, i * 4)[0]
        for i in range(ITEMCOM_HEADER_ENTRIES)
    ]
    used = [i for i, o in enumerate(offsets) if o != 0 or i == 0]
    last = used[-1]
    comments = {}
    for i in range(last):
        start, end = offsets[i], offsets[i + 1]
        if end <= start:
            continue
        chunk = data[start:end]
        text = decode_cstr(chunk)
        if text:
            comments[i] = strip_trailing_line_whitespace(text)
    return comments


def main():
    root = Path(__file__).resolve().parent.parent
    data_dir = root / "ft2-win-data"
    out_path = root / "tmp" / "ft2-win-data" / "item-data-kr.json"

    names = read_item_dat(data_dir / "item.dat")
    comments = read_itemcom_dat(data_dir / "itemcom.dat")

    ids = sorted(set(names) | set(comments))
    records = [
        {"id": i, "name": names.get(i, ""), "comment": comments.get(i, "")}
        for i in ids
    ]

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"wrote {len(records)} records -> {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
