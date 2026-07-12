#!/usr/bin/env python
# -*- coding: utf-8 -*-

import json
from pathlib import Path
from tkinter import colorchooser, filedialog, ttk
import tkinter as tk

import numpy as np
from PIL import Image, ImageColor, ImageTk

ROOT = Path(__file__).resolve().parents[1]
ZOOM_LEVELS = {"50%": 0.5, "100%": 1.0, "200%": 2.0, "400%": 4.0}
STATE_PATH = ROOT / "tmp/.gui-state/color_replace_gui.json"


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


class ColorReplaceGui(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Color Replace (A -> B)")
        self.geometry("1080x700")
        self.minsize(860, 540)

        self.source_path = None
        self.original_array = None  # H x W x 3 uint8, untouched
        self.array = None  # H x W x 3 uint8, working copy edits apply to
        self._photo = None
        self.pick_target = None  # "a" or "b" while armed, else None
        self.last_dir = load_last_dir()

        self.color_a_var = tk.StringVar(value="#ff0000")
        self.color_b_var = tk.StringVar(value="#00ff00")
        self.zoom_var = tk.StringVar(value="100%")
        self.status_var = tk.StringVar(value="load an image to begin")

        self._build_ui()

    # ---------------------------------------------------------------- UI ---

    def _build_ui(self):
        self.columnconfigure(0, weight=1)
        self.rowconfigure(2, weight=1)

        top = ttk.Frame(self, padding=8)
        top.grid(row=0, column=0, sticky="ew")
        ttk.Button(top, text="Load Image...", command=self._load_image).pack(side="left")
        self.image_label = ttk.Label(top, text="(no image loaded)")
        self.image_label.pack(side="left", padx=(8, 0))

        ttk.Label(top, text="Zoom").pack(side="left", padx=(20, 0))
        zoom_combo = ttk.Combobox(top, textvariable=self.zoom_var, values=list(ZOOM_LEVELS), width=6, state="readonly")
        zoom_combo.pack(side="left", padx=(4, 0))
        zoom_combo.bind("<<ComboboxSelected>>", lambda _e: self._redraw_canvas())

        controls = ttk.Frame(self, padding=(8, 0, 8, 8))
        controls.grid(row=1, column=0, sticky="ew")

        self._build_color_row(controls, "Color A (find)", self.color_a_var, "a")
        self._build_color_row(controls, "Color B (replace with)", self.color_b_var, "b")

        buttons = ttk.Frame(controls)
        buttons.pack(side="left", padx=(20, 0))
        ttk.Button(buttons, text="Apply (A -> B)", command=self.apply_replace).pack(fill="x")
        ttk.Button(buttons, text="Reset to Original", command=self.reset_image).pack(fill="x", pady=(4, 0))
        ttk.Button(buttons, text="Save Image", command=self.save_image).pack(fill="x", pady=(4, 0))
        ttk.Button(buttons, text="Save Image As...", command=self.save_image_as).pack(fill="x", pady=(4, 0))

        # canvas ------------------------------------------------------------
        canvas_frame = ttk.Frame(self, padding=(8, 0, 8, 8))
        canvas_frame.grid(row=2, column=0, sticky="nsew")
        canvas_frame.rowconfigure(0, weight=1)
        canvas_frame.columnconfigure(0, weight=1)

        self.canvas = tk.Canvas(canvas_frame, background="#202020")
        vbar = ttk.Scrollbar(canvas_frame, orient="vertical", command=self.canvas.yview)
        hbar = ttk.Scrollbar(canvas_frame, orient="horizontal", command=self.canvas.xview)
        self.canvas.configure(yscrollcommand=vbar.set, xscrollcommand=hbar.set)
        self.canvas.grid(row=0, column=0, sticky="nsew")
        vbar.grid(row=0, column=1, sticky="ns")
        hbar.grid(row=1, column=0, sticky="ew")
        self.canvas.bind("<Button-1>", self._on_canvas_click)

        ttk.Label(canvas_frame, textvariable=self.status_var, foreground="#666666").grid(
            row=2, column=0, columnspan=2, sticky="w", pady=(4, 0)
        )

    def _build_color_row(self, parent, label, var, which):
        row = ttk.Frame(parent)
        row.pack(side="left", padx=(0, 20))
        ttk.Label(row, text=label).pack(anchor="w")
        entry_row = ttk.Frame(row)
        entry_row.pack(anchor="w", pady=(2, 0))
        ttk.Entry(entry_row, textvariable=var, width=10).pack(side="left")
        swatch = tk.Label(entry_row, width=2, relief="solid", borderwidth=1)
        swatch.pack(side="left", padx=(4, 4))
        ttk.Button(entry_row, text="Pick...", command=lambda: self._pick_color(var, swatch)).pack(side="left")
        ttk.Button(entry_row, text="Pick from Image", command=lambda: self._arm_eyedropper(which)).pack(side="left", padx=(4, 0))
        var.trace_add("write", lambda *_: self._update_swatch(var, swatch))
        self._update_swatch(var, swatch)

    def _update_swatch(self, var, swatch):
        try:
            rgb = ImageColor.getcolor(var.get().strip(), "RGB")
            swatch.configure(background="#%02x%02x%02x" % rgb)
        except ValueError:
            pass

    def _pick_color(self, var, swatch):
        try:
            initial_rgb = ImageColor.getcolor(var.get().strip(), "RGB")
        except ValueError:
            initial_rgb = (0, 0, 0)
        _, hex_color = colorchooser.askcolor(color=initial_rgb, parent=self)
        if hex_color:
            var.set(hex_color)

    def _arm_eyedropper(self, which):
        self.pick_target = which
        self._set_status(f"click a pixel in the image to set Color {which.upper()}")

    # ------------------------------------------------------------ loading ---

    def _load_image(self):
        path = filedialog.askopenfilename(
            initialdir=self.last_dir,
            filetypes=[("Images", "*.png *.bmp *.jpg *.jpeg *.gif *.tga"), ("All files", "*.*")],
        )
        if not path:
            return
        try:
            img = Image.open(path).convert("RGB")
        except Exception as exc:
            self._set_status(f"[error] could not open image: {exc}")
            return

        self.last_dir = str(Path(path).parent)
        save_last_dir(self.last_dir)

        self.source_path = path
        self.original_array = np.array(img)
        self.array = self.original_array.copy()
        self.image_label.configure(text=f"{rel(path)}  ({img.width}x{img.height})")
        self._set_status("loaded -- set Color A/B and click Apply")
        self._redraw_canvas()

    # ------------------------------------------------------------ actions ---

    def apply_replace(self):
        if self.array is None:
            self._set_status("[warn] no image loaded")
            return
        try:
            color_a = ImageColor.getcolor(self.color_a_var.get().strip(), "RGB")
            color_b = ImageColor.getcolor(self.color_b_var.get().strip(), "RGB")
        except ValueError as exc:
            self._set_status(f"[error] invalid color: {exc}")
            return

        mask = np.all(self.array == color_a, axis=-1)
        count = int(np.count_nonzero(mask))
        self.array[mask] = color_b
        self._redraw_canvas()
        self._set_status(f"replaced {count} pixel(s): {self.color_a_var.get()} -> {self.color_b_var.get()}")

    def reset_image(self):
        if self.original_array is None:
            return
        self.array = self.original_array.copy()
        self._redraw_canvas()
        self._set_status("reset to original (nothing saved yet)")

    def save_image(self):
        if self.array is None:
            self._set_status("[warn] no image loaded")
            return
        Image.fromarray(self.array, "RGB").save(self.source_path)
        self._set_status(f"saved (overwrote) {rel(self.source_path)}")

    def save_image_as(self):
        if self.array is None:
            self._set_status("[warn] no image loaded")
            return
        source = Path(self.source_path)
        save_path = filedialog.asksaveasfilename(
            initialdir=str(source.parent),
            initialfile=source.name,
            defaultextension=source.suffix or ".png",
            filetypes=[("PNG", "*.png"), ("BMP", "*.bmp"), ("JPEG", "*.jpg *.jpeg"), ("All files", "*.*")],
        )
        if not save_path:
            return
        Image.fromarray(self.array, "RGB").save(save_path)
        self.last_dir = str(Path(save_path).parent)
        save_last_dir(self.last_dir)
        self._set_status(f"saved {rel(save_path)}")

    def _on_canvas_click(self, event):
        if self.array is None:
            return
        zoom = ZOOM_LEVELS[self.zoom_var.get()]
        x = int(self.canvas.canvasx(event.x) / zoom)
        y = int(self.canvas.canvasy(event.y) / zoom)
        h, w, _ = self.array.shape
        if not (0 <= x < w and 0 <= y < h):
            return

        r, g, b = (int(v) for v in self.array[y, x])
        hex_color = f"#{r:02x}{g:02x}{b:02x}"

        if self.pick_target == "a":
            self.color_a_var.set(hex_color)
            self.pick_target = None
            self._set_status(f"Color A set to {hex_color} from ({x},{y})")
        elif self.pick_target == "b":
            self.color_b_var.set(hex_color)
            self.pick_target = None
            self._set_status(f"Color B set to {hex_color} from ({x},{y})")
        else:
            self._set_status(f"({x},{y}) = {hex_color}")

    # ------------------------------------------------------------ preview ---

    def _redraw_canvas(self):
        if self.array is None:
            return
        image = Image.fromarray(self.array, "RGB")
        zoom = ZOOM_LEVELS[self.zoom_var.get()]
        if zoom != 1.0:
            image = image.resize((max(1, int(image.width * zoom)), max(1, int(image.height * zoom))), Image.NEAREST)

        self._photo = ImageTk.PhotoImage(image)
        self.canvas.delete("all")
        self.canvas.create_image(0, 0, anchor="nw", image=self._photo)
        self.canvas.configure(scrollregion=(0, 0, image.width, image.height))

    def _set_status(self, text):
        self.status_var.set(text)


if __name__ == "__main__":
    app = ColorReplaceGui()
    app.mainloop()
