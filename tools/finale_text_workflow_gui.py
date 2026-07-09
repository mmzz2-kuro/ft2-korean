#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
SLPS-01903 "17일차 후반부/최종보스전" 추가 대사 영역 워크플로 GUI.

기존 그룹 0~15 메시지뱅크(opcode 0x41)에도, opcode 6 소형 테이블에도
속하지 않는, 라이브 디버깅으로 발견한 세 번째 대사 저장 영역을 다룬다.
자세한 발견 경위는 docs/projects/SLPS-01903/dialogue-route.md의
"라이브 디버깅으로 찾은 세 번째 대사 저장 영역" 섹션 참고.

이 영역은 메시지ID/리소스ID 체계가 없어 절대 바이트 오프셋으로 직접
주소를 다루고, 스캔은 섹터 단위 후보를 픽셀 밀도로 걸러내는 방식이라
노이즈(다른 데이터가 우연히 텍스트처럼 보이는 경우)가 섞여 나온다.
그래서 이 도구는 스캔 후 사람이 이미지를 보고 직접 채택/삭제해야 한다.

절차:
  1. Scan: 지정한 바이트 범위를 훑어 후보 목록을 만들고 각 후보의 원본
     이미지를 추출한다.
  2. 목록에서 실제 대사가 아닌 후보(노이즈)는 "행 삭제"로 지운다.
  3. 실제 대사인 후보는 ko_text를 입력하고 미리보기로 확인한 뒤
     enabled를 켠다.
  4. Apply로 활성화된 행을 렌더링해 DAT/BIN에 패치한다.
"""

import csv
import importlib.util
import queue
import re
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

FINALE_TOOL = ROOT / "scripts" / "finale-text-pgm-tool.js"
RENDER_SCRIPT = ROOT / "scripts" / "render-text-to-message-pgm.ps1"

SHADE_MAP = {0: 255, 1: 190, 2: 100, 3: 35}


def rel(path):
    try:
        return str(Path(path).resolve().relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        return str(path)


def unescape_tsv(value):
    marker = chr(0xE000)
    return (value or "").replace("\\\\", marker).replace("\\n", "\n").replace("\\t", "\t").replace(marker, "\\")


def escape_tsv(value):
    return (value or "").replace("\\", "\\\\").replace("\t", "\\t").replace("\r", "").replace("\n", "\\n")


def parse_addr(text):
    text = (text or "").strip()
    if not text:
        raise ValueError("empty address")
    return int(text, 16) if text.lower().startswith("0x") else int(text)


def read_pgm_p2(path):
    text = Path(path).read_text(encoding="ascii")
    tokens = []
    for line in text.splitlines():
        line = re.sub(r"#.*", "", line).strip()
        if line:
            tokens.extend(line.split())
    if tokens.pop(0) != "P2":
        raise ValueError(f"{path} is not an ASCII PGM (P2) file")
    width = int(tokens.pop(0))
    height = int(tokens.pop(0))
    max_value = int(tokens.pop(0))
    pixels = [int(t) for t in tokens[: width * height]]
    if max_value != 3:
        pixels = [max(0, min(3, round(v * 3 / max_value))) for v in pixels]
    return width, height, pixels


def pgm_to_png(pgm_path, out_png_path, scale=4):
    width, height, pixels = read_pgm_p2(pgm_path)
    img = Image.new("L", (width, height))
    img.putdata([SHADE_MAP.get(v, 255) for v in pixels])
    Path(out_png_path).parent.mkdir(parents=True, exist_ok=True)
    img.resize((width * scale, height * scale), Image.NEAREST).save(out_png_path)
    return out_png_path


class FinaleTextWorkflowGui(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("SLPS-01903 Finale Text Workflow (3rd dialogue region)")
        self.geometry("1280x760")
        self.minsize(1080, 640)

        self.rows = []
        self.headers = [
            "enabled", "address", "ink", "source_png", "replacement_png",
            "ko_text", "font_size", "line_height", "pad", "ink_max",
            "threshold", "bright_threshold", "bold", "note",
        ]
        self.selected_index = None
        self.log_queue = queue.Queue()
        self.preview_photo = None
        self.source_photo = None

        self.vars = {
            "dat": tk.StringVar(value=str(ROOT / "ps1/SLPS-01903/FS2_FILE.DAT")),
            "source_bin": tk.StringVar(value=str(ROOT / "ps1/SLPS-01903/bincue/Farland Saga - Toki no Michishirube.bin")),
            "translation": tk.StringVar(value=str(ROOT / "tmp/SLPS-01903/finale-text-workflow/finale-text.tsv")),
            "mask_dir": tk.StringVar(value=str(ROOT / "tmp/SLPS-01903/finale-text-workflow/masks")),
            "font": tk.StringVar(value=str(ROOT / "font/gulim.ttc")),
            "out_dat": tk.StringVar(value=str(ROOT / "tmp/SLPS-01903/finale-text-workflow/out.DAT")),
            "fs2_lba": tk.StringVar(value="223"),
            "scan_start": tk.StringVar(value="0xBFF0000"),
            "scan_end": tk.StringVar(value="0xC200000"),
            "ink_min": tk.StringVar(value="100"),
            "ink_max": tk.StringVar(value="1300"),
        }

        self.edit_vars = {
            "address": tk.StringVar(),
            "ink": tk.StringVar(),
            "ko_text": tk.StringVar(),
            "font_size": tk.StringVar(value="12"),
            "line_height": tk.StringVar(value="15"),
            "pad": tk.StringVar(value="2"),
            "ink_max_v": tk.StringVar(value="2"),
            "threshold": tk.StringVar(value="32"),
            "bright_threshold": tk.StringVar(value="96"),
            "bold": tk.StringVar(value="0"),
            "note": tk.StringVar(),
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
            ("FS2_FILE.DAT", "dat", "file"),
            ("Source BIN(원본, 확장자 .bin일때만 사용)", "source_bin", "file"),
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

        scan_opts = ttk.LabelFrame(top, text="Scan 범위 (바이트 오프셋)", padding=6)
        scan_opts.grid(row=3, column=0, columnspan=6, sticky="ew", pady=(8, 0))
        ttk.Label(scan_opts, text="시작").pack(side="left")
        ttk.Entry(scan_opts, textvariable=self.vars["scan_start"], width=12).pack(side="left", padx=(4, 12))
        ttk.Label(scan_opts, text="끝").pack(side="left")
        ttk.Entry(scan_opts, textvariable=self.vars["scan_end"], width=12).pack(side="left", padx=(4, 12))
        ttk.Label(scan_opts, text="ink min").pack(side="left")
        ttk.Entry(scan_opts, textvariable=self.vars["ink_min"], width=6).pack(side="left", padx=(4, 12))
        ttk.Label(scan_opts, text="ink max").pack(side="left")
        ttk.Entry(scan_opts, textvariable=self.vars["ink_max"], width=6).pack(side="left", padx=(4, 12))

        buttons = ttk.Frame(top)
        buttons.grid(row=4, column=0, columnspan=6, sticky="ew", pady=(8, 0))
        ttk.Button(buttons, text="1. Scan for candidates", command=self.scan_candidates).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="Load TSV", command=self.load_tsv).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="Save TSV", command=self.save_tsv).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="행 삭제(노이즈)", command=self.delete_row).pack(side="left", padx=(0, 6))
        ttk.Button(buttons, text="2. Apply to DAT/BIN", command=self.apply_to_dat).pack(side="left", padx=(0, 6))

        main = ttk.PanedWindow(self, orient=tk.HORIZONTAL)
        main.grid(row=1, column=0, sticky="nsew", padx=8, pady=(0, 8))

        left = ttk.Frame(main)
        left.rowconfigure(0, weight=1)
        left.columnconfigure(0, weight=1)
        main.add(left, weight=3)

        cols = ("enabled", "address", "ink", "ko_text")
        self.tree = ttk.Treeview(left, columns=cols, show="headings", selectmode="browse")
        for col in cols:
            self.tree.heading(col, text=col)
            if col in ("enabled", "ink"):
                self.tree.column(col, width=55, minwidth=40, anchor="w", stretch=False)
            elif col == "address":
                self.tree.column(col, width=100, minwidth=90, anchor="w", stretch=False)
            else:
                self.tree.column(col, width=260, minwidth=120, anchor="w", stretch=True)
        self.tree.grid(row=0, column=0, sticky="nsew")
        ttk.Scrollbar(left, orient="vertical", command=self.tree.yview).grid(row=0, column=1, sticky="ns")
        self.tree.configure(yscrollcommand=lambda *args: None)
        self.tree.bind("<<TreeviewSelect>>", self.on_select)

        right = ttk.Frame(main, padding=(8, 0, 0, 0))
        right.columnconfigure(1, weight=1)
        main.add(right, weight=2)

        r = 0
        ttk.Label(right, text="Address").grid(row=r, column=0, sticky="w", pady=2)
        ttk.Entry(right, textvariable=self.edit_vars["address"], state="readonly").grid(row=r, column=1, sticky="ew", pady=2)
        r += 1
        ttk.Label(right, text="ink").grid(row=r, column=0, sticky="w", pady=2)
        ttk.Entry(right, textvariable=self.edit_vars["ink"], state="readonly").grid(row=r, column=1, sticky="ew", pady=2)
        r += 1
        ttk.Checkbutton(right, text="enabled (실제 대사로 채택 + 패치 대상)", variable=self.enabled_var).grid(row=r, column=0, columnspan=2, sticky="w", pady=2)
        r += 1

        ttk.Label(right, text="원본 이미지(추출된 일본어 대사)").grid(row=r, column=0, columnspan=2, sticky="w", pady=(8, 0))
        r += 1
        self.source_image_label = ttk.Label(right)
        self.source_image_label.grid(row=r, column=0, columnspan=2, sticky="w", pady=2)
        r += 1

        ttk.Label(right, text="메모(원문 참고용, 선택)").grid(row=r, column=0, columnspan=2, sticky="w", pady=(8, 0))
        r += 1
        ttk.Entry(right, textvariable=self.edit_vars["note"]).grid(row=r, column=0, columnspan=2, sticky="ew", pady=2)
        r += 1

        ttk.Label(right, text="번역 텍스트(ko_text, \\n으로 줄바꿈)").grid(row=r, column=0, columnspan=2, sticky="w", pady=(8, 0))
        r += 1
        ttk.Entry(right, textvariable=self.edit_vars["ko_text"]).grid(row=r, column=0, columnspan=2, sticky="ew", pady=2)
        r += 1

        opt_frame = ttk.Frame(right)
        opt_frame.grid(row=r, column=0, columnspan=2, sticky="ew", pady=(4, 0))
        r += 1
        opt_fields = [
            ("font_size", "font_size"), ("line_height", "line_height"), ("pad", "pad"),
            ("ink_max", "ink_max_v"), ("threshold", "threshold"),
            ("bright_threshold", "bright_threshold"), ("bold", "bold"),
        ]
        for i, (label, key) in enumerate(opt_fields):
            ttk.Label(opt_frame, text=label).grid(row=i // 4, column=(i % 4) * 2, sticky="w", padx=(0, 2))
            ttk.Entry(opt_frame, textvariable=self.edit_vars[key], width=6).grid(row=i // 4, column=(i % 4) * 2 + 1, sticky="w", padx=(0, 8))

        preview_buttons = ttk.Frame(right)
        preview_buttons.grid(row=r, column=0, columnspan=2, sticky="ew", pady=(6, 2))
        r += 1
        ttk.Button(preview_buttons, text="미리보기", command=self.preview_render).pack(side="left", padx=(0, 6))
        ttk.Button(preview_buttons, text="행 업데이트", command=self.update_row).pack(side="left")

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

    # -- process helpers -------------------------------------------------

    def _run_node(self, args):
        cmd = ["node", str(FINALE_TOOL)] + [str(a) for a in args]
        self._append_log(f"$ {' '.join(cmd)}\n")
        proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if proc.stdout:
            self._append_log(proc.stdout)
        if proc.returncode != 0:
            self._append_log(proc.stderr or "")
            raise RuntimeError(f"finale-text-pgm-tool.js {args[0]} failed (exit {proc.returncode})")
        return proc.stdout

    def _run_render(self, font_path, text, out_pgm, font_size, line_height, pad, ink_max, threshold, bright_threshold, bold):
        Path(out_pgm).parent.mkdir(parents=True, exist_ok=True)
        cmd = [
            "powershell", "-ExecutionPolicy", "Bypass", "-File", str(RENDER_SCRIPT),
            "-FontPath", font_path,
            "-Text", text,
            "-OutPath", str(out_pgm),
            "-FontSize", str(font_size),
            "-X", "0", "-Y", "0",
            "-LineHeight", str(line_height),
            "-Pad", str(pad),
            "-InkMax", str(ink_max),
            "-Threshold", str(threshold),
            "-BrightThreshold", str(bright_threshold),
            "-Bold", str(bold),
            "-Mode", "AntiAlias",
        ]
        self._append_log(f"$ {' '.join(cmd)}\n")
        proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if proc.stdout:
            self._append_log(proc.stdout)
        if proc.returncode != 0:
            self._append_log(proc.stderr or "")
            raise RuntimeError(f"render-text-to-message-pgm.ps1 failed (exit {proc.returncode})")

    # -- scan / tsv --------------------------------------------------------

    def scan_candidates(self):
        dat_path = self.vars["dat"].get()
        mask_dir = self.vars["mask_dir"].get()
        scan_start = self.vars["scan_start"].get()
        scan_end = self.vars["scan_end"].get()
        ink_min = self.vars["ink_min"].get()
        ink_max = self.vars["ink_max"].get()
        existing_addrs = {row["address"] for row in self.rows}

        def worker():
            try:
                index_json = ROOT / "tmp/SLPS-01903/finale-text-workflow/scan-index.json"
                self._run_node([
                    "scan", dat_path, str(index_json),
                    scan_start, scan_end,
                    "--ink-min", ink_min, "--ink-max", ink_max,
                ])
                import json
                candidates = json.loads(index_json.read_text(encoding="utf-8"))
                new_addrs = [f"0x{c['addr']:x}" for c in candidates if f"0x{c['addr']:x}" not in existing_addrs]
                ink_by_addr = {f"0x{c['addr']:x}": c["ink"] for c in candidates}

                if new_addrs:
                    self._run_node(["export", dat_path, mask_dir] + new_addrs)

                new_rows = []
                for addr in new_addrs:
                    source_png = str(Path(mask_dir) / f"finale-text-{addr}.png")
                    pgm_to_png(Path(mask_dir) / f"finale-text-{addr}.pgm", source_png)
                    new_rows.append({
                        "enabled": "0",
                        "address": addr,
                        "ink": str(ink_by_addr.get(addr, "")),
                        "source_png": source_png,
                        "replacement_png": "",
                        "ko_text": "",
                        "font_size": "12",
                        "line_height": "15",
                        "pad": "2",
                        "ink_max": "2",
                        "threshold": "32",
                        "bright_threshold": "96",
                        "bold": "0",
                        "note": "",
                    })

                def finish():
                    self.rows.extend(new_rows)
                    self.rows.sort(key=lambda r: int(r["address"], 16))
                    self.refresh_tree()
                    self.save_tsv()

                self.log_queue.put(("CALLBACK", finish))
                self._append_log(f"scan complete: {len(candidates)} candidates total, {len(new_rows)} new rows added\n")
            except Exception as exc:
                self._append_log(f"[error] scan failed: {exc}\n")

        threading.Thread(target=worker, daemon=True).start()

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
        self._append_log(f"saved {rel(path)} ({len(self.rows)} rows)\n")

    def refresh_tree(self):
        self.tree.delete(*self.tree.get_children())
        for i, row in enumerate(self.rows):
            self.tree.insert("", "end", iid=str(i), values=[row.get(c, "") for c in self.tree["columns"]])

    def delete_row(self):
        if self.selected_index is None:
            return
        del self.rows[self.selected_index]
        self.selected_index = None
        self.refresh_tree()
        self._append_log("행 삭제됨\n")

    def on_select(self, _event=None):
        selection = self.tree.selection()
        if not selection:
            return
        self.selected_index = int(selection[0])
        row = self.rows[self.selected_index]
        self.edit_vars["address"].set(row.get("address", ""))
        self.edit_vars["ink"].set(row.get("ink", ""))
        self.edit_vars["ko_text"].set(row.get("ko_text", ""))
        self.edit_vars["font_size"].set(row.get("font_size", "12"))
        self.edit_vars["line_height"].set(row.get("line_height", "15"))
        self.edit_vars["pad"].set(row.get("pad", "2"))
        self.edit_vars["ink_max_v"].set(row.get("ink_max", "2"))
        self.edit_vars["threshold"].set(row.get("threshold", "32"))
        self.edit_vars["bright_threshold"].set(row.get("bright_threshold", "96"))
        self.edit_vars["bold"].set(row.get("bold", "0"))
        self.edit_vars["note"].set(row.get("note", ""))
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
        row["line_height"] = self.edit_vars["line_height"].get()
        row["pad"] = self.edit_vars["pad"].get()
        row["ink_max"] = self.edit_vars["ink_max_v"].get()
        row["threshold"] = self.edit_vars["threshold"].get()
        row["bright_threshold"] = self.edit_vars["bright_threshold"].get()
        row["bold"] = self.edit_vars["bold"].get()
        row["note"] = self.edit_vars["note"].get()
        row["enabled"] = "1" if self.enabled_var.get() else "0"

    def _row_render_args(self, row):
        return (
            row.get("font_size", "12") or "12",
            row.get("line_height", "15") or "15",
            row.get("pad", "2") or "2",
            row.get("ink_max", "2") or "2",
            row.get("threshold", "32") or "32",
            row.get("bright_threshold", "96") or "96",
            row.get("bold", "0") or "0",
        )

    def preview_render(self):
        text = self.edit_vars["ko_text"].get().strip()
        if not text:
            self._append_log("[warn] ko_text가 비어있습니다\n")
            return
        preview_pgm = Path(self.vars["mask_dir"].get()) / "preview-tmp.pgm"
        preview_png = Path(self.vars["mask_dir"].get()) / "preview-tmp.png"
        try:
            self._run_render(
                self.vars["font"].get(), text, preview_pgm,
                self.edit_vars["font_size"].get(), self.edit_vars["line_height"].get(),
                self.edit_vars["pad"].get(), self.edit_vars["ink_max_v"].get(),
                self.edit_vars["threshold"].get(), self.edit_vars["bright_threshold"].get(),
                self.edit_vars["bold"].get(),
            )
            pgm_to_png(preview_pgm, preview_png)
        except Exception as exc:
            self._append_log(f"[error] preview render failed: {exc}\n")
            return
        self._show_image(str(preview_png), self.preview_image_label, "preview_photo")

    def update_row(self):
        if self.selected_index is None:
            return
        self._commit_edit_fields()
        row = self.rows[self.selected_index]
        text = row.get("ko_text", "").strip()
        if text:
            replacement_pgm = row.get("replacement_png", "").strip()
            if not replacement_pgm or not replacement_pgm.endswith(".png"):
                replacement_pgm = str(Path(self.vars["mask_dir"].get()) / f"finale-text-{row['address']}-ko.pgm")
            else:
                replacement_pgm = str(Path(replacement_pgm).with_suffix(".pgm"))
            replacement_png = str(Path(replacement_pgm).with_suffix(".png"))
            font_size, line_height, pad, ink_max, threshold, bright_threshold, bold = self._row_render_args(row)
            try:
                self._run_render(self.vars["font"].get(), text, replacement_pgm, font_size, line_height, pad, ink_max, threshold, bright_threshold, bold)
                pgm_to_png(replacement_pgm, replacement_png)
                row["replacement_png"] = replacement_png
            except Exception as exc:
                self._append_log(f"[error] render failed for {row.get('address')}: {exc}\n")
        self.refresh_tree()
        self.tree.selection_set(str(self.selected_index))
        self._show_image(row.get("replacement_png", ""), self.preview_image_label, "preview_photo")
        self._append_log(f"{row.get('address')} 업데이트됨\n")

    def apply_to_dat(self):
        self.save_tsv()
        rows_to_process = [row for row in self.rows if row.get("enabled") == "1" and row.get("ko_text", "").strip()]
        if not rows_to_process:
            self._append_log("[warn] no enabled rows with ko_text to apply\n")
            return

        font_path = self.vars["font"].get()
        initial_dat = self.vars["dat"].get()
        out_dat_field = self.vars["out_dat"].get()
        source_bin = self.vars["source_bin"].get()
        fs2_lba = self.vars["fs2_lba"].get()

        def worker():
            work_dir = ROOT / "tmp/SLPS-01903/finale-text-workflow"
            work_dir.mkdir(parents=True, exist_ok=True)
            current_dat = initial_dat
            applied = 0
            for row in rows_to_process:
                text = row.get("ko_text", "").strip()
                replacement_pgm = row.get("replacement_png", "").strip()
                replacement_pgm = str(Path(replacement_pgm).with_suffix(".pgm")) if replacement_pgm else str(work_dir / f"finale-text-{row['address']}-ko.pgm")
                font_size, line_height, pad, ink_max, threshold, bright_threshold, bold = self._row_render_args(row)
                try:
                    self._run_render(font_path, text, replacement_pgm, font_size, line_height, pad, ink_max, threshold, bright_threshold, bold)
                    working_dat = work_dir / "working-finale-text.DAT"
                    self._run_node(["patch", current_dat, str(working_dat), row["address"], replacement_pgm])
                    current_dat = str(working_dat)
                    applied += 1
                except Exception as exc:
                    self._append_log(f"[error] apply failed for {row.get('address')}: {exc}\n")

            out_is_bin = Path(out_dat_field).suffix.lower() == ".bin"
            Path(out_dat_field).parent.mkdir(parents=True, exist_ok=True)
            if applied == 0:
                self._append_log("[warn] nothing applied, skipping output\n")
                return
            if out_is_bin:
                inject_cmd = [
                    "node", str(ROOT / "scripts/inject-dat-into-raw-bin.js"),
                    source_bin, current_dat, out_dat_field,
                    "--lba", fs2_lba,
                ]
                self._append_log(f"$ {' '.join(inject_cmd)}\n")
                proc = subprocess.run(inject_cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
                self._append_log(proc.stdout or "")
                if proc.returncode != 0:
                    self._append_log(proc.stderr or "")
                    self._append_log("[error] BIN injection failed\n")
                    return
            else:
                shutil.copyfile(current_dat, out_dat_field)
            self._append_log(f"applied {applied}/{len(rows_to_process)} rows -> {rel(out_dat_field)}\n")

        threading.Thread(target=worker, daemon=True).start()

    def _append_log(self, text):
        # Thread-safe: only queues. The actual Text widget mutation happens on
        # the main thread inside _drain_log_queue, since worker threads call
        # this too (subprocess helpers run both on the main thread and off it).
        self.log_queue.put(text)

    def _drain_log_queue(self):
        while True:
            try:
                item = self.log_queue.get_nowait()
            except queue.Empty:
                break
            if isinstance(item, tuple) and item[0] == "CALLBACK":
                item[1]()
            else:
                self.log.insert("end", str(item))
                self.log.see("end")
        self.after(100, self._drain_log_queue)


if __name__ == "__main__":
    app = FinaleTextWorkflowGui()
    app.mainloop()
