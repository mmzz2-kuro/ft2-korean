# SLPS-01903 Message/Font Resource Candidates

## Current Correction

`tmp/SLPS-01903/rect-page0-16bpp.html` shows character portrait frames. The
`0x8017C6F4 -> 0x8017C4F0 -> 0x80188090` route is therefore a
portrait/expression image route, not the Japanese dialogue font route.

This is probably not encryption. The data renders correctly when interpreted as
16bpp 60x96 rectangle chunks, and the game path reads 6 sectors then transfers
the rectangle to VRAM without an obvious decrypt/decompress step.

## Stronger Text/Font Candidate: `0x8017FF00`

Disassembly:

```text
0x8017FF00:
  scriptWord = 0x8017C364()
  resourceId = scriptWord + 4277
  0x80187DE4(resourceId, commonBuffer)
  for i in 0..0xD7F:
    if commonBuffer[i] == 0:
      commonBuffer[i] = 0xFE
  copy 0xD80 bytes from commonBuffer to 0x8005B000
```

This path is more promising than the portrait path because it:

- consumes a script parameter;
- selects a late FS2 resource range with `4277 + value`;
- normalizes zero bytes into `0xFE`, which looks like a tile/control sentinel
  conversion;
- writes a fixed `0xD80` byte block to a display work buffer.

## Resource Range `4277..4449`

Quick scan result:

- `4277`: size `0x800`, mostly zero, nonzero first bytes:
  `7c 00 7b d6 7a ce 7b 10 7a ac 79 e8`
- `4278..4302`: mostly `0x1000` blocks, very sparse, many `0x00` and `0x4D`
  bytes.
- `4303..4449`: mostly `0x3000` blocks, many sparse image/tile-like blocks.
- Some blocks such as `4393`, `4439`, `4441`, `4447`, `4449` have distinctive
  repeated low-byte patterns and may be graphics/tile data rather than text.

The `0xD80` copy length does not match every resource size exactly. That may mean
the handler only uses the first `0xD80` bytes of each selected resource, or that
only a subset of `4277+n` resources is valid for this opcode.

## Related Work Buffers

The EXE also references nearby fixed buffers:

| buffer | observed use |
| --- | --- |
| `0x8005B000` | destination of `0x8017FF00` postprocessed `0xD80` byte block |
| `0x8005C000` | used by `0x8017A6E8`/`0x8017A740` family as generated GPU/display work data |
| `0x8005C800` | second generated display work block in the same family |
| `0x8005F000` | cleared and transferred to VRAM rect `x=508, y=248, w=4, h=8` by `0x8017BCF0` |

`0x8017A740` and nearby routines convert compact byte data into buffers at
`0x8005C000`/`0x8005C800`, then call GPU/display routines such as
`0x8016CBB4` and `0x8016CC10`. This looks like a likely consumer family for
text/font tile preparation, but the direct link from `0x8005B000` still needs to
be proven.

## Next Steps

1. Find the opcode/dispatch entry that reaches `0x8017FF00`, then collect actual
   scriptWord values used for `4277+n`.
2. Trace how `0x8005B000` is passed into the `0x8017A740` display conversion
   family, or find another consumer.
3. Generate previews for selected `4277+n` blocks as tilemaps/bitplanes, not as
   Shift-JIS text.
4. Once the real message/font format is identified, build an opcode-aware
   extractor for script banks `309..326`.

## Generated Preview HTML

Generated with:

```powershell
node scripts\export-fs2-message-candidate-html.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\message-candidates-4277-4302.html --start 4277 --count 26 --columns 1 --scale 2
node scripts\export-fs2-message-candidate-html.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\message-candidates-4303-4449.html --start 4303 --count 147 --columns 1 --scale 1
node scripts\export-fs2-message-candidate-html.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\message-candidates-interesting.html --start 4390 --count 60 --columns 1 --scale 2 --views byte64,1bpp128,1bpp256,2bpp128,4bpp128,8bpp64,16bpp64
```

Open these files:

- `tmp/SLPS-01903/message-candidates-4277-4302.html`
- `tmp/SLPS-01903/message-candidates-4303-4449.html`
- `tmp/SLPS-01903/message-candidates-interesting.html`

Each resource is shown in several interpretations:

- `byte64`: raw byte grayscale, 64 bytes per row.
- `1bpp128` / `1bpp256`: 1bpp bitmap views.
- `2bpp128`: 2bpp packed bitmap view.
- `4bpp128`: 4bpp packed bitmap view.
- `8bpp64`: 8bpp grayscale/raw-index view.
- `16bpp64`: 16bpp PS1 RGB555 grayscale view.

For each view, the left pane is raw data and the right pane applies the
`0x8017FF00` preprocessing step that converts `0x00` to `0xFE`.

## 2026-06-30 Follow-up: Offset and Other Candidates

Manual review of the first three preview HTML files did not show recognizable
Japanese glyphs. The visible patterns look more like tilemaps, intermediate
display buffers, or compressed/packed draw data than a font atlas.

Offset adjustment may still matter for large resources, but it is unlikely to
turn the `4277+n` range itself into readable Japanese glyphs. The stronger next
direction is to inspect other display/font-like resources.

New preview files:

```powershell
node scripts\export-fs2-message-candidate-html.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\font-candidates-827-900.html --start 827 --count 74 --columns 1 --scale 1 --limit-bytes 16384 --views 1bpp128,1bpp256,2bpp128,4bpp128,8bpp64,16bpp64
node scripts\export-fs2-message-candidate-html.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\font-candidates-827-828-payload.html --start 827 --count 2 --columns 1 --scale 1 --data-offset 16 --limit-bytes 32768 --views 1bpp128,1bpp256,2bpp128,4bpp128,8bpp64,16bpp64
node scripts\export-fs2-message-candidate-html.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\font-candidate-757.html --start 757 --count 1 --columns 1 --scale 2 --limit-bytes 8192 --views 1bpp128,1bpp256,2bpp128,4bpp128,8bpp64,16bpp64
node scripts\export-fs2-message-candidate-html.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\font-candidates-1151-1169.html --start 1151 --count 19 --columns 1 --scale 2 --limit-bytes 8192 --views 1bpp128,1bpp256,2bpp128,4bpp128,8bpp64,16bpp64
node scripts\export-fs2-message-candidate-html.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\font-candidate-829-offset-sweep.html --start 829 --count 1 --columns 1 --scale 2 --limit-bytes 4096 --offsets 0,0x1000,0x2000,0x3000,0x4000,0x5000,0x6000,0x7000,0x8000,0x9000,0xa000,0xb000,0xc000,0xd000,0xe000,0xf000,0x10000,0x11000,0x12000,0x13000,0x14000 --views 1bpp128,1bpp256,2bpp128,4bpp128,8bpp64,16bpp64
node scripts\export-fs2-message-candidate-html.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\message-candidate-4303-offset-sweep.html --start 4303 --count 1 --columns 1 --scale 2 --limit-bytes 2048 --offsets 0,0x100,0x200,0x300,0x400,0x500,0x600,0x700,0x800,0x900,0xa00,0xb00,0xc00,0xd00,0xe00,0xf00,0x1000,0x1400,0x1800,0x1c00,0x2000,0x2400,0x2800 --views byte64,1bpp128,1bpp256,2bpp128,4bpp128,8bpp64,16bpp64
```

Open these files:

- `tmp/SLPS-01903/font-candidates-827-900.html`
- `tmp/SLPS-01903/font-candidates-827-828-payload.html`
- `tmp/SLPS-01903/font-candidate-757.html`
- `tmp/SLPS-01903/font-candidates-1151-1169.html`
- `tmp/SLPS-01903/font-candidate-829-offset-sweep.html`
- `tmp/SLPS-01903/message-candidate-4303-offset-sweep.html`

Quick resource scan for `FF`-heavy 1bpp-like data found:

| resource | note |
| ---: | --- |
| `757` | `0x2000` bytes, `FF`-heavy, possible bitmap/mask candidate |
| `829` | `0x15000` bytes, large `FF`-heavy candidate |
| `1151..1169` | known UI mask-like range, useful for comparison but probably not dialogue body |

`827` and `828` have 16-byte big-endian headers and should be inspected both
from offset `0` and payload offset `0x10`.

## 2026-06-30 Correction: Exact 1bpp Widths

Manual review confirmed `1151..1169` contains readable pre-rendered Japanese UI
strings such as the day display. This range is not the main dialogue font; it is
a set of baked 1bpp UI masks.

The `829+n` path was initially previewed with generic widths such as 128 or 256
pixels. The disassembly shows the actual draw call uses:

```text
0x801AE38C / 0x801AE4FC / 0x801B15B0:
  load resource 829 + index to commonBuffer + 0x2000
  0x801AD230(x, y, widthBytes=36, heightBlocks=8, source=commonBuffer+0x2000, fg=2)
```

So the correct preview shape is:

```text
36 bytes per row * 8 pixels = 288 pixels wide
8 height blocks * 8 rows = 64 pixels high
36 * 64 = 0x900 bytes used
```

New exact-width preview files:

```powershell
node scripts\export-fs2-message-candidate-html.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\text-mask-candidates-829-840-1bpp288.html --start 829 --count 12 --columns 1 --scale 2 --limit-bytes 2304 --views 1bpp288,1bpp144,1bpp576
node scripts\export-fs2-message-candidate-html.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\text-mask-candidates-1008-1015-1bpp288.html --start 1008 --count 8 --columns 1 --scale 2 --limit-bytes 2304 --views 1bpp288,1bpp144,1bpp576
node scripts\export-fs2-message-candidate-html.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\text-mask-candidates-1074-1080-1bpp288.html --start 1074 --count 7 --columns 1 --scale 2 --limit-bytes 2304 --views 1bpp288,1bpp144,1bpp576
node scripts\export-fs2-message-candidate-html.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\ui-mask-candidates-1151-1169-1bpp256.html --start 1151 --count 19 --columns 1 --scale 2 --limit-bytes 2048 --views 1bpp256
```

Open:

- `tmp/SLPS-01903/text-mask-candidates-829-840-1bpp288.html`
- `tmp/SLPS-01903/text-mask-candidates-1008-1015-1bpp288.html`
- `tmp/SLPS-01903/text-mask-candidates-1074-1080-1bpp288.html`
- `tmp/SLPS-01903/ui-mask-candidates-1151-1169-1bpp256.html`

## 2026-07-01: Pre-rendered Text Masks Confirmed

Manual review confirmed that `830+` renders readable Japanese when interpreted
as `1bpp288 raw`. Resource `829` itself appears noisy or special, but resource
`830` begins with a readable item-description style mask:

```text
どこでも生えている一般的な薬草。
体力を２０回復する。
```

Current interpretation:

| range | layout | status |
| --- | --- | --- |
| `829..900` | `36 bytes/row * 64 rows = 288x64 1bpp`, first `0x900` bytes used | readable pre-rendered item/help description masks; `829` likely unused/special/noisy |
| `1008..1080` | same `288x64 1bpp` layout | readable pre-rendered item/help description masks |
| `1074+n` | same `288x64 1bpp` renderer family | overlaps the `1008..1080` item/help family; keep as renderer xref rather than a separate font |
| `1151..1169` | `32 bytes/row * 64 rows = 256x64 1bpp` | pre-rendered day/status UI strings such as `1日目` |

Generated wider exact-width previews:

```powershell
node scripts\export-fs2-message-candidate-html.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\text-mask-candidates-829-900-1bpp288.html --start 829 --count 72 --columns 1 --scale 2 --limit-bytes 2304 --views 1bpp288
node scripts\export-fs2-message-candidate-html.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\text-mask-candidates-1008-1080-1bpp288.html --start 1008 --count 73 --columns 1 --scale 2 --limit-bytes 2304 --views 1bpp288
```

Open:

- `tmp/SLPS-01903/text-mask-candidates-829-900-1bpp288.html`
- `tmp/SLPS-01903/text-mask-candidates-1008-1080-1bpp288.html`

Important consequence for Korean patching: at least some Japanese text is not
drawn from a reusable runtime font. It is stored as finished 1bpp mask images.
Replacing these strings may require image-level replacement, unless a separate
source text/font compiler format is found.

## 2026-07-01: Dialogue Route Pivot

Manual classification now treats `829..900` and `1008..1080` as item/help
description masks, not the main dialogue body. The strongest dialogue lead is
the script VM opcode path below.

```text
0x8017E4B8:
  opcode = 0x8017C364()
  handler = dispatchTable[opcode] at 0x801C4D4C
  jalr handler

opcode 0x41 -> handler 0x8017E638:
  messageId = 0x8017C364()
  0x8017CD88(messageId)

0x8017CD88:
  clear 0x8001D000, length 0x2580
  0x80187F54(messageId, commonBuffer + 0x1000, mode = gp+500)
  0x8017CC90()
  if mode != 0:
    0x80188070()
    0x8017CC4C()
```

`0x8017CC4C` loops 588 times through `0x8017C7C0()` and then transfers a
`100x48` rectangle from `0x8001D000` to VRAM. This is much closer to the main
rendered dialogue body than the fixed item/help masks.

`0x80187F54` does not use the ordinary FS2 sector table directly. It groups
`messageId` values around `1001`, reads a 2-sector header/control block, then
optionally reads the remaining sectors. That suggests dialogue text is in a
packed message-bank layout indexed by IDs such as `1001`, `1004`, `2001`,
`2004`, `3002`, and so on.

Reproducible scan:

```powershell
node scripts\scan-dialogue-opcode-refs.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 --ids 309-326 --opcode 0x41
```

Current valid-looking script-position `opcode 0x41` refs after applying the
`0x80187F54` group table bounds and counting the checked reader `0x8017C390`:

```text
1001 1004
1103 1104 1105 1106
2001 2004 2007 2008 2009
4001 4003 4004 4005 4007
6001 6002 6003 6004 6005
7002 7003 7004
```

`3002` remains a readable rendered message-bank candidate, but the current
script-position parser no longer finds it after the checked-reader fix. The
same scan still reports repeated small values such as `6` and `8`, and some
out-of-range IDs; treat those as parser desync/noise until the VM's branch and
variable-length opcodes are fully modeled. See
`docs/projects/SLPS-01903/dialogue-route.md` for exact sector mapping and the
packed-mask round-trip result.
