#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""Edit and post-process SS FS2 ending/menu/credit image resources."""

import json
import queue
import shutil
import subprocess
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk


ROOT = Path(__file__).resolve().parents[1]
RESOURCE_IDS = (0, 1, 2, 11, 12, 14, 15, 16, 18, 19, 20, 21)
CREDIT_IDS = (14, 15, 16, 18, 19, 20, 21)
DEFAULT_INPUT = ROOT / "output/ss-fs2-korean-final-track1.bin"
DEFAULT_TRACK2 = ROOT / "output/ss-fs2-korean-final-track2.bin"
DEFAULT_OUTPUT = ROOT / "output/ss-fs2-korean-ending-final.bin"
DEFAULT_WORK = ROOT / "tmp/ss-fs2-ending-resource-workflow"


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("SS 파랜드 사가 2 엔딩 이미지 편집/재삽입")
        self.geometry("1000x720")
        self.minsize(820, 600)
        self.events = queue.Queue()
        self.process = None
        self.running = False
        self.values = {
            "input": tk.StringVar(value=str(DEFAULT_INPUT)),
            "track2": tk.StringVar(value=str(DEFAULT_TRACK2)),
            "output": tk.StringVar(value=str(DEFAULT_OUTPUT)),
            "work": tk.StringVar(value=str(DEFAULT_WORK)),
        }
        self.enabled = {rid: tk.BooleanVar(value=True) for rid in RESOURCE_IDS}
        self.build_ui()
        self.after(100, self.poll)

    def build_ui(self):
        self.columnconfigure(0, weight=1)
        self.rowconfigure(3, weight=1)
        paths = ttk.LabelFrame(self, text="입력과 출력", padding=10)
        paths.grid(row=0, column=0, sticky="ew", padx=10, pady=10)
        paths.columnconfigure(1, weight=1)
        fields = (
            ("최종 빌드 Track 1 BIN", "input", "open"),
            ("Track 2 BIN (CUE용)", "track2", "open"),
            ("출력 Track 1 BIN", "output", "save"),
            ("작업 폴더", "work", "dir"),
        )
        for row, (label, key, mode) in enumerate(fields):
            ttk.Label(paths, text=label, width=22).grid(row=row, column=0, sticky="w", pady=3)
            ttk.Entry(paths, textvariable=self.values[key]).grid(row=row, column=1, sticky="ew", padx=6)
            ttk.Button(paths, text="찾기...", command=lambda k=key, m=mode: self.browse(k, m)).grid(row=row, column=2)

        resources = ttk.LabelFrame(self, text="처리할 SS 리소스", padding=10)
        resources.grid(row=1, column=0, sticky="ew", padx=10)
        notes = {
            0: "엔딩 질문", 1: "엔딩 선택지 2개", 2: "현재의 어트랙터로...", 11: "기획·개발·판매",
            12: "엔딩 크레딧", 14: "성우 캐스팅 1", 15: "성우 캐스팅 2", 16: "엔딩 크레딧",
            18: "엔딩 크레딧", 19: "엔딩 크레딧", 20: "엔딩 크레딧", 21: "엔딩 크레딧",
        }
        for index, rid in enumerate(RESOURCE_IDS):
            col, row = index % 3, index // 3
            ttk.Checkbutton(resources, variable=self.enabled[rid], text=f"{rid}: {notes[rid]}").grid(row=row, column=col, sticky="w", padx=(0, 20), pady=3)

        actions = ttk.Frame(self, padding=10)
        actions.grid(row=2, column=0, sticky="ew")
        self.export_button = ttk.Button(actions, text="1. 편집 PNG 추출", command=self.start_export)
        self.export_button.pack(side="left")
        self.apply_button = ttk.Button(actions, text="2. -ko-edit.png 자동 적용", command=self.start_apply)
        self.apply_button.pack(side="left", padx=6)
        self.stop_button = ttk.Button(actions, text="중지", command=self.stop, state="disabled")
        self.stop_button.pack(side="left")
        ttk.Label(actions, text="  추출 PNG를 복사해 파일명 끝을 -ko-edit.png로 바꾼 뒤 편집하세요.").pack(side="left")

        frame = ttk.LabelFrame(self, text="작업 로그", padding=6)
        frame.grid(row=3, column=0, sticky="nsew", padx=10, pady=(0, 10))
        frame.rowconfigure(0, weight=1); frame.columnconfigure(0, weight=1)
        self.log = tk.Text(frame, wrap="word", font=("Consolas", 9))
        self.log.grid(row=0, column=0, sticky="nsew")

    def browse(self, key, mode):
        current = Path(self.values[key].get() or ROOT)
        initial = str(current if current.is_dir() else current.parent)
        if mode == "dir": value = filedialog.askdirectory(initialdir=initial)
        elif mode == "save": value = filedialog.asksaveasfilename(initialdir=initial, initialfile=current.name, defaultextension=".bin", filetypes=[("BIN", "*.bin")])
        else: value = filedialog.askopenfilename(initialdir=initial, filetypes=[("BIN", "*.bin"), ("All files", "*.*")])
        if value: self.values[key].set(value)

    def selected(self):
        result = [rid for rid in RESOURCE_IDS if self.enabled[rid].get()]
        if not result: raise ValueError("리소스를 하나 이상 선택하세요.")
        return result

    def run(self, args):
        command = [str(value) for value in args]
        self.events.put(("log", "\n> " + subprocess.list2cmdline(command) + "\n"))
        self.process = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                        text=True, encoding="utf-8", errors="replace")
        for line in self.process.stdout: self.events.put(("log", line))
        code = self.process.wait(); self.process = None
        if code: raise RuntimeError(f"명령이 종료 코드 {code}로 실패했습니다.")

    def start(self, worker):
        if self.running: return
        try:
            ids = self.selected()
            if not Path(self.values["input"].get()).is_file(): raise FileNotFoundError("입력 Track 1 BIN이 없습니다.")
        except Exception as exc:
            messagebox.showerror("입력 오류", str(exc), parent=self); return
        self.running = True
        self.export_button.configure(state="disabled"); self.apply_button.configure(state="disabled"); self.stop_button.configure(state="normal")
        self.log.delete("1.0", "end")
        threading.Thread(target=self.worker_wrapper, args=(worker, ids), daemon=True).start()

    def worker_wrapper(self, worker, ids):
        try:
            worker(ids); self.events.put(("done", True, "작업이 완료되었습니다."))
        except Exception as exc: self.events.put(("done", False, str(exc)))

    def start_export(self): self.start(self.export_worker)

    def export_worker(self, ids):
        work = Path(self.values["work"].get()); work.mkdir(parents=True, exist_ok=True)
        source = self.values["input"].get()
        self.run(["node", ROOT / "scripts/ss-fs2-palette-layer-resource.js", "export", source, work, *ids])
        for rid in ids:
            raw = work / f"ss-fs2-resource-{rid}-raw.pgm"
            png = work / f"ss-fs2-resource-{rid}.png"
            self.run(["python", ROOT / "scripts/ss-fs2-ending-png-tool.py", "export", source, rid, raw, png])
        self.events.put(("log", f"\n편집 PNG 폴더: {work}\n"))

    def start_apply(self): self.start(self.apply_worker)

    def apply_worker(self, ids):
        work = Path(self.values["work"].get()); source = self.values["input"].get()
        items = []
        for rid in ids:
            raw = work / f"ss-fs2-resource-{rid}-raw.pgm"
            edit = work / f"ss-fs2-resource-{rid}-ko-edit.png"
            if not raw.is_file(): raise FileNotFoundError(f"먼저 추출해야 합니다: {raw}")
            if edit.is_file():
                applied = work / f"ss-fs2-resource-{rid}-applied.pgm"
                self.run(["python", ROOT / "scripts/ss-fs2-ending-png-tool.py", "import", source, rid, raw, edit, applied])
                items.append({"id": rid, "pgm": str(applied.resolve())})
            else:
                self.events.put(("log", f"[건너뜀] 편집 파일 없음: {edit.name}\n"))
        if not items: raise FileNotFoundError("적용할 -ko-edit.png 파일이 없습니다.")
        output = Path(self.values["output"].get()); output.parent.mkdir(parents=True, exist_ok=True)
        report = output.with_suffix(".report.json")
        item_by_id = {int(item["id"]): item for item in items}
        needs_expansion = any(rid in item_by_id for rid in (14, 18, 20, 21))
        if needs_expansion:
            missing = [rid for rid in CREDIT_IDS if rid not in item_by_id]
            if missing:
                raise FileNotFoundError(
                    "엔딩 크레딧 확장은 14, 15, 16, 18, 19, 20, 21 편집본이 모두 필요합니다. "
                    f"누락: {missing}"
                )
            ordinary = [item for item in items if int(item["id"]) not in CREDIT_IDS]
            expanded_source = source
            if ordinary:
                ordinary_manifest = work / "ending-ordinary-apply-manifest.json"
                ordinary_manifest.write_text(
                    json.dumps({"version": 1, "items": ordinary}, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                expanded_source = work / "ending-before-credit-expansion.bin"
                ordinary_report = work / "ending-before-credit-expansion.report.json"
                self.run([
                    "node", ROOT / "scripts/ss-fs2-palette-layer-resource.js", "apply",
                    source, expanded_source, ordinary_manifest, ordinary_report,
                ])
            credit_manifest = work / "ending-credit-expansion-manifest.json"
            credit_manifest.write_text(
                json.dumps(
                    {"version": 1, "items": [item_by_id[rid] for rid in CREDIT_IDS]},
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            self.run([
                "node", ROOT / "scripts/ss-fs2-expand-ending-credits.js",
                expanded_source, output, credit_manifest, report,
            ])
        else:
            manifest = work / "ending-apply-manifest.json"
            manifest.write_text(
                json.dumps({"version": 1, "items": items}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            self.run([
                "node", ROOT / "scripts/ss-fs2-palette-layer-resource.js", "apply",
                source, output, manifest, report,
            ])
        self.run(["node", ROOT / "scripts/ss-fs2-verify-patched-bin.js", source, output])
        track2 = Path(self.values["track2"].get())
        cue = output.with_suffix(".cue")
        cue.write_text(f'FILE "{output.name}" BINARY\n  TRACK 01 MODE1/2352\n    INDEX 01 00:00:00\nFILE "{track2.resolve()}" BINARY\n  TRACK 02 AUDIO\n    PREGAP 00:02:00\n    INDEX 01 00:00:00\n', encoding="ascii")
        self.events.put(("log", f"\n출력 BIN: {output}\nCUE: {cue}\n보고서: {report}\n"))

    def stop(self):
        if self.process and self.process.poll() is None: self.process.terminate()

    def poll(self):
        try:
            while True:
                event = self.events.get_nowait()
                if event[0] == "log": self.log.insert("end", event[1]); self.log.see("end")
                elif event[0] == "done":
                    self.running = False
                    self.export_button.configure(state="normal"); self.apply_button.configure(state="normal"); self.stop_button.configure(state="disabled")
                    (messagebox.showinfo if event[1] else messagebox.showerror)("완료" if event[1] else "오류", event[2], parent=self)
        except queue.Empty: pass
        self.after(100, self.poll)


if __name__ == "__main__":
    App().mainloop()
