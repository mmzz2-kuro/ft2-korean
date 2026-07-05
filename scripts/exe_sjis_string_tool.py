#!/usr/bin/env python
# -*- coding: utf-8 -*-

import argparse
import csv
import sys
from pathlib import Path


PSX_EXE_MAGIC = b"PS-X EXE"
SECTOR_SIZE = 2352
USER_OFFSET = 24
USER_SIZE = 2048

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")


def is_sjis_lead(byte):
    return 0x81 <= byte <= 0x9F or 0xE0 <= byte <= 0xFC


def is_sjis_trail(byte):
    return 0x40 <= byte <= 0x7E or 0x80 <= byte <= 0xFC


def char_len(buf, pos, end):
    b = buf[pos]
    if b in (0x00, 0xFF):
        return 0
    if b in (0x09, 0x0A, 0x0D) or 0x20 <= b <= 0x7E or 0xA1 <= b <= 0xDF:
        return 1
    if is_sjis_lead(b) and pos + 1 < end and is_sjis_trail(buf[pos + 1]):
        return 2
    return 0


def has_japanese(text):
    return any(
        "\u3040" <= ch <= "\u30ff"
        or "\u3400" <= ch <= "\u9fff"
        or "\u3000" <= ch <= "\u303f"
        for ch in text
    )


def read_u32_le(buf, off):
    return int.from_bytes(buf[off : off + 4], "little")


def find_raw_exe_sector(buf):
    for sector in range(len(buf) // SECTOR_SIZE):
        off = sector * SECTOR_SIZE + USER_OFFSET
        if buf[off : off + len(PSX_EXE_MAGIC)] == PSX_EXE_MAGIC:
            return sector
    return None


def raw_offset(exe_sector, exe_off):
    sector_delta = exe_off // USER_SIZE
    in_sector = exe_off % USER_SIZE
    return (exe_sector + sector_delta) * SECTOR_SIZE + USER_OFFSET + in_sector


def load_input(path):
    data = bytearray(Path(path).read_bytes())
    if data[: len(PSX_EXE_MAGIC)] == PSX_EXE_MAGIC:
        exe_len = 0x800 + read_u32_le(data, 0x1C)
        return {
            "kind": "exe",
            "data": data,
            "exe": bytearray(data[:exe_len]),
            "exe_sector": None,
            "exe_len": exe_len,
        }

    exe_sector = find_raw_exe_sector(data)
    if exe_sector is None:
        raise SystemExit(f"{path} is neither a PS-X EXE nor a raw BIN containing one")
    header_off = raw_offset(exe_sector, 0)
    exe_len = 0x800 + read_u32_le(data, header_off + 0x1C)
    exe = bytearray(exe_len)
    for exe_off in range(exe_len):
        exe[exe_off] = data[raw_offset(exe_sector, exe_off)]
    return {
        "kind": "raw",
        "data": data,
        "exe": exe,
        "exe_sector": exe_sector,
        "exe_len": exe_len,
    }


def write_output(loaded, out_path, patched_exe):
    if loaded["kind"] == "exe":
        out = bytearray(loaded["data"])
        out[: len(patched_exe)] = patched_exe
    else:
        out = bytearray(loaded["data"])
        exe_sector = loaded["exe_sector"]
        for exe_off, value in enumerate(patched_exe):
            out[raw_offset(exe_sector, exe_off)] = value
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_bytes(out)


def escape_tsv(value):
    return (value or "").replace("\\", "\\\\").replace("\t", "\\t").replace("\r", "").replace("\n", "\\n")


def unescape_tsv(value):
    marker = "\ue000"
    return (value or "").replace("\\\\", marker).replace("\\n", "\n").replace("\\t", "\t").replace(marker, "\\")


def split_terms(text):
    return [part.strip() for part in (text or "").split(",") if part.strip()]


def scan_strings(exe, min_bytes, include_ascii, terms, loose):
    rows = []
    pos = 0
    end = len(exe)
    while pos < end:
        start = pos
        while pos < end:
            n = char_len(exe, pos, end)
            if n == 0:
                break
            pos += n
        size = pos - start
        if size >= min_bytes:
            raw = bytes(exe[start:pos])
            try:
                text = raw.decode("cp932")
            except UnicodeDecodeError:
                text = ""
            term_match = not terms or any(term in text for term in terms)
            readable = include_ascii or has_japanese(text)
            if text and term_match and (loose or terms or readable):
                rows.append(
                    {
                        "enabled": "0",
                        "file_offset": f"0x{start:x}",
                        "max_bytes": str(size),
                        "source_text": text,
                        "ko_text": "",
                        "note": "",
                    }
                )
        pos = max(pos + 1, start + 1)
    return rows


def export_tsv(args):
    loaded = load_input(args.input)
    terms = split_terms(args.terms)
    rows = scan_strings(loaded["exe"], args.min_bytes, args.all, terms, args.loose)
    Path(args.tsv).parent.mkdir(parents=True, exist_ok=True)
    headers = ["enabled", "file_offset", "max_bytes", "source_text", "ko_text", "note"]
    with open(args.tsv, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=headers, delimiter="\t", lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: escape_tsv(row.get(key, "")) for key in headers})
    term_text = ",".join(terms) if terms else "(none)"
    print(f"input kind={loaded['kind']} exe_len=0x{loaded['exe_len']:x} strings={len(rows)} terms={term_text}")
    print(f"wrote {args.tsv}")


def read_tsv(path):
    with open(path, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        rows = []
        for row in reader:
            rows.append({key: unescape_tsv(value) for key, value in row.items()})
        return rows


def patch(args):
    loaded = load_input(args.input)
    exe = bytearray(loaded["exe"])
    applied = 0
    for row in read_tsv(args.tsv):
        if row.get("enabled", "0") in ("0", "false", "False", ""):
            continue
        text = row.get("ko_text", "").strip()
        if not text:
            continue
        off = int(row["file_offset"], 0)
        max_bytes = int(row["max_bytes"], 0)
        try:
            encoded = text.encode("cp932")
        except UnicodeEncodeError as exc:
            raise SystemExit(f"{row['file_offset']}: replacement is not encodable as CP932/Shift-JIS: {exc}") from exc
        if len(encoded) > max_bytes:
            raise SystemExit(
                f"{row['file_offset']}: replacement is {len(encoded)} bytes, exceeds original slot {max_bytes} bytes"
            )
        exe[off : off + max_bytes] = encoded + (b"\x00" * (max_bytes - len(encoded)))
        applied += 1
        print(f"patched {row['file_offset']} {len(encoded)}/{max_bytes} bytes: {text}")
    write_output(loaded, args.output, exe)
    print(f"input kind={loaded['kind']} applied={applied}")
    print(f"wrote {args.output}")


def main():
    parser = argparse.ArgumentParser(description="Export/patch SLPS-01903 PS-X EXE CP932 strings.")
    sub = parser.add_subparsers(dest="command", required=True)

    exp = sub.add_parser("export")
    exp.add_argument("input")
    exp.add_argument("tsv")
    exp.add_argument("--min-bytes", type=int, default=6)
    exp.add_argument("--all", action="store_true", help="include ASCII-only runs too")
    exp.add_argument(
        "--terms",
        default="セーブ,ロード,システム,設定,オプション,コンフィグ,終了,ステータス,アイテム,装備,魔法",
        help="comma-separated CP932 terms to keep; use an empty string to disable",
    )
    exp.add_argument("--loose", action="store_true", help="keep all decodable runs after term filtering")
    exp.set_defaults(func=export_tsv)

    pat = sub.add_parser("patch")
    pat.add_argument("input")
    pat.add_argument("tsv")
    pat.add_argument("output")
    pat.set_defaults(func=patch)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
