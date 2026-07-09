#!/usr/bin/env python
# -*- coding: utf-8 -*-

import csv
import importlib.util
import queue
import shutil
import subprocess
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, ttk

from PIL import Image, ImageTk

ROOT = Path(__file__).resolve().parents[1]

_spec = importlib.util.spec_from_file_location("name_table_tool", ROOT / "scripts" / "name-table-tool.py")
name_table_tool = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(name_table_tool)


def rel(path):
    try:
        return str(Path(path).resolve().relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        return str(path)


def unescape_tsv(value):
    marker = ""
    return (value or "").replace("\\\\", marker).replace("\\n", "\n").replace("\\t", "\t").replace(marker, "\\")


def escape_tsv(value):
    return (value or "").replace("\\", "\\\\").replace("\t", "\\t").replace("\r", "").replace("\n", "\\n")


class NameTableWorkflowGui(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("SLPS-01903 Name Table Workflow")
        self.geometry("1180x720")
        self.minsize(980, 600)

        self.rows = []
        self.headers = []
        self.selected_index = None
        self.log_queue = queue.Queue()
        self.preview_photo = None
        self.source_photo = None

        self.vars = {
            "dat": tk.StringVar(value=str(ROOT / "output/patched-farland-saga.bin")),
            "exe": tk.StringVar(value=str(ROOT / "ps1/SLPS-01903/SLPS_019.03")),
            "source_bin": tk.StringVar(value=str(ROOT / "ps1/SLPS-01903/bincue/Farland Saga - Toki no Michishirube.bin")),
            "translation": tk.StringVar(value=str(ROOT / "tmp/SLPS-01903/name-table-workflow/name-table.tsv")),
            "mask_dir": tk.StringVar(value=str(ROOT / "tmp/SLPS-01903/name-table-workflow/masks")),
            "font": tk.StringVar(value=str(ROOT / "font/gulim.ttc")),
            "font_size": tk.StringVar(value=""),
            "out_dat": tk.StringVar(value=str(ROOT / "output/patched-farland-saga-names.bin")),
            "fs2_lba": tk.StringVar(value="223"),
            "fs2_sectors": tk.StringVar(value="119472"),
        }

        self.edit_vars = {
            "table": tk.StringVar(),
            "id": tk.StringVar(),
            "jp_text": tk.StringVar(),
            "ko_text": tk.StringVar(),
            "font_size": tk.StringVar(),
        }
        self.enabled_var = tk.BooleanVar(value=False)

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
            ("FS2_FILE.DAT / BIN", "dat", "file"),
            ("SLPS_019.03", "exe", "file"),
            ("Source BIN", "source_bin", "file"),
            ("Translation TSV", "translation", "save"),
            ("Mask Dir", "mask_dir", "dir"),
            ("Font", "font", "file"),
            ("Output DAT/BIN", "out_dat", "save"),
        ]
        for i, (label, key, kind) in enumerate(path_rows):
            r = i // 2
            c = (i % 2) * 3
            ttk.Label(top, text=label).grid(row=r, column=c, sticky="w", padx=(0, 4), pady=2)
            ttk.Entry(top, textvariable=self.vars[key]).grid(row=r, column=c + 1, sticky="ew", padx=(0, 4), pady=2)
            ttk.Button(top, text="...", width=3, command=lambda k=key, t=kind: self._browse(k, t)).grid(row=r, column=c + 2, sticky="ew", pady=2)

        opts = ttk.Frame(top)
        opts.grid(row=4, column=0, columnspan=6, sticky="ew", pady=(8, 0))
        ttk.Label(opts, text="기본 폰트 크기(비우면 자동)").pack(side="left")
        ttk.Entry(opts, textvariable=self.vars["font_size"], width=5).pack(side="left", padx=(4, 12))
        ttk.Label(opts, text="LBA").pack(side="left")
        ttk.Entry(opts, textvariable=self.vars["fs2_lba"], width=6).pack(side="left", padx=(4, 12))
        ttk.Label(opts, text="sectors").pack(side="left")
        ttk.Entry(opts, textvariable=self.vars["fs2_sectors"], width=8).pack(side="left", padx=(4, 12))

        buttons = ttk.Frame(top)
        buttons.grid(row=5, column=0, columnspan=6, sticky="ew", pady=(8, 0))
        ttk.Button(buttons, text="1. Export TSV/Images", command=self.export_tsv).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="Load TSV", command=self.load_tsv).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="Save TSV", command=self.save_tsv).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="2. Apply to BIN", command=self.apply_to_bin).pack(side="left", padx=(0, 6))

        main = ttk.PanedWindow(self, orient=tk.HORIZONTAL)
        main.grid(row=1, column=0, sticky="nsew", padx=8, pady=(0, 8))

        left = ttk.Frame(main)
        left.rowconfigure(0, weight=1)
        left.columnconfigure(0, weight=1)
        main.add(left, weight=3)

        cols = ("enabled", "table", "id", "jp_text", "ko_text")
        self.tree = ttk.Treeview(left, columns=cols, show="headings", selectmode="browse")
        for col in cols:
            self.tree.heading(col, text=col)
            if col in ("enabled", "table", "id"):
                self.tree.column(col, width=55, minwidth=40, anchor="w", stretch=False)
            else:
                self.tree.column(col, width=200, minwidth=100, anchor="w", stretch=True)
        self.tree.grid(row=0, column=0, sticky="nsew")
        ttk.Scrollbar(left, orient="vertical", command=self.tree.yview).grid(row=0, column=1, sticky="ns")
        self.tree.configure(yscrollcommand=lambda *args: None)
        self.tree.bind("<<TreeviewSelect>>", self.on_select)

        right = ttk.Frame(main, padding=(8, 0, 0, 0))
        right.columnconfigure(1, weight=1)
        main.add(right, weight=2)

        r = 0
        ttk.Label(right, text="Table").grid(row=r, column=0, sticky="w", pady=2)
        ttk.Entry(right, textvariable=self.edit_vars["table"], state="readonly").grid(row=r, column=1, sticky="ew", pady=2)
        r += 1
        ttk.Label(right, text="ID").grid(row=r, column=0, sticky="w", pady=2)
        ttk.Entry(right, textvariable=self.edit_vars["id"], state="readonly").grid(row=r, column=1, sticky="ew", pady=2)
        r += 1
        ttk.Label(right, text="원문(참고)").grid(row=r, column=0, sticky="w", pady=2)
        ttk.Entry(right, textvariable=self.edit_vars["jp_text"], state="readonly").grid(row=r, column=1, sticky="ew", pady=2)
        r += 1
        ttk.Checkbutton(right, text="enabled", variable=self.enabled_var).grid(row=r, column=0, columnspan=2, sticky="w", pady=2)
        r += 1

        ttk.Label(right, text="원본 이미지").grid(row=r, column=0, columnspan=2, sticky="w", pady=(8, 0))
        r += 1
        self.source_image_label = ttk.Label(right)
        self.source_image_label.grid(row=r, column=0, columnspan=2, sticky="w", pady=2)
        r += 1

        ttk.Label(right, text="번역할 명칭(ko_text)").grid(row=r, column=0, columnspan=2, sticky="w", pady=(8, 0))
        r += 1
        ttk.Entry(right, textvariable=self.edit_vars["ko_text"]).grid(row=r, column=0, columnspan=2, sticky="ew", pady=2)
        r += 1
        ttk.Label(right, text="이 항목 폰트 크기(비우면 기본값)").grid(row=r, column=0, columnspan=2, sticky="w", pady=(4, 0))
        r += 1
        ttk.Entry(right, textvariable=self.edit_vars["font_size"], width=6).grid(row=r, column=0, sticky="w", pady=2)
        r += 1

        preview_buttons = ttk.Frame(right)
        preview_buttons.grid(row=r, column=0, columnspan=2, sticky="ew", pady=(6, 2))
        ttk.Button(preview_buttons, text="미리보기", command=self.preview_render).pack(side="left", padx=(0, 6))
        ttk.Button(preview_buttons, text="행 업데이트", command=self.update_row).pack(side="left")
        r += 1

        ttk.Label(right, text="변경 후 미리보기").grid(row=r, column=0, columnspan=2, sticky="w", pady=(6, 0))
        r += 1
        self.preview_image_label = ttk.Label(right)
        self.preview_image_label.grid(row=r, column=0, columnspan=2, sticky="w", pady=2)

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
            return str(ROOT / "tmp/SLPS-01903/name-table-workflow/extracted-FS2_FILE.DAT")
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
            try:
                name_table_tool.export_tsv(
                    self._effective_dat_path(),
                    self.vars["exe"].get(),
                    self.vars["translation"].get(),
                    self.vars["mask_dir"].get(),
                )
                self._append_log(f"exported name table to {rel(self.vars['translation'].get())}\n")
            except Exception as exc:
                self._append_log(f"[error] export failed: {exc}\n")
                return
            self.load_tsv()

        self._run_after_dat_ready(run_export)

    def load_tsv(self):
        path = Path(self.vars["translation"].get())
        if not path.exists():
            self._append_log(f"[warn] TSV does not exist: {rel(path)}\n")
            return
        with path.open(encoding="utf-8", newline="") as f:
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
            self._commit_edit_fields()
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
        self.edit_vars["table"].set(row.get("table", ""))
        self.edit_vars["id"].set(row.get("id", ""))
        self.edit_vars["jp_text"].set(row.get("jp_text", ""))
        self.edit_vars["ko_text"].set(row.get("ko_text", ""))
        self.edit_vars["font_size"].set(row.get("font_size", ""))
        self.enabled_var.set(row.get("enabled", "") == "1")
        self._show_image(row.get("source_png", ""), self.source_image_label, "source_photo")
        self._show_image(row.get("replacement_png", ""), self.preview_image_label, "preview_photo")

    def _show_image(self, path, label_widget, attr_name):
        if not path or not Path(path).exists():
            label_widget.configure(image="", text="(없음)")
            setattr(self, attr_name, None)
            return
        img = Image.open(path)
        photo = ImageTk.PhotoImage(img)
        setattr(self, attr_name, photo)
        label_widget.configure(image=photo, text="")

    def _commit_edit_fields(self):
        if self.selected_index is None:
            return
        row = self.rows[self.selected_index]
        row["ko_text"] = self.edit_vars["ko_text"].get()
        row["font_size"] = self.edit_vars["font_size"].get()
        row["enabled"] = "1" if self.enabled_var.get() else "0"

    def preview_render(self):
        text = self.edit_vars["ko_text"].get().strip()
        if not text:
            self._append_log("[warn] ko_text가 비어있습니다\n")
            return
        table_key = self.edit_vars["table"].get().strip() or "char"
        cfg = name_table_tool.TABLES[table_key]
        font_size = self.edit_vars["font_size"].get().strip() or self.vars["font_size"].get().strip() or None
        preview_path = Path(self.vars["mask_dir"].get()) / "preview-tmp.png"
        try:
            name_table_tool.render_name_png(text, self.vars["font"].get(), str(preview_path), cfg["width"], cfg["height"], font_size)
        except Exception as exc:
            self._append_log(f"[error] preview render failed: {exc}\n")
            return
        self._show_image(str(preview_path), self.preview_image_label, "preview_photo")

    def update_row(self):
        if self.selected_index is None:
            return
        self._commit_edit_fields()
        row = self.rows[self.selected_index]
        text = row.get("ko_text", "").strip()
        if text:
            table_key = row.get("table", "char")
            cfg = name_table_tool.TABLES[table_key]
            entry_id = int(row["id"])
            replacement_png = row.get("replacement_png", "").strip()
            if not replacement_png:
                source_png = Path(row.get("source_png", ""))
                replacement_png = str(source_png.with_name(f"name-{table_key}-{entry_id:02d}-ko.png")) if source_png.name else str(
                    Path(self.vars["mask_dir"].get()) / f"name-{table_key}-{entry_id:02d}-ko.png"
                )
                row["replacement_png"] = replacement_png
            font_size = row.get("font_size", "").strip() or self.vars["font_size"].get().strip() or None
            try:
                name_table_tool.render_name_png(text, self.vars["font"].get(), replacement_png, cfg["width"], cfg["height"], font_size)
            except Exception as exc:
                self._append_log(f"[error] render failed for id {entry_id}: {exc}\n")
        self.refresh_tree()
        self.tree.selection_set(str(self.selected_index))
        self._show_image(row.get("replacement_png", ""), self.preview_image_label, "preview_photo")
        self._append_log(f"id {row.get('id')} 업데이트됨\n")

    def apply_to_bin(self):
        self.save_tsv()
        rows_to_process = [row for row in self.rows if row.get("enabled") == "1"]
        if not rows_to_process:
            self._append_log("[warn] no enabled rows to apply\n")
            return

        def run_apply():
            for row in rows_to_process:
                text = row.get("ko_text", "").strip()
                replacement_png = row.get("replacement_png", "").strip()
                if not text or not replacement_png:
                    continue
                cfg = name_table_tool.TABLES[row.get("table", "char")]
                font_size = row.get("font_size", "").strip() or self.vars["font_size"].get().strip() or None
                try:
                    name_table_tool.render_name_png(text, self.vars["font"].get(), replacement_png, cfg["width"], cfg["height"], font_size)
                except Exception as exc:
                    self._append_log(f"[error] render failed for id {row.get('id')}: {exc}\n")

            out_dat_field = self.vars["out_dat"].get()
            out_is_bin = Path(out_dat_field).suffix.lower() == ".bin"
            work_dir = ROOT / "tmp/SLPS-01903/name-table-workflow"
            work_dir.mkdir(parents=True, exist_ok=True)
            working_dat = work_dir / "working-names.DAT"

            try:
                name_table_tool.patch(
                    self._effective_dat_path(),
                    self.vars["exe"].get(),
                    self.vars["translation"].get(),
                    str(working_dat),
                )
            except Exception as exc:
                self._append_log(f"[error] patch failed: {exc}\n")
                return

            Path(out_dat_field).parent.mkdir(parents=True, exist_ok=True)
            if out_is_bin:
                inject_cmd = [
                    "node",
                    str(ROOT / "scripts/inject-dat-into-raw-bin.js"),
                    self._effective_source_bin_path(),
                    str(working_dat),
                    out_dat_field,
                    "--lba",
                    self.vars["fs2_lba"].get(),
                ]
                self.run_command("Inject patched DAT into BIN", inject_cmd)
            else:
                shutil.copyfile(working_dat, out_dat_field)
                self._append_log(f"[info] wrote {rel(out_dat_field)}\n")

        self._run_after_dat_ready(run_apply)

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
    app = NameTableWorkflowGui()
    app.mainloop()
