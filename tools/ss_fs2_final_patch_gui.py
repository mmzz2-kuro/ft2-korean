#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""Build the current Sega Saturn Farland Saga 2 Korean integration patch."""

import json
import queue
import subprocess
import threading
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk


ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / "tmp/.gui-state/ss_fs2_final_patch_gui.json"
DEFAULT_TRACK1 = ROOT / "ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 1).bin"
DEFAULT_TRACK2 = ROOT / "ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 2).bin"
DEFAULT_PS1 = ROOT / "output/patched-farland-saga-logo.bin"
DEFAULT_OUT = ROOT / "output/ss-fs2-korean-final.bin"


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("SS Farland Saga 2 Korean Final Patch Builder")
        self.geometry("980x720")
        self.minsize(820, 600)
        saved = self.load_state()
        self.vars = {
            "track1": tk.StringVar(value=saved.get("track1", str(DEFAULT_TRACK1))),
            "track2": tk.StringVar(value=saved.get("track2", str(DEFAULT_TRACK2))),
            "ps1": tk.StringVar(value=saved.get("ps1", str(DEFAULT_PS1))),
            "output": tk.StringVar(value=saved.get("output", str(DEFAULT_OUT))),
            "work": tk.StringVar(value=saved.get("work", str(ROOT / "tmp/ss-fs2-final-build"))),
        }
        self.events = queue.Queue()
        self.process = None
        self.build_ui()
        self.after(100, self.poll_events)

    @staticmethod
    def load_state():
        try:
            return json.loads(STATE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def save_state(self):
        STATE.parent.mkdir(parents=True, exist_ok=True)
        STATE.write_text(json.dumps({k: v.get() for k, v in self.vars.items()}, ensure_ascii=False, indent=2), encoding="utf-8")

    def build_ui(self):
        self.columnconfigure(0, weight=1)
        self.rowconfigure(3, weight=1)
        intro = ttk.LabelFrame(self, text="현재 자동 적용 범위", padding=10)
        intro.grid(row=0, column=0, sticky="ew", padx=10, pady=(10, 6))
        ttk.Label(intro, text=(
            "일반 대사 2,437개(SS 전용 4개 포함), finale 220개, reveal 확장, 1bpp UI 336개, "
            "이름 420개, 8bpp UI 54개, 로고 2개, 화자명 25개를 원본 SS에 누적 적용합니다.\n"
            "팔레트 레이어 방식이 필요한 시스템 UI 5개(SS 714/1073/1074/1087/1088)는 아직 보류됩니다."
        ), justify="left").pack(anchor="w")

        paths = ttk.LabelFrame(self, text="입력과 출력", padding=10)
        paths.grid(row=1, column=0, sticky="ew", padx=10, pady=6)
        paths.columnconfigure(1, weight=1)
        rows = [
            ("SS Track 1 BIN", "track1", "open"),
            ("SS Track 2 BIN", "track2", "open"),
            ("최신 PS1 통합 BIN", "ps1", "open"),
            ("출력 Track 1 BIN", "output", "save"),
            ("중간 작업 폴더", "work", "dir"),
        ]
        for row, (label, key, mode) in enumerate(rows):
            ttk.Label(paths, text=label, width=19).grid(row=row, column=0, sticky="w", pady=3)
            ttk.Entry(paths, textvariable=self.vars[key]).grid(row=row, column=1, sticky="ew", padx=6, pady=3)
            ttk.Button(paths, text="찾기...", command=lambda k=key, m=mode: self.browse(k, m)).grid(row=row, column=2, pady=3)

        actions = ttk.Frame(self, padding=(10, 4))
        actions.grid(row=2, column=0, sticky="ew")
        self.build_button = ttk.Button(actions, text="최종 패치 빌드", command=self.start_build)
        self.build_button.pack(side="left")
        self.stop_button = ttk.Button(actions, text="중지", command=self.stop_build, state="disabled")
        self.stop_button.pack(side="left", padx=6)
        self.progress = ttk.Progressbar(actions, mode="indeterminate")
        self.progress.pack(side="left", fill="x", expand=True, padx=(12, 0))

        log_frame = ttk.LabelFrame(self, text="빌드 로그", padding=6)
        log_frame.grid(row=3, column=0, sticky="nsew", padx=10, pady=(4, 10))
        log_frame.rowconfigure(0, weight=1); log_frame.columnconfigure(0, weight=1)
        self.log = tk.Text(log_frame, wrap="none", font=("Consolas", 9))
        self.log.grid(row=0, column=0, sticky="nsew")
        y = ttk.Scrollbar(log_frame, orient="vertical", command=self.log.yview)
        y.grid(row=0, column=1, sticky="ns"); self.log.configure(yscrollcommand=y.set)

    def browse(self, key, mode):
        current = Path(self.vars[key].get())
        if mode == "open":
            value = filedialog.askopenfilename(initialdir=str(current.parent), filetypes=[("BIN files", "*.bin"), ("All files", "*.*")])
        elif mode == "save":
            value = filedialog.asksaveasfilename(initialdir=str(current.parent), initialfile=current.name, defaultextension=".bin", filetypes=[("BIN files", "*.bin")])
        else:
            value = filedialog.askdirectory(initialdir=str(current if current.is_dir() else current.parent))
        if value:
            self.vars[key].set(value)

    def append(self, text):
        self.log.insert("end", text)
        self.log.see("end")

    def start_build(self):
        if self.process is not None:
            return
        for key in ("track1", "track2", "ps1"):
            if not Path(self.vars[key].get()).is_file():
                messagebox.showerror("입력 오류", f"파일을 찾을 수 없습니다:\n{self.vars[key].get()}", parent=self)
                return
        output = Path(self.vars["output"].get())
        cue = output.with_suffix(".cue")
        report = output.with_suffix(".report.json")
        if output.resolve() in {Path(self.vars[k].get()).resolve() for k in ("track1", "track2", "ps1")}:
            messagebox.showerror("출력 오류", "출력 BIN은 입력 파일과 달라야 합니다.", parent=self)
            return
        self.save_state(); self.log.delete("1.0", "end")
        command = ["node", str(ROOT / "scripts/ss-fs2-build-final.js"), self.vars["track1"].get(), self.vars["track2"].get(), self.vars["ps1"].get(), str(output), str(cue), str(report), self.vars["work"].get()]
        self.append(" ".join(command) + "\n")
        self.build_button.configure(state="disabled"); self.stop_button.configure(state="normal"); self.progress.start(12)

        def worker():
            try:
                self.process = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", bufsize=1, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                for line in self.process.stdout:
                    self.events.put(("log", line))
                code = self.process.wait()
                self.events.put(("done", code, str(output), str(cue), str(report)))
            except Exception as exc:
                self.events.put(("error", str(exc)))
            finally:
                self.process = None
        threading.Thread(target=worker, daemon=True).start()

    def stop_build(self):
        if self.process is not None:
            self.process.terminate()
            self.append("\n[중지 요청]\n")

    def poll_events(self):
        try:
            while True:
                event = self.events.get_nowait()
                if event[0] == "log": self.append(event[1])
                elif event[0] == "done":
                    self.progress.stop(); self.build_button.configure(state="normal"); self.stop_button.configure(state="disabled")
                    if event[1] == 0:
                        messagebox.showinfo("빌드 완료", f"BIN: {event[2]}\nCUE: {event[3]}\n보고서: {event[4]}", parent=self)
                    else: messagebox.showerror("빌드 실패", f"빌드가 종료 코드 {event[1]}로 실패했습니다. 로그를 확인하세요.", parent=self)
                elif event[0] == "error":
                    self.progress.stop(); self.build_button.configure(state="normal"); self.stop_button.configure(state="disabled"); messagebox.showerror("실행 오류", event[1], parent=self)
        except queue.Empty:
            pass
        self.after(100, self.poll_events)


if __name__ == "__main__":
    App().mainloop()
