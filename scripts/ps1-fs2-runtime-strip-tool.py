#!/usr/bin/env python
"""Export/import PS1 FS2 runtime-composed ending strips in resource 23."""
import argparse
from pathlib import Path
import numpy as np
from PIL import Image

WIDTH, HEIGHT, BLOCK_BYTES, FRAME_COUNT = 320, 48, 2560, 47

def layout(exe):
    load=int.from_bytes(exe[0x18:0x1c],'little');rtab=0x801c4f68-load+0x800
    offs=[];carry=0;prev=0
    for i in range(4338):
        raw=int.from_bytes(exe[rtab+i*2:rtab+i*2+2],'little')
        if i and raw<prev:carry+=0x10000
        offs.append((raw+carry)*2048);prev=raw
    ftab=0x8016b320-load+0x800
    return offs,[(exe[ftab+i*2],exe[ftab+i*2+1]) for i in range(FRAME_COUNT)]

def compose(bank,start,count):
    if count>6:raise ValueError(f'invalid strip count {count}')
    raw=bank[start*BLOCK_BYTES:(start+count)*BLOCK_BYTES]
    if len(raw)!=count*BLOCK_BYTES:raise ValueError('resource 23 strip is truncated')
    canvas=np.zeros((HEIGHT,WIDTH),np.uint8);canvas[(6-count)*4:(6-count)*4+count*8]=raw.reshape(count*8,WIDTH)
    return canvas

def export(args):
    dat=Path(args.dat).read_bytes();exe=Path(args.exe).read_bytes();offs,frames=layout(exe)
    bank=np.frombuffer(dat[offs[23]:offs[24]],dtype=np.uint8);out=Path(args.outdir);out.mkdir(parents=True,exist_ok=True)
    for i,(start,count) in enumerate(frames):
        indexes=compose(bank,start,count);gray=np.choose(np.minimum(indexes,2),[0,128,255]).astype(np.uint8)
        Image.fromarray(gray,'L').save(out/f'ps1-fs2-runtime-frame-{i:02d}.png')
    print(f'exported {FRAME_COUNT} runtime frames to {out}')

def apply(args):
    original=Path(args.dat).read_bytes();dat=bytearray(original);exe=Path(args.exe).read_bytes();offs,frames=layout(exe);editdir=Path(args.editdir)
    writes={};edited=[]
    for i,(start,count) in enumerate(frames):
        p=editdir/f'ps1-fs2-runtime-frame-{i:02d}-ko-edit.png'
        if not p.is_file():continue
        image=Image.open(p).convert('L')
        if image.size!=(WIDTH,HEIGHT):raise ValueError(f'{p.name}: expected {WIDTH}x{HEIGHT}, got {image.size}')
        pix=np.asarray(image);y=(6-count)*4
        indexes=np.rint(pix[y:y+count*8].astype(np.float32)*2/255).clip(0,2).astype(np.uint8).tobytes();pos=offs[23]+start*BLOCK_BYTES
        for n,value in enumerate(indexes):
            absolute=pos+n
            if absolute in writes and writes[absolute]!=value:raise ValueError(f'{p.name}: conflicts at resource 23 +0x{absolute-offs[23]:x}')
            writes[absolute]=value
        edited.append(i)
    if not edited:raise FileNotFoundError('no ps1-fs2-runtime-frame-NN-ko-edit.png files found')
    for pos,value in writes.items():dat[pos]=value
    out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(dat)
    print(f'wrote {out}: editedFrames={edited}, changedBytes={sum(dat[p]!=original[p] for p in writes)}')

def map_resource14(args):
    source=Image.open(args.source_png).convert('L')
    if source.size!=(320,240):raise ValueError(f'expected 320x240 resource 14 PNG, got {source.size}')
    src=np.asarray(source);folder=Path(args.frame_dir)
    for frame in range(2,12):
        original=folder/f'ps1-fs2-runtime-frame-{frame:02d}.png'
        if not original.is_file():raise FileNotFoundError(f'missing exported runtime frame: {original}')
        image=np.array(Image.open(original).convert('L'),copy=True)
        image[16:32]=src[(frame-2)*16:(frame-1)*16]
        output=folder/f'ps1-fs2-runtime-frame-{frame:02d}-ko-edit.png'
        Image.fromarray(image,'L').save(output)
        print(f'wrote {output}')

def map_resource15(args):
    source=Image.open(args.source_png).convert('L')
    if source.size!=(320,240):raise ValueError(f'expected 320x240 resource 15 PNG, got {source.size}')
    src=np.asarray(source);folder=Path(args.frame_dir)
    for frame in range(13,18):
        original=folder/f'ps1-fs2-runtime-frame-{frame:02d}.png'
        if not original.is_file():raise FileNotFoundError(f'missing exported runtime frame: {original}')
        image=np.array(Image.open(original).convert('L'),copy=True)
        image[8:40]=src[(frame-13)*32:(frame-12)*32]
        output=folder/f'ps1-fs2-runtime-frame-{frame:02d}-ko-edit.png'
        Image.fromarray(image,'L').save(output)
        print(f'wrote {output}')

def map_resource16(args):
    source=Image.open(args.source_png).convert('L')
    if source.size!=(320,240):raise ValueError(f'expected 320x240 resource 16 PNG, got {source.size}')
    src=np.asarray(source);folder=Path(args.frame_dir)
    for frame in range(19,22):
        original=folder/f'ps1-fs2-runtime-frame-{frame:02d}.png'
        if not original.is_file():raise FileNotFoundError(f'missing exported runtime frame: {original}')
        image=np.array(Image.open(original).convert('L'),copy=True)
        image[16:32]=src[(frame-19)*16:(frame-18)*16]
        output=folder/f'ps1-fs2-runtime-frame-{frame:02d}-ko-edit.png'
        Image.fromarray(image,'L').save(output)
        print(f'wrote {output}')

RESOURCE_MAPS = {
    18: [(24,0,16,-32),(25,16,16,-32),(26,32,32,-32),(27,64,32,-32),(28,96,32,-32)],
    19: [(29,0,16,2),(30,16,32,2),(31,48,32,2)],
    20: [(32,0,16,-4),(33,16,32,-3),(34,48,32,-3),(35,80,32,4),(36,112,32,-3)],
    21: [(37,0,16,-31),(38,16,32,-29),(39,48,16,0)],
}

def map_resource18_21(args):
    rid=args.resource_id
    if rid not in RESOURCE_MAPS:raise ValueError('resource must be 18, 19, 20, or 21')
    source=Image.open(args.source_png).convert('L')
    if source.size!=(320,240):raise ValueError(f'expected 320x240 resource {rid} PNG, got {source.size}')
    src=np.asarray(source);folder=Path(args.frame_dir)
    for frame,sy,height,dx in RESOURCE_MAPS[rid]:
        original=folder/f'ps1-fs2-runtime-frame-{frame:02d}.png'
        if not original.is_file():raise FileNotFoundError(f'missing exported runtime frame: {original}')
        image=np.array(Image.open(original).convert('L'),copy=True);count=height//8;y=(6-count)*4
        strip=np.zeros((height,320),dtype=np.uint8)
        if dx>=0:strip[:,dx:]=src[sy:sy+height,:320-dx]
        else:strip[:,:320+dx]=src[sy:sy+height,-dx:]
        # The white right-hand boundary is a runtime layout marker, not part
        # of the shifted credit artwork.
        boundary=image[y:y+height,319].copy();image[y:y+height]=strip;image[y:y+height,319]=boundary
        output=folder/f'ps1-fs2-runtime-frame-{frame:02d}-ko-edit.png';Image.fromarray(image,'L').save(output)
        print(f'wrote {output} (resource={rid}, sourceY={sy}, height={height}, dx={dx})')

def main():
    ap=argparse.ArgumentParser();sub=ap.add_subparsers(dest='command',required=True)
    p=sub.add_parser('export');p.add_argument('dat');p.add_argument('exe');p.add_argument('outdir');p.set_defaults(func=export)
    p=sub.add_parser('apply');p.add_argument('dat');p.add_argument('exe');p.add_argument('editdir');p.add_argument('output');p.set_defaults(func=apply)
    p=sub.add_parser('map-resource14');p.add_argument('source_png');p.add_argument('frame_dir');p.set_defaults(func=map_resource14)
    p=sub.add_parser('map-resource15');p.add_argument('source_png');p.add_argument('frame_dir');p.set_defaults(func=map_resource15)
    p=sub.add_parser('map-resource16');p.add_argument('source_png');p.add_argument('frame_dir');p.set_defaults(func=map_resource16)
    p=sub.add_parser('map-resource18-21');p.add_argument('resource_id',type=int);p.add_argument('source_png');p.add_argument('frame_dir');p.set_defaults(func=map_resource18_21)
    a=ap.parse_args();a.func(a)
if __name__=='__main__':main()
