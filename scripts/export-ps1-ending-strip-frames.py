#!/usr/bin/env python
"""Export the 47 runtime-composed 320x48 ending strips from resource 23."""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageOps

dat=Path(sys.argv[1]).read_bytes(); exe=Path(sys.argv[2]).read_bytes(); out=Path(sys.argv[3])
load=int.from_bytes(exe[0x18:0x1c],'little'); rtab=0x801c4f68-load+0x800
offs=[];carry=0;prev=0
for i in range(4338):
 raw=int.from_bytes(exe[rtab+i*2:rtab+i*2+2],'little')
 if i and raw<prev:carry+=0x10000
 offs.append((raw+carry)*2048);prev=raw
bank=np.frombuffer(dat[offs[23]:offs[24]],dtype=np.uint8)
ftab=0x8016b320-load+0x800
out.mkdir(parents=True,exist_ok=True)
frames=[]
for i in range(47):
 start=exe[ftab+i*2]; count=exe[ftab+i*2+1]
 canvas=np.zeros((48,320),dtype=np.uint8)
 size=count*2560; raw=bank[start*2560:start*2560+size]
 if len(raw)==size and count<=6:
  strip=raw.reshape(count*8,320)
  y=(6-count)*4
  canvas[y:y+count*8]=strip
 preview=ImageOps.autocontrast(Image.fromarray(canvas,'L'))
 preview.save(out/f'frame-{i:02d}-start-{start:03d}-count-{count}.png')
 frames.append((canvas,start,count))
sheet=Image.new('L',(640,47*64),0); draw=ImageDraw.Draw(sheet)
for i,(frame,start,count) in enumerate(frames):
 y=i*64; sheet.paste(ImageOps.autocontrast(Image.fromarray(frame,'L')),(0,y)); draw.text((330,y+15),f'{i:02d} start={start} count={count}',fill=255)
sheet.save(out/'contact-sheet.png')
print(out/'contact-sheet.png')
