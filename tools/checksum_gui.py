#!/usr/bin/env python
# -*- coding: utf-8 -*-

import hashlib
import queue
import threading
import zlib
from pathlib import Path
from tkinter import filedialog, ttk
import tkinter as tk

ROOT = Path(__file__).resolve().parents[1]
CHUNK_SIZE = 1024 * 1024


def rel(path):
    try:
        return str(Path(path).resolve().relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        return str(path)


def compute_hashes(path, progress_cb):
    size = Path(path).stat().st_size
    crc = 0
    md5 = hashlib.md5()
    sha1 = hashlib.sha1()
    done = 0
    with open(path, "rb") as fh:
        while True:
            chunk = fh.read(CHUNK_SIZE)
            if not chunk:
                break
            crc = zlib.crc32(chunk, crc)
            md5.update(chunk)
            sha1.update(chunk)
            done += len(chunk)
            progress_cb(done, size)
    return size, f"{crc & 0xffffffff:08X}", md5.hexdigest(), sha1.hexdigest()


class ChecksumGui(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Checksum Tool (CRC32 / MD5 / SHA-1)")
        self.geometry("1180x560")
        self.minsize(900, 420)

        self.result_queue = queue.Queue()
        self.rows = {}  # iid -> {"path": str, "crc32": str, "md5": str, "sha1": str}

        self._build_ui()
        self.after(100, self._drain_queue)

    def _build_ui(self):
        self.columnconfigure(0, weight=1)
        self.rowconfigure(3, weight=1)

        top = ttk.Frame(self, padding=8)
        top.grid(row=0, column=0, sticky="ew")
        ttk.Label(top, text="Expected CRC32").pack(side="left")
        self.expected_crc32 = tk.StringVar()
        ttk.Entry(top, textvariable=self.expected_crc32, width=12).pack(side="left", padx=(4, 12))
        ttk.Label(top, text="Expected MD5").pack(side="left")
        self.expected_md5 = tk.StringVar()
        ttk.Entry(top, textvariable=self.expected_md5, width=34).pack(side="left", padx=(4, 12))
        ttk.Label(top, text="Expected SHA-1").pack(side="left")
        self.expected_sha1 = tk.StringVar()
        ttk.Entry(top, textvariable=self.expected_sha1, width=44).pack(side="left", padx=(4, 12))

        hint = ttk.Frame(self, padding=(8, 0, 8, 4))
        hint.grid(row=1, column=0, sticky="ew")
        ttk.Label(hint, text="(expected values are optional -- only applied when adding a single file)").pack(side="left")

        buttons = ttk.Frame(self, padding=(8, 0, 8, 8))
        buttons.grid(row=2, column=0, sticky="ew")
        ttk.Button(buttons, text="Add File(s)...", command=self._add_files).pack(side="left")
        ttk.Button(buttons, text="Remove Selected", command=self._remove_selected).pack(side="left", padx=(6, 0))
        ttk.Button(buttons, text="Clear List", command=self._clear_all).pack(side="left", padx=(6, 0))

        body = ttk.Frame(self, padding=(8, 0, 8, 8))
        body.grid(row=3, column=0, sticky="nsew")
        body.columnconfigure(0, weight=1)
        body.rowconfigure(0, weight=1)

        columns = ("file", "size", "crc32", "md5", "sha1", "match")
        self.tree = ttk.Treeview(body, columns=columns, show="headings", selectmode="extended")
        for col, text, width, anchor in [
            ("file", "File", 260, "w"),
            ("size", "Size", 90, "e"),
            ("crc32", "CRC32", 90, "center"),
            ("md5", "MD5", 260, "center"),
            ("sha1", "SHA-1", 300, "center"),
            ("match", "Match", 80, "center"),
        ]:
            self.tree.heading(col, text=text)
            self.tree.column(col, width=width, anchor=anchor, stretch=(col in ("file", "md5", "sha1")))
        self.tree.grid(row=0, column=0, sticky="nsew")

        scrollbar = ttk.Scrollbar(body, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)
        scrollbar.grid(row=0, column=1, sticky="ns")

        self.tree.tag_configure("ok", foreground="#1a7f1a")
        self.tree.tag_configure("mismatch", foreground="#b30000")

        self._build_context_menu()
        self.tree.bind("<Button-3>", self._show_context_menu)

        status = ttk.Frame(self, padding=(8, 0, 8, 8))
        status.grid(row=4, column=0, sticky="ew")
        status.columnconfigure(0, weight=1)
        self.progress = ttk.Progressbar(status, mode="determinate", maximum=100)
        self.progress.grid(row=0, column=0, sticky="ew")
        self.status_var = tk.StringVar(value="idle")
        ttk.Label(status, textvariable=self.status_var).grid(row=1, column=0, sticky="w", pady=(4, 0))

    def _build_context_menu(self):
        self.menu = tk.Menu(self, tearoff=0)
        self.menu.add_command(label="Copy CRC32", command=lambda: self._copy_field("crc32"))
        self.menu.add_command(label="Copy MD5", command=lambda: self._copy_field("md5"))
        self.menu.add_command(label="Copy SHA-1", command=lambda: self._copy_field("sha1"))
        self.menu.add_command(label="Copy Path", command=lambda: self._copy_field("path"))
        self.menu.add_command(label="Copy Row (tab-separated)", command=self._copy_row)

    def _show_context_menu(self, event):
        iid = self.tree.identify_row(event.y)
        if iid:
            self.tree.selection_set(iid)
            self.menu.tk_popup(event.x_root, event.y_root)

    def _selected_iid(self):
        selection = self.tree.selection()
        return selection[0] if selection else None

    def _copy_field(self, field):
        iid = self._selected_iid()
        if not iid or iid not in self.rows:
            return
        value = self.rows[iid].get(field, "")
        self.clipboard_clear()
        self.clipboard_append(value)

    def _copy_row(self):
        iid = self._selected_iid()
        if not iid:
            return
        values = self.tree.item(iid, "values")
        self.clipboard_clear()
        self.clipboard_append("\t".join(str(v) for v in values))

    def _add_files(self):
        paths = filedialog.askopenfilenames(initialdir=str(ROOT))
        if not paths:
            return

        expected_crc32 = self.expected_crc32.get().strip().upper() or None
        expected_md5 = self.expected_md5.get().strip().lower() or None
        expected_sha1 = self.expected_sha1.get().strip().lower() or None
        if len(paths) != 1:
            expected_crc32 = None
            expected_md5 = None
            expected_sha1 = None

        for path in paths:
            iid = self.tree.insert("", "end", values=(rel(path), "...", "...", "...", "...", "-"))
            self.rows[iid] = {"path": path, "crc32": "", "md5": "", "sha1": ""}
            threading.Thread(
                target=self._worker,
                args=(iid, path, expected_crc32, expected_md5, expected_sha1),
                daemon=True,
            ).start()

    def _worker(self, iid, path, expected_crc32, expected_md5, expected_sha1):
        def progress_cb(done, size):
            percent = (done / size * 100) if size else 100
            self.result_queue.put(("progress", iid, rel(path), percent))

        try:
            size, crc32, md5, sha1 = compute_hashes(path, progress_cb)
            self.result_queue.put(("done", iid, size, crc32, md5, sha1, expected_crc32, expected_md5, expected_sha1))
        except OSError as exc:
            self.result_queue.put(("error", iid, str(exc)))

    def _drain_queue(self):
        try:
            while True:
                message = self.result_queue.get_nowait()
                kind = message[0]
                if kind == "progress":
                    _, iid, name, percent = message
                    self.progress["value"] = percent
                    self.status_var.set(f"hashing {name}: {percent:.0f}%")
                elif kind == "done":
                    _, iid, size, crc32, md5, sha1, expected_crc32, expected_md5, expected_sha1 = message
                    self.rows[iid]["crc32"] = crc32
                    self.rows[iid]["md5"] = md5
                    self.rows[iid]["sha1"] = sha1

                    match = "-"
                    tag = ()
                    if expected_crc32 or expected_md5 or expected_sha1:
                        crc_ok = expected_crc32 is None or expected_crc32 == crc32
                        md5_ok = expected_md5 is None or expected_md5 == md5.lower()
                        sha_ok = expected_sha1 is None or expected_sha1 == sha1.lower()
                        if crc_ok and md5_ok and sha_ok:
                            match, tag = "OK", ("ok",)
                        else:
                            match, tag = "MISMATCH", ("mismatch",)

                    values = list(self.tree.item(iid, "values"))
                    values[1] = f"{size:,} bytes"
                    values[2] = crc32
                    values[3] = md5
                    values[4] = sha1
                    values[5] = match
                    self.tree.item(iid, values=values, tags=tag)
                    self.progress["value"] = 100
                    self.status_var.set("idle")
                elif kind == "error":
                    _, iid, err = message
                    values = list(self.tree.item(iid, "values"))
                    values[2] = values[3] = values[4] = "error"
                    values[5] = err
                    self.tree.item(iid, values=values, tags=("mismatch",))
                    self.status_var.set(f"error: {err}")
        except queue.Empty:
            pass
        self.after(100, self._drain_queue)

    def _remove_selected(self):
        for iid in self.tree.selection():
            self.tree.delete(iid)
            self.rows.pop(iid, None)

    def _clear_all(self):
        for iid in self.tree.get_children():
            self.tree.delete(iid)
        self.rows.clear()


if __name__ == "__main__":
    app = ChecksumGui()
    app.mainloop()
