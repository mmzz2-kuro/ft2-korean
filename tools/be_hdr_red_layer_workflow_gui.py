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
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            start, end = int(a.strip()), int(b.strip())
            ids.extend(range(min(start, end), max(start, end) + 1))
        else:
            ids.append(int(part))
    return sorted(set(ids))


def layer_label(indexes_text):
    safe = []
    for ch in (indexes_text or "").strip():
        if ch.isdigit() or ch in "-_":
            safe.append(ch)
        elif ch == ",":
            safe.append("_")
    return "idx" + ("".join(safe).strip("_-") or "layer")


class BeHdrRedLayerWorkflowGui(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("SLPS-01903 be-hdr Palette Layer Workflow")
        self.geometry("1280x760")
        self.minsize(1280, 720)
        self.log_queue = queue.Queue()
        self.vars = {
            "input_bin": tk.StringVar(value=str(ROOT / "output/patched-farland-saga-check1.bin")),
            "source_bin": tk.StringVar(value=str(ROOT / "output/patched-farland-saga-check1.bin")),
            "output_bin": tk.StringVar(value=str(ROOT / "output/patched-farland-saga-palette-layer.bin")),
            "exe": tk.StringVar(value=str(ROOT / "ps1/SLPS-01903/SLPS_019.03")),
            "work_dir": tk.StringVar(value=str(ROOT / "tmp/SLPS-01903/be-hdr-ui-workflow/palette-layer")),
            "ids": tk.StringVar(value="827,1187"),
            "indexes": tk.StringVar(value="224-231"),
            "fs2_lba": tk.StringVar(value="223"),
            "fs2_sectors": tk.StringVar(value="119472"),
            "threshold": tk.StringVar(value="38"),
            "split_indexes": tk.BooleanVar(value=True),
            "lossy_fit": tk.BooleanVar(value=False),
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
            ("Input BIN", "input_bin", "file"),
            ("Source BIN", "source_bin", "file"),
            ("Output BIN", "output_bin", "save"),
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
            ("IDs", "ids", 20),
            ("palette indexes", "indexes", 14),
            ("threshold", "threshold", 5),
            ("LBA", "fs2_lba", 6),
            ("sectors", "fs2_sectors", 8),
        ]:
            ttk.Label(opts, text=label).pack(side="left")
            ttk.Entry(opts, textvariable=self.vars[key], width=width).pack(side="left", padx=(4, 10))
        ttk.Checkbutton(opts, text="separate palette files", variable=self.vars["split_indexes"]).pack(side="left", padx=(0, 10))
        ttk.Checkbutton(opts, text="pack with lossy-fit", variable=self.vars["lossy_fit"]).pack(side="left", padx=(0, 10))
        ttk.Checkbutton(opts, text="allow tile overflow", variable=self.vars["allow_overflow"]).pack(side="left", padx=(0, 10))
        ttk.Button(opts, text="1. Extract DAT + Export Palette Layers", command=self.export_layers).pack(side="left", padx=(0, 6))
        ttk.Button(opts, text="2. Apply Edited Palette Layers", command=self.apply_layers).pack(side="left", padx=(0, 6))

        body = ttk.Frame(self, padding=8)
        body.grid(row=2, column=0, sticky="nsew")
        body.columnconfigure(0, weight=1)
        body.rowconfigure(1, weight=1)

        help_text = (
            "Workflow: first run Export, edit <id>-idx...-edit.png files, then Apply.\n"
            "With separate palette files enabled, indexes 2-3 exports idx2 and idx3 separately. Black means 'leave unchanged'.\n"
            "Use allow tile overflow only when pack-raw reports a small capacity overflow and the result must be tested in-game."
        )
        ttk.Label(body, text=help_text).grid(row=0, column=0, sticky="w", pady=(0, 6))

        self.log = tk.Text(body, height=24, wrap="word")
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

    def export_layers(self):
        work_dir = Path(self.vars["work_dir"].get())
        work_dir.mkdir(parents=True, exist_ok=True)
        dat_path = work_dir / "extracted-FS2_FILE.DAT"

        def dump_raw():
            ids = [str(i) for i in expand_ids(self.vars["ids"].get())]
            if not ids:
                self._append_log("[warn] no resource IDs selected.\n")
                return
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
                lambda: self._export_palette_images(ids),
            )

        self.run_command(
            "Extract FS2_FILE.DAT from BIN",
            [
                "node",
                str(ROOT / "scripts/extract-dat-from-raw-bin.js"),
                self.vars["input_bin"].get(),
                str(dat_path),
                "--lba",
                self.vars["fs2_lba"].get(),
                "--sectors",
                self.vars["fs2_sectors"].get(),
            ],
            dump_raw,
        )

    def _export_palette_images(self, ids):
        state = {"i": 0}
        groups = self._index_groups()
        if not groups:
            self._append_log("[warn] no palette indexes selected.\n")
            return

        def next_one():
            if state["i"] >= len(ids) * len(groups):
                self._append_log(f"[info] palette layer images are in {rel(self.vars['work_dir'].get())}\n")
                return
            resource_id = ids[state["i"] // len(groups)]
            group_indexes = groups[state["i"] % len(groups)]
            state["i"] += 1
            indexes_text = self._indexes_text(group_indexes)
            label = layer_label(indexes_text)
            work_dir = Path(self.vars["work_dir"].get())
            self.run_command(
                f"Export palette layer {resource_id} {label}",
                [
                    "python",
                    str(ROOT / "scripts/be-hdr-red-layer-tool.py"),
                    "export",
                    str(work_dir / f"be-hdr-ui-{resource_id}-raw.pgm"),
                    str(work_dir),
                    "--prefix",
                    f"be-hdr-ui-{resource_id}",
                    "--indexes",
                    indexes_text,
                    "--label",
                    label,
                ],
                next_one,
            )

        next_one()

    def apply_layers(self):
        work_dir = Path(self.vars["work_dir"].get())
        source_dat = work_dir / "extracted-FS2_FILE.DAT"
        working_dat = work_dir / "palette-layer-working.DAT"
        if not source_dat.exists():
            self._append_log(f"[warn] missing extracted DAT: {rel(source_dat)}. Run export first.\n")
            return
        shutil.copyfile(source_dat, working_dat)
        ids = [str(i) for i in expand_ids(self.vars["ids"].get())]
        groups = self._index_groups()
        if not ids:
            self._append_log("[warn] no resource IDs selected.\n")
            return
        if not groups:
            self._append_log("[warn] no palette indexes selected.\n")
            return
        state = {"i": 0, "current_dat": str(working_dat)}

        def next_one():
            if state["i"] >= len(ids):
                self._inject_bin(working_dat)
                return
            resource_id = ids[state["i"]]
            state["i"] += 1
            raw_pgm = work_dir / f"be-hdr-ui-{resource_id}-raw.pgm"

            def pack():
                cmd = [
                    "node",
                    str(ROOT / "scripts/be-hdr-ui-tile-tool.js"),
                    "pack-raw",
                    state["current_dat"],
                    self.vars["exe"].get(),
                    state["current_dat"],
                    resource_id,
                    str(chain_state["current_pgm"]),
                ]
                if self.vars["lossy_fit"].get():
                    cmd.append("--lossy-fit")
                if self.vars["allow_overflow"].get():
                    cmd.append("--allow-overflow")
                self.run_command(f"Pack palette layer {resource_id}", cmd, next_one)

            chain_state = {"group": 0, "current_pgm": raw_pgm, "applied_any": False}

            def apply_next_group():
                if chain_state["group"] >= len(groups):
                    if chain_state["applied_any"]:
                        pack()
                    else:
                        self._append_log(f"[skip] no edited palette layer for resource {resource_id}\n")
                        next_one()
                    return

                group_indexes = groups[chain_state["group"]]
                chain_state["group"] += 1
                indexes_text = self._indexes_text(group_indexes)
                label = layer_label(indexes_text)
                edited_png = work_dir / f"be-hdr-ui-{resource_id}-{label}-edit.png"
                if not edited_png.exists():
                    legacy_png = work_dir / f"be-hdr-ui-{resource_id}-red-edit.png"
                    if label == "idx224-231" and legacy_png.exists():
                        edited_png = legacy_png
                if not edited_png.exists():
                    self._append_log(f"[skip] missing edited palette layer: {rel(edited_png)}\n")
                    apply_next_group()
                    return

                out_pgm = work_dir / f"be-hdr-ui-{resource_id}-{label}-applied.pgm"
                self.run_command(
                    f"Apply palette layer PNG {resource_id} {label}",
                    [
                        "python",
                        str(ROOT / "scripts/be-hdr-red-layer-tool.py"),
                        "apply",
                        str(chain_state["current_pgm"]),
                        str(edited_png),
                        str(out_pgm),
                        "--indexes",
                        indexes_text,
                        "--threshold",
                        self.vars["threshold"].get(),
                    ],
                    lambda: self._mark_applied_and_continue(chain_state, out_pgm, apply_next_group),
                )

            apply_next_group()

        next_one()

    def _index_groups(self):
        indexes = expand_ids(self.vars["indexes"].get())
        if not indexes:
            return []
        if self.vars["split_indexes"].get():
            return [[index] for index in indexes]
        return [indexes]

    def _indexes_text(self, indexes):
        return ",".join(str(index) for index in indexes)

    def _mark_applied_and_continue(self, chain_state, out_pgm, callback):
        chain_state["current_pgm"] = out_pgm
        chain_state["applied_any"] = True
        callback()

    def _inject_bin(self, dat_path):
        self.run_command(
            "Inject palette-layer DAT into BIN",
            [
                "node",
                str(ROOT / "scripts/inject-dat-into-raw-bin.js"),
                self.vars["source_bin"].get(),
                str(dat_path),
                self.vars["output_bin"].get(),
                "--lba",
                self.vars["fs2_lba"].get(),
            ],
        )

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
    app = BeHdrRedLayerWorkflowGui()
    app.mainloop()
