# SLPS-01903 be-hdr UI Tool Workflow

This workflow edits the small 8bpp `be-hdr` tile resources used by menu/UI
labels.

Confirmed UI-looking resources from RAM tracing:

```text
827, 828, 1199, 1207, 1210, 1211, 1212, 1213
```

The menu label resources are not the same as the previous 1bpp mask resources.
They are `be-hdr` containers with:

- big-endian 16-byte header in `FS2_FILE.DAT`
- tilemap immediately before `tileDataOffset`
- 8bpp 8x8 tiles, 64 bytes per tile
- tilemap entries usually reference tile index as `raw >> 1`
- header `payloadSize` may stop before the last referenced tile; use the
  resource sector span as the tile-data bound for these menu resources

The source preview can look color-inverted depending on whether the visible
ink is interpreted as zero or non-zero. The tool exposes `invert`,
`source_ink_indexes`, `ink_index`, and `bg_index` so this can be adjusted
without changing the core patch logic.

## GUI

Run:

```powershell
python tools\be_hdr_ui_workflow_gui.py
```

Default IDs:

```text
827,828,1199,1207,1210,1211,1212,1213
```

Recommended starting options:

```text
invert=on
source_ink_indexes=224-232
ink_index=232
bg_index=3
font_size=24
line_height=24
pad=1
threshold=64
```

Important title-menu exception:

```text
resource_id=827
source_ink_indexes=1,2,224-231
ink_index=2
```

For `827`, the title/menu atlas uses both low indexes `1,2` and the usual
white text range `224-231` for visible label pixels. If only `1,2` is erased,
the selected title-menu row can leave a blue Japanese shadow behind the Korean
replacement. The current 827 row uses `source_ink_indexes=1,2,224-231`,
`ink_index=2`, `bg_index=3`, `patch_regions=auto`, and a custom source erase
mask:

```text
tmp/SLPS-01903/be-hdr-ui-workflow/masks/be-hdr-ui-827-erase-source-text.pbm
```

That erase mask removes original glyph pixels while filtering out long
horizontal runs from the selected-row red gradient. It also protects the
right-side place-name area with `lossy_protect_regions=432,0,80,512`.

When exporting `827`, the tool regenerates `be-hdr-ui-827.png` with
`source_ink_indexes=1,2` even if the bulk export option is still `224-232`.
Use that richer PNG as the edit base. It contains more labels than the default
`224-232` preview, including multiple title-menu copies; translate every copy
that appears in the atlas.

Flow:

1. Put either `FS2_FILE.DAT` or a raw `.bin` in the top `FS2_FILE.DAT` field.
2. Click `1. Export TSV/PBM`.
3. For simple one-line replacements, fill `ko_text`.
4. For mixed UI resources, edit the generated `editable_png` image and save a
   copy, then put that copy path in `replacement_png`.
5. Set `enabled` to `1` for those rows, or use `Check Filled`.
6. Adjust `invert`, `source_ink_indexes`, `ink_index`, `bg_index`, and font
   options if needed.
7. Click `2. Apply to BIN`.

Manual image replacement is preferred for resources where multiple menu labels
or UI fragments share one tilemap. The PNG uses the same black/white convention
as the PBM preview: for inverted rows such as `827`, draw replacement text in
white on a black background. During apply,
`replacement_pbm` is used first, then `replacement_png`; `ko_text` is used only
when neither replacement image path is set.

If `patch_regions` is set in the TSV, replacement and erase PBMs are clipped to
the semicolon-separated `x,y,w,h` rectangles before patching. This is an
optional narrow-patch aid. Setting `patch_regions=auto` compares `editable_png`
and `replacement_png`, then clips patching to the changed 8x8 tiles. This is the
preferred approach for dense atlas resources such as `827`, because full-atlas
patching can run out of free tile slots and corrupt shared tiles.

`lossy_fit=1` can merge similar final tiles if a dense atlas exceeds its tile
capacity, but this is a fallback only because merged tiles can visibly damage
Korean glyphs. For `827`, `heal_regions`/`heal_indexes` are now passed into the
patcher as a pre-heal step before tile packing. This restores the selected-row
red gradient first, reducing the current `827` replacement from 1571 unique
tiles to 1432/1439, so lossy merging is no longer needed in the latest apply.

If a raw `.bin` is used, the GUI extracts the FS2 user-data payload to
`tmp/SLPS-01903/be-hdr-ui-workflow/extracted-FS2_FILE.DAT` before export/apply
and injects the patched DAT back into the selected output BIN.

## CLI

Export source PBM masks and TSV:

```powershell
node scripts\export-behdr-ui-translation-table.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\be-hdr-ui-workflow\be-hdr-ui-translation.tsv tmp\SLPS-01903\be-hdr-ui-workflow\masks --ids 827,828,1199,1207,1210,1211,1212,1213 --invert --font-size 24 --line-height 24 --pad 1 --threshold 64 --bold 0 --source-ink-indexes 224-232 --ink-index 232 --bg-index 3
```

The first argument may also be a raw `.bin`; the script extracts the FS2 payload
internally using the default `--lba 223 --sectors 119472`.

Apply TSV to DAT/BIN:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\apply-behdr-ui-translation.ps1 -DatPath ps1\SLPS-01903\FS2_FILE.DAT -ExePath ps1\SLPS-01903\SLPS_019.03 -TranslationTsv tmp\SLPS-01903\be-hdr-ui-workflow\be-hdr-ui-translation.tsv -OutDat tmp\SLPS-01903\be-hdr-ui-workflow\patched-be-hdr-ui.DAT -SourceBin "ps1\SLPS-01903\bincue\Farland Saga - Toki no Michishirube.bin" -OutBin tmp\SLPS-01903\be-hdr-ui-workflow\patched-be-hdr-ui.bin -Fs2Lba 223 -FontPath font\NanumSquareRoundR.ttf -WorkDir tmp\SLPS-01903\be-hdr-ui-workflow\apply -Mode AntiAlias -TrimToOrigin
```

Low-level export/patch:

```powershell
node scripts\be-hdr-ui-tile-tool.js export ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\be-hdr-ui-workflow\source 1210 --invert
node scripts\be-hdr-ui-tile-tool.js patch ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\be-hdr-ui-workflow\patched-test.DAT 1210 tmp\SLPS-01903\be-hdr-ui-workflow\apply\be-hdr-ui-1210-ko.pbm --invert --ink-index 232 --bg-index 3
```

If the in-game colors are still reversed, try one of these:

```text
invert=off
source_ink_indexes=232
source_ink_indexes=224-232
resource 827 title menu: source_ink_indexes=1,2 and ink_index=2
resource 827 current setting: source_ink_indexes=1,2,224-231 and ink_index=2
ink_index=232, bg_index=3
```

## Current Visual Index Maps

Generated helper images:

```text
tmp/SLPS-01903/be-hdr-ui-workflow/menu-text-contact-811-1213.png
tmp/SLPS-01903/be-hdr-ui-workflow/status-panel-contact-1170-1217.png
tmp/SLPS-01903/be-hdr-ui-workflow/827-start-menu-index-probe-all.png
```

Confirmed groups from the contact sheets:

```text
811..826: short battle/map objective message-window text, e.g. slime defeat goals.
827: dense shared system/menu/place-name atlas.
1170,1172: character information/status label panels.
1173..1187,1190: equipment/shop/status/system panel labels.
1214..1217: memory-card/save related warning text panels.
```
