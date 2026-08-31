#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Post-process an already-built SS FS2 Track 1 BIN with palette-index layers."""

import json
import queue
import shutil
import subprocess
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

ROOT = Path(__file__).resolve().parents[1]
RESOURCE_DEFAULTS = [(714, "0-2"), (1073, "1-4"), (1074, "1-4,9,10,224-231"), (1087, "1,2,4,19,21-23,26-28,30-32,36,93,96-98,101,104,108,109,113,115,116,118,119,122,127,131,132,134,149,151,153,163,201,224-231"), (1088, "5-10")]


def parse_indexes(text):
    values = []
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = map(int, part.split("-", 1))
            values.extend(range(min(a, b), max(a, b) + 1))
        else:
            values.append(int(part))
    values = sorted(set(values))
    if not values or values[0] < 0 or values[-1] > 255:
        raise ValueError("팔레트 인덱스는 0..255 범위여야 합니다.")
    return values


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("SS 파랜드 사가 2 - 팔레트 레이어 후처리")
        self.geometry("1180x780")
        self.minsize(980, 680)
        self.events = queue.Queue()
        self.running = False
        self.proc = None
        self.paths = {
            "input": tk.StringVar(value=str(ROOT / "output/ss-fs2-korean-final-track1.bin")),
            "track2": tk.StringVar(value=str(ROOT / "output/ss-fs2-korean-final-track2.bin")),
            "output": tk.StringVar(value=str(ROOT / "output/ss-fs2-korean-palette-final.bin")),
            "work": tk.StringVar(value=str(ROOT / "tmp/ss-fs2-palette-layer")),
            "threshold": tk.StringVar(value="38"),
            "split": tk.BooleanVar(value=True),
        }
        self.rows = []
        self._ui()
        self.after(100, self._drain)

    def _ui(self):
        self.columnconfigure(0, weight=1); self.rowconfigure(3, weight=1)
        top = ttk.LabelFrame(self, text="입출력", padding=8); top.grid(row=0, column=0, sticky="ew", padx=8, pady=8); top.columnconfigure(1, weight=1)
        fields = [("최종 빌드 Track 1 BIN", "input", "open"), ("원본 Track 2 BIN (CUE용)", "track2", "open"), ("출력 Track 1 BIN", "output", "save"), ("레이어 작업 폴더", "work", "dir")]
        for r,(label,key,kind) in enumerate(fields):
            ttk.Label(top,text=label).grid(row=r,column=0,sticky="w",pady=2); ttk.Entry(top,textvariable=self.paths[key]).grid(row=r,column=1,sticky="ew",padx=6,pady=2); ttk.Button(top,text="...",width=4,command=lambda k=key,t=kind:self._browse(k,t)).grid(row=r,column=2)
        table = ttk.LabelFrame(self,text="대상 SS 리소스와 팔레트 인덱스",padding=8); table.grid(row=1,column=0,sticky="ew",padx=8)
        ttk.Label(table,text="사용",width=7).grid(row=0,column=0); ttk.Label(table,text="SS ID",width=10).grid(row=0,column=1); ttk.Label(table,text="팔레트 인덱스",width=22).grid(row=0,column=2); ttk.Label(table,text="설명").grid(row=0,column=3,sticky="w")
        notes = ["PS1 828 대응", "PS1 1187 대응", "PS1 1188 대응", "PS1 1201 대응 (저장/불러오기 배경 후보 21,22)", "PS1 1202 대응"]
        for n,((rid,indexes),note) in enumerate(zip(RESOURCE_DEFAULTS,notes),1):
            enabled=tk.BooleanVar(value=True); idx=tk.StringVar(value=indexes); self.rows.append((rid,enabled,idx))
            ttk.Checkbutton(table,variable=enabled).grid(row=n,column=0); ttk.Label(table,text=str(rid)).grid(row=n,column=1); ttk.Entry(table,textvariable=idx,width=22).grid(row=n,column=2,padx=6,pady=2); ttk.Label(table,text=note).grid(row=n,column=3,sticky="w")
        controls=ttk.Frame(self,padding=8); controls.grid(row=2,column=0,sticky="ew")
        ttk.Label(controls,text="색상 허용 오차").pack(side="left"); ttk.Entry(controls,textvariable=self.paths["threshold"],width=5).pack(side="left",padx=(4,12)); ttk.Checkbutton(controls,text="인덱스마다 PNG 분리",variable=self.paths["split"]).pack(side="left",padx=(0,12))
        self.export_btn=ttk.Button(controls,text="1. 레이어 추출",command=self.export); self.export_btn.pack(side="left",padx=4)
        self.apply_btn=ttk.Button(controls,text="2. 편집 레이어 재삽입",command=self.apply); self.apply_btn.pack(side="left",padx=4)
        self.stop_btn=ttk.Button(controls,text="중지",command=self.stop,state="disabled"); self.stop_btn.pack(side="left",padx=4)
        body=ttk.Frame(self,padding=(8,0,8,8)); body.grid(row=3,column=0,sticky="nsew"); body.rowconfigure(1,weight=1); body.columnconfigure(0,weight=1)
        help_text=("① 추출 후 작업 폴더의 *-edit.png만 편집합니다. 검은색은 변경하지 않음을 뜻합니다.\n"
                   "② 0번 레이어는 흰색=인덱스 0, 검은색=변경 없음으로 단독 출력됩니다.\n"
                   "③ context.png와 legend.png는 참고용입니다. 크기를 바꾸지 말고 지정 색을 유지합니다.\n"
                   "④ 재삽입은 최종 빌드 BIN을 복사한 새 BIN에만 적용하며, 타일 용량 초과 시 안전하게 중단합니다.")
        ttk.Label(body,text=help_text).grid(row=0,column=0,sticky="w",pady=(0,6)); self.log=tk.Text(body,wrap="word"); self.log.grid(row=1,column=0,sticky="nsew")

    def _browse(self,key,kind):
        cur=Path(self.paths[key].get() or ROOT); initial=str(cur if cur.is_dir() else cur.parent)
        if kind=="dir": value=filedialog.askdirectory(initialdir=initial)
        elif kind=="save": value=filedialog.asksaveasfilename(initialdir=initial,initialfile=cur.name,filetypes=[("BIN","*.bin"),("All","*")])
        else: value=filedialog.askopenfilename(initialdir=initial,filetypes=[("BIN","*.bin"),("All","*")])
        if value:self.paths[key].set(value)

    def selected(self):
        result=[]
        for rid,enabled,index_text in self.rows:
            if enabled.get(): result.append((rid,parse_indexes(index_text.get())))
        if not result: raise ValueError("대상 리소스를 하나 이상 선택하세요.")
        if not self.paths["split"].get():
            for rid, indexes in result:
                if 0 in indexes and len(indexes) > 1:
                    raise ValueError(f"SS {rid}: 인덱스 0은 다른 인덱스와 합치지 말고 단독 레이어로 추출하세요.")
        return result

    def _start(self,worker):
        if self.running:return
        try: selected=self.selected(); int(self.paths["threshold"].get())
        except Exception as exc: messagebox.showerror("입력 오류",str(exc)); return
        self.running=True; self.export_btn.configure(state="disabled"); self.apply_btn.configure(state="disabled"); self.stop_btn.configure(state="normal"); self.log.delete("1.0","end")
        threading.Thread(target=lambda:self._worker_wrapper(worker,selected),daemon=True).start()

    def _worker_wrapper(self,worker,selected):
        try: worker(selected); self.events.put(("done",True,"작업이 완료되었습니다."))
        except Exception as exc: self.events.put(("done",False,str(exc)))

    def run(self,cmd):
        self.events.put(("log","\n> "+subprocess.list2cmdline([str(x) for x in cmd])+"\n"))
        self.proc=subprocess.Popen([str(x) for x in cmd],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding="utf-8",errors="replace")
        for line in self.proc.stdout:self.events.put(("log",line))
        code=self.proc.wait(); self.proc=None
        if code: raise RuntimeError(f"명령이 실패했습니다 (exit {code})")

    def export(self): self._start(self._export_worker)
    def _export_worker(self,selected):
        work=Path(self.paths["work"].get()); work.mkdir(parents=True,exist_ok=True); ids=[str(r) for r,_ in selected]
        self.run(["node",ROOT/"scripts/ss-fs2-palette-layer-resource.js","export",self.paths["input"].get(),work,*ids])
        for rid,indexes in selected:
            groups=[[x] for x in indexes] if self.paths["split"].get() else [indexes]
            for group in groups:
                text=",".join(map(str,group)); label="idx"+"_".join(map(str,group))
                self.run(["python",ROOT/"scripts/be-hdr-red-layer-tool.py","export",work/f"ss-fs2-resource-{rid}-raw.pgm",work,"--prefix",f"ss-fs2-resource-{rid}","--indexes",text,"--label",label])
        self.events.put(("log",f"\n편집할 PNG 위치: {work}\n"))

    def apply(self): self._start(self._apply_worker)
    def _apply_worker(self,selected):
        work=Path(self.paths["work"].get()); items=[]
        for rid,indexes in selected:
            current=work/f"ss-fs2-resource-{rid}-raw.pgm"
            if not current.exists(): raise FileNotFoundError(f"먼저 추출해야 합니다: {current}")
            groups=[[x] for x in indexes] if self.paths["split"].get() else [indexes]
            applied=0
            for group in groups:
                text=",".join(map(str,group)); label="idx"+"_".join(map(str,group)); edit=work/f"ss-fs2-resource-{rid}-{label}-edit.png"
                if not edit.exists(): self.events.put(("log",f"[건너뜀] 편집 PNG 없음: {edit.name}\n")); continue
                out=work/f"ss-fs2-resource-{rid}-{label}-applied-{applied}.pgm"
                self.run(["python",ROOT/"scripts/be-hdr-red-layer-tool.py","apply",current,edit,out,"--indexes",text,"--threshold",self.paths["threshold"].get()]); current=out; applied+=1
            items.append({"id":rid,"pgm":str(current.resolve())})
        manifest=work/"apply-manifest.json"; manifest.write_text(json.dumps({"version":1,"items":items},ensure_ascii=False,indent=2),encoding="utf-8")
        output=Path(self.paths["output"].get()); output.parent.mkdir(parents=True,exist_ok=True); report=output.with_suffix(".report.json")
        self.run(["node",ROOT/"scripts/ss-fs2-palette-layer-resource.js","apply",self.paths["input"].get(),output,manifest,report])
        self.run(["node",ROOT/"scripts/ss-fs2-verify-patched-bin.js",self.paths["input"].get(),output])
        track2=Path(self.paths["track2"].get()); cue=output.with_suffix(".cue")
        cue.write_text(f'FILE "{output.name}" BINARY\n  TRACK 01 MODE1/2352\n    INDEX 01 00:00:00\nFILE "{track2.resolve()}" BINARY\n  TRACK 02 AUDIO\n    PREGAP 00:02:00\n    INDEX 01 00:00:00\n',encoding="ascii")
        self.events.put(("log",f"\n출력: {output}\nCUE: {cue}\n보고서: {report}\n"))

    def stop(self):
        if self.proc and self.proc.poll() is None:self.proc.terminate(); self.events.put(("log","\n[중지 요청]\n"))

    def _drain(self):
        try:
            while True:
                event=self.events.get_nowait()
                if event[0]=="log": self.log.insert("end",event[1]); self.log.see("end")
                elif event[0]=="done":
                    self.running=False; self.export_btn.configure(state="normal"); self.apply_btn.configure(state="normal"); self.stop_btn.configure(state="disabled")
                    (messagebox.showinfo if event[1] else messagebox.showerror)("완료" if event[1] else "오류",event[2])
        except queue.Empty: pass
        self.after(100,self._drain)


if __name__ == "__main__": App().mainloop()
