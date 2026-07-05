# SLPS-01903 Dialogue Tool Workflow

## Purpose

This workflow turns the current dialogue-mask research into three practical
steps:

1. Scan and validate dialogue candidate message IDs.
2. Export the candidate list into one translation TSV plus source mask PGM
   files.
3. Apply Korean translation text from the TSV into a patched raw disc `BIN`.

The original `ps1/SLPS-01903/FS2_FILE.DAT` and original BIN/CUE image are not
modified by these tools.

## GUI Tool

Run the combined Tkinter GUI:

```powershell
python tools\dialogue_workflow_gui.py
```

The GUI provides:

- Path fields for working `FS2_FILE.DAT`, `SLPS_019.03`, font, source BIN, candidate
  JSON, translation TSV, mask output directory, temporary patched DAT, and
  patched BIN output.
- `0. Extract DAT from BIN`: extracts `FS2_FILE.DAT` user data from the source
  raw BIN into the working DAT path. The default layout is `FS2 LBA = 223` and
  `FS2 Sectors = 119472`.
- The `FS2_FILE.DAT` field may also point directly to a raw `.bin` image. In
  that case `Scan Candidates`, `Export TSV/Masks`, and `Apply to BIN`
  automatically extract `tmp/SLPS-01903/dialogue-workflow/extracted-FS2_FILE.DAT`
  first and use that temporary DAT for the operation.
- If the selected `.bin` is already exactly the FS2 payload size
  (`244678656` bytes), the extractor treats it as an already-extracted DAT-like
  payload and copies it to the temporary DAT path instead of reading raw
  sectors.
- `1. Scan Candidates`: runs `dialogue-candidate-scan.js`.
- `2. Export TSV/Masks`: runs `export-dialogue-translation-table.js`, then
  loads the generated TSV.
- A TSV row editor for `source_note`, `ko_text`, `font_size`, `line_height`,
  `pad`, `ink_max`, `bright_threshold`, and `bold`.
- The table's first column is a check toggle. `Apply to BIN` only renders and
  patches checked rows that also have `ko_text`.
- Top path and option fields are saved to
  `tmp/SLPS-01903/dialogue-workflow/dialogue-gui-settings.json` and restored on
  the next GUI launch.
- Bulk render-option buttons:
  - `Options to Filled`: applies the current `font_size`, `line_height`, `pad`,
    `ink_max`, `bright_threshold`, and `bold` values to rows that already have
    `ko_text`.
  - `Options to All`: applies those render values to every TSV row.
- A built-in `200x48` source mask preview.
- `3. Apply to BIN`: runs `apply-dialogue-translation.ps1`, then injects the
  patched `FS2_FILE.DAT` user data into the raw BIN at `FS2 LBA = 223`.
- During apply, `message-mask-pgm-tool.js` rebuilds each patched message's
  reveal header at block offset `0x930` (`commonBuffer + 0x1930` after load).
  The rebuilt segment count is based on the last visible pixel in the Korean
  `200x48` mask, so longer Korean lines can still use the original left-to-right
  reveal path.
- `Instant Text`: experimental. It renders the loaded dialogue mask in full
  immediately and can make voiced dialogue advance before the voice finishes.
  Keep it off for normal voiced dialogue tests.

Use `\n` or actual line breaks in the Korean text editor for multi-line
dialogue. The GUI saves line breaks as escaped `\n` in the TSV.

## 1. Scan Candidates

If you want to work directly from the BIN/CUE image, extract the working DAT
first:

```powershell
node scripts\extract-dat-from-raw-bin.js "ps1\SLPS-01903\bincue\Farland Saga - Toki no Michishirube.bin" tmp\SLPS-01903\dialogue-workflow\extracted-FS2_FILE.DAT --lba 223 --sectors 119472
```

Then use that extracted DAT path for scanning/export/apply.

```powershell
node scripts\dialogue-candidate-scan.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\dialogue-workflow\dialogue-candidates.json --script-ids 309-326 --include 1001,3002 --opcode 0x41
```

Behavior:

- Script opcode `0x41` refs are scanned from script resources `309..326`.
- Every found message ID is checked against the message-bank tables.
- Valid IDs are added to `candidates`.
- Invalid/unmapped IDs are written to `rejected`.
- IDs passed with `--include` are manually validated; if a message-bank entry
  exists, the ID is added, otherwise it is excluded.
- If the candidate JSON already exists, previously validated manual candidates
  are preserved even when they are no longer present in the current
  `--include` list. This keeps earlier manual additions from disappearing when
  the GUI's Manual Include field is edited.

Current verification:

```text
candidates 25, rejected 34
manual 1001: already-present
manual 3002: mapped
```

## 2. Export Translation TSV

```powershell
node scripts\export-dialogue-translation-table.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\dialogue-workflow\dialogue-candidates.json tmp\SLPS-01903\dialogue-workflow\dialogue-translation.tsv tmp\SLPS-01903\dialogue-workflow\masks
```

Generated files:

```text
tmp/SLPS-01903/dialogue-workflow/dialogue-translation.tsv
tmp/SLPS-01903/dialogue-workflow/masks/message-mask-*.pgm
tmp/SLPS-01903/dialogue-workflow/masks/message-mask-manifest.json
```

TSV columns:

| column | use |
| --- | --- |
| `enabled` | `1` to include the row during apply, `0` to skip it |
| `message_id` | message-bank ID to patch |
| `source` | `script-scan`, `manual-validated`, or both |
| `refs` | script references, formatted as `script:entry:opcodeWord` |
| `mask_pgm` | extracted source mask path for visual/manual transcription |
| `source_note` | optional manual Japanese transcription or note |
| `ko_text` | Korean replacement text; blank rows are skipped |
| `font_size` | per-row render font size |
| `line_height` | per-row render line height |
| `pad` | per-row canvas padding after trim |
| `ink_max` | maximum ink palette index; use `2` to match original dialogue colors |
| `threshold` | minimum source brightness to treat as visible ink; default `32` |
| `bright_threshold` | brightness needed to become the brighter text ink; default `96` |
| `bold` | optional pixel dilation radius; use `1` if thin Korean strokes look too dark |

Use `\n` inside `ko_text` for explicit line breaks.

If `dialogue-translation.tsv` already exists, export preserves manual work by
copying the existing row's `source_note`, `ko_text`, `font_size`,
`line_height`, `pad`, `ink_max`, `threshold`, `bright_threshold`, `bold`, and
`enabled` for the same `message_id`. Newly discovered message IDs still receive
the default render settings.

Example:

```text
1004    script-scan    310:11:0xa27    ...    ...    뭐!?\n뭐!?\n뭐!?    16    15    1    2
```

## 3. Apply Translation TSV Into BIN

```powershell
powershell -ExecutionPolicy Bypass -File scripts\apply-dialogue-translation.ps1 -DatPath ps1\SLPS-01903\FS2_FILE.DAT -ExePath ps1\SLPS-01903\SLPS_019.03 -TranslationTsv tmp\SLPS-01903\dialogue-workflow\dialogue-translation.tsv -OutDat tmp\SLPS-01903\dialogue-workflow\patched-FS2_FILE.DAT -SourceBin "ps1\SLPS-01903\bincue\Farland Saga - Toki no Michishirube.bin" -OutBin tmp\SLPS-01903\dialogue-workflow\patched-farland-saga.bin -Fs2Lba 223 -FontPath font\NanumSquareRoundR.ttf -WorkDir tmp\SLPS-01903\dialogue-workflow\apply -Mode AntiAlias -TrimToOrigin
```

Behavior:

- Rows with blank `ko_text` are skipped.
- Rows with `enabled=0` are skipped.
- Rows with `ko_text` are rendered as `200x48` PGM masks.
- The rendered PGM is packed into the target message block's first `0x930`
  bytes.
- The message block's reveal/segment header at offset `0x930` is rebuilt from
  the replacement mask length. Use `message-mask-pgm-tool.js --keep-reveal` only
  for exact old-behavior tests.
- Multiple translated rows are applied sequentially into one temporary patched
  DAT.
- If `-SourceBin` and `-OutBin` are provided, the patched DAT is injected into
  the raw `MODE2/2352` disc image.
- If `-InstantDisplay` is provided, the output BIN is additionally patched in
  the boot executable dialogue setup path:
  - `SLPS_019.03` file offset `0x145F8`, RAM `0x8017CDF8` keeps the original
    `beq v1, zero, 0x8017CE1C` branch so the voice/init path is still entered.
  - `SLPS_019.03` file offset `0x14610`, RAM `0x8017CE10` removes the clear of
    `gp+0x1DC`, preserving the voice/dialogue gate set by the delayed path.
  - `SLPS_019.03` file offset `0x14618`, RAM `0x8017CE18` changes the full
    render path's return state from `3` to `2`, so the message enters the
    fully-rendered wait path instead of re-running the progressive reveal path.
  - `SLPS_019.03` file offset `0x14628`, RAM `0x8017CE28` changes the delayed
    path exit from `addiu v0, zero, 1` to `j 0x8017CE08`.
  - `SLPS_019.03` file offset `0x1462C`, RAM `0x8017CE2C` changes the jump
    delay slot to `nop`.

  This runs `jal 0x801958F0` first, then returns to the full render path through
  `0x8017CC4C`. This mode is for quick visual checks; do not use it for normal
  voiced-dialogue timing. The old branch-NOP instant patch is still available
  from `patch-dialogue-instant-display.js --legacy`, but it skips the voice/init
  call and can mute dialogue voice playback.

Raw BIN layout:

```text
track mode       MODE2/2352
FS2_FILE.DAT LBA 223
FS2 sectors      119472
FS2 byte size    244678656
sector size      2352
user data offset 24
user data size   2048
```

Raw BIN injection round-trip was verified by injecting the unmodified
`FS2_FILE.DAT` into the original BIN:

```text
sizeA 281875440 sizeB 281875440 diffBytes 0 first none
```

Sample verification with translated rows already present in the TSV:

```text
applied 7 translated rows -> tmp\SLPS-01903\dialogue-workflow\patched-empty-bin-FS2_FILE.DAT
injected patched DAT into BIN -> tmp\SLPS-01903\dialogue-workflow\patched-empty-bin-roundtrip.bin
binDiffBytes 1957 first 0x45a738c last 0x4a6e864
```

Instant-display patch can also be applied directly:

```powershell
node scripts\patch-dialogue-instant-display.js tmp\SLPS-01903\dialogue-workflow\patched-farland-saga.bin tmp\SLPS-01903\dialogue-workflow\patched-farland-saga-instant-display.bin
```

Restore an instant-display patched EXE/BIN:

```powershell
node scripts\patch-dialogue-instant-display.js tmp\SLPS-01903\dialogue-workflow\patched-farland-saga-instant-display.bin tmp\SLPS-01903\dialogue-workflow\patched-farland-saga-restored.bin --restore
```

## Notes

- The tools replace rendered dialogue masks, not compressed text strings.
- Japanese source text is not OCR'd automatically; use each source PGM/HTML
  preview for manual reading or transcription.
- Recommended current Korean render defaults are `font_size=16`,
  `line_height=15`, `pad=1`, `ink_max=2`, `threshold=32`,
  `bright_threshold=96`, `bold=0`, and `-TrimToOrigin`.
- Original dialogue masks observed so far use palette indices `1` and `2` for
  visible text. Avoid `ink_max=3` unless a specific message needs palette index
  `3`; in-game this can appear as blue/cyan text.
- If Korean vowels or thin strokes look black/dark in-game, lower
  `bright_threshold` to `80` or `64` first. If the glyph is still too thin, set
  `bold=1` for that row and re-apply.
