#!/usr/bin/env python
# -*- coding: utf-8 -*-

import json
import queue
import subprocess
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk


ROOT = Path(__file__).resolve().parents[1]
SETTINGS_PATH = ROOT / "trDatas/bin-patch-port-gui-settings.json"
PORT_SCRIPT = ROOT / "scripts/port-bin-patch.js"


def rel(path):
    try:
        return str(Path(path).resolve().relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        return str(path)


class BinPatchPortGui(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("BIN Patch Port Tool")
        self.geometry("980x520")
        self.minsize(900, 460)

        self.log_queue = queue.Queue()
        self.current_process = None
        self.vars = {
            "base_original": tk.StringVar(value=str(ROOT / "output/original/Farland Saga - Toki no Michishirube.bin")),
            "target_original": tk.StringVar(value=str(ROOT / "output/original2/Farland Saga - Toki no Michishirube (Japan).bin")),
            "base_patched": tk.StringVar(value=str(ROOT / "output/patched-farland-saga.bin")),
            "out_bin": tk.StringVar(value=str(ROOT / "output/patched-farland-saga-original2.bin")),
            "out_cue": tk.StringVar(value=str(ROOT / "output/patched-farland-saga-original2.cue")),
            "report": tk.StringVar(value=str(ROOT / "tmp/SLPS-01903/bin-patch-port-report.json")),
            "write_cue": tk.BooleanVar(value=True),
            "allow_conflicts": tk.BooleanVar(value=False),
        }

        self._load_settings()
        self.protocol("WM_DELETE_WINDOW", self._on_close)
        self._build_ui()
        self.after(100, self._drain_log_queue)

    def _build_ui(self):
        self.columnconfigure(0, weight=1)
        self.rowconfigure(2, weight=1)

        top = ttk.Frame(self, padding=10)
        top.grid(row=0, column=0, sticky="ew")
        top.columnconfigure(1, weight=1)

        rows = [
            ("Base original BIN", "base_original", "file"),
            ("Target original BIN", "target_original", "file"),
            ("Base patched BIN", "base_patched", "file"),
            ("Output BIN", "out_bin", "save"),
            ("Output CUE", "out_cue", "save"),
            ("Report JSON", "report", "save"),
        ]
        for row, (label, key, mode) in enumerate(rows):
            ttk.Label(top, text=label).grid(row=row, column=0, sticky="w", padx=(0, 8), pady=3)
            ttk.Entry(top, textvariable=self.vars[key]).grid(row=row, column=1, sticky="ew", pady=3)
            ttk.Button(top, text="...", width=4, command=lambda k=key, m=mode: self._browse(k, m)).grid(
                row=row, column=2, padx=(6, 0), pady=3
            )

        opts = ttk.Frame(self, padding=(10, 0, 10, 6))
        opts.grid(row=1, column=0, sticky="ew")
        ttk.Checkbutton(opts, text="write CUE", variable=self.vars["write_cue"]).pack(side="left")
        ttk.Checkbutton(opts, text="allow conflicts", variable=self.vars["allow_conflicts"]).pack(side="left", padx=(16, 0))
        ttk.Button(opts, text="Port Patch", command=self.port_patch).pack(side="right")
        ttk.Button(opts, text="Save Settings", command=self._save_settings).pack(side="right", padx=(0, 8))

        log_frame = ttk.LabelFrame(self, text="Log", padding=8)
        log_frame.grid(row=2, column=0, sticky="nsew", padx=10, pady=(0, 10))
        log_frame.columnconfigure(0, weight=1)
        log_frame.rowconfigure(0, weight=1)

        self.log = tk.Text(log_frame, wrap="word", height=14)
        self.log.grid(row=0, column=0, sticky="nsew")
        scroll = ttk.Scrollbar(log_frame, orient="vertical", command=self.log.yview)
        scroll.grid(row=0, column=1, sticky="ns")
        self.log.configure(yscrollcommand=scroll.set)

    def _browse(self, key, mode):
        current = self.vars[key].get()
        initialdir = str(Path(current).parent) if current else str(ROOT)
        if mode == "file":
            path = filedialog.askopenfilename(initialdir=initialdir, filetypes=[("BIN files", "*.bin"), ("All files", "*.*")])
        elif mode == "save":
            suffix = ".json" if key == "report" else ".cue" if key == "out_cue" else ".bin"
            filetypes = [("JSON files", "*.json")] if suffix == ".json" else [("CUE files", "*.cue")] if suffix == ".cue" else [("BIN files", "*.bin")]
            filetypes.append(("All files", "*.*"))
            path = filedialog.asksaveasfilename(initialdir=initialdir, defaultextension=suffix, filetypes=filetypes)
        else:
            path = ""
        if path:
            self.vars[key].set(path)

    def _load_settings(self):
        if not SETTINGS_PATH.exists():
            return
        try:
            data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        except Exception:
            return
        for key, var in self.vars.items():
            if key not in data:
                continue
            if isinstance(var, tk.BooleanVar):
                var.set(bool(data[key]))
            else:
                var.set(str(data[key]))

    def _save_settings(self):
        SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
        data = {key: var.get() for key, var in self.vars.items()}
        SETTINGS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        self._log(f"saved settings: {rel(SETTINGS_PATH)}\n")

    def _on_close(self):
        self._save_settings()
        self.destroy()

    def _log(self, text):
        self.log.insert("end", text)
        self.log.see("end")

    def _drain_log_queue(self):
        while True:
            try:
                text = self.log_queue.get_nowait()
            except queue.Empty:
                break
            self._log(text)
        self.after(100, self._drain_log_queue)

    def _run_command(self, title, cmd):
        if self.current_process is not None:
            messagebox.showwarning("Busy", "A command is already running.")
            return

        self._save_settings()
        self._log(f"\n## {title}\n")
        self._log(" ".join(str(part) for part in cmd) + "\n")

        def worker():
            try:
                self.current_process = subprocess.Popen(
                    cmd,
                    cwd=str(ROOT),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                )
                assert self.current_process.stdout is not None
                for line in self.current_process.stdout:
                    self.log_queue.put(line)
                code = self.current_process.wait()
                self.log_queue.put(f"[exit {code}]\n")
                if code == 0:
                    self.log_queue.put("Done.\n")
                else:
                    self.log_queue.put("Failed. Check conflicts/report above.\n")
            finally:
                self.current_process = None

        threading.Thread(target=worker, daemon=True).start()

    def port_patch(self):
        cmd = [
            "node",
            str(PORT_SCRIPT),
            self.vars["base_original"].get(),
            self.vars["target_original"].get(),
            self.vars["base_patched"].get(),
            self.vars["out_bin"].get(),
        ]
        if self.vars["write_cue"].get():
            cmd += ["--cue", self.vars["out_cue"].get()]
        report = self.vars["report"].get().strip()
        if report:
            cmd += ["--report", report]
        if self.vars["allow_conflicts"].get():
            cmd.append("--allow-conflicts")
        self._run_command("Port BIN patch", cmd)


if __name__ == "__main__":
    BinPatchPortGui().mainloop()
