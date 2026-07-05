#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ft2-win-data/event/FT.exe의 .data 섹션에서 캐릭터 이름 테이블을 뽑아낸다.

PE 섹션 테이블을 읽어 .data 섹션(raw_ptr..raw_ptr+raw_size)만 스캔한다.
(.text 코드 섹션은 CP949 유효 바이트 쌍이 우연히 매칭되는 노이즈가 너무 많아
 제외해야 했다.) .data 안에서 한글이 포함된 NUL 종료 문자열을 순서대로 모으면
 캐릭터 이름 27개가 연속으로 나온 구간이 있다(예: "길드 마스터", "코카트리스",
 "앨비스", "마스터", "카린" 등). 그 뒤로는 상태이상 이름("비행", "마비",
 "석화" 등) 테이블이 바로 이어진다.

주의: 이 테이블의 인덱스가 이벤트 스크립트의 `char_%02d` 스프라이트 번호와
1:1로 대응하는지는 코드상의 참조를 찾지 못해 확인하지 못했다. 이름 목록
자체는 맞지만, 어떤 인덱스가 어떤 이벤트 대사의 화자인지는 이 스크립트만으로
자동 매칭할 수 없다.
"""

import json
import struct
import sys
from pathlib import Path

NAME_TABLE_START = 303280
NAME_TABLE_END = 303524  # 상태이상 테이블("비행" 등) 시작 직전


def read_pe_sections(data):
    e_lfanew = struct.unpack_from("<I", data, 0x3C)[0]
    coff_off = e_lfanew + 4
    num_sections = struct.unpack_from("<H", data, coff_off + 2)[0]
    opt_hdr_size = struct.unpack_from("<H", data, coff_off + 16)[0]
    sec_table_off = coff_off + 20 + opt_hdr_size
    sections = []
    for i in range(num_sections):
        off = sec_table_off + i * 40
        name = data[off : off + 8].rstrip(b"\x00").decode("ascii", errors="replace")
        raw_size, raw_ptr = struct.unpack_from("<II", data, off + 16)
        sections.append({"name": name, "raw_ptr": raw_ptr, "raw_size": raw_size})
    return sections


def read_char_names(path):
    data = path.read_bytes()
    sections = read_pe_sections(data)
    data_section = next(s for s in sections if s["name"] == ".data")
    assert data_section["raw_ptr"] <= NAME_TABLE_START < data_section["raw_ptr"] + data_section["raw_size"]

    region = data[NAME_TABLE_START:NAME_TABLE_END]
    parts = [p for p in region.split(b"\x00") if p]
    return [p.decode("cp949", errors="replace") for p in parts]


def main():
    root = Path(__file__).resolve().parent.parent
    in_path = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "ft2-win-data" / "event" / "FT.exe"
    out_path = root / "tmp" / "ft2-win-data" / "char-names-kr.json"

    names = read_char_names(in_path)
    records = [{"id": i, "name": name} for i, name in enumerate(names)]

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"wrote {len(records)} names -> {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
