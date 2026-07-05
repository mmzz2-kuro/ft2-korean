#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ft2-win-data/race.dat + racecom.dat 에서 한글 종족 이름/설명을 뽑아낸다.

race.dat    : 86바이트 고정 레코드. 레코드 앞부분에 NUL로 끝나는 CP949 이름 문자열,
              뒤에 스탯으로 보이는 수치 필드가 이어진다.
racecom.dat : 헤더는 item.dat/itemcom.dat와 같은 256개(4바이트) 오프셋 테이블
              (1024바이트)이지만, 이 오프셋은 종족별 텍스트 경계와 무관하다.
              헤더 뒤 본문은 그냥 NUL로 끝나는 CP949 문자열이 race.dat 순서와
              똑같이 촘촘하게(패딩 없이) 연달아 이어져 있을 뿐이다. 즉 본문을
              NUL 기준으로 순서대로 나누면 그게 그대로 종족 0, 1, 2, ... 의
              설명이 된다.

              (오프셋 테이블 기반으로 슬롯을 나눠서 읽으면 텍스트가 슬롯 경계와
              안 맞아 깨지거나 밀린다 -- 예: id4 세이렌 설명이 슬롯 4~10에 걸쳐
              있고, id59/63 "결번"(미사용) 자리에 옆 종족의 설명이 새는 등. 순수
              NUL 분리 방식으로 바꾸니 이름 있는 모든 항목의 설명이 내용상 딱
              맞아떨어졌다.)
"""

import json
import struct
import sys
from pathlib import Path

RACE_RECORD_SIZE = 86
OFFSET_HEADER_ENTRIES = 256
HEADER_SIZE = OFFSET_HEADER_ENTRIES * 4


def decode_cstr(chunk, encoding="cp949"):
    nul = chunk.find(b"\x00")
    raw = chunk[:nul] if nul >= 0 else chunk
    return raw.decode(encoding, errors="replace")


def strip_trailing_line_whitespace(text):
    """줄 끝 공백만 제거한다. 강제 개행(\\n)과 줄 내부 공백은 그대로 둔다."""
    return "\n".join(line.rstrip(" \t\r") for line in text.split("\n"))


def read_race_dat(path):
    data = path.read_bytes()
    count = len(data) // RACE_RECORD_SIZE
    names = {}
    for i in range(count):
        chunk = data[i * RACE_RECORD_SIZE : (i + 1) * RACE_RECORD_SIZE]
        name = decode_cstr(chunk)
        if name:
            names[i] = name
    return names


def read_racecom_comments(path):
    data = path.read_bytes()
    end = struct.unpack_from("<I", data, (OFFSET_HEADER_ENTRIES - 1) * 4)[0] or len(data)
    body = data[HEADER_SIZE:end]
    parts = body.split(b"\x00")[:-1]  # 마지막은 종료 NUL 뒤의 빈 조각이라 버린다
    comments = {}
    for i, chunk in enumerate(parts):
        text = chunk.decode("cp949", errors="replace")
        if text:
            comments[i] = strip_trailing_line_whitespace(text)
    return comments


def main():
    root = Path(__file__).resolve().parent.parent
    data_dir = root / "ft2-win-data"
    out_path = root / "tmp" / "ft2-win-data" / "race-data-kr.json"

    names = read_race_dat(data_dir / "race.dat")
    comments = read_racecom_comments(data_dir / "racecom.dat")

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
