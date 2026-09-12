#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Build the seven PS1 opening character cards from the Windows Korean BMPs."""

import queue
import shutil
import subprocess
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk


ROOT = Path(__file__).resolve().parents[1]
IDS = (255, 257, 263, 265, 268, 269, 286)
TILE_CAPACITY = {255: 453, 257: 421, 263: 421, 265: 325, 286: 453}
TILE_BUDGETS = {255: 453, 257: 421, 263: 421, 265: 325, 268: 389, 269: 389, 286: 453}


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("PS1 파랜드 사가 2 오프닝 캐릭터 한글화")
        self.geometry("980x650")
        self.events = queue.Queue()
        self.process = None
        self.running = False
        base = ROOT / "tmp/SLPS-01903/opening-character-workflow"
        self.values = {
            "input": tk.StringVar(value=str(ROOT / "output/patched-farland-saga-logo.bin")),
            "exe": tk.StringVar(value=str(ROOT / "ps1/SLPS-01903/SLPS_019.03")),
            "bmp": tk.StringVar(value=str(base / "win-data")),
            "work": tk.StringVar(value=str(base / "gui-build")),
            "output": tk.StringVar(value=str(ROOT / "output/patched-farland-saga-opening-ko.bin")),
        }
        self._build_ui()
        self.after(100, self._poll)

    def _build_ui(self):
        self.columnconfigure(0, weight=1); self.rowconfigure(2, weight=1)
        paths = ttk.LabelFrame(self, text="입력과 출력", padding=10)
        paths.grid(row=0, column=0, sticky="ew", padx=10, pady=10); paths.columnconfigure(1, weight=1)
        rows = (("입력 PS1 BIN", "input", "file"), ("PS1 실행 파일", "exe", "file"),
                ("Windows BMP 폴더", "bmp", "dir"), ("작업 폴더", "work", "dir"),
                ("출력 PS1 BIN", "output", "save"))
        for row, (label, key, mode) in enumerate(rows):
            ttk.Label(paths, text=label, width=20).grid(row=row, column=0, sticky="w", pady=3)
            ttk.Entry(paths, textvariable=self.values[key]).grid(row=row, column=1, sticky="ew", padx=6)
            ttk.Button(paths, text="찾기...", command=lambda k=key, m=mode: self._browse(k, m)).grid(row=row, column=2)
        bar = ttk.Frame(self, padding=(10, 0, 10, 10)); bar.grid(row=1, column=0, sticky="ew")
        self.build_button = ttk.Button(bar, text="Windows BMP 7개를 PS1 BIN에 적용", command=self._start)
        self.build_button.pack(side="left")
        self.stop_button = ttk.Button(bar, text="중지", command=self._stop, state="disabled")
        self.stop_button.pack(side="left", padx=6)
        ttk.Label(bar, text="작업 폴더/edit의 *-ko-edit.png가 있으면 자동 렌더링보다 우선 적용합니다.").pack(side="left", padx=8)
        frame = ttk.LabelFrame(self, text="작업 로그", padding=6); frame.grid(row=2, column=0, sticky="nsew", padx=10, pady=(0, 10))
        frame.rowconfigure(0, weight=1); frame.columnconfigure(0, weight=1)
        self.log = tk.Text(frame, wrap="word", font=("Consolas", 9)); self.log.grid(row=0, column=0, sticky="nsew")

    def _browse(self, key, mode):
        path = Path(self.values[key].get() or ROOT); initial = str(path if path.is_dir() else path.parent)
        if mode == "dir": value = filedialog.askdirectory(initialdir=initial)
        elif mode == "save": value = filedialog.asksaveasfilename(initialdir=initial, initialfile=path.name, defaultextension=".bin", filetypes=[("BIN", "*.bin")])
        else: value = filedialog.askopenfilename(initialdir=initial, filetypes=[("PS1 파일", "*.bin *.03"), ("모든 파일", "*.*")])
        if value: self.values[key].set(value)

    def _run(self, args):
        cmd = [str(x) for x in args]
        self.events.put(("log", "\n> " + subprocess.list2cmdline(cmd) + "\n"))
        self.process = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                        text=True, encoding="utf-8", errors="replace")
        for line in self.process.stdout: self.events.put(("log", line))
        code = self.process.wait(); self.process = None
        if code: raise RuntimeError(f"명령이 종료 코드 {code}로 실패했습니다.")

    def _start(self):
        if self.running: return
        try:
            for key in ("input", "exe"):
                if not Path(self.values[key].get()).is_file(): raise FileNotFoundError(self.values[key].get())
            bmp = Path(self.values["bmp"].get())
            for rid in IDS:
                if not (bmp / f"be-hdr-ui-{rid}.BMP").is_file(): raise FileNotFoundError(bmp / f"be-hdr-ui-{rid}.BMP")
        except Exception as exc:
            messagebox.showerror("입력 오류", str(exc), parent=self); return
        self.running = True; self.log.delete("1.0", "end")
        self.build_button.configure(state="disabled"); self.stop_button.configure(state="normal")
        threading.Thread(target=self._worker, daemon=True).start()

    def _worker(self):
        try:
            work = Path(self.values["work"].get()); raw = work / "raw"; pgm = work / "windows-ko-pgm"
            preview = work / "preview"; edit = work / "edit"; background = work / "background"; stages = work / "stages"
            for folder in (work, raw, pgm, preview, edit, background, stages): folder.mkdir(parents=True, exist_ok=True)
            source_dat = work / "source-FS2_FILE.DAT"
            self._run(["node", ROOT / "scripts/extract-dat-from-raw-bin.js", self.values["input"].get(), source_dat,
                       "--lba", "223", "--bytes", "244678656"])
            self._run(["node", ROOT / "scripts/be-hdr-ui-tile-tool.js", "dump-raw", source_dat,
                       self.values["exe"].get(), raw, *IDS])
            self._run(["python", ROOT / "scripts/ps1-fs2-import-windows-opening-profiles.py",
                       self.values["bmp"].get(), raw, pgm, "--preview-dir", preview, "--background-dir", background])
            for rid in IDS:
                auto_png = preview / f"be-hdr-ui-{rid}-windows-ko.png"
                edit_png = edit / f"be-hdr-ui-{rid}-ko-edit.png"
                target_pgm = pgm / f"be-hdr-ui-{rid}-windows-ko.pgm"
                if not edit_png.exists():
                    shutil.copyfile(auto_png, edit_png)
                    self.events.put(("log", f"[편집 PNG 생성] {edit_png}\n"))
                # Keep the user's complete PNG and its antialiasing. Lulu and
                # Sophia are displayed from the unpacked resource-306 sheet,
                # so their otherwise restrictive BE-HDR tile budgets do not
                # apply at all.
                import_cmd = ["python", ROOT / "scripts/ps1-fs2-opening-edit-png.py", target_pgm, edit_png, target_pgm]
                if rid in TILE_CAPACITY:
                    import_cmd += ["--tile-budget", TILE_CAPACITY[rid]]
                self._run(import_cmd)
                self.events.put(("log", f"[편집 PNG 적용] resource {rid}: {edit_png.name}\n"))
            current = source_dat
            for rid in IDS:
                if rid in (268, 269):
                    self.events.put(("log", f"[BE-HDR 생략] resource {rid}: 실제 표시용 runtime resource 306만 적용\n"))
                    continue
                next_dat = stages / f"stage-{rid}.DAT"
                self._run(["node", ROOT / "scripts/be-hdr-ui-tile-tool.js", "pack-raw", current,
                           self.values["exe"].get(), next_dat, rid, pgm / f"be-hdr-ui-{rid}-windows-ko.pgm"])
                current = next_dat
            runtime_dat = stages / "stage-runtime-306.DAT"
            self._run(["python", ROOT / "scripts/ps1-fs2-patch-opening-runtime-sheet.py", current,
                       self.values["exe"].get(), pgm, runtime_dat])
            current = runtime_dat
            final_dat = work / "patched-opening-FS2_FILE.DAT"; shutil.copyfile(current, final_dat)
            unchecked = work / "opening-injected-unchecked.bin"
            output = Path(self.values["output"].get()); output.parent.mkdir(parents=True, exist_ok=True)
            self._run(["node", ROOT / "scripts/inject-dat-into-raw-bin.js", self.values["input"].get(), final_dat, unchecked, "--lba", "223"])
            self._run(["node", ROOT / "scripts/fix-bin-edc-ecc.js", self.values["input"].get(), unchecked, output,
                       "--exe", self.values["exe"].get(), "--fs2-lba", "223"])
            output.with_suffix(".cue").write_text(f'FILE "{output.name}" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n', encoding="ascii")
            self.events.put(("done", True, f"완료했습니다.\n{output}"))
        except Exception as exc:
            self.events.put(("done", False, str(exc)))

    def _stop(self):
        if self.process and self.process.poll() is None: self.process.terminate()

    def _poll(self):
        try:
            while True:
                event = self.events.get_nowait()
                if event[0] == "log": self.log.insert("end", event[1]); self.log.see("end")
                else:
                    self.running = False; self.build_button.configure(state="normal"); self.stop_button.configure(state="disabled")
                    (messagebox.showinfo if event[1] else messagebox.showerror)("완료" if event[1] else "오류", event[2], parent=self)
        except queue.Empty: pass
        self.after(100, self._poll)


if __name__ == "__main__":
    App().mainloop()
