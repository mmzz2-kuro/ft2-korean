#!/usr/bin/env python
# -*- coding: utf-8 -*-

from pathlib import Path
from tkinter import colorchooser, filedialog
import tkinter as tk
from tkinter import ttk

from PIL import Image, ImageColor, ImageDraw, ImageFont, ImageTk

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FONT = ROOT / "font" / "gulim.ttc"
ZOOM_LEVELS = {"50%": 0.5, "100%": 1.0, "200%": 2.0, "400%": 4.0}


def rel(path):
    try:
        return str(Path(path).resolve().relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        return str(path)


class ImageTextOverlayGui(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Image Text Overlay Tool")
        self.geometry("1200x760")
        self.minsize(900, 560)

        self.base_image = None
        self.source_path = None
        self.source_mode = "RGB"
        self.items = []  # list of dicts: text, font_path, font_index, size, color, x, y
        self.selected_index = None
        self.font_cache = {}
        self._photo = None

        self._build_ui()

    # ---------------------------------------------------------------- UI ---

    def _build_ui(self):
        self.columnconfigure(1, weight=1)
        self.rowconfigure(0, weight=1)

        side = ttk.Frame(self, padding=8)
        side.grid(row=0, column=0, sticky="ns")

        ttk.Button(side, text="Load Image...", command=self._load_image).pack(fill="x")
        self.image_label = ttk.Label(side, text="(no image loaded)")
        self.image_label.pack(fill="x", pady=(2, 10))

        ttk.Label(side, text="Text").pack(anchor="w")
        self.text_widget = tk.Text(side, height=4, width=32, wrap="word")
        self.text_widget.pack(fill="x", pady=(0, 8))
        self.text_widget.bind("<KeyRelease>", lambda _e: self._on_editor_change())

        font_row = ttk.Frame(side)
        font_row.pack(fill="x", pady=(0, 4))
        ttk.Label(font_row, text="Font").pack(side="left")
        self.font_path_var = tk.StringVar(value=str(DEFAULT_FONT))
        ttk.Entry(font_row, textvariable=self.font_path_var).pack(side="left", fill="x", expand=True, padx=(4, 4))
        ttk.Button(font_row, text="...", width=3, command=self._browse_font).pack(side="left")
        self.font_path_var.trace_add("write", lambda *_: self._on_editor_change())

        size_row = ttk.Frame(side)
        size_row.pack(fill="x", pady=(0, 4))
        ttk.Label(size_row, text="Size").pack(side="left")
        self.size_var = tk.StringVar(value="16")
        ttk.Spinbox(size_row, from_=1, to=999, width=6, textvariable=self.size_var,
                    command=self._on_editor_change).pack(side="left", padx=(4, 12))
        ttk.Label(size_row, text="TTC idx").pack(side="left")
        self.font_index_var = tk.StringVar(value="0")
        ttk.Spinbox(size_row, from_=0, to=32, width=4, textvariable=self.font_index_var,
                    command=self._on_editor_change).pack(side="left", padx=(4, 0))
        self.size_var.trace_add("write", lambda *_: self._on_editor_change())
        self.font_index_var.trace_add("write", lambda *_: self._on_editor_change())

        bold_row = ttk.Frame(side)
        bold_row.pack(fill="x", pady=(0, 4))
        self.bold_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(bold_row, text="Bold", variable=self.bold_var,
                        command=self._on_editor_change).pack(side="left")
        ttk.Label(bold_row, text="strength").pack(side="left", padx=(8, 0))
        self.bold_width_var = tk.StringVar(value="1")
        ttk.Spinbox(bold_row, from_=1, to=20, width=4, textvariable=self.bold_width_var,
                    command=self._on_editor_change).pack(side="left", padx=(4, 0))
        self.bold_width_var.trace_add("write", lambda *_: self._on_editor_change())

        self.antialias_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(bold_row, text="Anti-alias", variable=self.antialias_var,
                        command=self._on_editor_change).pack(side="left", padx=(12, 0))

        threshold_row = ttk.Frame(side)
        threshold_row.pack(fill="x", pady=(0, 4))
        self.threshold_mode_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(threshold_row, text="Pixel-perfect (threshold)", variable=self.threshold_mode_var,
                        command=self._on_editor_change).pack(side="left")

        threshold_opts = ttk.Frame(side)
        threshold_opts.pack(fill="x", pady=(0, 4))
        ttk.Label(threshold_opts, text="supersample").pack(side="left")
        self.supersample_var = tk.StringVar(value="4")
        ttk.Spinbox(threshold_opts, from_=1, to=8, width=4, textvariable=self.supersample_var,
                    command=self._on_editor_change).pack(side="left", padx=(4, 12))
        ttk.Label(threshold_opts, text="threshold").pack(side="left")
        self.threshold_var = tk.StringVar(value="64")
        ttk.Spinbox(threshold_opts, from_=1, to=254, width=5, textvariable=self.threshold_var,
                    command=self._on_editor_change).pack(side="left", padx=(4, 0))
        self.supersample_var.trace_add("write", lambda *_: self._on_editor_change())
        self.threshold_var.trace_add("write", lambda *_: self._on_editor_change())
        ttk.Label(side, text="(renders smooth at Nx size, box-filters down, then snaps to 1-bit --"
                              " avoids the mushy look plain AA-off has on dense Hangul glyphs."
                              " Lower threshold keeps more thin-stroke ink; raise it if text looks too fat)",
                  foreground="#666666", wraplength=280).pack(anchor="w", pady=(0, 4))

        ttk.Label(side, text="(faux bold via stroke; use a real bold font file for best results)",
                  foreground="#666666", wraplength=280).pack(anchor="w", pady=(0, 4))

        color_row = ttk.Frame(side)
        color_row.pack(fill="x", pady=(0, 4))
        ttk.Label(color_row, text="Color").pack(side="left")
        self.color_var = tk.StringVar(value="#000000")
        ttk.Entry(color_row, textvariable=self.color_var, width=12).pack(side="left", padx=(4, 4))
        self.color_swatch = tk.Label(color_row, width=2, relief="solid", borderwidth=1)
        self.color_swatch.pack(side="left", padx=(0, 4))
        ttk.Button(color_row, text="Pick...", command=self._pick_color).pack(side="left")
        self.color_var.trace_add("write", lambda *_: self._on_editor_change())

        pos_row = ttk.Frame(side)
        pos_row.pack(fill="x", pady=(0, 4))
        ttk.Label(pos_row, text="X").pack(side="left")
        self.x_var = tk.StringVar(value="0")
        ttk.Spinbox(pos_row, from_=-9999, to=9999, width=6, textvariable=self.x_var,
                    command=self._on_editor_change).pack(side="left", padx=(4, 12))
        ttk.Label(pos_row, text="Y").pack(side="left")
        self.y_var = tk.StringVar(value="0")
        ttk.Spinbox(pos_row, from_=-9999, to=9999, width=6, textvariable=self.y_var,
                    command=self._on_editor_change).pack(side="left", padx=(4, 0))
        self.x_var.trace_add("write", lambda *_: self._on_editor_change())
        self.y_var.trace_add("write", lambda *_: self._on_editor_change())

        ttk.Label(side, text="(click or drag on the image to set X/Y)", foreground="#666666").pack(anchor="w", pady=(0, 10))

        list_buttons = ttk.Frame(side)
        list_buttons.pack(fill="x", pady=(0, 4))
        ttk.Button(list_buttons, text="Add New Text", command=self._add_item).pack(fill="x")
        ttk.Button(list_buttons, text="Remove Selected", command=self._remove_selected).pack(fill="x", pady=(4, 0))

        ttk.Label(side, text="Placed Text").pack(anchor="w", pady=(10, 0))
        self.tree = ttk.Treeview(side, columns=("text", "size", "bold", "aa", "pp", "color", "x", "y"), show="headings", height=8)
        for col, text, width in [
            ("text", "Text", 90),
            ("size", "Sz", 30),
            ("bold", "B", 20),
            ("aa", "AA", 24),
            ("pp", "PP", 24),
            ("color", "Color", 60),
            ("x", "X", 40),
            ("y", "Y", 40),
        ]:
            self.tree.heading(col, text=text)
            self.tree.column(col, width=width, anchor="center" if col != "text" else "w")
        self.tree.pack(fill="both", expand=True)
        self.tree.bind("<<TreeviewSelect>>", self._on_tree_select)

        zoom_row = ttk.Frame(side)
        zoom_row.pack(fill="x", pady=(10, 0))
        ttk.Label(zoom_row, text="Zoom").pack(side="left")
        self.zoom_var = tk.StringVar(value="100%")
        zoom_combo = ttk.Combobox(zoom_row, textvariable=self.zoom_var, values=list(ZOOM_LEVELS), width=6, state="readonly")
        zoom_combo.pack(side="left", padx=(4, 0))
        zoom_combo.bind("<<ComboboxSelected>>", lambda _e: self._refresh_preview())

        ttk.Button(side, text="Save Image As...", command=self._save_image).pack(fill="x", pady=(10, 0))

        self.status_var = tk.StringVar(value="load an image to begin")
        ttk.Label(side, textvariable=self.status_var, foreground="#666666", wraplength=280).pack(fill="x", pady=(8, 0))

        canvas_frame = ttk.Frame(self)
        canvas_frame.grid(row=0, column=1, sticky="nsew")
        canvas_frame.rowconfigure(0, weight=1)
        canvas_frame.columnconfigure(0, weight=1)

        self.canvas = tk.Canvas(canvas_frame, background="#808080")
        vbar = ttk.Scrollbar(canvas_frame, orient="vertical", command=self.canvas.yview)
        hbar = ttk.Scrollbar(canvas_frame, orient="horizontal", command=self.canvas.xview)
        self.canvas.configure(yscrollcommand=vbar.set, xscrollcommand=hbar.set)
        self.canvas.grid(row=0, column=0, sticky="nsew")
        vbar.grid(row=0, column=1, sticky="ns")
        hbar.grid(row=1, column=0, sticky="ew")

        self.canvas.bind("<Button-1>", self._on_canvas_click)
        self.canvas.bind("<B1-Motion>", self._on_canvas_click)

    # ----------------------------------------------------------- actions ---

    def _browse_font(self):
        chosen = filedialog.askopenfilename(
            initialdir=str(Path(self.font_path_var.get()).parent),
            filetypes=[("Fonts", "*.ttf *.ttc *.otf"), ("All files", "*.*")],
        )
        if chosen:
            self.font_path_var.set(chosen)

    def _pick_color(self):
        current = self.color_var.get().strip()
        try:
            initial_rgb = ImageColor.getcolor(current, "RGB")
        except ValueError:
            initial_rgb = (0, 0, 0)
        _, hex_color = colorchooser.askcolor(color=initial_rgb, parent=self)
        if hex_color:
            self.color_var.set(hex_color)

    def _load_image(self):
        path = filedialog.askopenfilename(
            initialdir=str(ROOT),
            filetypes=[("Images", "*.png *.bmp *.jpg *.jpeg *.gif *.tga"), ("All files", "*.*")],
        )
        if not path:
            return
        try:
            img = Image.open(path)
            img.load()
        except Exception as exc:
            self._set_status(f"[error] could not open image: {exc}")
            return

        self.source_path = path
        self.source_mode = img.mode
        self.base_image = img
        self.items = []
        self.selected_index = None
        self.tree.delete(*self.tree.get_children())
        self.image_label.configure(text=f"{rel(path)}  ({img.width}x{img.height}, {img.mode})")
        self._set_status(f"loaded {rel(path)}")
        self._refresh_preview()

    def _editor_item(self):
        try:
            size = int(self.size_var.get())
            font_index = int(self.font_index_var.get() or 0)
            x = int(float(self.x_var.get()))
            y = int(float(self.y_var.get()))
            bold_width = int(self.bold_width_var.get() or 1)
            supersample = int(self.supersample_var.get() or 4)
            threshold = int(self.threshold_var.get() or 64)
        except ValueError:
            return None
        text = self.text_widget.get("1.0", "end-1c")
        return {
            "text": text,
            "font_path": self.font_path_var.get().strip(),
            "font_index": font_index,
            "size": size,
            "bold": bool(self.bold_var.get()),
            "bold_width": bold_width,
            "antialias": bool(self.antialias_var.get()),
            "threshold_mode": bool(self.threshold_mode_var.get()),
            "supersample": supersample,
            "threshold": threshold,
            "color": self.color_var.get().strip(),
            "x": x,
            "y": y,
        }

    def _load_editor_from_item(self, item):
        self.text_widget.delete("1.0", "end")
        self.text_widget.insert("1.0", item["text"])
        self.font_path_var.set(item["font_path"])
        self.font_index_var.set(str(item["font_index"]))
        self.size_var.set(str(item["size"]))
        self.bold_var.set(item.get("bold", False))
        self.bold_width_var.set(str(item.get("bold_width", 1)))
        self.antialias_var.set(item.get("antialias", True))
        self.threshold_mode_var.set(item.get("threshold_mode", False))
        self.supersample_var.set(str(item.get("supersample", 4)))
        self.threshold_var.set(str(item.get("threshold", 64)))
        self.color_var.set(item["color"])
        self.x_var.set(str(item["x"]))
        self.y_var.set(str(item["y"]))

    def _add_item(self):
        item = self._editor_item()
        if not item or not item["text"]:
            self._set_status("[warn] text is empty -- nothing to add")
            return
        self.items.append(item)
        self.tree.insert("", "end", values=self._tree_values(item))
        self.selected_index = None
        self.tree.selection_remove(*self.tree.selection())
        self.text_widget.delete("1.0", "end")
        self.text_widget.focus_set()
        self._refresh_preview()

    def _remove_selected(self):
        if self.selected_index is None:
            return
        del self.items[self.selected_index]
        self.tree.delete(self.tree.get_children()[self.selected_index])
        self.selected_index = None
        self._refresh_preview()

    def _on_tree_select(self, _event=None):
        selection = self.tree.selection()
        if not selection:
            self.selected_index = None
            return
        self.selected_index = self.tree.index(selection[0])
        self._load_editor_from_item(self.items[self.selected_index])
        self._refresh_preview()

    def _tree_values(self, item):
        preview = item["text"].replace("\n", "\\n")
        if len(preview) > 14:
            preview = preview[:14] + "..."
        return (
            preview,
            item["size"],
            "Y" if item.get("bold") else "",
            "Y" if item.get("antialias", True) else "",
            "Y" if item.get("threshold_mode") else "",
            item["color"],
            item["x"],
            item["y"],
        )

    def _on_editor_change(self):
        if self.selected_index is not None:
            item = self._editor_item()
            if item is None:
                return
            self.items[self.selected_index] = item
            iid = self.tree.get_children()[self.selected_index]
            self.tree.item(iid, values=self._tree_values(item))
        self._update_color_swatch()
        self._refresh_preview()

    def _update_color_swatch(self):
        try:
            rgb = ImageColor.getcolor(self.color_var.get().strip(), "RGB")
            self.color_swatch.configure(background="#%02x%02x%02x" % rgb)
        except ValueError:
            pass

    def _on_canvas_click(self, event):
        if self.base_image is None:
            return
        zoom = ZOOM_LEVELS[self.zoom_var.get()]
        x = int(self.canvas.canvasx(event.x) / zoom)
        y = int(self.canvas.canvasy(event.y) / zoom)
        self.x_var.set(str(x))
        self.y_var.set(str(y))

    # ----------------------------------------------------------- render ---

    def _get_font(self, path, size, index):
        key = (path, size, index)
        if key in self.font_cache:
            return self.font_cache[key]
        try:
            font = ImageFont.truetype(path, size=size, index=index)
        except Exception as exc:
            self._set_status(f"[error] font: {exc}")
            return None
        self.font_cache[key] = font
        return font

    def _parse_color(self, text):
        try:
            return ImageColor.getcolor(text.strip(), "RGBA")
        except ValueError as exc:
            self._set_status(f"[error] color: {exc}")
            return None

    def _draw_item(self, overlay, draw, item):
        if not item["text"]:
            return
        if item.get("threshold_mode"):
            self._draw_item_threshold(overlay, item)
        else:
            self._draw_item_plain(draw, item)

    def _draw_item_plain(self, draw, item):
        font = self._get_font(item["font_path"], item["size"], item["font_index"])
        if font is None:
            return
        color = self._parse_color(item["color"])
        if color is None:
            return
        stroke_width = item.get("bold_width", 1) if item.get("bold") else 0
        draw.fontmode = "L" if item.get("antialias", True) else "1"
        draw.text(
            (item["x"], item["y"]),
            item["text"],
            font=font,
            fill=color,
            stroke_width=stroke_width,
            stroke_fill=color if stroke_width else None,
        )

    def _draw_item_threshold(self, overlay, item):
        # Point-sampling an antialiased render (or forcing 1-bit rendering
        # directly) produces jagged, mushy strokes on dense Hangul glyphs.
        # Render at Nx size with normal AA, box-filter back down, then snap
        # to 1-bit -- same technique as scripts/render-text-to-1bpp-pbm.ps1.
        font = self._get_font(item["font_path"], item["size"], item["font_index"])
        if font is None:
            return
        color = self._parse_color(item["color"])
        if color is None:
            return
        supersample = max(1, item.get("supersample", 4))
        threshold = min(254, max(1, item.get("threshold", 128)))
        stroke_width = item.get("bold_width", 1) if item.get("bold") else 0

        spacing = 4
        measurer = ImageDraw.Draw(Image.new("L", (1, 1)))
        left, top, right, bottom = measurer.textbbox(
            (0, 0), item["text"], font=font, stroke_width=stroke_width, spacing=spacing
        )
        pad = stroke_width + 2
        patch_w = (right - left) + pad * 2
        patch_h = (bottom - top) + pad * 2
        if patch_w <= 0 or patch_h <= 0:
            return

        font_super = self._get_font(item["font_path"], item["size"] * supersample, item["font_index"])
        if font_super is None:
            return

        patch_super = Image.new("L", (patch_w * supersample, patch_h * supersample), 0)
        draw_super = ImageDraw.Draw(patch_super)
        draw_super.fontmode = "L"
        draw_super.text(
            (pad * supersample - left * supersample, pad * supersample - top * supersample),
            item["text"],
            font=font_super,
            fill=255,
            stroke_width=stroke_width * supersample,
            stroke_fill=255 if stroke_width else None,
            spacing=spacing * supersample,
        )

        coverage = patch_super.resize((patch_w, patch_h), Image.BOX)
        coverage = coverage.point(lambda a: 255 if a >= threshold else 0)

        colored = Image.new("RGBA", (patch_w, patch_h), color[:3] + (0,))
        colored.putalpha(coverage.point(lambda a: (a * color[3]) // 255))

        overlay.paste(colored, (item["x"] + left - pad, item["y"] + top - pad), colored)

    def _compose(self):
        if self.base_image is None:
            return None
        base_rgba = self.base_image.convert("RGBA")
        overlay = Image.new("RGBA", base_rgba.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        for item in self.items:
            self._draw_item(overlay, draw, item)
        if self.selected_index is None:
            pending = self._editor_item()
            if pending:
                self._draw_item(overlay, draw, pending)
        return Image.alpha_composite(base_rgba, overlay)

    def _refresh_preview(self):
        composite = self._compose()
        if composite is None:
            return
        zoom = ZOOM_LEVELS[self.zoom_var.get()]
        w, h = composite.size
        if zoom != 1.0:
            composite = composite.resize((max(1, int(w * zoom)), max(1, int(h * zoom))), Image.NEAREST)
        self._photo = ImageTk.PhotoImage(composite)
        self.canvas.delete("all")
        self.canvas.create_image(0, 0, anchor="nw", image=self._photo)
        self.canvas.configure(scrollregion=(0, 0, composite.width, composite.height))

    def _set_status(self, text):
        self.status_var.set(text)

    # ------------------------------------------------------------- save ---

    def _save_image(self):
        if self.base_image is None:
            self._set_status("[warn] no image loaded")
            return
        composite = self._compose()
        if composite is None:
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

        out = composite
        if Path(save_path).suffix.lower() in (".bmp", ".jpg", ".jpeg") or "A" not in self.source_mode:
            out = out.convert("RGB")
        out.save(save_path)
        self._set_status(f"saved {rel(save_path)}")


if __name__ == "__main__":
    app = ImageTextOverlayGui()
    app.mainloop()
