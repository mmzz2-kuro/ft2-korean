#!/usr/bin/env python
"""Compare two Yaba Sanshiro swap16 High Work RAM snapshots for exact values."""
import argparse
from pathlib import Path

BASE = 0x06000000


def guest_bytes(raw):
    out = bytearray(raw)
    for i in range(0, len(out) - 1, 2):
        out[i], out[i + 1] = out[i + 1], out[i]
    return bytes(out)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("before"); p.add_argument("after")
    p.add_argument("before_value", type=lambda x: int(x, 0)); p.add_argument("after_value", type=lambda x: int(x, 0))
    a = p.parse_args()
    before = guest_bytes(Path(a.before).read_bytes()); after = guest_bytes(Path(a.after).read_bytes())
    if len(before) != len(after): raise SystemExit("snapshot sizes differ")
    total_changed = sum(x != y for x, y in zip(before, after))
    print(f"changed bytes across snapshot: {total_changed}")
    for size in (1, 2, 4):
        if a.before_value >= 1 << (size * 8) or a.after_value >= 1 << (size * 8): continue
        hits=[]
        for off in range(0, len(before)-size+1):
            if int.from_bytes(before[off:off+size],"big")==a.before_value and int.from_bytes(after[off:off+size],"big")==a.after_value:
                hits.append(off)
        print(f"\n{size*8}-bit candidates: {len(hits)}")
        for off in hits[:200]:
            lo=max(0,off-8); hi=min(len(before),off+size+8)
            print(f"0x{BASE+off:08X}  before={before[lo:hi].hex(' ')}  after={after[lo:hi].hex(' ')}")


if __name__ == "__main__": main()
