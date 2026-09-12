#!/usr/bin/env python
"""Reconstruct the statically loaded PS1 ending VRAM pages (resources 24..26)."""
import sys
from pathlib import Path
import numpy as np
from PIL import Image

dat = Path(sys.argv[1]).read_bytes()
exe = Path(sys.argv[2]).read_bytes()
out = Path(sys.argv[3])
load = int.from_bytes(exe[0x18:0x1c], 'little')
table = 0x801c4f68 - load + 0x800
offs=[]; carry=0; prev=0
for i in range(4338):
    raw=int.from_bytes(exe[table+i*2:table+i*2+2],'little')
    if i and raw<prev: carry+=0x10000
    offs.append((raw+carry)*2048); prev=raw
vram=np.zeros((512,1024),dtype=np.uint16)
for rid,x,y,w,h,skip in [(24,0,0,512,256,0),(25,640,256,384,256,0),(26,768,0,256,256,512)]:
    raw=dat[offs[rid]+skip:offs[rid+1]]
    words=np.frombuffer(raw[:len(raw)//2*2],dtype='<u2')
    n=min(len(words),w*h)
    for row in range((n+w-1)//w):
        take=min(w,n-row*w)
        vram[y+row,x:x+take]=words[row*w:row*w+take]
r=((vram>>0)&31)*255//31; g=((vram>>5)&31)*255//31; b=((vram>>10)&31)*255//31
rgb=np.dstack((r,g,b)).astype(np.uint8)
out.parent.mkdir(parents=True,exist_ok=True)
Image.fromarray(rgb,'RGB').save(out)
print(out)
