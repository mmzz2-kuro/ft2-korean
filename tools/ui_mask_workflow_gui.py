#!/usr/bin/env python
# -*- coding: utf-8 -*-

import json
import os
import queue
import subprocess
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk


ROOT = Path(__file__).resolve().parents[1]
SETTINGS_PATH = ROOT / "trDatas/ui-mask-workflow/ui-mask-gui-settings.json"

PRESETS = {
    "day_1151_1168": {
        "label": "Day/status 1151-1168 (256x64)",
        "ids": "1151-1168",
        "bytes_per_row": "32",
        "rows": "64",
        "font_size": "24",
        "line_height": "24",
        "pad": "1",
        "threshold": "64",
        "bold": "0",
    },
    "item_830_1008": {
        "label": "Item 830-1008 (288x64)",
        "ids": "830-1008",
        "bytes_per_row": "36",
        "rows": "64",
        "font_size": "18",
        "line_height": "18",
        "pad": "1",
        "threshold": "64",
        "bold": "0",
    },
    "menu_1009_1080": {
        "label": "Menu/help 1009-1080 (288x64)",
        "ids": "1009-1080",
        "bytes_per_row": "36",
        "rows": "64",
        "font_size": "18",
        "line_height": "18",
        "pad": "1",
        "threshold": "64",
        "bold": "0",
    },
    "unit_help_1081_1147": {
        "label": "Unit/help 1081-1147 (288x64)",
        "ids": "1081-1147",
        "bytes_per_row": "36",
        "rows": "64",
        "font_size": "18",
        "line_height": "18",
        "pad": "1",
        "threshold": "64",
        "bold": "0",
    },
}


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


def read_pbm(path):
    tokens = []
    with open(path, "r", encoding="ascii") as f:
        for line in f:
            line = line.split("#", 1)[0].strip()
            if line:
                tokens.extend(line.split())

    if not tokens or tokens.pop(0) != "P1":
        raise ValueError(f"not a P1 PBM: {path}")
    width = int(tokens.pop(0))
    height = int(tokens.pop(0))
    pixels = [int(value) for value in tokens[: width * height]]
    return width, height, pixels


class UiMaskWorkflowGui(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("SLPS-01903 UI Mask Workflow")
        self.geometry("1180x820")
        self.minsize(2060, 1280)

        self.log_queue = queue.Queue()
        self.rows = []
        self.tsv_headers = []
        self.selected_index = None
        self.current_process = None
        self.required_tsv_headers = [
            "enabled",
            "resource_id",
            "mask_pbm",
            "source_note",
            "ko_text",
            "width",
            "height",
            "bytes_per_row",
            "rows",
            "data_offset",
            "font_size",
            "line_height",
            "pad",
            "threshold",
            "bold",
        ]

        self.vars = {
            "dat": tk.StringVar(value=str(ROOT / "ps1/SLPS-01903/FS2_FILE.DAT")),
            "exe": tk.StringVar(value=str(ROOT / "ps1/SLPS-01903/SLPS_019.03")),
            "font": tk.StringVar(value=str(ROOT / "font/gulim.ttc")),
            "source_bin": tk.StringVar(value=str(ROOT / "ps1/SLPS-01903/bincue/Farland Saga - Toki no Michishirube.bin")),
            "translation": tk.StringVar(value=str(ROOT / "trDatas/ui-mask-workflow/ui-mask-translation.tsv")),
            "mask_dir": tk.StringVar(value=str(ROOT / "tmp/SLPS-01903/ui-mask-workflow/masks")),
            "out_dat": tk.StringVar(value=str(ROOT / "tmp/SLPS-01903/ui-mask-workflow/patched-FS2_FILE.DAT")),
            "out_bin": tk.StringVar(value=str(ROOT / "tmp/SLPS-01903/ui-mask-workflow/patched-ui-farland-saga.bin")),
            "work_dir": tk.StringVar(value=str(ROOT / "tmp/SLPS-01903/ui-mask-workflow/apply")),
            "fs2_lba": tk.StringVar(value="223"),
            "fs2_sectors": tk.StringVar(value="119472"),
            "preset": tk.StringVar(value="day_1151_1168"),
            "ids": tk.StringVar(value=PRESETS["day_1151_1168"]["ids"]),
            "bytes_per_row": tk.StringVar(value=PRESETS["day_1151_1168"]["bytes_per_row"]),
            "rows_count": tk.StringVar(value=PRESETS["day_1151_1168"]["rows"]),
            "data_offset": tk.StringVar(value="0"),
            "mode": tk.StringVar(value="AntiAlias"),
            "trim": tk.BooleanVar(value=True),
        }

        self._load_settings()
        self.protocol("WM_DELETE_WINDOW", self._on_close)
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
            ("FS2_FILE.DAT or BIN", "dat", "file"),
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
            ttk.Button(top, text="...", width=3, command=lambda k=key, t=kind: self._browse(k, t)).grid(
                row=r, column=c + 2, sticky="ew", pady=2
            )

        opts = ttk.Frame(top)
        opts.grid(row=5, column=0, columnspan=6, sticky="ew", pady=(8, 0))
        ttk.Label(opts, text="Preset").pack(side="left")
        preset_combo = ttk.Combobox(
            opts,
            textvariable=self.vars["preset"],
            values=list(PRESETS.keys()),
            width=18,
            state="readonly",
        )
        preset_combo.pack(side="left", padx=(4, 4))
        preset_combo.bind("<<ComboboxSelected>>", lambda _event: self.apply_preset())
        ttk.Button(opts, text="Use Preset", command=self.apply_preset).pack(side="left", padx=(0, 12))

        for label, key, width in [
            ("IDs", "ids", 14),
            ("bytes/row", "bytes_per_row", 5),
            ("rows", "rows_count", 5),
            ("offset", "data_offset", 6),
            ("FS2 LBA", "fs2_lba", 7),
            ("sectors", "fs2_sectors", 8),
        ]:
            ttk.Label(opts, text=label).pack(side="left")
            ttk.Entry(opts, textvariable=self.vars[key], width=width).pack(side="left", padx=(4, 10))

        ttk.Label(opts, text="Render").pack(side="left")
        ttk.Combobox(opts, textvariable=self.vars["mode"], values=["AntiAlias", "Single"], width=10, state="readonly").pack(
            side="left", padx=(4, 10)
        )
        ttk.Checkbutton(opts, text="TrimToOrigin", variable=self.vars["trim"]).pack(side="left")

        buttons = ttk.Frame(top)
        buttons.grid(row=6, column=0, columnspan=6, sticky="ew", pady=(8, 0))
        ttk.Button(buttons, text="0. Extract DAT from BIN", command=self.extract_dat_from_bin).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="1. Export TSV/Masks", command=self.export_translation_table).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="Load TSV", command=self.load_tsv).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="Save TSV", command=self.save_tsv).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="Check Filled", command=lambda: self.set_checked_bulk("filled")).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="Check All", command=lambda: self.set_checked_bulk("all")).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="Uncheck All", command=lambda: self.set_checked_bulk("none")).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="2. Apply to BIN", command=self.apply_translation).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="Open Mask", command=self.open_selected_mask).pack(side="left", padx=(0, 6))

        main = ttk.PanedWindow(self, orient=tk.HORIZONTAL)
        main.grid(row=1, column=0, sticky="nsew", padx=8, pady=(0, 8))

        left = ttk.Frame(main)
        left.rowconfigure(0, weight=1)
        left.columnconfigure(0, weight=1)
        main.add(left, weight=3)

        columns = (
            "enabled",
            "resource_id",
            "ko_text",
            "font_size",
            "line_height",
            "pad",
            "threshold",
            "bold",
            "width",
        )
        self.tree = ttk.Treeview(left, columns=columns, show="headings", selectmode="browse")
        for col in columns:
            self.tree.heading(col, text=col)
            width = 82
            if col == "enabled":
                width = 58
            elif col == "ko_text":
                width = 280
            self.tree.column(col, width=width, anchor="center" if col == "enabled" else "w")
        self.tree.grid(row=0, column=0, sticky="nsew")
        self.tree.bind("<<TreeviewSelect>>", self._on_select_row)
        self.tree.bind("<Button-1>", self._on_tree_click)

        tree_scroll = ttk.Scrollbar(left, orient="vertical", command=self.tree.yview)
        tree_scroll.grid(row=0, column=1, sticky="ns")
        self.tree.configure(yscrollcommand=tree_scroll.set)

        right = ttk.Frame(main, padding=(8, 0, 0, 0))
        right.rowconfigure(5, weight=1)
        right.columnconfigure(1, weight=1)
        main.add(right, weight=2)

        ttk.Label(right, text="Resource ID").grid(row=0, column=0, sticky="w")
        self.resource_id_var = tk.StringVar()
        ttk.Entry(right, textvariable=self.resource_id_var, state="readonly").grid(row=0, column=1, sticky="ew", pady=2)

        ttk.Label(right, text="Source Note").grid(row=1, column=0, sticky="nw")
        self.source_note = tk.Text(right, height=4, wrap="word")
        self.source_note.grid(row=1, column=1, sticky="ew", pady=2)

        ttk.Label(right, text="Korean Text").grid(row=2, column=0, sticky="nw")
        self.ko_text = tk.Text(right, height=5, wrap="word")
        self.ko_text.grid(row=2, column=1, sticky="ew", pady=2)

        render_opts = ttk.Frame(right)
        render_opts.grid(row=3, column=1, sticky="ew", pady=2)
        self.font_size_var = tk.StringVar(value="24")
        self.line_height_var = tk.StringVar(value="24")
        self.pad_var = tk.StringVar(value="1")
        self.threshold_var = tk.StringVar(value="64")
        self.bold_var = tk.StringVar(value="0")
        for label, var in [
            ("font", self.font_size_var),
            ("line", self.line_height_var),
            ("pad", self.pad_var),
            ("threshold", self.threshold_var),
            ("bold", self.bold_var),
        ]:
            ttk.Label(render_opts, text=label).pack(side="left")
            ttk.Entry(render_opts, textvariable=var, width=6).pack(side="left", padx=(4, 10))

        render_buttons = ttk.Frame(right)
        render_buttons.grid(row=4, column=1, sticky="ew", pady=(4, 8))
        render_buttons.columnconfigure(0, weight=1)
        render_buttons.columnconfigure(1, weight=1)
        render_buttons.columnconfigure(2, weight=1)
        ttk.Button(render_buttons, text="Update Selected", command=self.update_selected_row).grid(
            row=0, column=0, sticky="ew", padx=(0, 4)
        )
        ttk.Button(render_buttons, text="Options to Filled", command=lambda: self.apply_render_options_bulk(True)).grid(
            row=0, column=1, sticky="ew", padx=4
        )
        ttk.Button(render_buttons, text="Options to All", command=lambda: self.apply_render_options_bulk(False)).grid(
            row=0, column=2, sticky="ew", padx=(4, 0)
        )

        preview_box = ttk.LabelFrame(right, text="Source Mask Preview")
        preview_box.grid(row=5, column=0, columnspan=2, sticky="nsew")
        preview_box.rowconfigure(0, weight=1)
        preview_box.columnconfigure(0, weight=1)
        self.preview_canvas = tk.Canvas(preview_box, width=560, height=240, bg="#f6f5f1", highlightthickness=0)
        self.preview_canvas.grid(row=0, column=0, sticky="nsew")

        log_frame = ttk.LabelFrame(self, text="Log", padding=4)
        log_frame.grid(row=2, column=0, sticky="ew", padx=8, pady=(0, 8))
        log_frame.columnconfigure(0, weight=1)
        self.log = tk.Text(log_frame, height=8, wrap="word")
        self.log.grid(row=0, column=0, sticky="ew")
        log_scroll = ttk.Scrollbar(log_frame, orient="vertical", command=self.log.yview)
        log_scroll.grid(row=0, column=1, sticky="ns")
        self.log.configure(yscrollcommand=log_scroll.set)

    def apply_preset(self):
        preset = PRESETS.get(self.vars["preset"].get())
        if not preset:
            return
        self.vars["ids"].set(preset["ids"])
        self.vars["bytes_per_row"].set(preset["bytes_per_row"])
        self.vars["rows_count"].set(preset["rows"])
        self.font_size_var.set(preset["font_size"])
        self.line_height_var.set(preset["line_height"])
        self.pad_var.set(preset["pad"])
        self.threshold_var.set(preset["threshold"])
        self.bold_var.set(preset["bold"])
        base = self.vars["preset"].get()
        self.vars["translation"].set(str(ROOT / f"trDatas/ui-mask-workflow/{base}.tsv"))
        self.vars["mask_dir"].set(str(ROOT / f"tmp/SLPS-01903/ui-mask-workflow/{base}-masks"))
        self._save_settings()

    def _load_settings(self):
        if not SETTINGS_PATH.exists():
            return
        try:
            data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        except Exception:
            return
        for key, value in data.get("vars", {}).items():
            if key not in self.vars:
                continue
            if isinstance(self.vars[key], tk.BooleanVar):
                self.vars[key].set(bool(value))
            else:
                self.vars[key].set(str(value))
        preset_aliases = {
            "system_ui_901_1007": "item_help_901_1007",
            "system_ui_1081_1147": "unit_help_1081_1147",
        }
        current_preset = self.vars["preset"].get()
        if current_preset in preset_aliases:
            self.vars["preset"].set(preset_aliases[current_preset])

    def _save_settings(self):
        SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "vars": {
                key: bool(var.get()) if isinstance(var, tk.BooleanVar) else var.get()
                for key, var in self.vars.items()
            }
        }
        SETTINGS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def _on_close(self):
        self._save_settings()
        self.destroy()

    def _browse(self, key, kind):
        current = self.vars[key].get()
        initial_dir = str(Path(current).parent if current else ROOT)
        if kind == "dir":
            chosen = filedialog.askdirectory(initialdir=initial_dir)
        elif kind == "save":
            chosen = filedialog.asksaveasfilename(initialdir=initial_dir, initialfile=Path(current).name)
        else:
            chosen = filedialog.askopenfilename(initialdir=initial_dir)
        if chosen:
            self.vars[key].set(chosen)
            self._save_settings()

    def _run_command(self, title, cmd, on_success=None):
        if self.current_process is not None:
            messagebox.showwarning("Busy", "A command is already running.")
            return

        self._save_settings()
        self._append_log(f"\n## {title}\n{self._format_cmd(cmd)}\n")

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
                for line in self.current_process.stdout:
                    self.log_queue.put(line)
                code = self.current_process.wait()
                self.log_queue.put(f"[exit {code}]\n")
                self.current_process = None
                if code == 0 and on_success:
                    self.log_queue.put(("CALLBACK", on_success))
            except Exception as exc:
                self.log_queue.put(f"[error] {exc}\n")
            finally:
                self.current_process = None

        threading.Thread(target=worker, daemon=True).start()

    def _format_cmd(self, cmd):
        return " ".join(f'"{part}"' if " " in str(part) else str(part) for part in cmd)

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

    def _dat_field_is_bin(self):
        return Path(self.vars["dat"].get()).suffix.lower() == ".bin"

    def _effective_source_bin_path(self):
        if self._dat_field_is_bin():
            return self.vars["dat"].get()
        return self.vars["source_bin"].get()

    def _effective_dat_path(self):
        if self._dat_field_is_bin():
            return str(ROOT / "tmp/SLPS-01903/ui-mask-workflow/extracted-FS2_FILE.DAT")
        return self.vars["dat"].get()

    def _extract_dat_command(self, source_bin, out_dat):
        return [
            "node",
            str(ROOT / "scripts/extract-dat-from-raw-bin.js"),
            source_bin,
            out_dat,
            "--lba",
            self.vars["fs2_lba"].get(),
            "--sectors",
            self.vars["fs2_sectors"].get(),
        ]

    def _run_after_dat_ready(self, next_step):
        if not self._dat_field_is_bin():
            next_step()
            return
        source_bin = self._effective_source_bin_path()
        out_dat = self._effective_dat_path()
        self.vars["source_bin"].set(source_bin)
        self._run_command("Extract FS2_FILE.DAT from BIN", self._extract_dat_command(source_bin, out_dat), on_success=next_step)

    def extract_dat_from_bin(self):
        self._run_command(
            "Extract FS2_FILE.DAT from BIN",
            self._extract_dat_command(self._effective_source_bin_path(), self._effective_dat_path()),
        )

    def export_translation_table(self):
        def run_export():
            cmd = [
                "node",
                str(ROOT / "scripts/export-ui-1bpp-translation-table.js"),
                self._effective_dat_path(),
                self.vars["exe"].get(),
                self.vars["translation"].get(),
                self.vars["mask_dir"].get(),
                "--ids",
                self.vars["ids"].get(),
                "--bytes-per-row",
                self.vars["bytes_per_row"].get(),
                "--rows",
                self.vars["rows_count"].get(),
                "--data-offset",
                self.vars["data_offset"].get(),
                "--font-size",
                self.font_size_var.get(),
                "--line-height",
                self.line_height_var.get(),
                "--pad",
                self.pad_var.get(),
                "--threshold",
                self.threshold_var.get(),
                "--bold",
                self.bold_var.get(),
            ]
            self._run_command("Export UI mask TSV and PBM files", cmd, on_success=self.load_tsv)

        self._run_after_dat_ready(run_export)

    def apply_translation(self):
        self.save_tsv(silent=True)

        def run_apply():
            out_dat = self.vars["out_dat"].get()
            out_bin = self.vars["out_bin"].get()
            if Path(out_dat).suffix.lower() == ".bin":
                out_bin = out_dat
                out_dat = str(ROOT / "tmp/SLPS-01903/ui-mask-workflow/patched-FS2_FILE.DAT")
                self._append_log(
                    "[info] Patched DAT tmp points to .bin; using it as final Output BIN and "
                    f"using temporary DAT path: {rel(out_dat)}\n"
                )
            cmd = [
                "powershell",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(ROOT / "scripts/apply-ui-1bpp-translation.ps1"),
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
            self._run_command("Apply UI mask TSV", cmd)

        self._run_after_dat_ready(run_apply)

    def load_tsv(self):
        path = Path(self.vars["translation"].get())
        if not path.exists():
            self._append_log(f"[warn] TSV does not exist: {path}\n")
            return
        lines = path.read_text(encoding="utf-8").splitlines()
        if not lines:
            self._append_log(f"[warn] empty TSV: {path}\n")
            return
        self.tsv_headers = lines[0].split("\t")
        for header in self.required_tsv_headers:
            if header not in self.tsv_headers:
                self.tsv_headers.append(header)
        self.rows = []
        for line in lines[1:]:
            if not line.strip():
                continue
            values = line.split("\t")
            row = {}
            for idx, header in enumerate(self.tsv_headers):
                row[header] = unescape_tsv(values[idx] if idx < len(values) else "")
            row.setdefault("enabled", "1")
            row.setdefault("data_offset", "0")
            row.setdefault("threshold", "64")
            row.setdefault("bold", "0")
            self.rows.append(row)
        self._refresh_tree()
        self._append_log(f"loaded {len(self.rows)} TSV rows: {rel(path)}\n")

    def save_tsv(self, silent=False):
        if self.selected_index is not None:
            self.update_selected_row(silent=True)
        path = Path(self.vars["translation"].get())
        path.parent.mkdir(parents=True, exist_ok=True)
        headers = self.tsv_headers or list(self.required_tsv_headers)
        for header in self.required_tsv_headers:
            if header not in headers:
                headers.append(header)
        lines = ["\t".join(headers)]
        for row in self.rows:
            lines.append("\t".join(escape_tsv(row.get(key, "")) for key in headers))
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        if not silent:
            self._append_log(f"saved TSV: {rel(path)}\n")

    def _refresh_tree(self):
        self.tree.delete(*self.tree.get_children())
        for idx, row in enumerate(self.rows):
            enabled = "Y" if row.get("enabled", "1") not in ("0", "false", "False", "") else "N"
            self.tree.insert(
                "",
                "end",
                iid=str(idx),
                values=(
                    enabled,
                    row.get("resource_id", ""),
                    row.get("ko_text", "").replace("\n", "\\n"),
                    row.get("font_size", ""),
                    row.get("line_height", ""),
                    row.get("pad", ""),
                    row.get("threshold", "64"),
                    row.get("bold", "0"),
                    row.get("width", ""),
                ),
            )

    def _on_tree_click(self, event):
        if self.tree.identify_region(event.x, event.y) != "cell":
            return
        if self.tree.identify_column(event.x) != "#1":
            return
        item = self.tree.identify_row(event.y)
        if not item:
            return
        index = int(item)
        row = self.rows[index]
        row["enabled"] = "0" if row.get("enabled", "1") not in ("0", "false", "False", "") else "1"
        self._refresh_tree()
        self.tree.selection_set(item)
        return "break"

    def set_checked_bulk(self, mode):
        if self.selected_index is not None:
            self.update_selected_row(silent=True)
        changed = 0
        for row in self.rows:
            if mode == "filled":
                checked = "1" if row.get("ko_text", "").strip() else "0"
            elif mode == "all":
                checked = "1"
            else:
                checked = "0"
            if row.get("enabled", "1") != checked:
                changed += 1
            row["enabled"] = checked
        self._refresh_tree()
        if self.selected_index is not None and self.selected_index < len(self.rows):
            self.tree.selection_set(str(self.selected_index))
        self._append_log(f"updated check state for {changed} rows\n")

    def _on_select_row(self, _event=None):
        selection = self.tree.selection()
        if not selection:
            return
        self.selected_index = int(selection[0])
        row = self.rows[self.selected_index]
        self.resource_id_var.set(row.get("resource_id", ""))
        self.source_note.delete("1.0", "end")
        self.source_note.insert("1.0", row.get("source_note", ""))
        self.ko_text.delete("1.0", "end")
        self.ko_text.insert("1.0", row.get("ko_text", ""))
        self.font_size_var.set(row.get("font_size", "24") or "24")
        self.line_height_var.set(row.get("line_height", "24") or "24")
        self.pad_var.set(row.get("pad", "1") or "1")
        self.threshold_var.set(row.get("threshold", "64") or "64")
        self.bold_var.set(row.get("bold", "0") or "0")
        self._draw_mask_preview(row.get("mask_pbm", ""))

    def update_selected_row(self, silent=False):
        if self.selected_index is None:
            return
        row = self.rows[self.selected_index]
        row["source_note"] = self.source_note.get("1.0", "end-1c")
        row["ko_text"] = self.ko_text.get("1.0", "end-1c")
        self._apply_render_options_to_row(row)
        self._refresh_tree()
        self.tree.selection_set(str(self.selected_index))
        if not silent:
            self._append_log(f"updated row {row.get('resource_id', '')}\n")

    def _apply_render_options_to_row(self, row):
        row["font_size"] = self.font_size_var.get()
        row["line_height"] = self.line_height_var.get()
        row["pad"] = self.pad_var.get()
        row["threshold"] = self.threshold_var.get()
        row["bold"] = self.bold_var.get()

    def apply_render_options_bulk(self, only_filled):
        if self.selected_index is not None:
            self.update_selected_row(silent=True)
        changed = 0
        for row in self.rows:
            if only_filled and not row.get("ko_text", "").strip():
                continue
            self._apply_render_options_to_row(row)
            changed += 1
        self._refresh_tree()
        if self.selected_index is not None and self.selected_index < len(self.rows):
            self.tree.selection_set(str(self.selected_index))
        target = "filled rows" if only_filled else "all rows"
        self._append_log(f"applied render options to {changed} {target}\n")

    def _draw_mask_preview(self, mask_path):
        self.preview_canvas.delete("all")
        if not mask_path:
            return
        path = Path(mask_path)
        if not path.is_absolute():
            path = ROOT / path
        if not path.exists():
            self.preview_canvas.create_text(12, 12, anchor="nw", text=f"missing: {mask_path}", fill="#a33")
            return
        try:
            width, height, pixels = read_pbm(path)
        except Exception as exc:
            self.preview_canvas.create_text(12, 12, anchor="nw", text=str(exc), fill="#a33")
            return

        scale = max(1, min(3, 540 // max(1, width), 220 // max(1, height)))
        for y in range(height):
            for x in range(width):
                value = pixels[y * width + x]
                color = "#111111" if value else "#ffffff"
                self.preview_canvas.create_rectangle(
                    x * scale,
                    y * scale,
                    (x + 1) * scale,
                    (y + 1) * scale,
                    outline=color,
                    fill=color,
                )

    def open_selected_mask(self):
        if self.selected_index is None:
            return
        mask_path = self.rows[self.selected_index].get("mask_pbm", "")
        if not mask_path:
            return
        path = Path(mask_path)
        if not path.is_absolute():
            path = ROOT / path
        if path.exists():
            os.startfile(path)


if __name__ == "__main__":
    app = UiMaskWorkflowGui()
    app.mainloop()
