#!/usr/bin/env python
"""Match resource 12 subtitle silhouette inside raw ending VRAM resources."""
import sys
from collections import Counter
from pathlib import Path
import cv2
import numpy as np

dat=Path(sys.argv[1]).read_bytes(); exe=Path(sys.argv[2]).read_bytes()
load=int.from_bytes(exe[0x18:0x1c],'little'); tab=0x801c4f68-load+0x800
offs=[];carry=0;prev=0
for i in range(4338):
 raw=int.from_bytes(exe[tab+i*2:tab+i*2+2],'little')
 if i and raw<prev:carry+=0x10000
 offs.append((raw+carry)*2048);prev=raw
b=offs[12];wt=int.from_bytes(dat[b:b+4],'big');ht=int.from_bytes(dat[b+4:b+8],'big');td=int.from_bytes(dat[b+12:b+16],'big');mb=wt*ht*2
mo=0x210 if ((0x210+mb+3)&~3)==td else 0x10
img=np.zeros((ht*8,wt*8),np.uint8)
for c in range(wt*ht):
 t=int.from_bytes(dat[b+mo+c*2:b+mo+c*2+2],'big')>>1
 img[(c//wt)*8:(c//wt+1)*8,(c%wt)*8:(c%wt+1)*8]=np.frombuffer(dat,dtype=np.uint8,count=64,offset=b+td+t*64).reshape(8,8)
crop=img[29:44,130:193]; bg=Counter(crop.ravel()).most_common(1)[0][0]; tpl=(crop!=bg).astype(np.uint8)
templates=[tpl[:,i*16:min((i+1)*16,tpl.shape[1])] for i in range(4)]
rows=[]
for rid in (24,25,26):
 raw=np.frombuffer(dat[offs[rid]:offs[rid+1]],dtype=np.uint8)
 for bpp,widths in ((8,(320,384,512,640,768,1024)),(4,(640,768,1024,1280,1536,2048))):
  pix=raw if bpp==8 else np.column_stack((raw&15,raw>>4)).reshape(-1)
  for width in widths:
   height=len(pix)//width
   if height<tpl.shape[0]:continue
   view=pix[:height*width].reshape(height,width)
   for val,_ in Counter(view.ravel()).most_common(32):
    layer=(view==val).astype(np.uint8)
    score=cv2.matchTemplate(layer,tpl,cv2.TM_CCOEFF_NORMED)
    _,mx,_,loc=cv2.minMaxLoc(score)
    rows.append((mx,rid,bpp,width,height,val,loc))
 # Direct-color VRAM pages. Geometry is independent of 16-bit byte order.
 words=np.frombuffer(raw[:len(raw)//2*2],dtype='<u2')
 for width in (256,320,384,512,640):
  height=len(words)//width
  if height<tpl.shape[0]:continue
  view=words[:height*width].reshape(height,width)
  for val,_ in Counter(view.ravel()).most_common(64):
   layer=(view==val).astype(np.uint8)
   score=cv2.matchTemplate(layer,tpl,cv2.TM_CCOEFF_NORMED)
   _,mx,_,loc=cv2.minMaxLoc(score)
   rows.append((mx,rid,16,width,height,int(val),loc))
for r in sorted(rows,reverse=True)[:80]:print(f'{r[0]:.6f}\tr{r[1]}\t{r[2]}bpp\t{r[3]}x{r[4]}\tidx={r[5]}\tx={r[6][0]} y={r[6][1]}')

print('\nper-character matches')
charrows=[]
for rid in (24,25,26):
 raw=np.frombuffer(dat[offs[rid]:offs[rid+1]],dtype=np.uint8)
 views=[]
 for bpp,widths in ((8,(320,384,512,640,768,1024)),(4,(640,768,1024,1280,1536,2048))):
  pix=raw if bpp==8 else np.column_stack((raw&15,raw>>4)).reshape(-1)
  for width in widths:
   height=len(pix)//width
   if height>=15:views.append((bpp,width,height,pix[:height*width].reshape(height,width)))
 words=np.frombuffer(raw[:len(raw)//2*2],dtype='<u2')
 for width in (256,320,384,512,640):
  height=len(words)//width
  if height>=15:views.append((16,width,height,words[:height*width].reshape(height,width)))
 for bpp,width,height,view in views:
  best=[]
  for ct in templates:
   cb=[]
   for val,_ in Counter(view.ravel()).most_common(64):
    s=cv2.matchTemplate((view==val).astype(np.uint8),ct,cv2.TM_CCOEFF_NORMED)
    _,mx,_,loc=cv2.minMaxLoc(s);cb.append((mx,int(val),loc))
   best.append(max(cb))
  charrows.append((sum(q[0] for q in best)/4,rid,bpp,width,height,best))
for avg,rid,bpp,width,height,best in sorted(charrows,reverse=True)[:40]:
 print(f'{avg:.6f}\tr{rid}\t{bpp}bpp\t{width}x{height}\t'+','.join(f'{q[0]:.3f}@{q[2][0]},{q[2][1]}:{q[1]}' for q in best))
