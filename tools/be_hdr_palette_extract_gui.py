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


def expand_ids(text):
    ids = []
    for part in (text or "").split(","):
        trimmed = part.strip()
        if not trimmed:
            continue
        if "-" in trimmed:
            start_text, end_text = trimmed.split("-", 1)
            start, end = int(start_text.strip()), int(end_text.strip())
            ids.extend(range(min(start, end), max(start, end) + 1))
        else:
            ids.append(int(trimmed))
    return sorted(set(ids))


class BeHdrPaletteExtractGui(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("SLPS-01903 be-hdr Palette Index Extract")
        self.geometry("980x640")
        self.minsize(860, 520)
        self.log_queue = queue.Queue()
        self.vars = {
            "source_bin": tk.StringVar(value=str(ROOT / "ps1/SLPS-01903/bincue/Farland Saga - Toki no Michishirube.bin")),
            "exe": tk.StringVar(value=str(ROOT / "ps1/SLPS-01903/SLPS_019.03")),
            "work_dir": tk.StringVar(value=str(ROOT / "tmp/SLPS-01903/be-hdr-ui-workflow/palette-extract")),
            "ids": tk.StringVar(value="1"),
            "palette_index": tk.StringVar(value="1"),
            "fs2_lba": tk.StringVar(value="223"),
            "fs2_sectors": tk.StringVar(value="119472"),
        }
        self._build_ui()
        self.after(100, self._drain_log_queue)

    def _build_ui(self):
        self.columnconfigure(0, weight=1)
        self.rowconfigure(2, weight=1)

        top = ttk.Frame(self, padding=8)
        top.grid(row=0, column=0, sticky="ew")
        top.columnconfigure(1, weight=1)

        rows = [
            ("Source BIN", "source_bin", "file"),
            ("SLPS_019.03", "exe", "file"),
            ("Work Dir", "work_dir", "dir"),
        ]
        for r, (label, key, kind) in enumerate(rows):
            ttk.Label(top, text=label).grid(row=r, column=0, sticky="w", padx=(0, 4), pady=2)
            ttk.Entry(top, textvariable=self.vars[key]).grid(row=r, column=1, sticky="ew", padx=(0, 4), pady=2)
            ttk.Button(top, text="...", width=3, command=lambda k=key, t=kind: self._browse(k, t)).grid(row=r, column=2, sticky="ew", pady=2)

        opts = ttk.Frame(self, padding=(8, 0, 8, 8))
        opts.grid(row=1, column=0, sticky="ew")
        for label, key, width in [
            ("resource IDs", "ids", 34),
            ("palette index", "palette_index", 6),
            ("LBA", "fs2_lba", 6),
            ("sectors", "fs2_sectors", 8),
        ]:
            ttk.Label(opts, text=label).pack(side="left")
            ttk.Entry(opts, textvariable=self.vars[key], width=width).pack(side="left", padx=(4, 10))
        ttk.Button(opts, text="Extract Palette Index Masks", command=self.extract_masks).pack(side="left", padx=(6, 0))

        body = ttk.Frame(self, padding=8)
        body.grid(row=2, column=0, sticky="nsew")
        body.columnconfigure(0, weight=1)
        body.rowconfigure(1, weight=1)

        help_text = (
            "resource IDs use the same 811-828,1170-1185,1187 style as be_hdr_ui_workflow_gui.py.\n"
            "Output: <workDir>/be-hdr-ui-<id>-index<N>-mask.png, white where that palette index is used, black elsewhere\n"
            "(index 1 is the outline-ink index -- pass it straight to scripts/mask-subtract-image.py as the mask)."
        )
        ttk.Label(body, text=help_text).grid(row=0, column=0, sticky="w", pady=(0, 6))

        self.log = tk.Text(body, height=28, wrap="word")
        self.log.grid(row=1, column=0, sticky="nsew")

    def _browse(self, key, kind):
        current = self.vars[key].get()
        initial = str(Path(current).parent if current else ROOT)
        if kind == "dir":
            chosen = filedialog.askdirectory(initialdir=initial)
        elif kind == "save":
            chosen = filedialog.asksaveasfilename(initialdir=initial, initialfile=Path(current).name)
        else:
            chosen = filedialog.askopenfilename(initialdir=initial)
        if chosen:
            self.vars[key].set(chosen)

    def run_command(self, title, cmd, on_success=None):
        self._append_log(f"\n## {title}\n{' '.join(map(str, cmd))}\n")

        def worker():
            try:
                proc = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
                for line in proc.stdout:
                    self.log_queue.put(line)
                code = proc.wait()
                self.log_queue.put(f"[exit {code}]\n")
                if code == 0 and on_success:
                    self.log_queue.put(("CALLBACK", on_success))
            except Exception as exc:
                self.log_queue.put(f"[error] {exc}\n")

        threading.Thread(target=worker, daemon=True).start()

    def extract_masks(self):
        try:
            ids = [str(i) for i in expand_ids(self.vars["ids"].get())]
        except ValueError as exc:
            self._append_log(f"[error] could not parse resource IDs: {exc}\n")
            return
        if not ids:
            self._append_log("[warn] no resource IDs entered\n")
            return
        try:
            palette_index = int(self.vars["palette_index"].get())
        except ValueError:
            self._append_log("[error] palette index must be an integer\n")
            return

        work_dir = Path(self.vars["work_dir"].get())
        work_dir.mkdir(parents=True, exist_ok=True)
        dat_path = work_dir / "extracted-FS2_FILE.DAT"

        def dump_raw():
            self.run_command(
                "Dump raw palette indices",
                [
                    "node",
                    str(ROOT / "scripts/be-hdr-ui-tile-tool.js"),
                    "dump-raw",
                    str(dat_path),
                    self.vars["exe"].get(),
                    str(work_dir),
                    *ids,
                ],
                lambda: self._extract_index_masks(work_dir, ids, palette_index),
            )

        self.run_command(
            "Extract FS2_FILE.DAT from BIN",
            [
                "node",
                str(ROOT / "scripts/extract-dat-from-raw-bin.js"),
                self.vars["source_bin"].get(),
                str(dat_path),
                "--lba",
                self.vars["fs2_lba"].get(),
                "--sectors",
                self.vars["fs2_sectors"].get(),
            ],
            dump_raw,
        )

    def _extract_index_masks(self, work_dir, ids, palette_index):
        state = {"i": 0}

        def next_one():
            if state["i"] >= len(ids):
                self._append_log(f"[info] palette index masks are in {rel(work_dir)}\n")
                return
            resource_id = ids[state["i"]]
            state["i"] += 1
            raw_pgm = work_dir / f"be-hdr-ui-{resource_id}-raw.pgm"
            out_png = work_dir / f"be-hdr-ui-{resource_id}-index{palette_index}-mask.png"
            if not raw_pgm.exists():
                self._append_log(f"[skip] resource {resource_id}: no raw dump at {rel(raw_pgm)}\n")
                next_one()
                return
            self.run_command(
                f"Extract palette index {palette_index} mask for resource {resource_id}",
                [
                    "python",
                    str(ROOT / "scripts/extract-palette-index-mask.py"),
                    str(raw_pgm),
                    str(out_png),
                    "--index",
                    str(palette_index),
                ],
                next_one,
            )

        next_one()

    def _append_log(self, text):
        self.log.insert("end", text)
        self.log.see("end")

    def _drain_log_queue(self):
        while True:
            try:
                item = self.log_queue.get_nowait()
            except queue.Empty:
                break
            if isinstance(item, tuple) and item[0] == "CALLBACK":
                item[1]()
            else:
                self._append_log(str(item))
        self.after(100, self._drain_log_queue)


if __name__ == "__main__":
    app = BeHdrPaletteExtractGui()
    app.mainloop()
