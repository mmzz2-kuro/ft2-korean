# SLPS-01903 Dialogue Mask Replacement

## Status

The dialogue message-bank masks can now be extracted as editable `200x48`
palette-index PGM files and packed back into a DAT copy. This is an image-level
replacement path for the rendered dialogue body.

For the current three-step translation workflow, see:

```text
docs/projects/SLPS-01903/dialogue-tool-workflow.md
```

The extracted mask format is:

```text
P2 PGM
width  = 200
height = 48
maxval = 3
pixel values = dialogue palette indices 0..3
```

## Export Masks

```powershell
node scripts\message-mask-pgm-tool.js export ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\message-mask-pgm 1001 1004 1103 1104 1105 1106 2001 2004 2007 2008 2009 3002 4001 4003 4004 4005 4007 6001 6002 6003 6004 6005 7002 7003 7004
```

Generated files:

```text
tmp/SLPS-01903/message-mask-pgm/message-mask-1001.pgm
...
tmp/SLPS-01903/message-mask-pgm/message-mask-7004.pgm
tmp/SLPS-01903/message-mask-pgm/message-mask-manifest.json
```

## Patch One Mask Into A DAT Copy

This writes a new DAT file and leaves the original source DAT untouched:

```powershell
node scripts\message-mask-pgm-tool.js patch ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\patched-FS2_FILE-1004.DAT 1004 tmp\SLPS-01903\message-mask-pgm\message-mask-1004.pgm
```

The tool packs the `200x48` PGM pixels into the message block's first `0x930`
preprocessed bytes, then applies the inverse halfword byte order expected by
`0x8017CC90`.

## Verification

Round-trip verification:

```powershell
node scripts\verify-message-bank-pack.js tmp\SLPS-01903\patched-FS2_FILE-1004.DAT ps1\SLPS-01903\SLPS_019.03 1004
```

No-change patch verification performed on `message-mask-1004.pgm`:

```text
OK 1004: mask 0x930 bytes round-trips, sectors 30882..30888
diffBytes 0 first none
```

This confirms that exporting an original mask and patching it back into a DAT
copy produces identical bytes.

## Test Marker Patch

A visible non-translation test marker was generated for message `1004` to prove
that edited PGM masks affect only the expected packed mask region:

```text
tmp/SLPS-01903/message-mask-pgm/message-mask-1004-test-marker.pgm
tmp/SLPS-01903/patched-FS2_FILE-1004-test-marker.DAT
tmp/SLPS-01903/patched-1004-test-marker-preview.html
tmp/SLPS-01903/patched-1004-test-marker-preview-bgfe.html
```

Verification:

```text
OK 1004: mask 0x930 bytes round-trips, sectors 30882..30888
diffBytes 242 first 0x3c51011 last 0x3c5142c
```

The changed byte range stays inside message `1004`'s first packed mask area.

## Korean Smoke Patch

Message `1004` was patched with the Korean text `뭐!?` rendered from:

```text
font/NanumSquareRoundR.ttf
```

Render command:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\render-text-to-message-pgm.ps1 -FontPath font\NanumSquareRoundR.ttf -Text "뭐!?" -OutPath tmp\SLPS-01903\message-mask-pgm\message-mask-1004-ko-mwo.pgm -FontSize 24 -X 0 -Y 0 -Mode AntiAlias -TrimToOrigin
```

Patch command:

```powershell
node scripts\message-mask-pgm-tool.js patch ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\patched-FS2_FILE-1004-ko-mwo.DAT 1004 tmp\SLPS-01903\message-mask-pgm\message-mask-1004-ko-mwo.pgm
```

Generated files:

```text
tmp/SLPS-01903/message-mask-pgm/message-mask-1004-ko-mwo.pgm
tmp/SLPS-01903/patched-FS2_FILE-1004-ko-mwo.DAT
tmp/SLPS-01903/patched-1004-ko-mwo-preview.html
tmp/SLPS-01903/patched-1004-ko-mwo-preview-bgfe.html
```

Verification:

```text
OK 1004: mask 0x930 bytes round-trips, sectors 30882..30888
diffBytes 145 first 0x3c51003 last 0x3c51398
bbox 0 0 39 20
```

The `뭐!?` PGM was also compared against a separately rendered `?!?` PGM and
the pixel data differs, confirming that the Korean glyph render path was used.

## Korean Three-Line Size Test

Message `1004` was also rendered as three lines at font size `14` to check a
line budget suitable for normal dialogue:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\render-text-to-message-pgm.ps1 -FontPath font\NanumSquareRoundR.ttf -Text "뭐!?\n뭐!?\n뭐!?" -OutPath tmp\SLPS-01903\message-mask-pgm\message-mask-1004-ko-mwo-3line-f14.pgm -FontSize 14 -X 0 -Y 0 -LineHeight 14 -Mode AntiAlias -TrimToOrigin
node scripts\message-mask-pgm-tool.js patch ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\patched-FS2_FILE-1004-ko-mwo-3line-f14.DAT 1004 tmp\SLPS-01903\message-mask-pgm\message-mask-1004-ko-mwo-3line-f14.pgm
```

Generated files:

```text
tmp/SLPS-01903/message-mask-pgm/message-mask-1004-ko-mwo-3line-f14.pgm
tmp/SLPS-01903/patched-FS2_FILE-1004-ko-mwo-3line-f14.DAT
tmp/SLPS-01903/patched-1004-ko-mwo-3line-f14-preview.html
tmp/SLPS-01903/patched-1004-ko-mwo-3line-f14-preview-bgfe.html
```

Verification:

```text
OK 1004: mask 0x930 bytes round-trips, sectors 30882..30888
diffBytes 198 first 0x3c51001 last 0x3c5167c
bbox 0 0 23 39
```

## Korean Three-Line 16px Pad Test

`16px` also fits in three lines when rendered with a tighter `15px` line height
and `1px` canvas padding:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\render-text-to-message-pgm.ps1 -FontPath font\NanumSquareRoundR.ttf -Text "뭐!?\n뭐!?\n뭐!?" -OutPath tmp\SLPS-01903\message-mask-pgm\message-mask-1004-ko-mwo-3line-f16-lh15-pad1.pgm -FontSize 16 -X 0 -Y 0 -LineHeight 15 -Pad 1 -Mode AntiAlias -TrimToOrigin
node scripts\message-mask-pgm-tool.js patch ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\patched-FS2_FILE-1004-ko-mwo-3line-f16-lh15-pad1.DAT 1004 tmp\SLPS-01903\message-mask-pgm\message-mask-1004-ko-mwo-3line-f16-lh15-pad1.pgm
```

Generated files:

```text
tmp/SLPS-01903/message-mask-pgm/message-mask-1004-ko-mwo-3line-f16-lh15-pad1.pgm
tmp/SLPS-01903/patched-FS2_FILE-1004-ko-mwo-3line-f16-lh15-pad1.DAT
tmp/SLPS-01903/patched-1004-ko-mwo-3line-f16-lh15-pad1-preview.html
tmp/SLPS-01903/patched-1004-ko-mwo-3line-f16-lh15-pad1-preview-bgfe.html
```

Verification:

```text
OK 1004: mask 0x930 bytes round-trips, sectors 30882..30888
diffBytes 216 first 0x3c51008 last 0x3c51690
bbox 2 1 28 44
```

## Current Limits

- This replaces the visible `200x48` rendered mask data and now also rebuilds
  the segment/reveal header stored after the mask. At runtime that header lands
  at `commonBuffer + 0x1930`.
- The rebuilt segment count is based on the last visible pixel in the
  replacement mask. This keeps the original progressive left-to-right reveal
  path while allowing longer Korean masks to finish rendering before the
  message enters the completed state.
- Replacement text still must fit within the existing `200x48` canvas.
- Use `scripts/message-mask-pgm-tool.js patch ... --keep-reveal` only when an
  exact old-style mask-only patch is needed for comparison.
- `3002` is included because it renders as a readable message-bank candidate,
  although the current approximate script-position scan does not find a direct
  `opcode 0x41` reference after the checked-reader fix.
