# SLPS-01903 Dialogue Route Notes

## Current Lead

The main dialogue path is script opcode `0x41`, not the pre-rendered 1bpp
item/help masks. Manual review of the generated render previews confirmed that
message IDs `1004` through `7004` in this route are dialogue text.

Dispatch:

```text
0x8017E4B8:
  opcode = 0x8017C364()
  handler = *(0x801C4D4C + opcode * 4)
  jalr handler
```

Important dispatch entries:

| opcode | handler | current classification |
| ---: | --- | --- |
| `0x3F` | `0x8017E5D8` | portrait/expression slot 0 |
| `0x40` | `0x8017E608` | portrait/expression slot 1 |
| `0x41` | `0x8017E638` | main dialogue/message candidate |
| `0x76` | `0x8017FE80` | 256x64 1bpp day/status UI mask |
| `0x78` | `0x8017FF00` | display-work block candidate; currently lower confidence |

## Opcode `0x41`

Handler:

```text
0x8017E638:
  clear 0x801CBDF8
  messageId = 0x8017C364()
  0x8017CD88(messageId)
```

Renderer/load path:

```text
0x8017CD88(messageId):
  clear 0x8001D000, length 0x2580
  0x80187F54(messageId, commonBuffer + 0x1000, mode = gp+500)
  store returned length/count at gp+502
  0x8017CC90()
  if mode != 0:
    0x80188070()
    0x8017CC4C()
```

`0x8017CC4C` calls `0x8017C7C0(index)` for `index = 0..587`, then
`0x8017C750` transfers a `100x48` rectangle from `0x8001D000` to VRAM. This
looks like a rendered dialogue bitmap work buffer.

`0x8017CC90` preprocesses the loaded block:

```text
commonBuffer + 0x1000: byte-swap 0x930 bytes as halfwords
commonBuffer + 0x1930: byte-swap 0xD0 bytes as words
then build a table at commonBuffer + 0x0000 from the header/count data
```

## Message Bank Loader

`0x80187F54` is not the ordinary `0x80187DE4(resourceId, dst)` FS2 loader.
It treats the incoming `messageId` as a packed message-bank index:

```text
messageId - 1001
-> choose a group table from 0x80169DB0
-> choose a sector base from 0x801D0B90
-> read 2 sectors to dst
-> if mode == 0, read the remaining sectors to dst + 0x1000
```

This is why candidate IDs look like `1004`, `2001`, `3002`, `7004`, etc. They
are not normal FS2 resource IDs, even though they share the same numeric space.

Corrected table addresses:

| table | address | role |
| --- | --- | --- |
| group pointer table | `0x80169DB0` | 17 pointers to per-group sector offset tables |
| group base-sector table | `0x801D0B90` | runtime-built base sectors; this uses the end sector of each extended range |
| extended range start table | `0x801D0BD8` | runtime-built start sectors for the 17 extended ranges |

The rough mapping is:

```text
n = messageId - 1001
group = floor(n / 1000)
index = n % 1000
sectorStart = groupBase[group] + groupOffsetTable[group][index]
sectorEnd = groupBase[group] + groupOffsetTable[group][index + 1]
```

## Script Scan

Use:

```powershell
node scripts\scan-dialogue-opcode-refs.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 --ids 309-326 --opcode 0x41
```

The scanner is approximate. It uses entry pointer boundaries and static
script-word reader counts per handler. It currently counts both `0x8017C364`
and the checked reader `0x8017C390`, but it can still desync on branches and
variable-length opcodes. Treat small repeated values such as `6` or `8` as
noise until the VM parser is complete.

Current script-position scan output:

```text
1001 1004
1103 1104 1105 1106
1203 1204
1301 1303
1502 1508
1603
1707 1708 1714
2000
2001 2004 2007 2008 2009
4001 4003 4004 4005 4007
6001 6002 6003 6004 6005
7000 7002 7003 7004
```

After applying the `0x80187F54` group table bounds, the current script-position
scan has 24 valid message refs and 34 parser-noise hits. The valid refs are:

```text
1001 1004
1103 1104 1105 1106
2001 2004 2007 2008 2009
4001 4003 4004 4005 4007
6001 6002 6003 6004 6005
7002 7003 7004
```

`3002` is still a readable rendered message-bank candidate, but the current
script-position scan no longer finds it after the `0x8017C390` reader fix.

Mapped sector ranges:

| messageId | group | index | DAT offset | bytes | sectors |
| ---: | ---: | ---: | ---: | ---: | --- |
| `1001` | 0 | 0 | `0x03C37000` | `0xD000` | `30830..30856` |
| `1004` | 0 | 3 | `0x03C51000` | `0x3000` | `30882..30888` |
| `1103` | 0 | 102 | `0x04060000` | `0x8000` | `32960..32976` |
| `1104` | 0 | 103 | `0x04068000` | `0xF000` | `32976..33006` |
| `1105` | 0 | 104 | `0x04077000` | `0x4000` | `33006..33014` |
| `1106` | 0 | 105 | `0x0407B000` | `0x2000` | `33014..33018` |
| `2001` | 1 | 0 | `0x045C7000` | `0x11000` | `35726..35760` |
| `2004` | 1 | 3 | `0x045E8000` | `0x9000` | `35792..35810` |
| `2007` | 1 | 6 | `0x0460B000` | `0x4000` | `35862..35870` |
| `2008` | 1 | 7 | `0x0460F000` | `0x10000` | `35870..35902` |
| `2009` | 1 | 8 | `0x0461F000` | `0x6000` | `35902..35914` |
| `3002` | 2 | 1 | `0x053D5000` | `0x14000` | `42922..42962` |
| `4001` | 3 | 0 | `0x05C02000` | `0x7000` | `47108..47122` |
| `4003` | 3 | 2 | `0x05C0F000` | `0xE000` | `47134..47162` |
| `4004` | 3 | 3 | `0x05C1D000` | `0xA000` | `47162..47182` |
| `4005` | 3 | 4 | `0x05C27000` | `0xA000` | `47182..47202` |
| `4007` | 3 | 6 | `0x05C36000` | `0x8000` | `47212..47228` |
| `6001` | 5 | 0 | `0x06DCF000` | `0x8000` | `56222..56238` |
| `6002` | 5 | 1 | `0x06DD7000` | `0x8000` | `56238..56254` |
| `6003` | 5 | 2 | `0x06DDF000` | `0x7000` | `56254..56268` |
| `6004` | 5 | 3 | `0x06DE6000` | `0x2000` | `56268..56272` |
| `6005` | 5 | 4 | `0x06DE8000` | `0x9000` | `56272..56290` |
| `7002` | 6 | 1 | `0x07497000` | `0x5000` | `59694..59704` |
| `7003` | 6 | 2 | `0x0749C000` | `0x4000` | `59704..59712` |
| `7004` | 6 | 3 | `0x074A0000` | `0x13000` | `59712..59750` |

## Next Work

Raw message-bank blocks can now be dumped with:

```powershell
node scripts\dump-message-bank-block.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\message-banks 1004 1103 2001 2004 3002 4001 6001 7004
```

Generated sample files:

```text
tmp/SLPS-01903/message-banks/message-bank-1004.bin
tmp/SLPS-01903/message-banks/message-bank-1103.bin
tmp/SLPS-01903/message-banks/message-bank-2001.bin
tmp/SLPS-01903/message-banks/message-bank-2004.bin
tmp/SLPS-01903/message-banks/message-bank-3002.bin
tmp/SLPS-01903/message-banks/message-bank-4001.bin
tmp/SLPS-01903/message-banks/message-bank-6001.bin
tmp/SLPS-01903/message-banks/message-bank-7004.bin
```

The dumped blocks do not begin with plain Shift-JIS text. Their first bytes look
like packed bitmap/control data, which matches the game path that builds a
render table and then draws a `100x48` mask.

First offline full-render preview:

```powershell
node scripts\render-message-bank-html.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\message-bank-render-preview.html 1004 1103 1104 1105 1106 2001 2004 3002 4001 6001 7004 --scale 4 --bg 00
node scripts\render-message-bank-html.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\message-bank-render-preview-bgfe.html 1004 1103 1104 1105 1106 2001 2004 3002 4001 6001 7004 --scale 4 --bg fe
```

Open:

```text
tmp/SLPS-01903/message-bank-render-preview.html
tmp/SLPS-01903/message-bank-render-preview-bgfe.html
```

Full valid-candidate preview:

```powershell
node scripts\render-message-bank-html.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\message-bank-render-valid-candidates.html 1001 1004 1103 1104 1105 1106 2001 2004 2007 2008 2009 3002 4001 4003 4004 4005 4007 6001 6002 6003 6004 6005 7002 7003 7004 --scale 4 --bg 00
node scripts\render-message-bank-html.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\message-bank-render-valid-candidates-bgfe.html 1001 1004 1103 1104 1105 1106 2001 2004 2007 2008 2009 3002 4001 4003 4004 4005 4007 6001 6002 6003 6004 6005 7002 7003 7004 --scale 4 --bg fe
```

Open:

```text
tmp/SLPS-01903/message-bank-render-valid-candidates.html
tmp/SLPS-01903/message-bank-render-valid-candidates-bgfe.html
```

Script-position preview and manifest:

```powershell
node scripts\export-dialogue-script-preview-html.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\dialogue-script-preview.html --ids 309-326 --scale 4 --bg 00
node scripts\export-dialogue-script-preview-html.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\dialogue-script-preview-bgfe.html --ids 309-326 --scale 4 --bg fe
```

Open:

```text
tmp/SLPS-01903/dialogue-script-preview.html
tmp/SLPS-01903/dialogue-script-preview-bgfe.html
```

See also:

```text
docs/projects/SLPS-01903/dialogue-script-map.md
```

Implementation notes:

- The script reproduces the `0x8017CC90` byte swaps for `commonBuffer+0x1000`
  and `commonBuffer+0x1930`.
- The full render loop uses `0x8017C7C0`'s 588 entries from
  `commonBuffer+0x1000`.
- Each entry contains two 16-bit vertical 2bpp strips. The game writes the low
  bits to the lower row first, so each 8-row halfword is vertically reversed
  while rendering.
- The preview canvas is `200x48` bytes. This corresponds to the work buffer
  that the game sends as a `100x48` 4bpp VRAM rectangle.

Packed-mask round-trip check:

```powershell
node scripts\verify-message-bank-pack.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 1001 1004 1103 1104 1105 1106 2001 2004 2007 2008 2009 3002 4001 4003 4004 4005 4007 6001 6002 6003 6004 6005 7002 7003 7004
```

Result: all 25 checked message masks round-trip from packed `0x930` bytes to
the `200x48` preview pixels and back to identical packed bytes. This confirms
that a direct image-level Korean replacement path can target the first `0x930`
bytes of the preprocessed message block, then apply the inverse halfword byte
swap before reinsertion into `FS2_FILE.DAT`.

PGM export/patch workflow:

```text
docs/projects/SLPS-01903/dialogue-mask-replacement.md
```

Current extracted masks:

```text
tmp/SLPS-01903/message-mask-pgm/
```

1. Create a small Korean replacement mask for one low-risk message ID, likely
   `1004`, within the existing `200x48` canvas.
2. Patch it into a DAT copy with `scripts/message-mask-pgm-tool.js`.
3. Rebuild or inject the modified DAT into the disc image, then test in an
   emulator.
4. Improve the VM parser so the skipped parser-noise hits can be classified.
