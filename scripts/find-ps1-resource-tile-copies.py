#!/usr/bin/env python
"""Search the complete PS1 FS2 archive for tiles used by a BE-HDR image crop."""

import argparse
from bisect import bisect_right
from collections import Counter, defaultdict
from pathlib import Path


def starts(exe, count=4338):
    load = int.from_bytes(exe[0x18:0x1c], "little")
    pos = 0x801C4F68 - load + 0x800
    out, carry, prev = [], 0, 0
    for i in range(count):
        raw = int.from_bytes(exe[pos + i * 2:pos + i * 2 + 2], "little")
        if i and raw < prev:
            carry += 0x10000
        out.append((raw + carry) * 2048)
        prev = raw
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dat")
    ap.add_argument("exe")
    ap.add_argument("resource", type=int)
    ap.add_argument("crop", help="x,y,w,h")
    ap.add_argument("--top", type=int, default=30)
    args = ap.parse_args()
    dat = Path(args.dat).read_bytes()
    offsets = starts(Path(args.exe).read_bytes())
    rid = args.resource
    base, end = offsets[rid], offsets[rid + 1]
    wt = int.from_bytes(dat[base:base + 4], "big")
    ht = int.from_bytes(dat[base + 4:base + 8], "big")
    td = int.from_bytes(dat[base + 12:base + 16], "big")
    map_bytes = wt * ht * 2
    align4 = lambda n: (n + 3) & ~3
    mo = td - map_bytes
    if align4(0x210 + map_bytes) == td:
        mo = 0x210
    elif align4(0x10 + map_bytes) == td:
        mo = 0x10
    x, y, w, h = map(int, args.crop.split(","))
    cells = set()
    for py in range(y, y + h):
        for px in range(x, x + w):
            cells.add((py // 8) * wt + px // 8)
    tile_ids = []
    for cell in sorted(cells):
        tile_ids.append(int.from_bytes(dat[base + mo + cell * 2:base + mo + cell * 2 + 2], "big") >> 1)
    tile_ids = sorted(set(tile_ids))
    patterns = {}
    for tid in tile_ids:
        tile = dat[base + td + tid * 64:base + td + (tid + 1) * 64]
        if len(tile) == 64 and len(set(tile)) > 1:
            patterns[tid] = tile
    hits = defaultdict(list)
    for tid, pattern in patterns.items():
        pos = -1
        while True:
            pos = dat.find(pattern, pos + 1)
            if pos < 0:
                break
            hit_rid = bisect_right(offsets, pos) - 1
            hits[hit_rid].append((tid, pos - offsets[hit_rid]))
    ranked = []
    for hit_rid, values in hits.items():
        unique = len(set(t for t, _ in values))
        ranked.append((unique, len(values), hit_rid, values))
    ranked.sort(reverse=True)
    print(f"source={rid} crop={args.crop} nonblank_unique_tiles={len(patterns)}")
    print("unique\thits\tresource\toffset\tsize\tsource_tile_ids")
    for unique, count, hit_rid, values in ranked[:args.top]:
        sample = ",".join(f"{tid}@0x{off:x}" for tid, off in values[:16])
        size = offsets[hit_rid + 1] - offsets[hit_rid] if hit_rid + 1 < len(offsets) else 0
        print(f"{unique}\t{count}\t{hit_rid}\t0x{offsets[hit_rid]:x}\t0x{size:x}\t{sample}")


if __name__ == "__main__":
    main()
