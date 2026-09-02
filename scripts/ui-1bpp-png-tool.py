#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Lossless-ish visual bridge between ASCII P1 PBM masks and editable PNG."""
import argparse
from pathlib import Path
from PIL import Image


def read_pbm(path):
    tokens=[]
    for line in Path(path).read_text(encoding="ascii").splitlines():
        line=line.split("#",1)[0].strip()
        if line: tokens.extend(line.split())
    if not tokens or tokens.pop(0)!="P1": raise ValueError(f"not a P1 PBM: {path}")
    width,height=int(tokens.pop(0)),int(tokens.pop(0)); pixels=[int(x) for x in tokens]
    if len(pixels)!=width*height or any(x not in (0,1) for x in pixels): raise ValueError(f"invalid PBM data: {path}")
    return width,height,pixels


def pbm_to_png(src,dst):
    w,h,p=read_pbm(src); image=Image.new("L",(w,h)); image.putdata([0 if x else 255 for x in p]); Path(dst).parent.mkdir(parents=True,exist_ok=True); image.save(dst); print(f"wrote {dst} ({w}x{h}, black=ink)")


def png_to_pbm(src,dst,width,height,threshold):
    image=Image.open(src).convert("RGBA")
    if image.size!=(width,height): raise ValueError(f"{src}: size {image.size}, expected {(width,height)}")
    rgba=list(image.get_flattened_data() if hasattr(image, "get_flattened_data") else image.getdata()); pixels=[]
    for r,g,b,a in rgba:
        # Composite transparency on white so erased/transparent areas stay blank.
        lum=((299*r+587*g+114*b)//1000*a+255*(255-a))//255
        pixels.append(1 if lum<threshold else 0)
    lines=["P1","# PNG-edited 1bpp UI mask",f"{width} {height}"]
    for y in range(height): lines.append(" ".join(map(str,pixels[y*width:(y+1)*width])))
    Path(dst).parent.mkdir(parents=True,exist_ok=True); Path(dst).write_text("\n".join(lines)+"\n",encoding="ascii"); print(f"wrote {dst} ({sum(pixels)} ink pixels, threshold={threshold})")


def main():
    p=argparse.ArgumentParser(); sub=p.add_subparsers(dest="cmd",required=True)
    a=sub.add_parser("pbm-to-png"); a.add_argument("src"); a.add_argument("dst")
    a=sub.add_parser("png-to-pbm"); a.add_argument("src"); a.add_argument("dst"); a.add_argument("--width",type=int,required=True); a.add_argument("--height",type=int,required=True); a.add_argument("--threshold",type=int,default=128)
    a=p.parse_args()
    if a.cmd=="pbm-to-png": pbm_to_png(a.src,a.dst)
    else: png_to_pbm(a.src,a.dst,a.width,a.height,a.threshold)


if __name__=="__main__": main()
