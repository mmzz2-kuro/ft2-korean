#!/usr/bin/env python3
"""Prepare true-colour title images for the be-hdr indexed logo workflow.

Each title resource carries its own 256-entry PS1 BGR555 CLUT between the
16-byte be-hdr header and the tile map.  Replacement pixels are quantized
against that exact CLUT.  Pixels outside the requested rectangles retain their
original palette indices byte-for-byte.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import struct

from PIL import Image


DEFAULT_REGIONS = {
    251: ((0, 0, 320, 240),),
    288: ((0, 0, 320, 240),),
}


def read_p2(path: Path) -> tuple[int, int, bytes]:
    tokens: list[str] = []
    for line in path.read_text(encoding="ascii").splitlines():
        tokens.extend(line.split("#", 1)[0].split())
    if len(tokens) < 4 or tokens[0] != "P2":
        raise ValueError(f"{path} is not an ASCII P2 PGM")
    width, height, maximum = map(int, tokens[1:4])
    if maximum != 255:
        raise ValueError(f"{path} must have maxval 255, got {maximum}")
    pixels = bytes(int(value) for value in tokens[4:])
    if len(pixels) != width * height:
        raise ValueError(f"{path} has {len(pixels)} pixels, expected {width * height}")
    return width, height, pixels


def in_regions(x: int, y: int, regions: tuple[tuple[int, int, int, int], ...]) -> bool:
    return any(x0 <= x < x1 and y0 <= y < y1 for x0, y0, x1, y1 in regions)


def replacement_alpha(x: int, y: int, regions: tuple[tuple[int, int, int, int], ...]) -> float:
    return 1.0 if in_regions(x, y, regions) else 0.0


def read_resource_clut(dat_path: Path, exe_path: Path, resource_id: int) -> list[tuple[int, int, int]]:
    exe = exe_path.read_bytes()
    dat = dat_path.read_bytes()
    load_address = struct.unpack_from("<I", exe, 0x18)[0]
    table_offset = 0x801C4F68 - load_address + 0x800
    sector = struct.unpack_from("<H", exe, table_offset + resource_id * 2)[0]
    resource_offset = sector * 0x800
    width_tiles, height_tiles, _, tile_data_offset = struct.unpack_from(">IIII", dat, resource_offset)
    tile_map_offset = tile_data_offset - width_tiles * height_tiles * 2
    if tile_map_offset < 0x210:
        raise ValueError(f"resource {resource_id} has no 256-entry CLUT before its tile map")
    values = struct.unpack_from(">256H", dat, resource_offset + 0x10)
    return [
        (
            round((value & 0x1F) * 255 / 31),
            round(((value >> 5) & 0x1F) * 255 / 31),
            round(((value >> 10) & 0x1F) * 255 / 31),
        )
        for value in values
    ]


def colour_distance(a: tuple[int, int, int], b: tuple[int, int, int]) -> int:
    dr, dg, db = a[0] - b[0], a[1] - b[1], a[2] - b[2]
    # Equal-channel RGB distance avoids selecting a much darker blue merely to
    # gain a small green-channel improvement (visible as sky-colour speckles).
    return dr * dr + dg * dg + db * db


def remove_isolated_palette_pixels(
    indexes: bytearray,
    width: int,
    height: int,
    source,
    clut: list[tuple[int, int, int]],
) -> int:
    """Remove single-pixel palette outliers only inside locally smooth RGB areas."""
    original = bytes(indexes)
    replacements: list[tuple[int, int]] = []
    for y in range(1, height - 1):
        for x in range(1, width - 1):
            source_neighbours = [source[xx, yy] for yy in range(y - 1, y + 2) for xx in range(x - 1, x + 2)]
            local_range = max(
                max(colour[channel] for colour in source_neighbours)
                - min(colour[channel] for colour in source_neighbours)
                for channel in range(3)
            )
            if local_range >= 25:
                continue

            pos = y * width + x
            current = original[pos]
            neighbours = [
                original[yy * width + xx]
                for yy in range(y - 1, y + 2)
                for xx in range(x - 1, x + 2)
                if (xx, yy) != (x, y)
            ]
            if neighbours.count(current) > 1:
                continue
            neighbour_colours = [clut[index] for index in neighbours]
            median_colour = tuple(
                sum(sorted(colour[channel] for colour in neighbour_colours)[3:5]) / 2
                for channel in range(3)
            )
            if sum((clut[current][channel] - median_colour[channel]) ** 2 for channel in range(3)) <= 45**2:
                continue

            target = source[x, y]
            candidates = set(neighbours)
            best = min(candidates, key=lambda index: colour_distance(target, clut[index]))
            if neighbours.count(best) < 3:
                continue
            if colour_distance(target, clut[best]) <= colour_distance(target, clut[current]) + 256:
                replacements.append((pos, best))

    for pos, index in replacements:
        indexes[pos] = index
    return len(replacements)


def prepare_one(
    resource_id: int,
    raw_pgm: Path,
    source_png: Path,
    output_png: Path,
    dat_path: Path,
    exe_path: Path,
) -> None:
    width, height, original = read_p2(raw_pgm)
    rgb = Image.open(source_png).convert("RGB")
    if rgb.size != (width, height):
        raise ValueError(f"{source_png} must be {width}x{height}, got {rgb.width}x{rgb.height}")
    regions = DEFAULT_REGIONS.get(resource_id)
    if not regions:
        raise ValueError(f"no replacement regions are defined for resource {resource_id}")

    clut = read_resource_clut(dat_path, exe_path, resource_id)
    candidates = list(enumerate(clut))
    cache: dict[tuple[int, int, int], int] = {}
    out = bytearray(original)
    source = rgb.load()
    changed = 0
    for y in range(height):
        for x in range(width):
            alpha = replacement_alpha(x, y, regions)
            if alpha <= 0:
                continue
            original_colour = clut[original[y * width + x]]
            target_colour = source[x, y]
            colour = tuple(
                round(original_colour[channel] * (1.0 - alpha) + target_colour[channel] * alpha)
                for channel in range(3)
            )
            index = cache.get(colour)
            if index is None:
                index = min(candidates, key=lambda item: colour_distance(colour, item[1]))[0]
                cache[colour] = index
            pos = y * width + x
            if out[pos] != index:
                out[pos] = index
                changed += 1

    despeckled = remove_isolated_palette_pixels(out, width, height, source, clut)

    image = Image.frombytes("P", (width, height), bytes(out))
    image.putpalette([component for value in range(256) for component in (value, value, value)])
    output_png.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_png)
    preview = Image.new("RGB", (width, height))
    preview.putdata([clut[index] for index in out])
    preview_path = output_png.with_name(output_png.stem.replace("-indexed-edit", "-clut-preview") + ".png")
    preview.save(preview_path)
    print(
        f"{resource_id}: wrote {output_png} ({changed} pixels changed, "
        f"{despeckled} isolated pixels cleaned, exact 256-colour CLUT, "
        f"{len(set(out))} used indices); preview {preview_path}"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--work-dir", type=Path, default=Path("tmp/SLPS-01903/logo-workflow"))
    parser.add_argument("--input-dir", type=Path, default=Path("winLogo"))
    parser.add_argument("--dat", type=Path, default=Path("ps1/SLPS-01903/FS2_FILE.DAT"))
    parser.add_argument("--exe", type=Path, default=Path("ps1/SLPS-01903/SLPS_019.03"))
    args = parser.parse_args()
    for resource_id in (251, 288):
        prepare_one(
            resource_id,
            args.work_dir / "raw" / f"be-hdr-ui-{resource_id}-raw.pgm",
            args.input_dir / f"TITLE-{resource_id}-resize.png",
            args.work_dir / "edit" / f"be-hdr-ui-{resource_id}-indexed-edit.png",
            args.dat,
            args.exe,
        )


if __name__ == "__main__":
    main()
