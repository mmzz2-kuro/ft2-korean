#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""GUI for applying the confirmed seven opening character cards to Saturn."""

import queue
import subprocess
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk


ROOT = Path(__file__).resolve().parents[1]


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("새턴 파랜드 사가 2 - 오프닝 캐릭터 설명 적용")
        self.geometry("980x620")
        self.events, self.process, self.running = queue.Queue(), None, False
        self.values = {
            "input": tk.StringVar(value=str(ROOT / "output/ss-fs2-korean-ending-credits-expanded.bin")),
            "source": tk.StringVar(value=str(ROOT / "tmp/SLPS-01903/opening-character-workflow/gui-build/windows-ko-pgm")),
            "work": tk.StringVar(value=str(ROOT / "tmp/ss-fs2-opening-character-workflow/gui-build")),
            "output": tk.StringVar(value=str(ROOT / "output/ss-fs2-korean-opening-profiles.bin")),
        }
        self._ui(); self.after(100, self._poll)

    def _ui(self):
        self.columnconfigure(0, weight=1); self.rowconfigure(2, weight=1)
        box = ttk.LabelFrame(self, text="입력과 출력", padding=10)
        box.grid(row=0, column=0, sticky="ew", padx=10, pady=10); box.columnconfigure(1, weight=1)
        rows = (("입력 새턴 Track 1 BIN", "input", "file"), ("PS1 확정 PGM 폴더", "source", "dir"),
                ("작업 폴더", "work", "dir"), ("출력 새턴 Track 1 BIN", "output", "save"))
        for row, (label, key, mode) in enumerate(rows):
            ttk.Label(box, text=label, width=23).grid(row=row, column=0, sticky="w", pady=3)
            ttk.Entry(box, textvariable=self.values[key]).grid(row=row, column=1, sticky="ew", padx=6)
            ttk.Button(box, text="찾기...", command=lambda k=key, m=mode: self._browse(k, m)).grid(row=row, column=2)
        bar = ttk.Frame(self, padding=(10, 0, 10, 10)); bar.grid(row=1, column=0, sticky="ew")
        self.start = ttk.Button(bar, text="캐릭터 설명 7장 적용", command=self._start); self.start.pack(side="left")
        self.stop = ttk.Button(bar, text="중지", command=self._stop, state="disabled"); self.stop.pack(side="left", padx=6)
        ttk.Label(bar, text="PS1에서 확인한 최종 PGM을 새턴 대응 리소스에 적용합니다.").pack(side="left", padx=8)
        frame = ttk.LabelFrame(self, text="작업 로그", padding=6); frame.grid(row=2, column=0, sticky="nsew", padx=10, pady=(0, 10))
        frame.rowconfigure(0, weight=1); frame.columnconfigure(0, weight=1)
        self.log = tk.Text(frame, wrap="word", font=("Consolas", 9)); self.log.grid(row=0, column=0, sticky="nsew")

    def _browse(self, key, mode):
        path = Path(self.values[key].get() or ROOT); initial = str(path if path.is_dir() else path.parent)
        if mode == "dir": value = filedialog.askdirectory(initialdir=initial)
        elif mode == "save": value = filedialog.asksaveasfilename(initialdir=initial, initialfile=path.name,
                                                                    defaultextension=".bin", filetypes=[("BIN", "*.bin")])
        else: value = filedialog.askopenfilename(initialdir=initial, filetypes=[("BIN", "*.bin"), ("모든 파일", "*.*")])
        if value: self.values[key].set(value)

    def _start(self):
        if self.running: return
        if not Path(self.values["input"].get()).is_file():
            messagebox.showerror("입력 오류", "입력 BIN을 찾을 수 없습니다.", parent=self); return
        self.running = True; self.log.delete("1.0", "end")
        self.start.configure(state="disabled"); self.stop.configure(state="normal")
        threading.Thread(target=self._worker, daemon=True).start()

    def _worker(self):
        try:
            work = Path(self.values["work"].get()); report = work / "ss-opening-build-report.json"
            cmd = ["python", str(ROOT / "scripts/ss-fs2-build-opening-profiles.py"), self.values["input"].get(),
                   self.values["source"].get(), str(work), self.values["output"].get(), str(report)]
            self.events.put(("log", "> " + subprocess.list2cmdline(cmd) + "\n"))
            self.process = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                            text=True, encoding="utf-8", errors="replace")
            for line in self.process.stdout: self.events.put(("log", line))
            code = self.process.wait(); self.process = None
            if code: raise RuntimeError(f"빌드가 종료 코드 {code}로 실패했습니다.")
            self.events.put(("done", True, f"완료했습니다.\n{self.values['output'].get()}"))
        except Exception as exc: self.events.put(("done", False, str(exc)))

    def _stop(self):
        if self.process and self.process.poll() is None: self.process.terminate()

    def _poll(self):
        try:
            while True:
                event = self.events.get_nowait()
                if event[0] == "log": self.log.insert("end", event[1]); self.log.see("end")
                else:
                    self.running = False; self.start.configure(state="normal"); self.stop.configure(state="disabled")
                    (messagebox.showinfo if event[1] else messagebox.showerror)("완료" if event[1] else "오류", event[2], parent=self)
        except queue.Empty: pass
        self.after(100, self._poll)


if __name__ == "__main__":
    App().mainloop()
