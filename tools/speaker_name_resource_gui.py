#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""Browse and patch the 8bpp dialogue speaker-name resources in FS2_FILE.DAT."""

import json
import struct
import subprocess
import tempfile
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
import tkinter as tk

from PIL import Image, ImageTk


ROOT = Path(__file__).resolve().parents[1]
STATE_PATH = ROOT / "tmp/.gui-state/speaker_name_resource_gui.json"
DEFAULT_DAT = ROOT / "ps1/SLPS-01903/FS2_FILE.DAT"
DEFAULT_EXE = ROOT / "ps1/SLPS-01903/SLPS_019.03"

FIRST_ID = 4277
LAST_ID = 4449
FS2_LBA = 223
FS2_SECTORS = 119472
SECTOR_SIZE = 2352
USER_OFFSET = 24
USER_SIZE = 2048
FS2_SIZE = FS2_SECTORS * USER_SIZE
WIDTH = 72
HEIGHT = 48
ROW_BYTES = WIDTH
PIXEL_BYTES = ROW_BYTES * HEIGHT  # 0xd80

# Exact indices matter. Vanilla names use 0x01 for the soft edge and 0x4D for
# the main stroke; index 0 is transparent before the runtime changes it to 0xFE.
PALETTE_RGB = [(i, i, i) for i in range(256)]
PALETTE_RGB[1] = (150, 150, 150)
PALETTE_RGB[0x4D] = (0, 0, 0)


def rel(path):
    try:
        return str(Path(path).resolve().relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        return str(path)


def load_state():
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_state(data):
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def read_fs2_payload(path):
    path = Path(path)
    size = path.stat().st_size
    if size == FS2_SIZE:
        return path.read_bytes(), "dat"

    required = (FS2_LBA + FS2_SECTORS) * SECTOR_SIZE
    if size < required:
        raise ValueError(
            f"{path.name} is neither a {FS2_SIZE}-byte FS2_FILE.DAT nor a raw BIN "
            f"large enough to contain FS2 at LBA {FS2_LBA}"
        )

    payload = bytearray(FS2_SIZE)
    with path.open("rb") as source:
        source.seek(FS2_LBA * SECTOR_SIZE)
        for sector in range(FS2_SECTORS):
            raw = source.read(SECTOR_SIZE)
            if len(raw) != SECTOR_SIZE:
                raise ValueError(f"unexpected EOF at FS2 sector {sector}")
            dst = sector * USER_SIZE
            payload[dst : dst + USER_SIZE] = raw[USER_OFFSET : USER_OFFSET + USER_SIZE]
    return bytes(payload), "bin"


def resource_ranges(exe_bytes):
    load_addr = struct.unpack_from("<I", exe_bytes, 0x18)[0]
    table_off = 0x801C4F68 - load_addr + 0x800
    ranges = {}
    for resource_id in range(FIRST_ID, LAST_ID + 1):
        start_sector = struct.unpack_from("<H", exe_bytes, table_off + resource_id * 2)[0]
        end_sector = struct.unpack_from("<H", exe_bytes, table_off + (resource_id + 1) * 2)[0]
        ranges[resource_id] = (start_sector * 0x800, (end_sector - start_sector) * 0x800)
    return ranges


def decode_8bpp(chunk):
    if len(chunk) < PIXEL_BYTES:
        chunk = chunk + bytes(PIXEL_BYTES - len(chunk))
    return bytearray(chunk[:PIXEL_BYTES])


def encode_8bpp(indices):
    if len(indices) != WIDTH * HEIGHT:
        raise ValueError(f"expected {WIDTH}x{HEIGHT} pixels")
    return bytes(indices)


def indexed_image(indices):
    image = Image.frombytes("P", (WIDTH, HEIGHT), bytes(indices))
    palette = []
    for rgb in PALETTE_RGB:
        palette.extend(rgb)
    palette.extend([0] * (768 - len(palette)))
    image.putpalette(palette)
    image.info["transparency"] = 0
    return image


def editing_image(indices):
    """Return the editing format: original white/gray ink on black."""
    rgba = bytearray(WIDTH * HEIGHT * 4)
    for i, value in enumerate(indices):
        if value == 0x4D:
            color = b"\xff\xff\xff\xff"
        elif value == 0x01:
            color = b"\x78\x78\x78\xff"
        else:
            color = b"\x00\x00\x00\xff"
        rgba[i * 4 : i * 4 + 4] = color
    return Image.frombytes("RGBA", (WIDTH, HEIGHT), bytes(rgba))


def bbox_and_indices(indices):
    xs, ys, used = [], [], set()
    for y in range(HEIGHT):
        for x in range(WIDTH):
            value = indices[y * WIDTH + x]
            if value:
                xs.append(x)
                ys.append(y)
                used.add(value)
    if not xs:
        return "empty", "-"
    bbox = f"{min(xs)},{min(ys)}-{max(xs)},{max(ys)}"
    return bbox, ",".join(str(v) for v in sorted(used))


def read_import_indices(path):
    image = Image.open(path)
    if image.size != (WIDTH, HEIGHT):
        raise ValueError(f"PNG must be exactly {WIDTH}x{HEIGHT}; got {image.width}x{image.height}")

    # Older exact-index exports remain accepted for compatibility.
    if image.mode == "P":
        values = bytearray(image.getdata())
        if 0x4D in values and set(values).issubset({0, 0x01, 0x4D}):
            return values

    # Normal editing path: black background, gray edge, white main stroke.
    # A transparent background from an older export is also accepted.
    rgba = image.convert("RGBA")
    values = bytearray(WIDTH * HEIGHT)
    for i, (r, g, b, a) in enumerate(rgba.getdata()):
        if a < 16:
            values[i] = 0
            continue
        luminance = (r * 299 + g * 587 + b * 114) // 1000
        if luminance < 32:
            values[i] = 0
        elif luminance <= 200:
            values[i] = 0x01
        else:
            values[i] = 0x4D
    return values


class SpeakerNameResourceGui(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("SLPS-01903 Speaker Name Resource Browser")
        self.geometry("1180x760")
        self.minsize(940, 620)

        state = load_state()
        self.dat_var = tk.StringVar(value=state.get("dat", str(DEFAULT_DAT)))
        self.exe_var = tk.StringVar(value=state.get("exe", str(DEFAULT_EXE)))
        self.filter_var = tk.StringVar(value="non-empty")
        self.status_var = tk.StringVar(value="Load FS2_FILE.DAT to scan speaker-name resources.")

        self.dat_bytes = None
        self.ranges = {}
        self.records = []
        self.working = {}
        self.input_mode = None
        self._photo = None
        self._build_ui()

    def _build_ui(self):
        self.columnconfigure(0, weight=1)
        self.rowconfigure(2, weight=1)

        paths = ttk.Frame(self, padding=8)
        paths.grid(row=0, column=0, sticky="ew")
        paths.columnconfigure(1, weight=1)
        ttk.Label(paths, text="FS2_FILE.DAT / raw BIN").grid(row=0, column=0, sticky="w")
        ttk.Entry(paths, textvariable=self.dat_var).grid(row=0, column=1, sticky="ew", padx=6)
        ttk.Button(paths, text="Browse...", command=self._browse_dat).grid(row=0, column=2)
        ttk.Label(paths, text="SLPS_019.03").grid(row=1, column=0, sticky="w", pady=(6, 0))
        ttk.Entry(paths, textvariable=self.exe_var).grid(row=1, column=1, sticky="ew", padx=6, pady=(6, 0))
        ttk.Button(paths, text="Browse...", command=self._browse_exe).grid(row=1, column=2, pady=(6, 0))

        actions = ttk.Frame(self, padding=(8, 0, 8, 8))
        actions.grid(row=1, column=0, sticky="ew")
        ttk.Button(actions, text="Load / Rescan", command=self.load_resources).pack(side="left")
        ttk.Label(actions, text="Show").pack(side="left", padx=(18, 4))
        combo = ttk.Combobox(actions, textvariable=self.filter_var, values=("non-empty", "all", "modified"), width=11, state="readonly")
        combo.pack(side="left")
        combo.bind("<<ComboboxSelected>>", lambda _e: self._populate_tree())
        ttk.Button(actions, text="Export Selected PNG...", command=self.export_selected).pack(side="left", padx=(18, 0))
        ttk.Button(actions, text="Export All Visible...", command=self.export_visible).pack(side="left", padx=(4, 0))
        ttk.Button(actions, text="Import Replacement PNG...", command=self.import_replacement).pack(side="left", padx=(4, 0))
        ttk.Button(actions, text="Reset Selected", command=self.reset_selected).pack(side="left", padx=(4, 0))
        ttk.Button(actions, text="Save Patched DAT / BIN...", command=self.save_patched).pack(side="right")

        body = ttk.Panedwindow(self, orient="horizontal")
        body.grid(row=2, column=0, sticky="nsew", padx=8)

        left = ttk.Frame(body)
        left.rowconfigure(0, weight=1)
        left.columnconfigure(0, weight=1)
        columns = ("id", "offset", "size", "bbox", "indices", "state")
        self.tree = ttk.Treeview(left, columns=columns, show="headings", selectmode="browse")
        headings = {"id": "Resource ID", "offset": "DAT offset", "size": "Size", "bbox": "Ink bbox", "indices": "Indices", "state": "State"}
        widths = {"id": 88, "offset": 105, "size": 72, "bbox": 115, "indices": 90, "state": 80}
        for col in columns:
            self.tree.heading(col, text=headings[col])
            self.tree.column(col, width=widths[col], anchor="center")
        scroll = ttk.Scrollbar(left, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scroll.set)
        self.tree.grid(row=0, column=0, sticky="nsew")
        scroll.grid(row=0, column=1, sticky="ns")
        self.tree.bind("<<TreeviewSelect>>", lambda _e: self._show_selected())
        body.add(left, weight=3)

        right = ttk.Frame(body, padding=(12, 0, 0, 0))
        right.columnconfigure(0, weight=1)
        right.rowconfigure(1, weight=1)
        self.info_label = ttk.Label(right, text="Select a resource", justify="left")
        self.info_label.grid(row=0, column=0, sticky="w", pady=(0, 8))
        self.canvas = tk.Canvas(right, width=576, height=384, background="#ffffff", highlightthickness=1)
        self.canvas.grid(row=1, column=0, sticky="nsew")
        ttk.Label(
            right,
            text="PNG editing: 72x48, black background + original white/gray ink.\nBlack=background, gray=shadow, white=main stroke. Resource 4278 is コック.",
            foreground="#666666",
            justify="left",
        ).grid(row=2, column=0, sticky="w", pady=(8, 0))
        body.add(right, weight=4)

        ttk.Label(self, textvariable=self.status_var, padding=8, foreground="#555555").grid(row=3, column=0, sticky="ew")

    def _browse_dat(self):
        path = filedialog.askopenfilename(
            initialdir=str(Path(self.dat_var.get()).parent),
            filetypes=[("FS2 DAT / raw BIN", "*.DAT *.dat *.BIN *.bin"), ("DAT files", "*.DAT *.dat"), ("BIN files", "*.BIN *.bin"), ("All files", "*.*")],
        )
        if path:
            self.dat_var.set(path)

    def _browse_exe(self):
        path = filedialog.askopenfilename(initialdir=str(Path(self.exe_var.get()).parent), filetypes=[("PS-X EXE", "SLPS*"), ("All files", "*.*")])
        if path:
            self.exe_var.set(path)

    def load_resources(self):
        try:
            dat_path = Path(self.dat_var.get())
            exe_path = Path(self.exe_var.get())
            self.dat_bytes, self.input_mode = read_fs2_payload(dat_path)
            self.ranges = resource_ranges(exe_path.read_bytes())
            self.records = []
            self.working = {}
            for resource_id, (offset, size) in self.ranges.items():
                if offset + min(size, PIXEL_BYTES) > len(self.dat_bytes):
                    continue
                indices = decode_8bpp(self.dat_bytes[offset : offset + min(size, PIXEL_BYTES)])
                bbox, used = bbox_and_indices(indices)
                self.records.append({"id": resource_id, "offset": offset, "size": size, "bbox": bbox, "indices": used})
            save_state({"dat": str(dat_path), "exe": str(exe_path)})
            self._populate_tree()
            source_kind = "raw BIN" if self.input_mode == "bin" else "FS2_FILE.DAT"
            self.status_var.set(f"Loaded {len(self.records)} resources ({FIRST_ID}..{LAST_ID}) from {source_kind}: {rel(dat_path)}")
        except Exception as exc:
            messagebox.showerror("Load failed", str(exc), parent=self)

    def _visible_records(self):
        mode = self.filter_var.get()
        if mode == "all":
            return self.records
        if mode == "modified":
            return [r for r in self.records if r["id"] in self.working]
        return [r for r in self.records if r["bbox"] != "empty"]

    def _populate_tree(self):
        selected = self.selected_id()
        self.tree.delete(*self.tree.get_children())
        for rec in self._visible_records():
            rid = rec["id"]
            state = "modified" if rid in self.working else "original"
            self.tree.insert("", "end", iid=str(rid), values=(rid, f"0x{rec['offset']:08X}", f"0x{rec['size']:X}", rec["bbox"], rec["indices"], state))
        if selected is not None and self.tree.exists(str(selected)):
            self.tree.selection_set(str(selected))
            self.tree.see(str(selected))
        elif self.tree.get_children():
            first = self.tree.get_children()[0]
            self.tree.selection_set(first)
            self.tree.see(first)
        self._show_selected()

    def selected_id(self):
        selection = self.tree.selection()
        return int(selection[0]) if selection else None

    def _record(self, resource_id):
        return next((r for r in self.records if r["id"] == resource_id), None)

    def _indices_for(self, resource_id):
        if resource_id in self.working:
            return self.working[resource_id]
        rec = self._record(resource_id)
        if not rec:
            return None
        return decode_8bpp(self.dat_bytes[rec["offset"] : rec["offset"] + min(rec["size"], PIXEL_BYTES)])

    def _show_selected(self):
        rid = self.selected_id()
        self.canvas.delete("all")
        if rid is None:
            self.info_label.configure(text="Select a resource")
            return
        rec = self._record(rid)
        indices = self._indices_for(rid)
        bbox, used = bbox_and_indices(indices)
        image = editing_image(indices).convert("RGB").resize((WIDTH * 8, HEIGHT * 8), Image.NEAREST)
        self._photo = ImageTk.PhotoImage(image)
        self.canvas.create_image(0, 0, anchor="nw", image=self._photo)
        self.canvas.configure(scrollregion=(0, 0, image.width, image.height))
        state = "modified" if rid in self.working else "original"
        known = "  (コック)" if rid == 4278 else ""
        self.info_label.configure(text=f"Resource {rid}{known}\nDAT 0x{rec['offset']:08X}, size 0x{rec['size']:X}\nInk bbox {bbox}; indices {used}; {state}")

    def export_selected(self):
        rid = self.selected_id()
        if rid is None:
            return
        path = filedialog.asksaveasfilename(initialdir=str(ROOT / "trDatas"), initialfile=f"speaker-name-{rid}.png", defaultextension=".png", filetypes=[("PNG", "*.png")])
        if path:
            editing_image(self._indices_for(rid)).save(path)
            self.status_var.set(f"Exported resource {rid} to {rel(path)}")

    def export_visible(self):
        directory = filedialog.askdirectory(initialdir=str(ROOT / "trDatas"))
        if not directory:
            return
        count = 0
        for rec in self._visible_records():
            rid = rec["id"]
            editing_image(self._indices_for(rid)).save(Path(directory) / f"speaker-name-{rid}.png")
            count += 1
        self.status_var.set(f"Exported {count} PNGs to {rel(directory)}")

    def import_replacement(self):
        rid = self.selected_id()
        if rid is None:
            return
        path = filedialog.askopenfilename(initialdir=str(ROOT / "trDatas"), filetypes=[("PNG", "*.png"), ("Images", "*.png *.bmp *.tga"), ("All files", "*.*")])
        if not path:
            return
        try:
            self.working[rid] = read_import_indices(path)
            self._refresh_record(rid)
            self._populate_tree()
            self.tree.selection_set(str(rid))
            self.tree.see(str(rid))
            self._show_selected()
            self.status_var.set(f"Imported replacement for resource {rid}: {rel(path)}")
        except Exception as exc:
            messagebox.showerror("Import failed", str(exc), parent=self)

    def _refresh_record(self, rid):
        rec = self._record(rid)
        rec["bbox"], rec["indices"] = bbox_and_indices(self._indices_for(rid))

    def reset_selected(self):
        rid = self.selected_id()
        if rid is None or rid not in self.working:
            return
        del self.working[rid]
        self._refresh_record(rid)
        self._populate_tree()
        if self.tree.exists(str(rid)):
            self.tree.selection_set(str(rid))
        self.status_var.set(f"Reset resource {rid} to original")

    def save_patched(self):
        if self.dat_bytes is None:
            return
        if not self.working:
            messagebox.showinfo("Nothing to save", "No replacement PNGs have been imported.", parent=self)
            return
        source = Path(self.dat_var.get())
        if self.input_mode == "bin":
            initial_file = f"{source.stem}-speaker-names-patched.bin"
            extension = ".bin"
            filetypes = [("Raw BIN", "*.bin"), ("All files", "*.*")]
        else:
            initial_file = "patched-speaker-names-FS2_FILE.DAT"
            extension = ".DAT"
            filetypes = [("DAT files", "*.DAT"), ("All files", "*.*")]
        path = filedialog.asksaveasfilename(
            initialdir=str(ROOT / "output"),
            initialfile=initial_file,
            defaultextension=extension,
            filetypes=filetypes,
        )
        if not path:
            return
        try:
            destination = Path(path)
            if destination.resolve() == source.resolve():
                raise ValueError("output must not overwrite the input BIN/DAT")
            output = bytearray(self.dat_bytes)
            for rid, indices in self.working.items():
                offset, size = self.ranges[rid]
                if size < PIXEL_BYTES:
                    raise ValueError(f"resource {rid} is only 0x{size:X} bytes; needs 0x{PIXEL_BYTES:X}")
                output[offset : offset + PIXEL_BYTES] = encode_8bpp(indices)
            destination.parent.mkdir(parents=True, exist_ok=True)

            if self.input_mode == "bin":
                work_root = ROOT / "tmp/SLPS-01903/speaker-name-bin-workflow"
                work_root.mkdir(parents=True, exist_ok=True)
                with tempfile.TemporaryDirectory(dir=work_root) as temp_dir:
                    temp_dir = Path(temp_dir)
                    patched_dat = temp_dir / "patched-FS2_FILE.DAT"
                    unfixed_bin = temp_dir / "injected-unfixed.bin"
                    patched_dat.write_bytes(output)
                    self.status_var.set("Injecting patched FS2 data into raw BIN...")
                    self.update_idletasks()
                    subprocess.run(
                        [
                            "node",
                            str(ROOT / "scripts/inject-dat-into-raw-bin.js"),
                            str(source),
                            str(patched_dat),
                            str(unfixed_bin),
                            "--lba",
                            str(FS2_LBA),
                        ],
                        cwd=ROOT,
                        check=True,
                        capture_output=True,
                        text=True,
                    )
                    self.status_var.set("Recomputing EDC/ECC for changed BIN sectors...")
                    self.update_idletasks()
                    subprocess.run(
                        [
                            "node",
                            str(ROOT / "scripts/fix-bin-edc-ecc.js"),
                            str(source),
                            str(unfixed_bin),
                            str(destination),
                            "--exe",
                            self.exe_var.get(),
                            "--fs2-lba",
                            str(FS2_LBA),
                        ],
                        cwd=ROOT,
                        check=True,
                        capture_output=True,
                        text=True,
                    )
            else:
                destination.write_bytes(output)

            kind = "BIN (EDC/ECC fixed)" if self.input_mode == "bin" else "DAT"
            self.status_var.set(f"Saved {len(self.working)} patched resource(s) to {kind}: {rel(destination)}")
        except subprocess.CalledProcessError as exc:
            detail = (exc.stdout or "") + (exc.stderr or "")
            messagebox.showerror("BIN save failed", detail.strip() or str(exc), parent=self)
        except Exception as exc:
            messagebox.showerror("Save failed", str(exc), parent=self)


if __name__ == "__main__":
    SpeakerNameResourceGui().mainloop()
