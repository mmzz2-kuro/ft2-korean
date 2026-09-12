#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Apply the confirmed PS1 opening-profile images to the Saturn Track 1 BIN."""

import json
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MAPPING = {226: 255, 228: 257, 234: 263, 236: 265, 239: 268, 240: 269, 257: 286}
CAPACITY = {226: 453, 228: 421, 234: 421, 236: 325, 239: 389, 240: 389, 257: 453}


def read_pgm(path):
    tokens = []
    for line in Path(path).read_text(encoding="ascii").splitlines():
        tokens.extend(line.split("#", 1)[0].split())
    if not tokens or tokens.pop(0) != "P2":
        raise ValueError(f"{path}: P2 PGM이 아닙니다.")
    width, height, maximum = map(int, (tokens.pop(0), tokens.pop(0), tokens.pop(0)))
    pixels = list(map(int, tokens))
    if maximum != 255 or len(pixels) != width * height:
        raise ValueError(f"{path}: 잘못된 PGM입니다.")
    return width, height, pixels


def write_pgm(path, width, height, pixels):
    lines = ["P2", "# PS1 confirmed opening profile mapped to Saturn", f"{width} {height}", "255"]
    for y in range(height):
        lines.append(" ".join(map(str, pixels[y * width:(y + 1) * width])))
    Path(path).write_text("\n".join(lines) + "\n", encoding="ascii", newline="\n")


def tiles(pixels, width, height):
    return [tuple(pixels[(ty + y) * width + tx + x] for y in range(8) for x in range(8))
            for ty in range(0, height, 8) for tx in range(0, width, 8)]


def fit_background(pixels, width, height, budget, protected_y=152):
    changes = []
    while True:
        current = tiles(pixels, width, height)
        counts = Counter(current)
        if len(counts) <= budget:
            return len(current), len(counts), changes
        patterns = list(counts)
        candidates = []
        columns = width // 8
        for pos, tile in enumerate(current):
            tx, ty = pos % columns, pos // columns
            if ty * 8 < protected_y or counts[tile] != 1:
                continue
            distance, replacement = min((sum(a != b for a, b in zip(tile, other)), other)
                                        for other in patterns if other != tile)
            candidates.append((distance, ty, tx, replacement))
        if not candidates:
            raise ValueError(f"{len(counts)}개 타일을 {budget}개로 줄일 수 없습니다.")
        distance, ty, tx, replacement = min(candidates)
        for y in range(8):
            for x in range(8):
                pixels[(ty * 8 + y) * width + tx * 8 + x] = replacement[y * 8 + x]
        changes.append({"x": tx * 8, "y": ty * 8, "changedPixels": distance})


def fit_karin_upper_background(pixels, width, height, budget):
    """Keep Karin's entire lower area and black foreground text untouched."""
    changes = []
    columns = width // 8
    while True:
        current = tiles(pixels, width, height)
        counts = Counter(current)
        if len(counts) <= budget:
            return len(current), len(counts), changes
        patterns = [tile for tile in counts if 1 not in tile]
        candidates = []
        for pos, tile in enumerate(current):
            tx, ty = pos % columns, pos // columns
            if ty * 8 >= 144 or counts[tile] != 1 or 1 in tile:
                continue
            distance, replacement = min((sum(a != b for a, b in zip(tile, other)), other)
                                        for other in patterns if other != tile)
            candidates.append((distance, ty, tx, replacement))
        if not candidates:
            raise ValueError("카린 상단 배경만으로 타일 수를 줄일 수 없습니다.")
        distance, ty, tx, replacement = min(candidates)
        for y in range(8):
            for x in range(8):
                pixels[(ty * 8 + y) * width + tx * 8 + x] = replacement[y * 8 + x]
        changes.append({"x": tx * 8, "y": ty * 8, "changedPixels": distance})


def run(args):
    print(">", subprocess.list2cmdline([str(x) for x in args]), flush=True)
    subprocess.run([str(x) for x in args], cwd=ROOT, check=True)


def main(argv):
    if len(argv) != 6:
        print("usage: python scripts/ss-fs2-build-opening-profiles.py <input.bin> <ps1-pgm-dir> <work-dir> <output.bin> <report.json>", file=sys.stderr)
        raise SystemExit(2)
    input_bin, source_dir, work_dir, output_bin, report_path = map(Path, argv[1:])
    raw_dir, mapped_dir = work_dir / "raw", work_dir / "mapped-pgm"
    raw_dir.mkdir(parents=True, exist_ok=True); mapped_dir.mkdir(parents=True, exist_ok=True)
    run(["node", ROOT / "scripts/ss-fs2-palette-layer-resource.js", "export", input_bin, raw_dir, *MAPPING])
    reports, items = [], []
    for ss_id, ps_id in MAPPING.items():
        source = source_dir / f"be-hdr-ui-{ps_id}-windows-ko.pgm"
        if ss_id == 257:
            edit_png = source_dir.parent / "edit" / "be-hdr-ui-286-ko-edit.png"
            intended = mapped_dir / "ss-fs2-resource-257-intended.pgm"
            run(["python", ROOT / "scripts/ps1-fs2-opening-edit-png.py", source, edit_png, intended])
            source = intended
        width, height, pixels = read_pgm(source)
        before = len(set(tiles(pixels, width, height)))
        changes = []
        if before > CAPACITY[ss_id] and ss_id == 257:
            _, after, changes = fit_karin_upper_background(pixels, width, height, CAPACITY[ss_id])
        elif before > CAPACITY[ss_id] and ss_id != 240:
            _, after, changes = fit_background(pixels, width, height, CAPACITY[ss_id])
        else:
            after = before
        target = mapped_dir / f"ss-fs2-resource-{ss_id}-ko.pgm"
        write_pgm(target, width, height, pixels)
        if ss_id not in (240, 257):
            items.append({"id": ss_id, "pgm": str(target.resolve())})
        reports.append({"ssResourceId": ss_id, "psResourceId": ps_id, "width": width, "height": height,
                        "uniqueTilesBefore": before, "uniqueTilesAfter": after,
                        "capacity": CAPACITY[ss_id], "backgroundTileChanges": changes})
        print(f"PS1 {ps_id} -> SS {ss_id}: {before} -> {after}/{CAPACITY[ss_id]} tiles", flush=True)
    manifest = work_dir / "opening-manifest.json"
    manifest.write_text(json.dumps({"version": 1, "items": items}, ensure_ascii=False, indent=2), encoding="utf-8")
    apply_report = work_dir / "opening-apply-report.json"
    intermediate = work_dir / "opening-without-sophia.bin"
    output_bin.parent.mkdir(parents=True, exist_ok=True)
    run(["node", ROOT / "scripts/ss-fs2-palette-layer-resource.js", "apply", input_bin, intermediate, manifest, apply_report])
    expansion_report = work_dir / "sophia-expansion-report.json"
    run(["node", ROOT / "scripts/ss-fs2-expand-opening-sophia.js", intermediate, output_bin,
         mapped_dir / "ss-fs2-resource-240-ko.pgm", mapped_dir / "ss-fs2-resource-257-ko.pgm", expansion_report])
    input_cue = input_bin.with_suffix(".cue")
    if input_cue.is_file():
        cue_lines = input_cue.read_text(encoding="utf-8").splitlines()
        cue_lines[0] = f'FILE "{output_bin.name}" BINARY'
        cue_text = "\n".join(cue_lines) + "\n"
    else:
        track2 = ROOT / "output/ss-fs2-korean-final-track2.bin"
        cue_text = (f'FILE "{output_bin.name}" BINARY\n  TRACK 01 MODE1/2352\n    INDEX 01 00:00:00\n'
                    f'FILE "{track2}" BINARY\n  TRACK 02 AUDIO\n    PREGAP 00:02:00\n    INDEX 01 00:00:00\n')
    output_bin.with_suffix(".cue").write_text(cue_text, encoding="utf-8", newline="\n")
    final = {"version": 1, "inputBin": str(input_bin.resolve()), "outputBin": str(output_bin.resolve()),
             "sourcePgmDir": str(source_dir.resolve()), "items": reports,
             "applyReport": json.loads(apply_report.read_text(encoding="utf-8")),
             "sophiaExpansionReport": json.loads(expansion_report.read_text(encoding="utf-8"))}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"완료: {output_bin}\n보고서: {report_path}", flush=True)


if __name__ == "__main__":
    main(sys.argv)
