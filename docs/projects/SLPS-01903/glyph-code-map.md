# SLPS-01903 Portrait/Expression Code Map

## Purpose

This document originally tracked the path as a possible glyph/font map. That
classification is now corrected: the path maps internal 2-byte display codes to
portrait/expression rectangle chunks stored in the FS2 extended ranges.

This is not the main Japanese dialogue font path.

The current display path is:

```text
script words
-> 0x8017C6F4: ((first + 64) << 8) + second
-> 0x8017C4F0: lookup in code table at 0x80169A08
-> 0x80188090: read 6 sectors from extended page by code index
-> 0x8016C8C8: transfer a 60x96 or 60x92 rectangle to VRAM
```

User visual verification of `tmp/SLPS-01903/rect-page0-16bpp.html` showed
character portrait frames, not readable Japanese glyphs. Therefore this route is
useful for portrait/expression replacement, but not for text extraction.

## Artifacts

Generated review files:

```powershell
node scripts\export-fs2-extended-html.js ps1\SLPS-01903\SLPS_019.03 ps1\SLPS-01903\FS2_FILE.DAT tmp\SLPS-01903\extended-page0.html --page 0 --chunk-width-bytes 16 --chunk-rows 24 --columns 7 --scale 2
node scripts\export-fs2-extended-html.js ps1\SLPS-01903\SLPS_019.03 ps1\SLPS-01903\FS2_FILE.DAT tmp\SLPS-01903\extended-page1.html --page 1 --chunk-width-bytes 16 --chunk-rows 24 --columns 7 --scale 2
```

Open these generated files in a browser:

- `tmp/SLPS-01903/extended-page0.html`
- `tmp/SLPS-01903/extended-page1.html`

Each cell label has:

```text
index code value
```

Example:

```text
000 AA 0x4141
001 AB 0x4142
002 AC 0x4143
```

## Current Findings

- The EXE code table at `0x80169A08` has 148 entries.
- Entry `147` is `0x0000`, likely a sentinel.
- The 147 visible code entries align exactly with one extended range page:

```text
0x1B9000 bytes = 882 sectors
882 sectors / 147 codes = 6 sectors per code
```

- Each visible code index maps to one `0x3000` byte portrait/expression chunk
  per page.
- Page selection is controlled through `0x801CBC58`; values `<= 0` are coerced to page `1` inside `0x80188090`.

## 2026-06-30 Rendering Correction

The first generated HTML atlas used a 1bpp bitmap assumption. That output is not expected to show readable Japanese text.

The disassembly shows:

```text
0x80188090(index, dst)
-> reads 6 sectors into the common buffer
-> 0x8017C4F0 calls 0x8016C8C8 with a 60x96 or 60x92 rect
```

So each code-table index is a GPU-ready rectangle chunk, not a simple 1bpp
glyph bitmap. This is probably not encryption: no decrypt/decompress routine
appears between the 6-sector read and the GPU transfer wrapper.

New comparison files:

```powershell
node scripts\export-fs2-extended-rect-html.js ps1\SLPS-01903\SLPS_019.03 ps1\SLPS-01903\FS2_FILE.DAT tmp\SLPS-01903\rect-page0-4bpp.html --page 0 --width 60 --height 96 --bpp 4 --columns 7 --scale 3
node scripts\export-fs2-extended-rect-html.js ps1\SLPS-01903\SLPS_019.03 ps1\SLPS-01903\FS2_FILE.DAT tmp\SLPS-01903\rect-page0-8bpp.html --page 0 --width 60 --height 96 --bpp 8 --columns 7 --scale 3
node scripts\export-fs2-extended-rect-html.js ps1\SLPS-01903\SLPS_019.03 ps1\SLPS-01903\FS2_FILE.DAT tmp\SLPS-01903\rect-page0-16bpp.html --page 0 --width 60 --height 96 --bpp 16 --columns 7 --scale 3
node scripts\export-fs2-extended-rect-html.js ps1\SLPS-01903\SLPS_019.03 ps1\SLPS-01903\FS2_FILE.DAT tmp\SLPS-01903\rect-page0-4bpp-60x92.html --page 0 --width 60 --height 92 --bpp 4 --columns 7 --scale 3
```

`rect-page0-16bpp.html` renders recognizable character portraits. Keep these
files as portrait/expression atlases.

## Manual Portrait Mapping Table

Fill this if portrait/expression replacement becomes part of the patch scope.

| index | code | value | page | portrait/expression | notes |
| ---: | --- | --- | ---: | --- | --- |
| 0 | `AA` | `0x4141` | 0 |  |  |
| 1 | `AB` | `0x4142` | 0 |  |  |
| 2 | `AC` | `0x4143` | 0 |  |  |
| 3 | `AD` | `0x4144` | 0 |  |  |
| 4 | `AE` | `0x4145` | 0 |  |  |
| 5 | `AG` | `0x4147` | 0 |  |  |
| 6 | `AH` | `0x4148` | 0 |  |  |
| 7 | `AI` | `0x4149` | 0 |  |  |
| 8 | `AJ` | `0x414A` | 0 |  |  |
| 9 | `AK` | `0x414B` | 0 |  |  |

## Next Work

1. Treat `0x8017C6F4 -> 0x8017C4F0 -> 0x80188090` as portrait/expression
   selection, not text rendering.
2. Continue main dialogue investigation from `docs/projects/SLPS-01903/dialogue-route.md`.
3. Keep `0x8017FF00` / opcode `0x78` as a lower-confidence display-work
   candidate. The current approximate opcode-aware scan does not find valid
   script hits for `0x78`.
