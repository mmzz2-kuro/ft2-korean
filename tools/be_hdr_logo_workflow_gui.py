#!/usr/bin/env python
# -*- coding: utf-8 -*-

import queue
import shutil
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
        item = part.strip()
        if not item:
            continue
        if "-" in item:
            a, b = [int(v.strip(), 0) for v in item.split("-", 1)]
            ids.extend(range(min(a, b), max(a, b) + 1))
        else:
            ids.append(int(item, 0))
    return list(dict.fromkeys(ids))


class BeHdrLogoWorkflowGui(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("SLPS-01903 Title Logo Workflow")
        self.geometry("1040x660")
        self.minsize(900, 560)
        self.log_queue = queue.Queue()
        self.vars = {
            "source": tk.StringVar(value=str(ROOT / "output/patched-farland-saga.bin")),
            "exe": tk.StringVar(value=str(ROOT / "ps1/SLPS-01903/SLPS_019.03")),
            "out": tk.StringVar(value=str(ROOT / "output/patched-farland-saga-logo.bin")),
            "work_dir": tk.StringVar(value=str(ROOT / "tmp/SLPS-01903/logo-workflow")),
            "ids": tk.StringVar(value="251,288,287,300"),
            "fs2_lba": tk.StringVar(value="223"),
            "fs2_sectors": tk.StringVar(value="119472"),
            "allow_overflow": tk.BooleanVar(value=False),
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
            ("Source BIN/DAT", "source", "file"),
            ("SLPS_019.03", "exe", "file"),
            ("Output BIN/DAT", "out", "save"),
            ("Work Dir", "work_dir", "dir"),
        ]
        for r, (label, key, kind) in enumerate(rows):
            ttk.Label(top, text=label).grid(row=r, column=0, sticky="w", padx=(0, 6), pady=2)
            ttk.Entry(top, textvariable=self.vars[key]).grid(row=r, column=1, sticky="ew", padx=(0, 4), pady=2)
            ttk.Button(top, text="...", width=3, command=lambda k=key, t=kind: self._browse(k, t)).grid(row=r, column=2, sticky="ew", pady=2)

        opts = ttk.Frame(self, padding=(8, 0, 8, 8))
        opts.grid(row=1, column=0, sticky="ew")
        for label, key, width in [
            ("resource IDs", "ids", 24),
            ("LBA", "fs2_lba", 6),
            ("sectors", "fs2_sectors", 8),
        ]:
            ttk.Label(opts, text=label).pack(side="left")
            ttk.Entry(opts, textvariable=self.vars[key], width=width).pack(side="left", padx=(4, 10))
        ttk.Checkbutton(opts, text="allow overflow", variable=self.vars["allow_overflow"]).pack(side="left", padx=(0, 10))
        ttk.Button(opts, text="1. Extract Logo Images", command=self.extract_images).pack(side="left", padx=(6, 0))
        ttk.Button(opts, text="2. Apply Edited Images", command=self.apply_images).pack(side="left", padx=(6, 0))

        body = ttk.Frame(self, padding=8)
        body.grid(row=2, column=0, sticky="nsew")
        body.columnconfigure(0, weight=1)
        body.rowconfigure(1, weight=1)

        help_text = (
            "Extract creates raw PGM, contrast PNG, and indexed PNG files.\n"
            "Edit files as: <workDir>/edit/be-hdr-ui-<id>-indexed-edit.png, keeping indexed palette values when possible.\n"
            "Apply packs only IDs that have an *-indexed-edit.png file."
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

    def _source_is_bin(self):
        return Path(self.vars["source"].get()).suffix.lower() == ".bin"

    def _effective_dat(self):
        if self._source_is_bin():
            return Path(self.vars["work_dir"].get()) / "extracted-FS2_FILE.DAT"
        return Path(self.vars["source"].get())

    def _prepare_dat(self, next_step):
        if not self._source_is_bin():
            next_step()
            return
        work_dir = Path(self.vars["work_dir"].get())
        work_dir.mkdir(parents=True, exist_ok=True)
        self.run_command(
            "Extract FS2_FILE.DAT from BIN",
            [
                "node",
                str(ROOT / "scripts/extract-dat-from-raw-bin.js"),
                self.vars["source"].get(),
                str(self._effective_dat()),
                "--lba",
                self.vars["fs2_lba"].get(),
                "--sectors",
                self.vars["fs2_sectors"].get(),
            ],
            next_step,
        )

    def extract_images(self):
        try:
            ids = [str(i) for i in expand_ids(self.vars["ids"].get())]
        except ValueError as exc:
            self._append_log(f"[error] could not parse IDs: {exc}\n")
            return
        if not ids:
            self._append_log("[warn] no IDs entered\n")
            return

        def run_extract():
            work_dir = Path(self.vars["work_dir"].get())
            raw_dir = work_dir / "raw"
            edit_dir = work_dir / "edit"
            raw_dir.mkdir(parents=True, exist_ok=True)
            edit_dir.mkdir(parents=True, exist_ok=True)

            def make_contact():
                self.run_command(
                    "Build contrast contact sheet",
                    [
                        "python",
                        str(ROOT / "scripts/export-behdr-contrast-contact-sheet.py"),
                        str(self._effective_dat()),
                        self.vars["exe"].get(),
                        str(work_dir / "logo-contact.png"),
                        ",".join(ids),
                        "--thumb-width",
                        "240",
                        "--thumb-height",
                        "160",
                        "--cols",
                        "4",
                    ],
                    lambda: self._extract_derived_images(raw_dir, edit_dir, ids),
                )

            self.run_command(
                "Dump raw logo palette indices",
                [
                    "node",
                    str(ROOT / "scripts/be-hdr-ui-tile-tool.js"),
                    "dump-raw",
                    str(self._effective_dat()),
                    self.vars["exe"].get(),
                    str(raw_dir),
                    *ids,
                ],
                make_contact,
            )

        self._prepare_dat(run_extract)

    def _extract_derived_images(self, raw_dir, edit_dir, ids):
        state = {"i": 0}

        def next_one():
            if state["i"] >= len(ids):
                self._append_log(f"[info] logo workflow files are in {rel(Path(self.vars['work_dir'].get()))}\n")
                return
            rid = ids[state["i"]]
            state["i"] += 1
            raw_pgm = raw_dir / f"be-hdr-ui-{rid}-raw.pgm"
            contrast_png = raw_dir / f"be-hdr-ui-{rid}-contrast.png"
            indexed_png = edit_dir / f"be-hdr-ui-{rid}-indexed.png"
            if not raw_pgm.exists():
                self._append_log(f"[skip] resource {rid}: raw PGM missing\n")
                next_one()
                return

            def make_indexed():
                self.run_command(
                    f"Create indexed PNG for resource {rid}",
                    [
                        "python",
                        str(ROOT / "scripts/pgm-indexed-png.py"),
                        "to-png",
                        str(raw_pgm),
                        str(indexed_png),
                    ],
                    next_one,
                )

            self.run_command(
                f"Create contrast PNG for resource {rid}",
                [
                    "python",
                    str(ROOT / "scripts/contrast-pgm-image.py"),
                    str(raw_pgm),
                    str(contrast_png),
                ],
                make_indexed,
            )

        next_one()

    def apply_images(self):
        try:
            ids = [str(i) for i in expand_ids(self.vars["ids"].get())]
        except ValueError as exc:
            self._append_log(f"[error] could not parse IDs: {exc}\n")
            return

        def run_apply():
            work_dir = Path(self.vars["work_dir"].get())
            direct_dir = work_dir / "direct-apply"
            direct_dir.mkdir(parents=True, exist_ok=True)
            working_dat = direct_dir / "working.DAT"
            shutil.copyfile(self._effective_dat(), working_dat)
            state = {"i": 0}

            def process_next():
                if state["i"] >= len(ids):
                    finalize()
                    return
                rid = ids[state["i"]]
                state["i"] += 1
                edit_png = work_dir / "edit" / f"be-hdr-ui-{rid}-indexed-edit.png"
                if not edit_png.exists():
                    self._append_log(f"[skip] resource {rid}: edit PNG not found ({rel(edit_png)})\n")
                    process_next()
                    return
                decoded_pgm = direct_dir / f"be-hdr-ui-{rid}-edited.pgm"

                def pack_raw():
                    cmd = [
                        "node",
                        str(ROOT / "scripts/be-hdr-ui-tile-tool.js"),
                        "pack-raw",
                        str(working_dat),
                        self.vars["exe"].get(),
                        str(working_dat),
                        rid,
                        str(decoded_pgm),
                    ]
                    if self.vars["allow_overflow"].get():
                        cmd.append("--allow-overflow")
                    self.run_command(f"Pack resource {rid}", cmd, process_next)

                self.run_command(
                    f"Convert edited indexed PNG for resource {rid}",
                    [
                        "python",
                        str(ROOT / "scripts/pgm-indexed-png.py"),
                        "to-pgm",
                        str(edit_png),
                        str(decoded_pgm),
                    ],
                    pack_raw,
                )

            def finalize():
                out_path = Path(self.vars["out"].get())
                out_path.parent.mkdir(parents=True, exist_ok=True)
                if out_path.suffix.lower() == ".bin":
                    source_bin = self.vars["source"].get()
                    if not self._source_is_bin():
                        self._append_log("[error] output is BIN but source is not BIN; choose a BIN source or output DAT\n")
                        return
                    self.run_command(
                        "Inject logo-patched DAT into BIN",
                        [
                            "node",
                            str(ROOT / "scripts/inject-dat-into-raw-bin.js"),
                            source_bin,
                            str(working_dat),
                            str(out_path),
                            "--lba",
                            self.vars["fs2_lba"].get(),
                        ],
                    )
                else:
                    shutil.copyfile(working_dat, out_path)
                    self._append_log(f"[info] wrote {rel(out_path)}\n")

            process_next()

        self._prepare_dat(run_apply)

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
    app = BeHdrLogoWorkflowGui()
    app.mainloop()
