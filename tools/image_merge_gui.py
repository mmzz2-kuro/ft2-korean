#!/usr/bin/env python
# -*- coding: utf-8 -*-

import json
from pathlib import Path
from tkinter import filedialog, ttk
import tkinter as tk

import numpy as np
from PIL import Image, ImageTk

ROOT = Path(__file__).resolve().parents[1]
ZOOM_LEVELS = {"50%": 0.5, "100%": 1.0, "200%": 2.0, "400%": 4.0}
STATE_PATH = ROOT / "tmp/.gui-state/image_merge_gui.json"


def rel(path):
    try:
        return str(Path(path).resolve().relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        return str(path)


def load_last_dir():
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8")).get("last_dir", str(ROOT))
    except (OSError, ValueError):
        return str(ROOT)


def save_last_dir(directory):
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps({"last_dir": str(directory)}), encoding="utf-8")


class ImageMergeGui(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Image Merge (load a base, import & merge layers on top)")
        self.geometry("1100x720")
        self.minsize(880, 560)

        self.base_path = None
        self.canvas_image = None  # RGBA PIL.Image, the accumulated merged result
        self._photo = None
        self.last_dir = load_last_dir()

        self.zoom_var = tk.StringVar(value="100%")
        self.offset_x_var = tk.StringVar(value="0")
        self.offset_y_var = tk.StringVar(value="0")
        self.exclude_black_var = tk.BooleanVar(value=True)
        self.status_var = tk.StringVar(value="load a base image to begin")

        self._build_ui()

    # ---------------------------------------------------------------- UI ---

    def _build_ui(self):
        self.columnconfigure(0, weight=3)
        self.columnconfigure(1, weight=1)
        self.rowconfigure(1, weight=1)

        top = ttk.Frame(self, padding=8)
        top.grid(row=0, column=0, columnspan=2, sticky="ew")
        ttk.Button(top, text="Load Base Image...", command=self._load_base).pack(side="left")
        ttk.Button(top, text="Import & Merge...", command=self._import_merge).pack(side="left", padx=(6, 0))

        ttk.Label(top, text="at X").pack(side="left", padx=(16, 0))
        ttk.Entry(top, textvariable=self.offset_x_var, width=6).pack(side="left", padx=(4, 0))
        ttk.Label(top, text="Y").pack(side="left", padx=(8, 0))
        ttk.Entry(top, textvariable=self.offset_y_var, width=6).pack(side="left", padx=(4, 0))

        ttk.Checkbutton(top, text="Exclude black (0,0,0)", variable=self.exclude_black_var).pack(side="left", padx=(16, 0))

        ttk.Button(top, text="Reset to Base", command=self._reset_to_base).pack(side="left", padx=(16, 0))
        ttk.Button(top, text="Save Merged Image As...", command=self._save_as).pack(side="left", padx=(16, 0))

        ttk.Label(top, text="Zoom").pack(side="left", padx=(20, 0))
        zoom_combo = ttk.Combobox(top, textvariable=self.zoom_var, values=list(ZOOM_LEVELS), width=6, state="readonly")
        zoom_combo.pack(side="left", padx=(4, 0))
        zoom_combo.bind("<<ComboboxSelected>>", lambda _e: self._redraw_canvas())

        # canvas ------------------------------------------------------------
        canvas_frame = ttk.Frame(self, padding=(8, 0, 4, 8))
        canvas_frame.grid(row=1, column=0, sticky="nsew")
        canvas_frame.rowconfigure(0, weight=1)
        canvas_frame.columnconfigure(0, weight=1)

        self.canvas = tk.Canvas(canvas_frame, background="#808080")
        vbar = ttk.Scrollbar(canvas_frame, orient="vertical", command=self.canvas.yview)
        hbar = ttk.Scrollbar(canvas_frame, orient="horizontal", command=self.canvas.xview)
        self.canvas.configure(yscrollcommand=vbar.set, xscrollcommand=hbar.set)
        self.canvas.grid(row=0, column=0, sticky="nsew")
        vbar.grid(row=0, column=1, sticky="ns")
        hbar.grid(row=1, column=0, sticky="ew")

        ttk.Label(canvas_frame, textvariable=self.status_var, foreground="#666666").grid(
            row=2, column=0, columnspan=2, sticky="w", pady=(4, 0)
        )

        # history side panel --------------------------------------------------
        side = ttk.Frame(self, padding=(4, 0, 8, 8))
        side.grid(row=1, column=1, sticky="nsew")
        side.rowconfigure(1, weight=1)
        side.columnconfigure(0, weight=1)
        ttk.Label(side, text="Merge history").grid(row=0, column=0, sticky="w")
        self.log = tk.Text(side, width=34, wrap="word")
        self.log.grid(row=1, column=0, sticky="nsew")

    # ------------------------------------------------------------ loading ---

    def _pick_image_path(self):
        return filedialog.askopenfilename(
            initialdir=self.last_dir,
            filetypes=[("Images", "*.png *.bmp *.jpg *.jpeg *.gif *.tga"), ("All files", "*.*")],
        )

    def _remember_dir(self, path):
        self.last_dir = str(Path(path).parent)
        save_last_dir(self.last_dir)

    def _load_base(self):
        path = self._pick_image_path()
        if not path:
            return
        try:
            img = Image.open(path).convert("RGBA")
        except Exception as exc:
            self._set_status(f"[error] could not open image: {exc}")
            return

        self.base_path = path
        self.base_image = img
        self.canvas_image = img.copy()
        self._remember_dir(path)
        self._append_log(f"base: {rel(path)} ({img.width}x{img.height})\n")
        self._set_status(f"loaded base {rel(path)}")
        self._redraw_canvas()

    def _import_merge(self):
        if self.canvas_image is None:
            self._set_status("[warn] load a base image first")
            return
        path = self._pick_image_path()
        if not path:
            return
        try:
            layer = Image.open(path).convert("RGBA")
        except Exception as exc:
            self._set_status(f"[error] could not open image: {exc}")
            return

        try:
            x = int(self.offset_x_var.get())
            y = int(self.offset_y_var.get())
        except ValueError:
            self._set_status("[error] X/Y offset must be integers")
            return

        canvas_w, canvas_h = self.canvas_image.size
        left, top = max(0, x), max(0, y)
        right, bottom = min(canvas_w, x + layer.width), min(canvas_h, y + layer.height)
        if left >= right or top >= bottom:
            self._append_log(f"[skip] {rel(path)} at ({x},{y}) does not overlap the canvas at all\n")
            self._set_status(f"[warn] {rel(path)} is entirely outside the canvas -- not merged")
            return

        crop_box = (left - x, top - y, right - x, bottom - y)
        cropped = layer.crop(crop_box)

        black_note = ""
        if self.exclude_black_var.get():
            arr = np.array(cropped)
            black_mask = np.all(arr[:, :, :3] == 0, axis=-1)
            excluded = int(np.count_nonzero(black_mask))
            if excluded:
                arr[black_mask, 3] = 0
                cropped = Image.fromarray(arr, "RGBA")
                black_note = f", excluded {excluded} black px"

        self.canvas_image.alpha_composite(cropped, dest=(left, top))

        self._remember_dir(path)
        clipped_note = "" if (left, top, right, bottom) == (x, y, x + layer.width, y + layer.height) else " (clipped to canvas)"
        self._append_log(f"merged: {rel(path)} ({layer.width}x{layer.height}) at ({x},{y}){clipped_note}{black_note}\n")
        self._set_status(f"merged {rel(path)} at ({x},{y})")
        self._redraw_canvas()

    def _reset_to_base(self):
        if self.base_image is None:
            return
        self.canvas_image = self.base_image.copy()
        self._append_log("--- reset to base ---\n")
        self._set_status("reset to base (nothing saved yet)")
        self._redraw_canvas()

    def _save_as(self):
        if self.canvas_image is None:
            self._set_status("[warn] nothing to save")
            return
        base = Path(self.base_path)
        save_path = filedialog.asksaveasfilename(
            initialdir=self.last_dir,
            initialfile=f"{base.stem}-merged.png",
            defaultextension=".png",
            filetypes=[("PNG", "*.png"), ("BMP", "*.bmp"), ("All files", "*.*")],
        )
        if not save_path:
            return

        out = self.canvas_image
        if Path(save_path).suffix.lower() in (".bmp", ".jpg", ".jpeg"):
            out = out.convert("RGB")
        out.save(save_path)
        self._remember_dir(save_path)
        self._append_log(f"saved: {rel(save_path)}\n")
        self._set_status(f"saved {rel(save_path)}")

    # ------------------------------------------------------------ preview ---

    def _redraw_canvas(self):
        if self.canvas_image is None:
            return
        image = self.canvas_image
        zoom = ZOOM_LEVELS[self.zoom_var.get()]
        if zoom != 1.0:
            image = image.resize((max(1, int(image.width * zoom)), max(1, int(image.height * zoom))), Image.NEAREST)

        self._photo = ImageTk.PhotoImage(image)
        self.canvas.delete("all")
        self.canvas.create_image(0, 0, anchor="nw", image=self._photo)
        self.canvas.configure(scrollregion=(0, 0, image.width, image.height))

    def _append_log(self, text):
        self.log.insert("end", text)
        self.log.see("end")

    def _set_status(self, text):
        self.status_var.set(text)


if __name__ == "__main__":
    app = ImageMergeGui()
    app.mainloop()
