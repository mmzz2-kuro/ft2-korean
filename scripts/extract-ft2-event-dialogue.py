#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ft2-win-data/event/EVENT*.dat 에서 한글 대사를 이벤트(라벨)별로 뽑아낸다.

파일 구조:
  헤더  : [ascii 라벨 이름]\\0[4바이트 LE 오프셋] 이 반복된다. 라벨이 아닌
          첫 스크립트 바이트(=`begin` 라벨의 오프셋)에서 헤더가 끝난다.
          라벨 하나 = 스크립트 안의 서브루틴 하나(town/day/night/inn/store 등),
          여기서는 이 라벨 구간을 "이벤트"로 취급해 대사를 그 안에 묶는다.
  본문  : 0xFF 로 시작하는 옵코드 스트림. 대사 출력 옵코드는 `0xFF 0x06`
          다음에 NUL로 끝나는 CP949 문자열이 온다.
          `_`(밑줄)는 원문 상 공백 문자이고 `*`(별)는 쉼표(,) 표기이므로,
          디코드한 뒤 각각 공백/쉼표로 치환한다. `」`는 대사 종료를 표시하는
          닫는 인용부호라 그대로 둔다.
          `[S16]`/`[S32]`처럼 대사 안에 섞여 있는 `[S<숫자>]` 태그는 폰트
          크기 변경 코드([S16]이 기본값)라서 텍스트에서 완전히 제거한다.
  주의  : 화자(캐릭터) 이름을 문자열 단위로 명시하는 옵코드는 찾지 못했다.
          대사 안의 `[S32]`/`[S16]`/`[S24]` 같은 태그는 표정/이미지 전환으로
          보이며 화자 식별자가 아니다. 그래서 화자는 별도로 표시하지 않고,
          라벨(이벤트) 단위로만 대사를 묶는다.
  예외  : EVENT98.dat처럼 `0xFF 0x06` 대사 옵코드가 하나도 없는 파일은
          `0xFF 0x00 0x63` + 1바이트 다음에 문자열이 오는 다른 옵코드를 쓴다.
          내용을 보면 캐릭터 대사가 아니라 인트로/타이틀 내레이션이라서,
          이 경우는 `lines` 대신 `narration`으로 따로 표시한다.
"""

import json
import re
import sys
from pathlib import Path

DIALOGUE_OPCODE = re.compile(rb"\xff\x06")
NARRATION_OPCODE = re.compile(rb"\xff\x00\x63")
MAX_LABEL_LEN = 40
MAX_STRING_LEN = 400


FONT_SIZE_TAG = re.compile(r"\[S\d+\]")


def apply_script_punctuation(text):
    """원문 표기 규칙: `_`는 공백, `*`는 쉼표, `[S<숫자>]`는 폰트 크기 태그라 제거."""
    text = FONT_SIZE_TAG.sub("", text)
    return text.replace("_", " ").replace("*", ",")


def read_labels(data):
    pos = 0
    labels = []
    while pos < len(data):
        nul = data.find(b"\x00", pos)
        if nul == -1 or nul - pos > MAX_LABEL_LEN:
            break
        raw = data[pos:nul]
        if not raw or not all(0x20 <= b < 0x7F for b in raw):
            break
        offset = int.from_bytes(data[nul + 1 : nul + 5], "little")
        labels.append({"name": raw.decode("ascii"), "offset": offset})
        pos = nul + 5
    return labels, pos


def extract_dialogue_lines(data, start, end):
    lines = []
    for m in DIALOGUE_OPCODE.finditer(data, start, end):
        text_start = m.end()
        nul = data.find(b"\x00", text_start)
        if nul == -1 or nul - text_start > MAX_STRING_LEN:
            continue
        raw = data[text_start:nul]
        text = apply_script_punctuation(raw.decode("cp949", errors="replace"))
        if text:
            lines.append({"offset": m.start(), "text": text})
    return lines


def extract_narration_lines(data, start, end):
    lines = []
    for m in NARRATION_OPCODE.finditer(data, start, end):
        text_start = m.end() + 1  # 옵코드 뒤 1바이트(길이/타입으로 보임)를 건너뜀
        nul = data.find(b"\x00", text_start)
        if nul == -1 or nul - text_start > MAX_STRING_LEN:
            continue
        raw = data[text_start:nul]
        text = apply_script_punctuation(raw.decode("cp949", errors="replace"))
        if text:
            lines.append({"offset": m.start(), "text": text})
    return lines


def build_events(data, labels, header_end):
    ordered = sorted(labels, key=lambda l: l["offset"])
    events = []
    for i, label in enumerate(ordered):
        start = label["offset"]
        end = ordered[i + 1]["offset"] if i + 1 < len(ordered) else len(data)
        lines = extract_dialogue_lines(data, start, end)
        event = {"label": label["name"], "offset": start, "lines": lines}
        if not lines:
            narration = extract_narration_lines(data, start, end)
            if narration:
                event["narration"] = narration
        events.append(event)
    return events


def main():
    root = Path(__file__).resolve().parent.parent
    in_path = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "ft2-win-data" / "event" / "EVENT00.dat"
    out_path = (
        Path(sys.argv[2])
        if len(sys.argv) > 2
        else root / "tmp" / "ft2-win-data" / "event" / f"{in_path.stem}-dialogue-kr.json"
    )

    data = in_path.read_bytes()
    labels, header_end = read_labels(data)
    events = build_events(data, labels, header_end)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps({"source": in_path.name, "events": events}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    total_lines = sum(len(e["lines"]) for e in events)
    total_narration = sum(len(e.get("narration", [])) for e in events)
    print(
        f"wrote {len(events)} events / {total_lines} lines / {total_narration} narration -> {out_path}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
