# SLPS-01903 UI Mask Workflow

This workflow edits the 1bpp UI mask resources that are stored as already
rendered images inside `FS2_FILE.DAT`.

## Confirmed Layouts

| range | layout | current use |
| --- | --- | --- |
| `1151..1169` | `256x64`, `32 bytes/row`, 1bpp | day/status labels such as `1日目` |
| `829..900` | `288x64`, `36 bytes/row`, 1bpp | menu/help/item description masks |
| `901..1007` | `288x64`, `36 bytes/row`, 1bpp | item/help description masks |
| `1008..1080` | `288x64`, `36 bytes/row`, 1bpp | menu/help/item description masks |
| `1081..1148` | `288x64`, `36 bytes/row`, 1bpp | unit/help description masks |

The stored game bit convention is inverted: bit `0` is ink and bit `1` is
background. The editable PBM files use the normal visible convention where
PBM `1` means ink.

## GUI

Run:

```powershell
python tools\ui_mask_workflow_gui.py
```

Use the preset selector:

- `day_1151_1169`: exports/patches the day/status masks.
- `menu_829_900`: exports/patches the first menu/help mask range.
- `menu_1008_1080`: exports/patches the second menu/help mask range.
- `item_help_901_1007`: exports/patches more item/help masks.
- `unit_help_1081_1148`: exports/patches unit/help masks.

`1149` and `1150` are intentionally excluded from the system UI presets because
their first bytes do not match the same 1bpp rendered text-mask pattern.

## System UI Search Notes

The ranges previously labeled `system_ui_901_1007` and
`system_ui_1081_1148` were reclassified after manual review:

- `901..1007`: additional item/help description masks.
- `1081..1148`: unit/help description masks.

Candidate HTML files for the next system-UI search pass:

```text
tmp/SLPS-01903/system-ui-behdr-245-302.html
tmp/SLPS-01903/system-ui-behdr-633-660.html
tmp/SLPS-01903/system-ui-behdr-758-807.html
tmp/SLPS-01903/system-ui-struct-327-346.html
tmp/SLPS-01903/system-ui-struct-462-490.html
tmp/SLPS-01903/system-ui-struct-538-566.html
```

These files preview direct-load graphics and dynamic resource-table candidates
with multiple raw bitmap interpretations. If readable save/load/config/status
labels are visible there, that range should get a dedicated editor instead of
using the 1bpp mask presets blindly.

Follow-up search found that the `be-hdr` graphics path is separate from the
1bpp mask workflow. Manual visual review ruled out the first strong-looking
candidate group:

| range | format | notes |
| --- | --- | --- |
| `266..286` | `be-hdr` tilemap + 64-byte 8bpp tiles | not system UI; visually identified as opening character-description graphics and background/image material |

Reference preview command for the rejected group:

```powershell
node scripts\export-fs2-behdr-tilemap-html.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\system-ui-behdr-tilemap-main.html 266 270 271 273 276 279 280 281 282 283 284 285 286 --scale 1
```

Additional visual candidates were also checked and ruled out as the same
opening/image family:

```text
tmp/SLPS-01903/system-ui-next-candidates-245-264-633-660.html
tmp/SLPS-01903/be-hdr-tilemap-758-807.html
```

The next search should be runtime-guided: enter the actual system
menu/status/shop/config screen in the emulator and log or infer the resource IDs
loaded immediately before that UI appears. See
`docs/projects/SLPS-01903/runtime-resource-tracing.md`.

Main flow:

1. Put either `FS2_FILE.DAT` or a raw `.bin` in the top input field.
2. Click `1. Export TSV/Masks`.
3. Edit `ko_text` for the rows to replace, then check only those rows.
4. Adjust `font`, `line`, `pad`, `threshold`, and `bold` per row or in bulk.
5. Click `2. Apply to BIN`.

If the top field points to a `.bin`, the GUI extracts the FS2 payload first.
If `Source BIN` is a full raw BIN, the patched DAT is injected back into that
BIN. If it is DAT-sized, the tool writes the patched payload directly.

## Command-Line Pieces

Export PBM masks directly:

```powershell
node scripts\ui-1bpp-mask-tool.js export ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\ui-mask-test 1151 1152 --bytes-per-row 32 --rows 64
```

Render Korean text to an editable PBM:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\render-text-to-1bpp-pbm.ps1 -FontPath font\korean-central.ttf -Text "1일째" -OutPath tmp\SLPS-01903\ui-mask-test\ui-mask-1151-ko.pbm -Width 256 -Height 64 -FontSize 24 -LineHeight 24 -Pad 1 -TrimToOrigin
```

Patch one resource into a DAT copy:

```powershell
node scripts\ui-1bpp-mask-tool.js patch ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\patched-ui-1151.DAT 1151 tmp\SLPS-01903\ui-mask-test\ui-mask-1151-ko.pbm --bytes-per-row 32 --rows 64
```
