#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Find BE-HDR resources containing a palette-independent image fragment."""

import argparse
from collections import Counter
from pathlib import Path

import cv2
import numpy as np


def resource_starts(exe, count=4337):
    load = int.from_bytes(exe[0x18:0x1C], "little")
    table = 0x801C4F68 - load + 0x800
    result, carry, previous = [], 0, int.from_bytes(exe[table:table + 2], "little")
    for rid in range(count + 1):
        raw = int.from_bytes(exe[table + rid * 2:table + rid * 2 + 2], "little")
        if rid and raw < previous:
            carry += 0x10000
        result.append(raw + carry)
        previous = raw
    return result


def decode(dat, offsets, rid):
    begin, end = offsets[rid] * 2048, offsets[rid + 1] * 2048
    if begin + 16 > end or end > len(dat):
        return None
    wt = int.from_bytes(dat[begin:begin + 4], "big")
    ht = int.from_bytes(dat[begin + 4:begin + 8], "big")
    td = int.from_bytes(dat[begin + 12:begin + 16], "big")
    if not (1 <= wt <= 512 and 1 <= ht <= 512):
        return None
    map_bytes = wt * ht * 2
    align4 = lambda value: (value + 3) & ~3
    mo = td - map_bytes
    if align4(0x210 + map_bytes) == td:
        mo = 0x210
    elif align4(0x10 + map_bytes) == td:
        mo = 0x10
    capacity = (end - begin - td) // 64
    if mo < 0x10 or td < mo + map_bytes or capacity < 1 or wt * ht > 262144:
        return None
    image = np.zeros((ht * 8, wt * 8), dtype=np.uint8)
    for cell in range(wt * ht):
        tile = int.from_bytes(dat[begin + mo + cell * 2:begin + mo + cell * 2 + 2], "big") >> 1
        if tile >= capacity:
            return None
        tx, ty = cell % wt, cell // wt
        tile_data = np.frombuffer(dat, dtype=np.uint8, count=64, offset=begin + td + tile * 64).reshape(8, 8)
        image[ty * 8:ty * 8 + 8, tx * 8:tx * 8 + 8] = tile_data
    return image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("dat")
    parser.add_argument("exe")
    parser.add_argument("target_id", type=int)
    parser.add_argument("region", help="x,y,w,h")
    parser.add_argument("--top", type=int, default=40)
    args = parser.parse_args()
    dat, exe = Path(args.dat).read_bytes(), Path(args.exe).read_bytes()
    offsets = resource_starts(exe)
    target = decode(dat, offsets, args.target_id)
    if target is None:
        raise ValueError(f"cannot decode target resource {args.target_id}")
    x, y, width, height = map(int, args.region.split(","))
    crop = target[y:y + height, x:x + width]
    background = Counter(crop.ravel()).most_common(1)[0][0]
    template = (crop != background).astype(np.uint8)
    results = []
    for rid in range(min(4337, len(offsets) - 1)):
        image = decode(dat, offsets, rid)
        if image is None or image.shape[0] < height or image.shape[1] < width:
            continue
        # Compare silhouettes, not a single palette index.  The same artwork
        # may use several foreground indices or a different palette layout.
        candidate_background = Counter(image.ravel()).most_common(1)[0][0]
        layer = (image != candidate_background).astype(np.uint8)
        scores = cv2.matchTemplate(layer, template, cv2.TM_CCOEFF_NORMED)
        _, score, _, location = cv2.minMaxLoc(scores)
        best = (float(score), int(location[0]), int(location[1]), int(candidate_background))
        results.append((best[0], rid, best[1], best[2], best[3], image.shape[1], image.shape[0]))
    results.sort(reverse=True)
    print("score\tresource\tx\ty\tindex\tsize")
    for score, rid, hit_x, hit_y, value, image_width, image_height in results[:args.top]:
        print(f"{score:.6f}\t{rid}\t{hit_x}\t{hit_y}\t{value}\t{image_width}x{image_height}")


if __name__ == "__main__":
    main()
