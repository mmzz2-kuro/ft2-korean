#!/usr/bin/env python3
import argparse
from pathlib import Path

from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("in_pgm")
    ap.add_argument("out_png")
    args = ap.parse_args()

    img = Image.open(args.in_pgm).convert("L")
    values = list(img.getdata())
    mn = min(values)
    mx = max(values)
    if mx > mn:
        scale = 255.0 / (mx - mn)
        img.putdata([max(0, min(255, int((v - mn) * scale))) for v in values])
    out = Path(args.out_png)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    print(out)


if __name__ == "__main__":
    main()
