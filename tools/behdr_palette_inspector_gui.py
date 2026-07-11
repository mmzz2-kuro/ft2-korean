#!/usr/bin/env python
# -*- coding: utf-8 -*-

import importlib.util
import queue
import subprocess
import threading
from collections import Counter
from pathlib import Path
from tkinter import filedialog, ttk
import tkinter as tk

from PIL import Image, ImageTk

ROOT = Path(__file__).resolve().parents[1]
ZOOM_LEVELS = {"50%": 0.5, "100%": 1.0, "200%": 2.0, "400%": 4.0}

_spec = importlib.util.spec_from_file_location("colorize_behdr_pgm", ROOT / "scripts" / "colorize-behdr-pgm.py")
colorize_behdr_pgm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(colorize_behdr_pgm)


def rel(path):
    try:
        return str(Path(path).resolve().relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        return str(path)


def describe_index(value):
    if value == 0:
        return "black / empty"
    if value == 1:
        return "text OUTLINE ink"
    if value == 2:
        return "text FILL ink"
    if value == 3:
        return "erase remnant / stray pixel"
    if value == 4:
        return "normal background"
    if 224 <= value <= 232:
        return "animated glow-gradient family"
    if value in colorize_behdr_pgm.TRIM_VALUES:
        return "border/frame trim marker"
    return "unknown -- real color not modeled by this toolchain"


class BehdrPaletteInspectorGui(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("be-hdr UI Palette Index Inspector")
        self.geometry("1240x760")
        self.minsize(980, 560)

        self.log_queue = queue.Queue()
        self.width = None
        self.height = None
        self.pixels = None
        self._photo = None
        self._drag_start = None
        self._selection_canvas_item = None

        self.vars = {
            "dat": tk.StringVar(value=str(ROOT / "ps1/SLPS-01903/FS2_FILE.DAT")),
            "exe": tk.StringVar(value=str(ROOT / "ps1/SLPS-01903/SLPS_019.03")),
            "work_dir": tk.StringVar(value=str(ROOT / "tmp/SLPS-01903/palette-inspector")),
            "resource_id": tk.StringVar(value="1201"),
        }

        self._build_ui()
        self.after(100, self._drain_log_queue)

    # ---------------------------------------------------------------- UI ---

    def _build_ui(self):
        self.columnconfigure(0, weight=3)
        self.columnconfigure(1, weight=2)
        self.rowconfigure(1, weight=1)

        top = ttk.Frame(self, padding=8)
        top.grid(row=0, column=0, columnspan=2, sticky="ew")
        top.columnconfigure(1, weight=1)

        rows = [
            ("FS2_FILE.DAT", "dat", "file"),
            ("SLPS_019.03", "exe", "file"),
            ("Work Dir", "work_dir", "dir"),
        ]
        for r, (label, key, kind) in enumerate(rows):
            ttk.Label(top, text=label).grid(row=r, column=0, sticky="w", padx=(0, 4), pady=2)
            ttk.Entry(top, textvariable=self.vars[key]).grid(row=r, column=1, sticky="ew", padx=(0, 4), pady=2)
            ttk.Button(top, text="...", width=3, command=lambda k=key, t=kind: self._browse(k, t)).grid(row=r, column=2, sticky="ew", pady=2)

        controls = ttk.Frame(top)
        controls.grid(row=3, column=0, columnspan=3, sticky="ew", pady=(6, 0))
        ttk.Label(controls, text="Resource ID").pack(side="left")
        ttk.Entry(controls, textvariable=self.vars["resource_id"], width=10).pack(side="left", padx=(4, 12))
        ttk.Button(controls, text="Inspect", command=self.inspect).pack(side="left")
        ttk.Label(controls, text="Zoom").pack(side="left", padx=(16, 0))
        self.zoom_var = tk.StringVar(value="200%")
        zoom_combo = ttk.Combobox(controls, textvariable=self.zoom_var, values=list(ZOOM_LEVELS), width=6, state="readonly")
        zoom_combo.pack(side="left", padx=(4, 0))
        zoom_combo.bind("<<ComboboxSelected>>", lambda _e: self._redraw_canvas())
        ttk.Button(controls, text="Save Colorized PNG...", command=self._save_colorized).pack(side="left", padx=(16, 0))

        # canvas ------------------------------------------------------------
        canvas_frame = ttk.Frame(self)
        canvas_frame.grid(row=1, column=0, sticky="nsew", padx=(8, 4), pady=(0, 8))
        canvas_frame.rowconfigure(0, weight=1)
        canvas_frame.columnconfigure(0, weight=1)

        self.canvas = tk.Canvas(canvas_frame, background="#202020")
        vbar = ttk.Scrollbar(canvas_frame, orient="vertical", command=self.canvas.yview)
        hbar = ttk.Scrollbar(canvas_frame, orient="horizontal", command=self.canvas.xview)
        self.canvas.configure(yscrollcommand=vbar.set, xscrollcommand=hbar.set)
        self.canvas.grid(row=0, column=0, sticky="nsew")
        vbar.grid(row=0, column=1, sticky="ns")
        hbar.grid(row=1, column=0, sticky="ew")

        self.canvas.bind("<ButtonPress-1>", self._on_drag_start)
        self.canvas.bind("<B1-Motion>", self._on_drag_move)
        self.canvas.bind("<ButtonRelease-1>", self._on_drag_end)

        self.pixel_status_var = tk.StringVar(value="click or drag on the image to inspect indexes")
        ttk.Label(canvas_frame, textvariable=self.pixel_status_var, foreground="#333333").grid(
            row=2, column=0, columnspan=2, sticky="w", pady=(4, 0)
        )

        # side panel ----------------------------------------------------------
        side = ttk.Frame(self, padding=(4, 0, 8, 8))
        side.grid(row=1, column=1, sticky="nsew")
        side.rowconfigure(1, weight=1)
        side.rowconfigure(3, weight=1)
        side.columnconfigure(0, weight=1)

        ttk.Label(side, text="Whole-image index histogram").grid(row=0, column=0, sticky="w")
        self.full_tree = self._make_histogram_tree(side)
        self.full_tree.grid(row=1, column=0, sticky="nsew", pady=(0, 8))

        ttk.Label(side, text="Selected-region index histogram").grid(row=2, column=0, sticky="w")
        self.region_tree = self._make_histogram_tree(side)
        self.region_tree.grid(row=3, column=0, sticky="nsew", pady=(0, 8))

        note = (
            "Swatches/colors above are this toolchain's fixed DEBUG legend, not the "
            "real in-game CLUT (which this project does not decode). \"unknown\" indexes "
            "may still render as a distinct, possibly animated, color in the real game."
        )
        ttk.Label(side, text=note, foreground="#666666", wraplength=380, justify="left").grid(
            row=4, column=0, sticky="ew", pady=(0, 8)
        )

        self.log = tk.Text(side, height=8, wrap="word")
        self.log.grid(row=5, column=0, sticky="nsew")

    def _make_histogram_tree(self, parent):
        tree = ttk.Treeview(parent, columns=("index", "count", "percent", "category"), show="headings", height=8)
        for col, text, width, anchor in [
            ("index", "Index", 50, "center"),
            ("count", "Count", 70, "e"),
            ("percent", "%", 55, "e"),
            ("category", "Category", 220, "w"),
        ]:
            tree.heading(col, text=text)
            tree.column(col, width=width, anchor=anchor, stretch=(col == "category"))
        return tree

    # ------------------------------------------------------------ actions ---

    def _browse(self, key, kind):
        current = self.vars[key].get()
        initial = str(Path(current).parent if current else ROOT)
        if kind == "dir":
            chosen = filedialog.askdirectory(initialdir=initial)
        else:
            chosen = filedialog.askopenfilename(initialdir=initial)
        if chosen:
            self.vars[key].set(chosen)

    def inspect(self):
        resource_id = self.vars["resource_id"].get().strip()
        if not resource_id.isdigit():
            self._append_log("[error] resource ID must be a number\n")
            return

        work_dir = Path(self.vars["work_dir"].get())
        work_dir.mkdir(parents=True, exist_ok=True)
        cmd = [
            "node",
            str(ROOT / "scripts/be-hdr-ui-tile-tool.js"),
            "dump-raw",
            self.vars["dat"].get(),
            self.vars["exe"].get(),
            str(work_dir),
            resource_id,
        ]
        self._append_log(f"\n## dump-raw resource {resource_id}\n{' '.join(cmd)}\n")

        def worker():
            try:
                proc = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
                for line in proc.stdout:
                    self.log_queue.put(("log", line))
                code = proc.wait()
                self.log_queue.put(("log", f"[exit {code}]\n"))
                if code == 0:
                    pgm_path = work_dir / f"be-hdr-ui-{resource_id}-raw.pgm"
                    self.log_queue.put(("loaded", str(pgm_path)))
            except Exception as exc:
                self.log_queue.put(("log", f"[error] {exc}\n"))

        threading.Thread(target=worker, daemon=True).start()

    def _load_pgm(self, path):
        width, height, pixels = colorize_behdr_pgm.read_pgm(path)
        self.width, self.height, self.pixels = width, height, pixels
        self._append_log(f"loaded {rel(path)} ({width}x{height})\n")
        self._redraw_canvas()
        self._fill_histogram(self.full_tree, pixels)
        self.region_tree.delete(*self.region_tree.get_children())
        self.pixel_status_var.set("click or drag on the image to inspect indexes")

    def _fill_histogram(self, tree, pixel_values):
        tree.delete(*tree.get_children())
        total = len(pixel_values)
        if total == 0:
            return
        counts = Counter(pixel_values)
        for value, count in counts.most_common():
            percent = count / total * 100
            tree.insert("", "end", values=(value, count, f"{percent:.1f}", describe_index(value)))

    def _redraw_canvas(self):
        if self.pixels is None:
            return
        image = Image.new("RGB", (self.width, self.height))
        image.putdata([colorize_behdr_pgm.colorize(v) for v in self.pixels])
        zoom = ZOOM_LEVELS[self.zoom_var.get()]
        if zoom != 1.0:
            image = image.resize((max(1, int(self.width * zoom)), max(1, int(self.height * zoom))), Image.NEAREST)
        self._photo = ImageTk.PhotoImage(image)
        self.canvas.delete("all")
        self.canvas.create_image(0, 0, anchor="nw", image=self._photo)
        self.canvas.configure(scrollregion=(0, 0, image.width, image.height))
        self._selection_canvas_item = None

    def _canvas_to_image_coords(self, event):
        zoom = ZOOM_LEVELS[self.zoom_var.get()]
        x = int(self.canvas.canvasx(event.x) / zoom)
        y = int(self.canvas.canvasy(event.y) / zoom)
        x = max(0, min(self.width - 1, x)) if self.width else 0
        y = max(0, min(self.height - 1, y)) if self.height else 0
        return x, y

    def _on_drag_start(self, event):
        if self.pixels is None:
            return
        self._drag_start = self._canvas_to_image_coords(event)
        self._update_selection_rect(self._drag_start, self._drag_start)

    def _on_drag_move(self, event):
        if self.pixels is None or self._drag_start is None:
            return
        current = self._canvas_to_image_coords(event)
        self._update_selection_rect(self._drag_start, current)

    def _on_drag_end(self, event):
        if self.pixels is None or self._drag_start is None:
            return
        current = self._canvas_to_image_coords(event)
        x0, y0 = self._drag_start
        x1, y1 = current
        left, right = sorted((x0, x1))
        top, bottom = sorted((y0, y1))
        self._report_region(left, top, right, bottom)
        self._drag_start = None

    def _update_selection_rect(self, start, current):
        zoom = ZOOM_LEVELS[self.zoom_var.get()]
        x0, y0 = start
        x1, y1 = current
        left, right = sorted((x0, x1))
        top, bottom = sorted((y0, y1))
        coords = (left * zoom, top * zoom, (right + 1) * zoom, (bottom + 1) * zoom)
        if self._selection_canvas_item is None:
            self._selection_canvas_item = self.canvas.create_rectangle(*coords, outline="#00ff00", width=2)
        else:
            self.canvas.coords(self._selection_canvas_item, *coords)

    def _report_region(self, left, top, right, bottom):
        values = []
        for y in range(top, bottom + 1):
            row_off = y * self.width
            values.extend(self.pixels[row_off + left:row_off + right + 1])
        self._fill_histogram(self.region_tree, values)

        w, h = right - left + 1, bottom - top + 1
        if w == 1 and h == 1:
            value = values[0]
            self.pixel_status_var.set(f"({left},{top}) = index {value}  --  {describe_index(value)}")
        else:
            self.pixel_status_var.set(f"region ({left},{top}) to ({right},{bottom})  [{w}x{h}, {len(values)} px]")

    def _save_colorized(self):
        if self.pixels is None:
            self._append_log("[warn] nothing loaded yet\n")
            return
        save_path = filedialog.asksaveasfilename(
            initialdir=str(self.vars["work_dir"].get()),
            initialfile=f"be-hdr-ui-{self.vars['resource_id'].get().strip()}-colorized.png",
            defaultextension=".png",
            filetypes=[("PNG", "*.png"), ("All files", "*.*")],
        )
        if not save_path:
            return
        image = Image.new("RGB", (self.width, self.height))
        image.putdata([colorize_behdr_pgm.colorize(v) for v in self.pixels])
        image.save(save_path)
        self._append_log(f"saved {rel(save_path)}\n")

    def _append_log(self, text):
        self.log.insert("end", text)
        self.log.see("end")

    def _drain_log_queue(self):
        while True:
            try:
                kind, payload = self.log_queue.get_nowait()
            except queue.Empty:
                break
            if kind == "log":
                self._append_log(payload)
            elif kind == "loaded":
                self._load_pgm(payload)
        self.after(100, self._drain_log_queue)


if __name__ == "__main__":
    app = BehdrPaletteInspectorGui()
    app.mainloop()
