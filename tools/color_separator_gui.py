#!/usr/bin/env python
# -*- coding: utf-8 -*-

from pathlib import Path
from tkinter import filedialog, messagebox, ttk
import tkinter as tk

import numpy as np
from PIL import Image, ImageTk

ROOT = Path(__file__).resolve().parents[1]
ZOOM_LEVELS = {"50%": 0.5, "100%": 1.0, "200%": 2.0, "400%": 4.0}
MANY_COLORS_WARNING_THRESHOLD = 100


def rel(path):
    try:
        return str(Path(path).resolve().relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        return str(path)


class ColorSeparatorGui(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Color Separator (isolate each color onto a black background)")
        self.geometry("1180x720")
        self.minsize(900, 560)

        self.source_path = None
        self.array = None  # H x W x 3 uint8
        self.colors = []  # list of (r, g, b, count)
        self._photo = None
        self.show_original_var = tk.BooleanVar(value=False)

        self._build_ui()

    # ---------------------------------------------------------------- UI ---

    def _build_ui(self):
        self.columnconfigure(0, weight=3)
        self.columnconfigure(1, weight=2)
        self.rowconfigure(1, weight=1)

        top = ttk.Frame(self, padding=8)
        top.grid(row=0, column=0, columnspan=2, sticky="ew")
        ttk.Button(top, text="Load Image...", command=self._load_image).pack(side="left")
        self.image_label = ttk.Label(top, text="(no image loaded)")
        self.image_label.pack(side="left", padx=(8, 0))

        ttk.Label(top, text="Zoom").pack(side="left", padx=(20, 0))
        self.zoom_var = tk.StringVar(value="100%")
        zoom_combo = ttk.Combobox(top, textvariable=self.zoom_var, values=list(ZOOM_LEVELS), width=6, state="readonly")
        zoom_combo.pack(side="left", padx=(4, 0))
        zoom_combo.bind("<<ComboboxSelected>>", lambda _e: self._redraw_canvas())

        ttk.Checkbutton(top, text="Show original (instead of isolated preview)", variable=self.show_original_var,
                        command=self._redraw_canvas).pack(side="left", padx=(20, 0))

        # canvas ------------------------------------------------------------
        canvas_frame = ttk.Frame(self)
        canvas_frame.grid(row=1, column=0, sticky="nsew", padx=(8, 4), pady=(0, 8))
        canvas_frame.rowconfigure(0, weight=1)
        canvas_frame.columnconfigure(0, weight=1)

        self.canvas = tk.Canvas(canvas_frame, background="#000000")
        vbar = ttk.Scrollbar(canvas_frame, orient="vertical", command=self.canvas.yview)
        hbar = ttk.Scrollbar(canvas_frame, orient="horizontal", command=self.canvas.xview)
        self.canvas.configure(yscrollcommand=vbar.set, xscrollcommand=hbar.set)
        self.canvas.grid(row=0, column=0, sticky="nsew")
        vbar.grid(row=0, column=1, sticky="ns")
        hbar.grid(row=1, column=0, sticky="ew")

        # side panel ----------------------------------------------------------
        side = ttk.Frame(self, padding=(4, 0, 8, 8))
        side.grid(row=1, column=1, sticky="nsew")
        side.rowconfigure(1, weight=1)
        side.columnconfigure(0, weight=1)

        ttk.Label(side, text="Colors found (select one or more)").grid(row=0, column=0, sticky="w")
        self.tree = ttk.Treeview(side, columns=("hex", "count", "percent"), show="headings", selectmode="extended")
        for col, text, width, anchor in [
            ("hex", "Color", 90, "center"),
            ("count", "Pixels", 90, "e"),
            ("percent", "%", 60, "e"),
        ]:
            self.tree.heading(col, text=text)
            self.tree.column(col, width=width, anchor=anchor)
        self.tree.grid(row=1, column=0, sticky="nsew")
        self.tree.bind("<<TreeviewSelect>>", lambda _e: self._redraw_canvas())

        scrollbar = ttk.Scrollbar(side, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)
        scrollbar.grid(row=1, column=1, sticky="ns")

        out_row = ttk.Frame(side, padding=(0, 8, 0, 4))
        out_row.grid(row=2, column=0, columnspan=2, sticky="ew")
        out_row.columnconfigure(1, weight=1)
        ttk.Label(out_row, text="Output Dir").grid(row=0, column=0, sticky="w")
        self.output_dir_var = tk.StringVar(value=str(ROOT / "tmp/color-separator"))
        ttk.Entry(out_row, textvariable=self.output_dir_var).grid(row=0, column=1, sticky="ew", padx=(4, 4))
        ttk.Button(out_row, text="...", width=3, command=self._browse_output_dir).grid(row=0, column=2)

        buttons = ttk.Frame(side)
        buttons.grid(row=3, column=0, columnspan=2, sticky="ew", pady=(4, 0))
        ttk.Button(buttons, text="Export Selected -> One File...", command=self._export_selected_combined).pack(fill="x")
        ttk.Button(buttons, text="Export Selected -> Separate Files", command=self._export_selected_separate).pack(fill="x", pady=(4, 0))
        ttk.Button(buttons, text="Export ALL Colors -> Separate Files", command=self._export_all_separate).pack(fill="x", pady=(4, 0))

        self.status_var = tk.StringVar(value="load an image to begin")
        ttk.Label(side, textvariable=self.status_var, foreground="#666666", wraplength=340).grid(
            row=4, column=0, columnspan=2, sticky="ew", pady=(8, 0)
        )

    def _browse_output_dir(self):
        chosen = filedialog.askdirectory(initialdir=self.output_dir_var.get() or str(ROOT))
        if chosen:
            self.output_dir_var.set(chosen)

    # ------------------------------------------------------------ loading ---

    def _load_image(self):
        path = filedialog.askopenfilename(
            initialdir=str(ROOT),
            filetypes=[("Images", "*.png *.bmp *.jpg *.jpeg *.gif *.tga"), ("All files", "*.*")],
        )
        if not path:
            return
        try:
            img = Image.open(path).convert("RGB")
        except Exception as exc:
            self._set_status(f"[error] could not open image: {exc}")
            return

        self.source_path = path
        self.array = np.array(img)
        self.image_label.configure(text=f"{rel(path)}  ({img.width}x{img.height})")
        self._build_color_list()
        self._redraw_canvas()

    def _build_color_list(self):
        self.tree.delete(*self.tree.get_children())
        flat = self.array.reshape(-1, 3)
        unique, counts = np.unique(flat, axis=0, return_counts=True)
        order = np.argsort(-counts)
        total = flat.shape[0]

        self.colors = []
        for idx in order:
            r, g, b = (int(v) for v in unique[idx])
            count = int(counts[idx])
            self.colors.append((r, g, b, count))
            hex_color = f"#{r:02x}{g:02x}{b:02x}"
            tag = hex_color
            self.tree.tag_configure(tag, background=hex_color)
            self.tree.insert("", "end", values=(hex_color, count, f"{count / total * 100:.2f}"), tags=(tag,))

        self._set_status(f"{len(self.colors)} unique color(s) found")

    # ------------------------------------------------------------ masking ---

    def _selected_colors(self):
        result = []
        for iid in self.tree.selection():
            hex_color = self.tree.item(iid, "values")[0]
            r = int(hex_color[1:3], 16)
            g = int(hex_color[3:5], 16)
            b = int(hex_color[5:7], 16)
            result.append((r, g, b))
        return result

    def _isolate(self, colors):
        output = np.zeros_like(self.array)
        for r, g, b in colors:
            mask = np.all(self.array == (r, g, b), axis=-1)
            output[mask] = (r, g, b)
        return output

    # ------------------------------------------------------------ preview ---

    def _redraw_canvas(self):
        if self.array is None:
            return
        if self.show_original_var.get():
            array = self.array
        else:
            colors = self._selected_colors()
            array = self._isolate(colors) if colors else np.zeros_like(self.array)

        image = Image.fromarray(array, "RGB")
        zoom = ZOOM_LEVELS[self.zoom_var.get()]
        if zoom != 1.0:
            image = image.resize((max(1, int(image.width * zoom)), max(1, int(image.height * zoom))), Image.NEAREST)

        self._photo = ImageTk.PhotoImage(image)
        self.canvas.delete("all")
        self.canvas.create_image(0, 0, anchor="nw", image=self._photo)
        self.canvas.configure(scrollregion=(0, 0, image.width, image.height))

    # ------------------------------------------------------------- export ---

    def _output_dir(self):
        out_dir = Path(self.output_dir_var.get())
        out_dir.mkdir(parents=True, exist_ok=True)
        return out_dir

    def _stem(self):
        return Path(self.source_path).stem if self.source_path else "image"

    def _export_selected_combined(self):
        colors = self._selected_colors()
        if not colors:
            self._set_status("[warn] no colors selected")
            return
        save_path = filedialog.asksaveasfilename(
            initialdir=str(self._output_dir()),
            initialfile=f"{self._stem()}-selected.png",
            defaultextension=".png",
            filetypes=[("PNG", "*.png"), ("All files", "*.*")],
        )
        if not save_path:
            return
        Image.fromarray(self._isolate(colors), "RGB").save(save_path)
        self._set_status(f"saved {rel(save_path)} ({len(colors)} color(s) combined)")

    def _export_selected_separate(self):
        colors = self._selected_colors()
        if not colors:
            self._set_status("[warn] no colors selected")
            return
        self._export_colors(colors)

    def _export_all_separate(self):
        colors = [(r, g, b) for r, g, b, _count in self.colors]
        if not colors:
            self._set_status("[warn] no image loaded")
            return
        if len(colors) > MANY_COLORS_WARNING_THRESHOLD:
            proceed = messagebox.askyesno(
                "Many colors",
                f"This image has {len(colors)} unique colors, which means {len(colors)} separate "
                "files will be written. Continue?",
            )
            if not proceed:
                return
        self._export_colors(colors)

    def _export_colors(self, colors):
        out_dir = self._output_dir()
        stem = self._stem()
        for r, g, b in colors:
            output = np.zeros_like(self.array)
            mask = np.all(self.array == (r, g, b), axis=-1)
            output[mask] = (r, g, b)
            out_path = out_dir / f"{stem}-{r:02x}{g:02x}{b:02x}.png"
            Image.fromarray(output, "RGB").save(out_path)
        self._set_status(f"wrote {len(colors)} file(s) to {rel(out_dir)}")

    def _set_status(self, text):
        self.status_var.set(text)


if __name__ == "__main__":
    app = ColorSeparatorGui()
    app.mainloop()
