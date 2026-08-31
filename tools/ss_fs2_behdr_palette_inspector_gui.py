#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Inspect raw palette indexes of SS Farland Saga 2 be-hdr resources."""

import importlib.util
import queue
import subprocess
import threading
from collections import Counter
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, ttk

from PIL import Image, ImageTk

ROOT = Path(__file__).resolve().parents[1]
ZOOMS = {"50%": .5, "100%": 1, "200%": 2, "400%": 4, "800%": 8}
KNOWN_IDS = (714, 1073, 1074, 1087, 1088)
_spec = importlib.util.spec_from_file_location("colorize_behdr_pgm", ROOT / "scripts/colorize-behdr-pgm.py")
colors = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(colors)


def describe(v):
    if v == 0: return "black / empty"
    if v == 1: return "text outline candidate"
    if v == 2: return "text fill candidate"
    if v == 3: return "erase/background candidate"
    if v == 4: return "normal background candidate"
    if v in (21, 22): return "save/load background candidate"
    if 224 <= v <= 231: return "animated text/glow gradient"
    if v in colors.TRIM_VALUES: return "border/frame trim marker"
    return "other / inspect in context"


class App(tk.Tk):
    def __init__(self):
        super().__init__(); self.title("SS FS2 be-hdr 팔레트 인덱스 검사기"); self.geometry("1260x780"); self.minsize(980,580)
        self.events=queue.Queue(); self.width=self.height=None; self.pixels=None; self.photo=None; self.drag=None; self.rect=None
        self.bin=tk.StringVar(value=str(ROOT/"output/ss-fs2-korean-final-track1.bin")); self.work=tk.StringVar(value=str(ROOT/"tmp/ss-fs2-palette-inspector")); self.rid=tk.StringVar(value="1087"); self.zoom=tk.StringVar(value="200%")
        self._ui(); self.after(100,self._drain)

    def _ui(self):
        self.columnconfigure(0,weight=3); self.columnconfigure(1,weight=2); self.rowconfigure(1,weight=1)
        top=ttk.Frame(self,padding=8); top.grid(row=0,column=0,columnspan=2,sticky="ew"); top.columnconfigure(1,weight=1)
        for row,(label,var,kind) in enumerate((("SS 최종 Track 1 BIN",self.bin,"file"),("작업 폴더",self.work,"dir"))):
            ttk.Label(top,text=label).grid(row=row,column=0,sticky="w",pady=2); ttk.Entry(top,textvariable=var).grid(row=row,column=1,sticky="ew",padx=6,pady=2); ttk.Button(top,text="...",width=4,command=lambda v=var,k=kind:self._browse(v,k)).grid(row=row,column=2)
        ctl=ttk.Frame(top); ctl.grid(row=2,column=0,columnspan=3,sticky="ew",pady=(6,0)); ttk.Label(ctl,text="SS 리소스 ID").pack(side="left")
        ttk.Combobox(ctl,textvariable=self.rid,values=[str(x) for x in KNOWN_IDS],width=9).pack(side="left",padx=(4,10)); ttk.Button(ctl,text="검사",command=self.inspect).pack(side="left")
        ttk.Label(ctl,text="확대").pack(side="left",padx=(16,0)); z=ttk.Combobox(ctl,textvariable=self.zoom,values=list(ZOOMS),width=6,state="readonly"); z.pack(side="left",padx=4); z.bind("<<ComboboxSelected>>",lambda _e:self.redraw())
        ttk.Button(ctl,text="색상화 PNG 저장...",command=self.save).pack(side="left",padx=(12,0)); ttk.Label(ctl,text="알려진 대상: 714 / 1073 / 1074 / 1087 / 1088",foreground="#666").pack(side="left",padx=16)
        cf=ttk.Frame(self); cf.grid(row=1,column=0,sticky="nsew",padx=(8,4),pady=(0,8)); cf.rowconfigure(0,weight=1); cf.columnconfigure(0,weight=1)
        self.canvas=tk.Canvas(cf,background="#202020"); vb=ttk.Scrollbar(cf,orient="vertical",command=self.canvas.yview); hb=ttk.Scrollbar(cf,orient="horizontal",command=self.canvas.xview); self.canvas.configure(yscrollcommand=vb.set,xscrollcommand=hb.set); self.canvas.grid(row=0,column=0,sticky="nsew"); vb.grid(row=0,column=1,sticky="ns"); hb.grid(row=1,column=0,sticky="ew")
        self.canvas.bind("<ButtonPress-1>",self.drag_start); self.canvas.bind("<B1-Motion>",self.drag_move); self.canvas.bind("<ButtonRelease-1>",self.drag_end)
        self.status=tk.StringVar(value="이미지를 클릭하거나 드래그해 인덱스를 확인하세요."); ttk.Label(cf,textvariable=self.status).grid(row=2,column=0,columnspan=2,sticky="w",pady=(4,0))
        side=ttk.Frame(self,padding=(4,0,8,8)); side.grid(row=1,column=1,sticky="nsew"); side.columnconfigure(0,weight=1); side.rowconfigure(1,weight=1); side.rowconfigure(3,weight=1)
        ttk.Label(side,text="전체 이미지 인덱스 분포").grid(row=0,column=0,sticky="w"); self.full=self.tree(side); self.full.grid(row=1,column=0,sticky="nsew",pady=(0,8)); ttk.Label(side,text="선택 영역 인덱스 분포").grid(row=2,column=0,sticky="w"); self.region=self.tree(side); self.region.grid(row=3,column=0,sticky="nsew",pady=(0,8))
        ttk.Label(side,text="표시 색상은 인덱스를 구분하기 위한 디버그 색상입니다. 실제 게임 색상은 팔레트 전환 상태에 따라 달라질 수 있습니다.",wraplength=390,justify="left",foreground="#666").grid(row=4,column=0,sticky="ew",pady=(0,8)); self.log=tk.Text(side,height=7,wrap="word"); self.log.grid(row=5,column=0,sticky="nsew")

    def tree(self,parent):
        t=ttk.Treeview(parent,columns=("i","n","p","d"),show="headings",height=8)
        for c,label,w,a in (("i","Index",50,"center"),("n","Count",75,"e"),("p","%",55,"e"),("d","설명",220,"w")): t.heading(c,text=label); t.column(c,width=w,anchor=a,stretch=c=="d")
        return t

    def _browse(self,var,kind):
        p=Path(var.get() or ROOT); initial=str(p if p.is_dir() else p.parent); value=filedialog.askdirectory(initialdir=initial) if kind=="dir" else filedialog.askopenfilename(initialdir=initial,filetypes=[("BIN","*.bin"),("모든 파일","*")]);
        if value: var.set(value)

    def inspect(self):
        text=self.rid.get().strip()
        if not text.isdigit(): self.write("[오류] 리소스 ID는 숫자여야 합니다.\n"); return
        out=Path(self.work.get()); out.mkdir(parents=True,exist_ok=True); cmd=["node",ROOT/"scripts/ss-fs2-palette-layer-resource.js","export",self.bin.get(),out,text]; self.write("\n> "+subprocess.list2cmdline([str(x) for x in cmd])+"\n")
        def worker():
            try:
                p=subprocess.Popen([str(x) for x in cmd],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding="utf-8",errors="replace")
                for line in p.stdout:self.events.put(("log",line))
                code=p.wait(); self.events.put(("log",f"[exit {code}]\n"))
                if code==0:self.events.put(("load",str(out/f"ss-fs2-resource-{text}-raw.pgm")))
            except Exception as e:self.events.put(("log",f"[오류] {e}\n"))
        threading.Thread(target=worker,daemon=True).start()

    def load(self,p):
        self.width,self.height,self.pixels=colors.read_pgm(p); self.write(f"불러옴: {p} ({self.width}x{self.height})\n"); self.redraw(); self.hist(self.full,self.pixels); self.region.delete(*self.region.get_children()); self.status.set("이미지를 클릭하거나 드래그해 인덱스를 확인하세요.")

    def hist(self,t,values):
        t.delete(*t.get_children()); total=len(values)
        for v,n in Counter(values).most_common():t.insert("","end",values=(v,n,f"{n/total*100:.1f}",describe(v)))

    def redraw(self):
        if self.pixels is None:return
        im=Image.new("RGB",(self.width,self.height)); im.putdata([colors.colorize(v) for v in self.pixels]); z=ZOOMS[self.zoom.get()]
        if z!=1:im=im.resize((int(self.width*z),int(self.height*z)),Image.NEAREST)
        self.photo=ImageTk.PhotoImage(im); self.canvas.delete("all"); self.canvas.create_image(0,0,anchor="nw",image=self.photo); self.canvas.configure(scrollregion=(0,0,im.width,im.height)); self.rect=None

    def coord(self,e):
        z=ZOOMS[self.zoom.get()]; return max(0,min(self.width-1,int(self.canvas.canvasx(e.x)/z))),max(0,min(self.height-1,int(self.canvas.canvasy(e.y)/z)))
    def drag_start(self,e):
        if self.pixels is not None:self.drag=self.coord(e); self.draw_rect(self.drag,self.drag)
    def drag_move(self,e):
        if self.drag is not None:self.draw_rect(self.drag,self.coord(e))
    def draw_rect(self,a,b):
        z=ZOOMS[self.zoom.get()]; x0,x1=sorted((a[0],b[0])); y0,y1=sorted((a[1],b[1])); box=(x0*z,y0*z,(x1+1)*z,(y1+1)*z)
        if self.rect is None:self.rect=self.canvas.create_rectangle(*box,outline="#00ff00",width=2)
        else:self.canvas.coords(self.rect,*box)
    def drag_end(self,e):
        if self.drag is None:return
        b=self.coord(e); x0,x1=sorted((self.drag[0],b[0])); y0,y1=sorted((self.drag[1],b[1])); vals=[]
        for y in range(y0,y1+1):vals.extend(self.pixels[y*self.width+x0:y*self.width+x1+1])
        self.hist(self.region,vals); self.status.set(f"({x0},{y0}) index {vals[0]} — {describe(vals[0])}" if x0==x1 and y0==y1 else f"영역 ({x0},{y0})~({x1},{y1}) [{x1-x0+1}x{y1-y0+1}]"); self.drag=None

    def save(self):
        if self.pixels is None:self.write("[경고] 먼저 리소스를 검사하세요.\n"); return
        p=filedialog.asksaveasfilename(initialdir=self.work.get(),initialfile=f"ss-fs2-resource-{self.rid.get()}-colorized.png",defaultextension=".png",filetypes=[("PNG","*.png")]);
        if p:
            im=Image.new("RGB",(self.width,self.height)); im.putdata([colors.colorize(v) for v in self.pixels]); im.save(p); self.write(f"저장: {p}\n")
    def write(self,s):self.log.insert("end",s); self.log.see("end")
    def _drain(self):
        try:
            while True:
                kind,value=self.events.get_nowait(); self.write(value) if kind=="log" else self.load(value)
        except queue.Empty:pass
        self.after(100,self._drain)


if __name__=="__main__":App().mainloop()
