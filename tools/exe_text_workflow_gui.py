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
SETTINGS_PATH = ROOT / "tmp/SLPS-01903/exe-text-workflow/exe-text-gui-settings.json"


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


class ExeTextWorkflowGui(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("SLPS-01903 EXE/System Text Workflow")
        self.geometry("1180x760")
        self.minsize(1080, 680)

        self.log_queue = queue.Queue()
        self.rows = []
        self.tsv_headers = []
        self.selected_index = None
        self.current_process = None
        self.required_tsv_headers = ["enabled", "file_offset", "max_bytes", "source_text", "ko_text", "note"]

        self.vars = {
            "input": tk.StringVar(value=str(ROOT / "ps1/SLPS-01903/bincue/Farland Saga - Toki no Michishirube.bin")),
            "translation": tk.StringVar(value=str(ROOT / "tmp/SLPS-01903/exe-text-workflow/exe-system-text.tsv")),
            "output": tk.StringVar(value=str(ROOT / "output/patched-exe-system-text.bin")),
            "min_bytes": tk.StringVar(value="6"),
            "terms": tk.StringVar(value="セーブ,ロード,システム,設定,オプション,コンフィグ,終了,ステータス,アイテム,装備,魔法"),
            "loose": tk.BooleanVar(value=False),
            "include_ascii": tk.BooleanVar(value=False),
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

        for row, (label, key, kind) in enumerate(
            [
                ("Input EXE or BIN", "input", "file"),
                ("Translation TSV", "translation", "save"),
                ("Output EXE or BIN", "output", "save"),
            ]
        ):
            ttk.Label(top, text=label).grid(row=row, column=0, sticky="w", padx=(0, 4), pady=2)
            ttk.Entry(top, textvariable=self.vars[key]).grid(row=row, column=1, sticky="ew", padx=(0, 4), pady=2)
            ttk.Button(top, text="...", width=3, command=lambda k=key, t=kind: self._browse(k, t)).grid(
                row=row, column=2, sticky="ew", pady=2
            )

        opts = ttk.Frame(top)
        opts.grid(row=3, column=0, columnspan=3, sticky="ew", pady=(8, 0))
        ttk.Label(opts, text="Min bytes").pack(side="left")
        ttk.Entry(opts, textvariable=self.vars["min_bytes"], width=5).pack(side="left", padx=(4, 12))
        ttk.Label(opts, text="Terms").pack(side="left")
        ttk.Entry(opts, textvariable=self.vars["terms"], width=56).pack(side="left", padx=(4, 12))
        ttk.Checkbutton(opts, text="Include ASCII-only", variable=self.vars["include_ascii"]).pack(side="left")
        ttk.Checkbutton(opts, text="Loose", variable=self.vars["loose"]).pack(side="left", padx=(8, 0))
        ttk.Label(
            opts,
            text="Replacements must fit original byte slots and be CP932/Shift-JIS encodable.",
        ).pack(side="left", padx=(18, 0))

        buttons = ttk.Frame(top)
        buttons.grid(row=4, column=0, columnspan=3, sticky="ew", pady=(8, 0))
        ttk.Button(buttons, text="1. Export TSV", command=self.export_tsv).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="Load TSV", command=self.load_tsv).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="Save TSV", command=self.save_tsv).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="Check Filled", command=lambda: self.set_checked_bulk("filled")).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="Check All", command=lambda: self.set_checked_bulk("all")).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="Uncheck All", command=lambda: self.set_checked_bulk("none")).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="2. Apply", command=self.apply_patch).pack(side="left", padx=(0, 6))

        main = ttk.PanedWindow(self, orient=tk.HORIZONTAL)
        main.grid(row=1, column=0, sticky="nsew", padx=8, pady=(0, 8))

        left = ttk.Frame(main)
        left.rowconfigure(0, weight=1)
        left.columnconfigure(0, weight=1)
        main.add(left, weight=3)

        columns = ("enabled", "file_offset", "max_bytes", "source_text", "ko_text")
        self.tree = ttk.Treeview(left, columns=columns, show="headings", selectmode="browse")
        for col in columns:
            self.tree.heading(col, text=col)
            width = 90
            if col == "enabled":
                width = 58
            elif col in ("source_text", "ko_text"):
                width = 300
            self.tree.column(col, width=width, anchor="center" if col == "enabled" else "w")
        self.tree.grid(row=0, column=0, sticky="nsew")
        self.tree.bind("<<TreeviewSelect>>", self._on_select_row)
        self.tree.bind("<Button-1>", self._on_tree_click)
        tree_scroll = ttk.Scrollbar(left, orient="vertical", command=self.tree.yview)
        tree_scroll.grid(row=0, column=1, sticky="ns")
        self.tree.configure(yscrollcommand=tree_scroll.set)

        right = ttk.Frame(main, padding=(8, 0, 0, 0))
        right.columnconfigure(1, weight=1)
        right.rowconfigure(3, weight=1)
        main.add(right, weight=2)

        ttk.Label(right, text="Offset").grid(row=0, column=0, sticky="w")
        self.offset_var = tk.StringVar()
        ttk.Entry(right, textvariable=self.offset_var, state="readonly").grid(row=0, column=1, sticky="ew", pady=2)

        ttk.Label(right, text="Source").grid(row=1, column=0, sticky="nw")
        self.source_text = tk.Text(right, height=4, wrap="word")
        self.source_text.grid(row=1, column=1, sticky="ew", pady=2)

        ttk.Label(right, text="Replacement").grid(row=2, column=0, sticky="nw")
        self.ko_text = tk.Text(right, height=4, wrap="word")
        self.ko_text.grid(row=2, column=1, sticky="ew", pady=2)

        ttk.Label(right, text="Note").grid(row=3, column=0, sticky="nw")
        self.note_text = tk.Text(right, height=4, wrap="word")
        self.note_text.grid(row=3, column=1, sticky="nsew", pady=2)

        ttk.Button(right, text="Update Selected", command=self.update_selected_row).grid(
            row=4, column=1, sticky="ew", pady=(6, 0)
        )

        log_frame = ttk.LabelFrame(self, text="Log", padding=4)
        log_frame.grid(row=2, column=0, sticky="ew", padx=8, pady=(0, 8))
        log_frame.columnconfigure(0, weight=1)
        self.log = tk.Text(log_frame, height=8, wrap="word")
        self.log.grid(row=0, column=0, sticky="ew")
        log_scroll = ttk.Scrollbar(log_frame, orient="vertical", command=self.log.yview)
        log_scroll.grid(row=0, column=1, sticky="ns")
        self.log.configure(yscrollcommand=log_scroll.set)

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
        if kind == "save":
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

    def export_tsv(self):
        cmd = [
            "python",
            str(ROOT / "scripts/exe_sjis_string_tool.py"),
            "export",
            self.vars["input"].get(),
            self.vars["translation"].get(),
            "--min-bytes",
            self.vars["min_bytes"].get(),
            "--terms",
            self.vars["terms"].get(),
        ]
        if self.vars["include_ascii"].get():
            cmd.append("--all")
        if self.vars["loose"].get():
            cmd.append("--loose")
        self._run_command("Export EXE strings", cmd, on_success=self.load_tsv)

    def apply_patch(self):
        self.save_tsv(silent=True)
        cmd = [
            "python",
            str(ROOT / "scripts/exe_sjis_string_tool.py"),
            "patch",
            self.vars["input"].get(),
            self.vars["translation"].get(),
            self.vars["output"].get(),
        ]
        self._run_command("Apply EXE strings", cmd)

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
            row.setdefault("enabled", "0")
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
            enabled = "Y" if row.get("enabled", "0") not in ("0", "false", "False", "") else "N"
            self.tree.insert(
                "",
                "end",
                iid=str(idx),
                values=(
                    enabled,
                    row.get("file_offset", ""),
                    row.get("max_bytes", ""),
                    row.get("source_text", ""),
                    row.get("ko_text", ""),
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
        row = self.rows[int(item)]
        row["enabled"] = "0" if row.get("enabled", "0") not in ("0", "false", "False", "") else "1"
        self._refresh_tree()
        self.tree.selection_set(item)
        return "break"

    def set_checked_bulk(self, mode):
        if self.selected_index is not None:
            self.update_selected_row(silent=True)
        for row in self.rows:
            if mode == "filled":
                row["enabled"] = "1" if row.get("ko_text", "").strip() else "0"
            elif mode == "all":
                row["enabled"] = "1"
            else:
                row["enabled"] = "0"
        self._refresh_tree()

    def _on_select_row(self, _event=None):
        selection = self.tree.selection()
        if not selection:
            return
        self.selected_index = int(selection[0])
        row = self.rows[self.selected_index]
        self.offset_var.set(f"{row.get('file_offset', '')} / {row.get('max_bytes', '')} bytes")
        self.source_text.delete("1.0", "end")
        self.source_text.insert("1.0", row.get("source_text", ""))
        self.ko_text.delete("1.0", "end")
        self.ko_text.insert("1.0", row.get("ko_text", ""))
        self.note_text.delete("1.0", "end")
        self.note_text.insert("1.0", row.get("note", ""))

    def update_selected_row(self, silent=False):
        if self.selected_index is None:
            return
        row = self.rows[self.selected_index]
        row["source_text"] = self.source_text.get("1.0", "end-1c")
        row["ko_text"] = self.ko_text.get("1.0", "end-1c")
        row["note"] = self.note_text.get("1.0", "end-1c")
        self._refresh_tree()
        self.tree.selection_set(str(self.selected_index))
        if not silent:
            self._append_log(f"updated row {row.get('file_offset', '')}\n")


if __name__ == "__main__":
    app = ExeTextWorkflowGui()
    app.mainloop()
