#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""PS1 Farland Saga 2 ending/menu/credit resource PNG workflow."""

import queue
import shutil
import subprocess
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
IDS = (0, 1, 2, 11, 12, 14, 15, 16, 18, 19, 20, 21)
LABELS = {0: "엔딩 질문", 1: "엔딩 선택지", 2: "어트랙터 문구", 11: "기획·개발·판매",
          12: "엔딩 크레딧", 14: "성우 캐스팅 1", 15: "성우 캐스팅 2", 16: "엔딩 크레딧",
          18: "엔딩 크레딧", 19: "엔딩 크레딧", 20: "엔딩 크레딧", 21: "엔딩 크레딧"}


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("PS1 파랜드 사가 2 엔딩 리소스 편집")
        self.geometry("1020x740")
        self.minsize(850, 620)
        self.events, self.process, self.running = queue.Queue(), None, False
        self.paths = {
            "input": tk.StringVar(value=str(ROOT / "output/patched-farland-saga-logo.bin")),
            "exe": tk.StringVar(value=str(ROOT / "ps1/SLPS-01903/SLPS_019.03")),
            "output": tk.StringVar(value=str(ROOT / "output/patched-farland-saga-ending.bin")),
            "work": tk.StringVar(value=str(ROOT / "tmp/SLPS-01903/ending-resource-workflow")),
        }
        self.enabled = {rid: tk.BooleanVar(value=True) for rid in IDS}
        self._ui(); self.after(100, self._poll)

    def _ui(self):
        self.columnconfigure(0, weight=1); self.rowconfigure(3, weight=1)
        box = ttk.LabelFrame(self, text="입력과 출력", padding=10); box.grid(row=0, column=0, sticky="ew", padx=10, pady=10); box.columnconfigure(1, weight=1)
        for row, (label, key, mode) in enumerate((("PS1 원본/패치 BIN", "input", "open"), ("PS1 실행 파일", "exe", "open"), ("출력 BIN", "output", "save"), ("작업 폴더", "work", "dir"))):
            ttk.Label(box, text=label, width=20).grid(row=row, column=0, sticky="w", pady=3)
            ttk.Entry(box, textvariable=self.paths[key]).grid(row=row, column=1, sticky="ew", padx=6)
            ttk.Button(box, text="찾기...", command=lambda k=key, m=mode: self._browse(k, m)).grid(row=row, column=2)
        resources = ttk.LabelFrame(self, text="처리할 PS1 리소스", padding=10); resources.grid(row=1, column=0, sticky="ew", padx=10)
        for i, rid in enumerate(IDS):
            ttk.Checkbutton(resources, variable=self.enabled[rid], text=f"{rid}: {LABELS[rid]}").grid(row=i // 3, column=i % 3, sticky="w", padx=(0, 24), pady=3)
        actions = ttk.Frame(self, padding=10); actions.grid(row=2, column=0, sticky="ew")
        self.export_btn = ttk.Button(actions, text="1. 편집 PNG 추출", command=lambda: self._start(self._export)); self.export_btn.pack(side="left")
        self.apply_btn = ttk.Button(actions, text="2. -ko-edit.png 자동 적용", command=lambda: self._start(self._apply)); self.apply_btn.pack(side="left", padx=6)
        self.stop_btn = ttk.Button(actions, text="중지", command=self._stop, state="disabled"); self.stop_btn.pack(side="left")
        ttk.Label(actions, text="  추출 PNG를 복사해 파일명 끝을 -ko-edit.png로 바꾼 뒤 편집하세요.").pack(side="left")
        frame = ttk.LabelFrame(self, text="작업 로그", padding=6); frame.grid(row=3, column=0, sticky="nsew", padx=10, pady=(0, 10)); frame.rowconfigure(0, weight=1); frame.columnconfigure(0, weight=1)
        self.log = tk.Text(frame, wrap="word", font=("Consolas", 9)); self.log.grid(row=0, column=0, sticky="nsew")

    def _browse(self, key, mode):
        p = Path(self.paths[key].get() or ROOT); initial = str(p if p.is_dir() else p.parent)
        if mode == "dir": value = filedialog.askdirectory(initialdir=initial)
        elif mode == "save": value = filedialog.asksaveasfilename(initialdir=initial, initialfile=p.name, defaultextension=".bin", filetypes=[("BIN", "*.bin")])
        else: value = filedialog.askopenfilename(initialdir=initial, filetypes=[("지원 파일", "*.bin *.03"), ("모든 파일", "*.*")])
        if value: self.paths[key].set(value)

    def _ids(self):
        ids = [rid for rid in IDS if self.enabled[rid].get()]
        if not ids: raise ValueError("리소스를 하나 이상 선택하세요.")
        return ids

    def _run(self, args):
        cmd = [str(x) for x in args]; self.events.put(("log", "\n> " + subprocess.list2cmdline(cmd) + "\n"))
        self.process = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
        for line in self.process.stdout: self.events.put(("log", line))
        code = self.process.wait(); self.process = None
        if code: raise RuntimeError(f"명령이 종료 코드 {code}로 실패했습니다.")

    def _start(self, worker):
        if self.running: return
        try:
            ids = self._ids()
            for key in ("input", "exe"):
                if not Path(self.paths[key].get()).is_file(): raise FileNotFoundError(f"파일이 없습니다: {self.paths[key].get()}")
        except Exception as exc: messagebox.showerror("입력 오류", str(exc), parent=self); return
        self.running = True; self.log.delete("1.0", "end")
        self.export_btn.configure(state="disabled"); self.apply_btn.configure(state="disabled"); self.stop_btn.configure(state="normal")
        threading.Thread(target=self._worker, args=(worker, ids), daemon=True).start()

    def _worker(self, worker, ids):
        try: worker(ids); self.events.put(("done", True, "작업이 완료되었습니다."))
        except Exception as exc: self.events.put(("done", False, str(exc)))

    def _prepare_dat(self, work):
        dat = work / "extracted-FS2_FILE.DAT"
        self._run(["node", ROOT / "scripts/extract-dat-from-raw-bin.js", self.paths["input"].get(), dat, "--lba", "223", "--bytes", "244678656"])
        return dat

    @staticmethod
    def _pgm_pixels(path):
        tokens = []
        for line in Path(path).read_text(encoding="ascii").splitlines():
            tokens.extend(line.split("#", 1)[0].split())
        if not tokens or tokens.pop(0) != "P2": raise ValueError(f"P2 PGM이 아닙니다: {path}")
        width, height, maximum = int(tokens.pop(0)), int(tokens.pop(0)), int(tokens.pop(0))
        pixels = bytes(map(int, tokens))
        if maximum != 255 or len(pixels) != width * height: raise ValueError(f"PGM 데이터가 잘못됐습니다: {path}")
        return width, height, pixels

    def _export(self, ids):
        work = Path(self.paths["work"].get()); work.mkdir(parents=True, exist_ok=True); dat = self._prepare_dat(work); exe = self.paths["exe"].get()
        self._run(["node", ROOT / "scripts/be-hdr-ui-tile-tool.js", "dump-raw", dat, exe, work, *ids])
        for rid in ids:
            raw, png = work / f"be-hdr-ui-{rid}-raw.pgm", work / f"ps1-fs2-resource-{rid}.png"
            self._run(["python", ROOT / "scripts/ps1-fs2-ending-png-tool.py", "export", dat, exe, rid, raw, png])
        self._run(["python", ROOT / "scripts/ps1-fs2-runtime-strip-tool.py", "export", dat, exe, work])
        self.events.put(("log", f"\n편집 PNG 폴더: {work}\n"))

    def _apply(self, ids):
        work = Path(self.paths["work"].get()); work.mkdir(parents=True, exist_ok=True); dat = self._prepare_dat(work); exe = self.paths["exe"].get(); current = dat
        edited = []
        for rid in ids:
            raw = work / f"be-hdr-ui-{rid}-raw.pgm"; png = work / f"ps1-fs2-resource-{rid}-ko-edit.png"
            if not png.is_file(): self.events.put(("log", f"[건너뜀] {png.name} 없음\n")); continue
            if rid in (12, 14, 15, 16, 18, 19, 20, 21):
                self.events.put(("log", f"[런타임 이관 예정] resource {rid}: 미사용 BE-HDR 패킹 생략\n"))
                continue
            if not raw.is_file(): raise FileNotFoundError(f"먼저 PNG를 추출하세요: {raw}")
            pgm, next_dat = work / f"ps1-fs2-resource-{rid}-applied.pgm", work / f"apply-stage-{rid}.DAT"
            self._run(["python", ROOT / "scripts/ps1-fs2-ending-png-tool.py", "import", dat, exe, rid, raw, png, pgm])
            self._run(["node", ROOT / "scripts/be-hdr-ui-tile-tool.js", "pack-raw", current, exe, next_dat, rid, pgm])
            verify_dir = work / "verify"; verify_dir.mkdir(parents=True, exist_ok=True)
            self._run(["node", ROOT / "scripts/be-hdr-ui-tile-tool.js", "dump-raw", next_dat, exe, verify_dir, rid])
            verified = verify_dir / f"be-hdr-ui-{rid}-raw.pgm"
            if self._pgm_pixels(pgm) != self._pgm_pixels(verified):
                raise RuntimeError(f"resource {rid}: 재삽입 후 화면이 편집 이미지와 일치하지 않습니다. 출력 BIN을 만들지 않습니다.")
            self.events.put(("log", f"[검증 성공] resource {rid}: 재추출 화면 완전 일치\n"))
            current = next_dat; edited.append(rid)
        runtime_title = work / "ps1-fs2-runtime-frame-00-ko-edit.png"
        legacy_title = work / "ps1-fs2-resource-12-ko-edit.png"
        if legacy_title.is_file():
            source = Image.open(legacy_title).convert("L")
            if source.size != (320, 240):
                raise ValueError(f"{legacy_title.name}: 320x240 이미지가 필요합니다.")
            source.crop((0, 0, 320, 48)).save(runtime_title)
            self.events.put(("log", f"[자동 이관] {legacy_title.name} 상단 320x48 -> {runtime_title.name}\n"))
        legacy_cast = next((path for path in (
            work / "ps1-fs2-resource-14-ko-edit.png",
            work / "ss-fs2-resource-14-ko-edit.png",
        ) if path.is_file()), None)
        if legacy_cast:
            self._run(["python", ROOT / "scripts/ps1-fs2-runtime-strip-tool.py", "export", current, exe, work])
            self._run(["python", ROOT / "scripts/ps1-fs2-runtime-strip-tool.py", "map-resource14", legacy_cast, work])
            self.events.put(("log", f"[자동 이관] {legacy_cast.name} -> runtime frame 02~11\n"))
        legacy_cast2 = next((path for path in (
            work / "ps1-fs2-resource-15-ko-edit.png",
            work / "ss-fs2-resource-15-ko-edit.png",
        ) if path.is_file()), None)
        if legacy_cast2:
            self._run(["python", ROOT / "scripts/ps1-fs2-runtime-strip-tool.py", "export", current, exe, work])
            self._run(["python", ROOT / "scripts/ps1-fs2-runtime-strip-tool.py", "map-resource15", legacy_cast2, work])
            self.events.put(("log", f"[자동 이관] {legacy_cast2.name} -> runtime frame 13~17\n"))
        legacy_credit16 = next((path for path in (
            work / "ps1-fs2-resource-16-ko-edit.png",
            work / "ss-fs2-resource-16-ko-edit.png",
        ) if path.is_file()), None)
        if legacy_credit16:
            self._run(["python", ROOT / "scripts/ps1-fs2-runtime-strip-tool.py", "export", current, exe, work])
            self._run(["python", ROOT / "scripts/ps1-fs2-runtime-strip-tool.py", "map-resource16", legacy_credit16, work])
            self.events.put(("log", f"[자동 이관] {legacy_credit16.name} -> runtime frame 19~21\n"))
        for rid in (18, 19, 20, 21):
            legacy_staff = next((path for path in (
                work / f"ps1-fs2-resource-{rid}-ko-edit.png",
                work / f"ss-fs2-resource-{rid}-ko-edit.png",
            ) if path.is_file()), None)
            if legacy_staff:
                self._run(["python", ROOT / "scripts/ps1-fs2-runtime-strip-tool.py", "export", current, exe, work])
                self._run(["python", ROOT / "scripts/ps1-fs2-runtime-strip-tool.py", "map-resource18-21", rid, legacy_staff, work])
                self.events.put(("log", f"[자동 이관] {legacy_staff.name} -> runtime staff frames\n"))
        runtime_edits = list(work.glob("ps1-fs2-runtime-frame-??-ko-edit.png"))
        if runtime_edits:
            next_dat = work / "apply-stage-runtime-23.DAT"
            self._run(["python", ROOT / "scripts/ps1-fs2-runtime-strip-tool.py", "apply", current, exe, work, next_dat])
            current = next_dat
            edited.append("runtime-23")
        if not edited: raise FileNotFoundError("적용할 -ko-edit.png 파일이 없습니다.")
        preview = work / "runtime-applied-preview"
        self._run(["python", ROOT / "scripts/ps1-fs2-runtime-strip-tool.py", "export", current, exe, preview])
        self.events.put(("log", f"[육안 검증 PNG] {preview}\n"))
        final_dat = work / "patched-ending-FS2_FILE.DAT"; shutil.copyfile(current, final_dat)
        output = Path(self.paths["output"].get()); output.parent.mkdir(parents=True, exist_ok=True)
        unchecked = work / "ending-injected-unchecked.bin"
        self._run(["node", ROOT / "scripts/inject-dat-into-raw-bin.js", self.paths["input"].get(), final_dat, unchecked, "--lba", "223"])
        self._run(["node", ROOT / "scripts/fix-bin-edc-ecc.js", self.paths["input"].get(), unchecked, output,
                   "--exe", exe, "--fs2-lba", "223"])
        output.with_suffix(".cue").write_text(f'FILE "{output.name}" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n', encoding="ascii")
        self.events.put(("log", f"\n적용 리소스: {edited}\n출력 BIN: {output}\nCUE: {output.with_suffix('.cue')}\n"))

    def _stop(self):
        if self.process and self.process.poll() is None: self.process.terminate()

    def _poll(self):
        try:
            while True:
                event = self.events.get_nowait()
                if event[0] == "log": self.log.insert("end", event[1]); self.log.see("end")
                else:
                    self.running = False; self.export_btn.configure(state="normal"); self.apply_btn.configure(state="normal"); self.stop_btn.configure(state="disabled")
                    (messagebox.showinfo if event[1] else messagebox.showerror)("완료" if event[1] else "오류", event[2], parent=self)
        except queue.Empty: pass
        self.after(100, self._poll)


if __name__ == "__main__":
    App().mainloop()
