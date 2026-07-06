#!/usr/bin/env python
# -*- coding: utf-8 -*-

import csv
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


def unescape_tsv(value):
    marker = "\ue000"
    return (value or "").replace("\\\\", marker).replace("\\n", "\n").replace("\\t", "\t").replace(marker, "\\")


def escape_tsv(value):
    return (value or "").replace("\\", "\\\\").replace("\t", "\\t").replace("\r", "").replace("\n", "\\n")


class BeHdrUiWorkflowGui(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("SLPS-01903 be-hdr UI Workflow")
        self.geometry("1180x760")
        self.minsize(980, 620)

        self.rows = []
        self.headers = []
        self.selected_index = None
        self.log_queue = queue.Queue()
        self.vars = {
            "dat": tk.StringVar(value=str(ROOT / "output/patched-farland-saga.bin")),
            "exe": tk.StringVar(value=str(ROOT / "ps1/SLPS-01903/SLPS_019.03")),
            "font": tk.StringVar(value=str(ROOT / "font/NanumSquareRoundR.ttf")),
            "source_bin": tk.StringVar(value=str(ROOT / "ps1/SLPS-01903/bincue/Farland Saga - Toki no Michishirube.bin")),
            "translation": tk.StringVar(value=str(ROOT / "tmp/SLPS-01903/be-hdr-ui-workflow/be-hdr-ui-translation.tsv")),
            "mask_dir": tk.StringVar(value=str(ROOT / "tmp/SLPS-01903/be-hdr-ui-workflow/masks")),
            "out_dat": tk.StringVar(value=str(ROOT / "output/patched-farland-saga-ui.bin")),
            "out_bin": tk.StringVar(value=str(ROOT / "tmp/SLPS-01903/be-hdr-ui-workflow/patched-be-hdr-ui.bin")),
            "work_dir": tk.StringVar(value=str(ROOT / "tmp/SLPS-01903/be-hdr-ui-workflow/apply")),
            "ids": tk.StringVar(value="827,828,1199,1207,1210,1211,1212,1213"),
            "fs2_lba": tk.StringVar(value="223"),
            "fs2_sectors": tk.StringVar(value="119472"),
            "font_size": tk.StringVar(value="24"),
            "line_height": tk.StringVar(value="24"),
            "pad": tk.StringVar(value="1"),
            "threshold": tk.StringVar(value="64"),
            "bold": tk.StringVar(value="0"),
            "source_ink_indexes": tk.StringVar(value="224-232"),
            "ink_index": tk.StringVar(value="232"),
            "bg_index": tk.StringVar(value="3"),
            "invert": tk.BooleanVar(value=True),
            "trim": tk.BooleanVar(value=True),
            "mode": tk.StringVar(value="AntiAlias"),
        }

        self._build_ui()
        self.after(100, self._drain_log_queue)

    def _build_ui(self):
        self.columnconfigure(0, weight=1)
        self.rowconfigure(1, weight=1)

        top = ttk.Frame(self, padding=8)
        top.grid(row=0, column=0, sticky="ew")
        top.columnconfigure(1, weight=1)
        top.columnconfigure(3, weight=1)

        path_rows = [
            ("FS2_FILE.DAT", "dat", "file"),
            ("SLPS_019.03", "exe", "file"),
            ("Font", "font", "file"),
            ("Source BIN", "source_bin", "file"),
            ("Translation TSV", "translation", "save"),
            ("Mask Dir", "mask_dir", "dir"),
            ("Patched DAT tmp", "out_dat", "save"),
            ("Output BIN", "out_bin", "save"),
            ("Work Dir", "work_dir", "dir"),
        ]
        for i, (label, key, kind) in enumerate(path_rows):
            r = i // 2
            c = (i % 2) * 3
            ttk.Label(top, text=label).grid(row=r, column=c, sticky="w", padx=(0, 4), pady=2)
            ttk.Entry(top, textvariable=self.vars[key]).grid(row=r, column=c + 1, sticky="ew", padx=(0, 4), pady=2)
            ttk.Button(top, text="...", width=3, command=lambda k=key, t=kind: self._browse(k, t)).grid(row=r, column=c + 2, sticky="ew", pady=2)

        opts = ttk.Frame(top)
        opts.grid(row=5, column=0, columnspan=6, sticky="ew", pady=(8, 0))
        for label, key, width in [
            ("IDs", "ids", 34),
            ("font", "font_size", 4),
            ("line", "line_height", 4),
            ("pad", "pad", 4),
            ("thr", "threshold", 4),
            ("bold", "bold", 4),
            ("src ink", "source_ink_indexes", 7),
            ("ink", "ink_index", 3),
            ("bg", "bg_index", 3),
            ("LBA", "fs2_lba", 6),
            ("sectors", "fs2_sectors", 7),
        ]:
            ttk.Label(opts, text=label).pack(side="left")
            ttk.Entry(opts, textvariable=self.vars[key], width=width).pack(side="left", padx=(4, 8))
        ttk.Checkbutton(opts, text="invert", variable=self.vars["invert"]).pack(side="left", padx=(0, 8))
        ttk.Checkbutton(opts, text="trim", variable=self.vars["trim"]).pack(side="left", padx=(0, 8))
        ttk.Combobox(opts, textvariable=self.vars["mode"], values=["AntiAlias", "Single"], width=9, state="readonly").pack(side="left")

        buttons = ttk.Frame(top)
        buttons.grid(row=6, column=0, columnspan=6, sticky="ew", pady=(8, 0))
        ttk.Button(buttons, text="1. Export TSV/PBM", command=self.export_tsv).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="Load TSV", command=self.load_tsv).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="Save TSV", command=self.save_tsv).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="Check Filled", command=lambda: self.set_checked("filled")).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="Check All", command=lambda: self.set_checked("all")).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="Uncheck All", command=lambda: self.set_checked("none")).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="Check Selected", command=lambda: self.set_checked_selected(True)).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="Uncheck Selected", command=lambda: self.set_checked_selected(False)).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="Apply Bulk Options", command=self.apply_bulk_options).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="2. Apply to BIN", command=self.apply_tsv).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="2. Apply to BIN (Direct)", command=self.apply_tsv_direct).pack(side="left", padx=(0, 6))

        main = ttk.PanedWindow(self, orient=tk.HORIZONTAL)
        main.grid(row=1, column=0, sticky="nsew", padx=8, pady=(0, 8))

        left = ttk.Frame(main)
        left.rowconfigure(0, weight=1)
        left.columnconfigure(0, weight=1)
        main.add(left, weight=3)

        cols = (
            "enabled",
            "resource_id",
            "ko_text",
            "replacement_png",
            "erase_pbm",
            "replacement_mode",
            "patch_regions",
            "width",
            "height",
            "font_size",
            "invert",
            "source_ink_indexes",
            "ink_index",
            "bg_index",
            "lossy_fit",
            "lossy_protect_regions",
            "heal_regions",
            "heal_indexes",
            "heal_radius",
        )
        self.tree = ttk.Treeview(left, columns=cols, show="headings", selectmode="extended")
        for col in cols:
            self.tree.heading(col, text=col)
            self.tree.column(col, width=76 if col != "ko_text" else 240, anchor="w")
        self.tree.grid(row=0, column=0, sticky="nsew")
        ttk.Scrollbar(left, orient="vertical", command=self.tree.yview).grid(row=0, column=1, sticky="ns")
        self.tree.configure(yscrollcommand=lambda *args: None)
        self.tree.bind("<<TreeviewSelect>>", self.on_select)
        self.tree.bind("<Double-1>", lambda _event: self.toggle_selected())

        right = ttk.Frame(main, padding=(8, 0, 0, 0))
        right.columnconfigure(1, weight=1)
        main.add(right, weight=2)
        self.edit_vars = {
            k: tk.StringVar()
            for k in [
                "enabled",
                "resource_id",
                "ko_text",
                "width",
                "height",
                "font_size",
                "line_height",
                "pad",
                "threshold",
                "bold",
                "invert",
                "source_ink_indexes",
                "ink_index",
                "bg_index",
                "source_pbm",
                "editable_png",
                "replacement_pbm",
                "replacement_png",
                "erase_pbm",
                "replacement_mode",
                "patch_regions",
                "lossy_fit",
                "lossy_protect_regions",
                "heal_regions",
                "heal_indexes",
                "heal_radius",
            ]
        }
        for r, key in enumerate(["enabled", "resource_id", "source_pbm", "editable_png", "replacement_pbm", "replacement_png", "erase_pbm", "replacement_mode", "patch_regions", "lossy_fit", "lossy_protect_regions", "heal_regions", "heal_indexes", "heal_radius", "ko_text", "width", "height", "font_size", "line_height", "pad", "threshold", "bold", "invert", "source_ink_indexes", "ink_index", "bg_index"]):
            ttk.Label(right, text=key).grid(row=r, column=0, sticky="w", pady=2)
            ttk.Entry(right, textvariable=self.edit_vars[key]).grid(row=r, column=1, sticky="ew", pady=2)
        ttk.Button(right, text="Update Row", command=self.update_row).grid(row=26, column=0, columnspan=2, sticky="ew", pady=(8, 2))

        log_frame = ttk.LabelFrame(self, text="Log", padding=4)
        log_frame.grid(row=2, column=0, sticky="ew", padx=8, pady=(0, 8))
        log_frame.columnconfigure(0, weight=1)
        self.log = tk.Text(log_frame, height=8, wrap="word")
        self.log.grid(row=0, column=0, sticky="ew")

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

    def _dat_field_is_bin(self):
        return Path(self.vars["dat"].get()).suffix.lower() == ".bin"

    def _effective_source_bin_path(self):
        if self._dat_field_is_bin():
            return self.vars["dat"].get()
        return self.vars["source_bin"].get()

    def _effective_dat_path(self):
        if self._dat_field_is_bin():
            return str(ROOT / "tmp/SLPS-01903/be-hdr-ui-workflow/extracted-FS2_FILE.DAT")
        return self.vars["dat"].get()

    def _extract_dat_command(self):
        return [
            "node",
            str(ROOT / "scripts/extract-dat-from-raw-bin.js"),
            self._effective_source_bin_path(),
            self._effective_dat_path(),
            "--lba",
            self.vars["fs2_lba"].get(),
            "--sectors",
            self.vars["fs2_sectors"].get(),
        ]

    def _run_after_dat_ready(self, next_step):
        if not self._dat_field_is_bin():
            next_step()
            return
        self.vars["source_bin"].set(self._effective_source_bin_path())
        self.run_command("Extract FS2_FILE.DAT from BIN", self._extract_dat_command(), on_success=next_step)

    def export_tsv(self):
        def run_export():
            cmd = [
                "node",
                str(ROOT / "scripts/export-behdr-ui-translation-table.js"),
                self._effective_dat_path(),
                self.vars["exe"].get(),
                self.vars["translation"].get(),
                self.vars["mask_dir"].get(),
                "--ids",
                self.vars["ids"].get(),
                "--font-size",
                self.vars["font_size"].get(),
                "--line-height",
                self.vars["line_height"].get(),
                "--pad",
                self.vars["pad"].get(),
                "--threshold",
                self.vars["threshold"].get(),
                "--bold",
                self.vars["bold"].get(),
                "--ink-index",
                self.vars["ink_index"].get(),
                "--bg-index",
                self.vars["bg_index"].get(),
                "--source-ink-indexes",
                self.vars["source_ink_indexes"].get(),
                "--lba",
                self.vars["fs2_lba"].get(),
                "--sectors",
                self.vars["fs2_sectors"].get(),
            ]
            if self.vars["invert"].get():
                cmd.append("--invert")

            def run_dump_raw():
                ids = [part.strip() for part in self.vars["ids"].get().split(",") if part.strip()]
                dump_cmd = [
                    "node",
                    str(ROOT / "scripts/be-hdr-ui-tile-tool.js"),
                    "dump-raw",
                    self._effective_dat_path(),
                    self.vars["exe"].get(),
                    self.vars["mask_dir"].get(),
                    *ids,
                ]

                def run_colorize_batch():
                    colorize_cmd = [
                        "python",
                        str(ROOT / "scripts/colorize-behdr-pgm.py"),
                        "batch",
                        self.vars["mask_dir"].get(),
                        self.vars["ids"].get(),
                    ]
                    self.run_command("Colorize editable_png as raw-index images", colorize_cmd, self.load_tsv)

                self.run_command("Dump raw palette indices for editable_png", dump_cmd, run_colorize_batch)

            self.run_command("Export be-hdr UI TSV/PBM", cmd, run_dump_raw)

        self._run_after_dat_ready(run_export)

    def apply_tsv(self):
        self.save_tsv()

        def run_apply():
            out_dat = self.vars["out_dat"].get()
            out_bin = self.vars["out_bin"].get()
            if Path(out_dat).suffix.lower() == ".bin":
                out_bin = out_dat
                out_dat = str(ROOT / "tmp/SLPS-01903/be-hdr-ui-workflow/patched-be-hdr-ui.DAT")
                self._append_log(f"[info] Patched DAT tmp points to .bin; using temporary DAT path: {rel(out_dat)}\n")
            cmd = [
                "powershell",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(ROOT / "scripts/apply-behdr-ui-translation.ps1"),
                "-DatPath",
                self._effective_dat_path(),
                "-ExePath",
                self.vars["exe"].get(),
                "-TranslationTsv",
                self.vars["translation"].get(),
                "-OutDat",
                out_dat,
                "-SourceBin",
                self._effective_source_bin_path(),
                "-OutBin",
                out_bin,
                "-Fs2Lba",
                self.vars["fs2_lba"].get(),
                "-FontPath",
                self.vars["font"].get(),
                "-WorkDir",
                self.vars["work_dir"].get(),
                "-Mode",
                self.vars["mode"].get(),
            ]
            if self.vars["trim"].get():
                cmd.append("-TrimToOrigin")
            self.run_command("Apply be-hdr UI translation", cmd)

        self._run_after_dat_ready(run_apply)

    def apply_tsv_direct(self):
        self.save_tsv()
        rows_to_process = [row for row in self.rows if row.get("enabled") == "1"]
        if not rows_to_process:
            self._append_log("[warn] no enabled rows to apply\n")
            return

        def run_apply():
            out_dat_field = self.vars["out_dat"].get()
            out_is_bin = Path(out_dat_field).suffix.lower() == ".bin"
            work_dir = ROOT / "tmp/SLPS-01903/be-hdr-ui-workflow/direct-apply"
            work_dir.mkdir(parents=True, exist_ok=True)
            state = {"current_dat": self._effective_dat_path(), "index": 0}

            def process_next():
                if state["index"] >= len(rows_to_process):
                    finalize()
                    return
                row = rows_to_process[state["index"]]
                state["index"] += 1
                resource_id = row.get("resource_id", "").strip()
                replacement_png = row.get("replacement_png", "").strip()
                if not resource_id:
                    process_next()
                    return
                if not replacement_png or not Path(replacement_png).exists():
                    self._append_log(f"[skip] resource {resource_id}: replacement_png missing or not found ({replacement_png})\n")
                    process_next()
                    return
                raw_pgm = Path(self.vars["mask_dir"].get()) / f"be-hdr-ui-{resource_id}-raw.pgm"
                if not raw_pgm.exists():
                    self._append_log(f"[skip] resource {resource_id}: no reference raw pgm at {rel(raw_pgm)} -- run Export TSV/PBM first\n")
                    process_next()
                    return

                decoded_pgm = work_dir / f"{resource_id}-decoded.pgm"
                decode_cmd = [
                    "python",
                    str(ROOT / "scripts/decode-behdr-edited-image.py"),
                    str(raw_pgm),
                    replacement_png,
                    str(decoded_pgm),
                    "--outline-index",
                    "1",
                    "--fill-index",
                    "2",
                ]

                def run_pack(resource_id=resource_id, decoded_pgm=decoded_pgm, step=state["index"]):
                    next_dat = work_dir / f"working-{step}.DAT"
                    pack_cmd = [
                        "node",
                        str(ROOT / "scripts/be-hdr-ui-tile-tool.js"),
                        "pack-raw",
                        state["current_dat"],
                        self.vars["exe"].get(),
                        str(next_dat),
                        resource_id,
                        str(decoded_pgm),
                        "--lossy-fit",
                    ]

                    def after_pack():
                        state["current_dat"] = str(next_dat)
                        process_next()

                    self.run_command(f"Pack resource {resource_id} (direct)", pack_cmd, after_pack)

                self.run_command(f"Decode replacement_png for resource {resource_id}", decode_cmd, run_pack)

            def finalize():
                Path(out_dat_field).parent.mkdir(parents=True, exist_ok=True)
                if out_is_bin:
                    inject_cmd = [
                        "node",
                        str(ROOT / "scripts/inject-dat-into-raw-bin.js"),
                        self._effective_source_bin_path(),
                        state["current_dat"],
                        out_dat_field,
                        "--lba",
                        self.vars["fs2_lba"].get(),
                    ]
                    self.run_command("Inject accumulated DAT into BIN", inject_cmd)
                else:
                    import shutil

                    shutil.copyfile(state["current_dat"], out_dat_field)
                    self._append_log(f"[info] wrote {rel(out_dat_field)}\n")

            process_next()

        self._run_after_dat_ready(run_apply)

    def load_tsv(self):
        path = Path(self.vars["translation"].get())
        if not path.exists():
            self._append_log(f"[warn] TSV does not exist: {rel(path)}\n")
            return
        with path.open("r", encoding="utf-8", newline="") as f:
            reader = csv.reader(f, delimiter="\t")
            rows = list(reader)
        if not rows:
            return
        self.headers = rows[0]
        self.rows = [{h: unescape_tsv(row[i] if i < len(row) else "") for i, h in enumerate(self.headers)} for row in rows[1:] if any(row)]
        self.refresh_tree()
        self._append_log(f"loaded {len(self.rows)} rows: {rel(path)}\n")

    def save_tsv(self):
        if self.selected_index is not None:
            self.update_row()
        path = Path(self.vars["translation"].get())
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8", newline="") as f:
            writer = csv.writer(f, delimiter="\t", lineterminator="\n")
            writer.writerow(self.headers)
            for row in self.rows:
                writer.writerow([escape_tsv(row.get(h, "")) for h in self.headers])
        self._append_log(f"saved {rel(path)}\n")

    def refresh_tree(self):
        self.tree.delete(*self.tree.get_children())
        for i, row in enumerate(self.rows):
            self.tree.insert("", "end", iid=str(i), values=[row.get(c, "") for c in self.tree["columns"]])

    def on_select(self, _event=None):
        selection = self.tree.selection()
        if not selection:
            return
        self.selected_index = int(selection[0])
        row = self.rows[self.selected_index]
        for key, var in self.edit_vars.items():
            var.set(row.get(key, ""))

    def update_row(self):
        if self.selected_index is None:
            return
        row = self.rows[self.selected_index]
        for key, var in self.edit_vars.items():
            if key in self.headers:
                row[key] = var.get()
        self.refresh_tree()
        self.tree.selection_set(str(self.selected_index))

    def toggle_selected(self):
        if self.selected_index is None:
            return
        row = self.rows[self.selected_index]
        row["enabled"] = "" if row.get("enabled") == "1" else "1"
        self.refresh_tree()

    def set_checked(self, mode):
        for row in self.rows:
            if mode == "all":
                row["enabled"] = "1"
            elif mode == "none":
                row["enabled"] = ""
            elif mode == "filled":
                row["enabled"] = "1" if row.get("ko_text", "").strip() else ""
        self.refresh_tree()

    def set_checked_selected(self, checked):
        selection = self.tree.selection()
        if not selection:
            self._append_log("[warn] no rows selected\n")
            return

        if self.selected_index is not None:
            self.update_row()

        indices = sorted(int(iid) for iid in selection)
        value = "1" if checked else ""
        changed = 0
        for idx in indices:
            row = self.rows[idx]
            if row.get("enabled", "") != value:
                changed += 1
            row["enabled"] = value

        self.refresh_tree()
        restore = [str(idx) for idx in indices if idx < len(self.rows)]
        if restore:
            self.tree.selection_set(restore)
        label = "checked" if checked else "unchecked"
        self._append_log(f"{label} {changed} selected rows\n")

    def apply_bulk_options(self):
        for row in self.rows:
            row["font_size"] = self.vars["font_size"].get()
            row["line_height"] = self.vars["line_height"].get()
            row["pad"] = self.vars["pad"].get()
            row["threshold"] = self.vars["threshold"].get()
            row["bold"] = self.vars["bold"].get()
            row["invert"] = "1" if self.vars["invert"].get() else "0"
            row["source_ink_indexes"] = self.vars["source_ink_indexes"].get()
            row["ink_index"] = self.vars["ink_index"].get()
            row["bg_index"] = self.vars["bg_index"].get()
        self.refresh_tree()

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
    app = BeHdrUiWorkflowGui()
    app.mainloop()
