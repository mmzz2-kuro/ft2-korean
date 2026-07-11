#!/usr/bin/env python
# -*- coding: utf-8 -*-

import queue
import subprocess
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, ttk

ROOT = Path(__file__).resolve().parents[1]


def rel(path):
    try:
        return str(Path(path).resolve().relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        return str(path)


class BinEdcEccFixGui(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("BIN EDC/ECC Fix (recompute checksums for edited sectors)")
        self.geometry("980x640")
        self.minsize(820, 520)

        self.log_queue = queue.Queue()
        self.vars = {
            "original_bin": tk.StringVar(value=str(ROOT / "output/farland-saga.bin")),
            "target_bin": tk.StringVar(value=""),
            "output_bin": tk.StringVar(value=""),
            "exe": tk.StringVar(value=str(ROOT / "ps1/SLPS-01903/SLPS_019.03")),
            "fs2_lba": tk.StringVar(value="223"),
        }

        self._build_ui()
        self.after(100, self._drain_log_queue)

    # ---------------------------------------------------------------- UI ---

    def _build_ui(self):
        self.columnconfigure(0, weight=1)
        self.rowconfigure(3, weight=1)

        top = ttk.Frame(self, padding=8)
        top.grid(row=0, column=0, sticky="ew")
        top.columnconfigure(1, weight=1)

        rows = [
            ("Original BIN (known-good)", "original_bin", "file"),
            ("Target BIN (has bad sectors)", "target_bin", "file"),
            ("SLPS_019.03 (optional, for resource-ID report)", "exe", "file"),
        ]
        for r, (label, key, kind) in enumerate(rows):
            ttk.Label(top, text=label).grid(row=r, column=0, sticky="w", padx=(0, 4), pady=2)
            ttk.Entry(top, textvariable=self.vars[key]).grid(row=r, column=1, sticky="ew", padx=(0, 4), pady=2)
            ttk.Button(top, text="...", width=3, command=lambda k=key, t=kind: self._browse(k, t)).grid(row=r, column=2, sticky="ew", pady=2)

        opts = ttk.Frame(self, padding=(8, 0, 8, 4))
        opts.grid(row=1, column=0, sticky="ew")
        ttk.Label(opts, text="FS2 LBA").pack(side="left")
        ttk.Entry(opts, textvariable=self.vars["fs2_lba"], width=8).pack(side="left", padx=(4, 0))
        ttk.Button(opts, text="Self-Test Algorithm Against Original BIN", command=self.run_self_test).pack(side="left", padx=(20, 0))

        out_row = ttk.Frame(self, padding=(8, 0, 8, 8))
        out_row.grid(row=2, column=0, sticky="ew")
        out_row.columnconfigure(1, weight=1)
        ttk.Label(out_row, text="Output BIN").grid(row=0, column=0, sticky="w", padx=(0, 4))
        ttk.Entry(out_row, textvariable=self.vars["output_bin"]).grid(row=0, column=1, sticky="ew", padx=(0, 4))
        ttk.Button(out_row, text="...", width=3, command=self._browse_output).grid(row=0, column=2, padx=(0, 10))
        ttk.Button(out_row, text="Fix EDC/ECC", command=self.run_fix).grid(row=0, column=3)

        body = ttk.Frame(self, padding=8)
        body.grid(row=3, column=0, sticky="nsew")
        body.columnconfigure(0, weight=1)
        body.rowconfigure(1, weight=1)

        help_text = (
            "Compares Original BIN against Target BIN sector by sector. Any sector whose "
            "2048-byte user data was changed gets its EDC and ECC (Reed-Solomon P/Q) "
            "recomputed in the output; every other sector -- including any the original "
            "disc might carry intentionally-bad EDC for copy protection -- is copied through "
            "byte-for-byte untouched. This is what makes edited sectors readable on strict "
            "emulator cores, ODEs, and real hardware (see references/platforms/ps1.md)."
        )
        ttk.Label(body, text=help_text, wraplength=920, justify="left").grid(row=0, column=0, sticky="w", pady=(0, 6))

        self.log = tk.Text(body, height=26, wrap="word")
        self.log.grid(row=1, column=0, sticky="nsew")

    def _browse(self, key, kind):
        current = self.vars[key].get()
        initial = str(Path(current).parent if current else ROOT)
        if kind == "dir":
            chosen = filedialog.askdirectory(initialdir=initial)
        else:
            chosen = filedialog.askopenfilename(initialdir=initial)
        if chosen:
            self.vars[key].set(chosen)

    def _browse_output(self):
        current = self.vars["output_bin"].get() or self.vars["target_bin"].get()
        initial_dir = str(Path(current).parent) if current else str(ROOT)
        initial_file = Path(current).stem + "-fixed.bin" if current else "fixed.bin"
        chosen = filedialog.asksaveasfilename(
            initialdir=initial_dir,
            initialfile=initial_file,
            defaultextension=".bin",
            filetypes=[("BIN", "*.bin"), ("All files", "*.*")],
        )
        if chosen:
            self.vars["output_bin"].set(chosen)

    # ------------------------------------------------------------ actions ---

    def run_command(self, title, cmd):
        self._append_log(f"\n## {title}\n{' '.join(map(str, cmd))}\n")

        def worker():
            try:
                proc = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
                for line in proc.stdout:
                    self.log_queue.put(line)
                code = proc.wait()
                self.log_queue.put(f"[exit {code}]\n")
            except Exception as exc:
                self.log_queue.put(f"[error] {exc}\n")

        threading.Thread(target=worker, daemon=True).start()

    def run_self_test(self):
        original_bin = self.vars["original_bin"].get().strip()
        if not original_bin:
            self._append_log("[error] set Original BIN first\n")
            return
        self.run_command(
            "Self-test: recompute every sector's EDC/ECC and compare to the disc's own stored bytes",
            ["node", str(ROOT / "scripts/fix-bin-edc-ecc.js"), "--self-test", original_bin],
        )

    def run_fix(self):
        original_bin = self.vars["original_bin"].get().strip()
        target_bin = self.vars["target_bin"].get().strip()
        output_bin = self.vars["output_bin"].get().strip()
        exe = self.vars["exe"].get().strip()
        fs2_lba = self.vars["fs2_lba"].get().strip()

        if not original_bin or not target_bin:
            self._append_log("[error] original BIN and target BIN are both required\n")
            return
        if not output_bin:
            self._append_log("[error] choose an output BIN path\n")
            return

        cmd = ["node", str(ROOT / "scripts/fix-bin-edc-ecc.js"), original_bin, target_bin, output_bin]
        if exe:
            cmd.extend(["--exe", exe, "--fs2-lba", fs2_lba])
        self.run_command(f"Fix EDC/ECC: {rel(target_bin)} -> {rel(output_bin)}", cmd)

    def _append_log(self, text):
        self.log.insert("end", text)
        self.log.see("end")

    def _drain_log_queue(self):
        while True:
            try:
                item = self.log_queue.get_nowait()
            except queue.Empty:
                break
            self._append_log(str(item))
        self.after(100, self._drain_log_queue)


if __name__ == "__main__":
    app = BinEdcEccFixGui()
    app.mainloop()
