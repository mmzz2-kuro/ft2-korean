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


class BinResourceRestoreGui(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("BIN Resource Restore (copy resource-ID ranges between two BINs)")
        self.geometry("1000x680")
        self.minsize(860, 540)

        self.log_queue = queue.Queue()
        self.vars = {
            "original_bin": tk.StringVar(value=str(ROOT / "ps1/SLPS-01903/bincue/Farland Saga - Toki no Michishirube.bin")),
            "modified_bin": tk.StringVar(value=""),
            "exe": tk.StringVar(value=str(ROOT / "ps1/SLPS-01903/SLPS_019.03")),
            "work_dir": tk.StringVar(value=str(ROOT / "tmp/SLPS-01903/bin-resource-restore")),
            "fs2_lba": tk.StringVar(value="223"),
            "fs2_sectors": tk.StringVar(value="119472"),
            "ids": tk.StringVar(value="1201"),
            "output_bin": tk.StringVar(value=""),
            "dry_run": tk.BooleanVar(value=False),
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
            ("Original BIN (source of truth)", "original_bin", "file"),
            ("Modified BIN (gets restored)", "modified_bin", "file"),
            ("SLPS_019.03", "exe", "file"),
            ("Work Dir", "work_dir", "dir"),
        ]
        for r, (label, key, kind) in enumerate(rows):
            ttk.Label(top, text=label).grid(row=r, column=0, sticky="w", padx=(0, 4), pady=2)
            ttk.Entry(top, textvariable=self.vars[key]).grid(row=r, column=1, sticky="ew", padx=(0, 4), pady=2)
            ttk.Button(top, text="...", width=3, command=lambda k=key, t=kind: self._browse(k, t)).grid(row=r, column=2, sticky="ew", pady=2)

        opts = ttk.Frame(self, padding=(8, 0, 8, 4))
        opts.grid(row=1, column=0, sticky="ew")
        for label, key, width in [
            ("FS2 LBA", "fs2_lba", 8),
            ("FS2 sectors", "fs2_sectors", 10),
            ("resource IDs", "ids", 30),
        ]:
            ttk.Label(opts, text=label).pack(side="left")
            ttk.Entry(opts, textvariable=self.vars[key], width=width).pack(side="left", padx=(4, 10))
        ttk.Checkbutton(opts, text="Dry run (report only, don't write output)", variable=self.vars["dry_run"]).pack(side="left", padx=(6, 0))

        out_row = ttk.Frame(self, padding=(8, 0, 8, 8))
        out_row.grid(row=2, column=0, sticky="ew")
        out_row.columnconfigure(1, weight=1)
        ttk.Label(out_row, text="Output BIN").grid(row=0, column=0, sticky="w", padx=(0, 4))
        ttk.Entry(out_row, textvariable=self.vars["output_bin"]).grid(row=0, column=1, sticky="ew", padx=(0, 4))
        ttk.Button(out_row, text="...", width=3, command=self._browse_output).grid(row=0, column=2, padx=(0, 10))
        ttk.Button(out_row, text="Restore Resource(s)", command=self.run_restore).grid(row=0, column=3)

        body = ttk.Frame(self, padding=8)
        body.grid(row=3, column=0, sticky="nsew")
        body.columnconfigure(0, weight=1)
        body.rowconfigure(1, weight=1)

        help_text = (
            "Copies just the byte range for each resource ID (same EXE sector table "
            "as scripts/list-fs2-resource-ids.js / be-hdr-ui-tile-tool.js) from the "
            "Original BIN's FS2_FILE.DAT into a copy of the Modified BIN's FS2_FILE.DAT, "
            "then writes a new BIN with that patched FS2_FILE.DAT injected back in. "
            "Everything outside the listed resource IDs is left exactly as it was in "
            "the Modified BIN. resource IDs accept '1201' or ranges/lists like '224-232,1201'."
        )
        ttk.Label(body, text=help_text, wraplength=940, justify="left").grid(row=0, column=0, sticky="w", pady=(0, 6))

        self.log = tk.Text(body, height=28, wrap="word")
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
        current = self.vars["output_bin"].get() or self.vars["modified_bin"].get()
        initial_dir = str(Path(current).parent) if current else str(ROOT)
        initial_file = Path(current).name if current else "restored.bin"
        chosen = filedialog.asksaveasfilename(
            initialdir=initial_dir,
            initialfile=initial_file,
            defaultextension=".bin",
            filetypes=[("BIN", "*.bin"), ("All files", "*.*")],
        )
        if chosen:
            self.vars["output_bin"].set(chosen)

    # ------------------------------------------------------------ actions ---

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

    def run_restore(self):
        original_bin = self.vars["original_bin"].get().strip()
        modified_bin = self.vars["modified_bin"].get().strip()
        exe = self.vars["exe"].get().strip()
        output_bin = self.vars["output_bin"].get().strip()

        if not original_bin or not modified_bin or not exe:
            self._append_log("[error] original BIN, modified BIN, and SLPS_019.03 are all required\n")
            return
        if not output_bin:
            self._append_log("[error] choose an output BIN path\n")
            return

        try:
            ids = [str(i) for i in expand_ids(self.vars["ids"].get())]
        except ValueError as exc:
            self._append_log(f"[error] could not parse resource IDs: {exc}\n")
            return
        if not ids:
            self._append_log("[warn] no resource IDs entered\n")
            return

        work_dir = Path(self.vars["work_dir"].get())
        work_dir.mkdir(parents=True, exist_ok=True)
        original_dat = work_dir / "original-FS2_FILE.DAT"
        modified_dat = work_dir / "modified-FS2_FILE.DAT"
        restored_dat = work_dir / "restored-FS2_FILE.DAT"

        lba = self.vars["fs2_lba"].get().strip()
        sectors = self.vars["fs2_sectors"].get().strip()

        def extract_original():
            self.run_command(
                "Extract FS2_FILE.DAT from Original BIN",
                ["node", str(ROOT / "scripts/extract-dat-from-raw-bin.js"), original_bin, str(original_dat), "--lba", lba, "--sectors", sectors],
                extract_modified,
            )

        def extract_modified():
            self.run_command(
                "Extract FS2_FILE.DAT from Modified BIN",
                ["node", str(ROOT / "scripts/extract-dat-from-raw-bin.js"), modified_bin, str(modified_dat), "--lba", lba, "--sectors", sectors],
                restore_range,
            )

        def restore_range():
            cmd = [
                "node",
                str(ROOT / "scripts/restore-fs2-resource-range.js"),
                str(original_dat),
                str(modified_dat),
                exe,
                str(restored_dat),
                *ids,
            ]
            if self.vars["dry_run"].get():
                cmd.append("--dry-run")
                self.run_command(f"Dry-run restore resources {','.join(ids)}", cmd, None)
            else:
                self.run_command(f"Restore resources {','.join(ids)} from Original into Modified", cmd, inject_output)

        def inject_output():
            self.run_command(
                "Inject restored FS2_FILE.DAT into a copy of the Modified BIN",
                ["node", str(ROOT / "scripts/inject-dat-into-raw-bin.js"), modified_bin, str(restored_dat), output_bin, "--lba", lba],
                lambda: self._append_log(f"[done] wrote {rel(output_bin)}\n"),
            )

        extract_original()

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
    app = BinResourceRestoreGui()
    app.mainloop()
