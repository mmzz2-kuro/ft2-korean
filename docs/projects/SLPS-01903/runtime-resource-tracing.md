# SLPS-01903 Runtime Resource Tracing

Static previews ruled out the visible `be-hdr` candidate groups checked so far.
The next step is to identify resources loaded at the exact moment a target menu
or status/config screen appears.

## Savestate Diff Method

This method does not require an emulator debugger. It scans emulator savestates
or RAM dumps for FS2 resource byte signatures.

1. Load the game just before opening the target UI.
2. Save a state as the "before" file.
3. Open the target menu/status/config/shop UI and wait until it is fully drawn.
4. Save a second state as the "after" file.
5. Run:

```powershell
node scripts\scan-runtime-resource-hits.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 path\to\after.state --before path\to\before.state --sig-len 64 --min-size 1024
```

The output lists resource IDs that appear in the after state but not in the
before state:

```text
id  stateOffset  datOffset  size  variant  sigRel  sigMatches  class
```

Useful options:

```powershell
--ids 0-2000
--ids 245-302,633-660,758-807
--sig-len 96
--min-size 2048
```

If the savestate format stores RAM compressed with gzip/zlib, the script tries
to decompress it automatically. If it reports no useful hits, export or obtain a
raw RAM dump from an emulator/debugger and pass that file as the after/before
input instead.

## Debugger Log Method

If using an emulator with CPU breakpoints/logpoints, log register `a0` at these
resource loader entry points:

```text
0x80187DE4
0x80187E14
0x80187D84
0x80187E70
```

Procedure:

1. Start logging before opening the target UI.
2. Open the target UI.
3. Stop logging once the UI is fully visible.
4. Inspect the `a0` values loaded immediately before the screen appears.

Those `a0` values are the most likely FS2 resource IDs for that UI.

## Ruled-Out Static Candidates

Manual visual review ruled these out as system UI:

- `266..286`: opening character-description graphics and backgrounds.
- `245..264`, `301..302`, `633`, `657..660`: same opening/image family.
- `758..807`: same opening/image family.

## 2026-07-03 RAM Dump Results

DuckStation RAM dumps were added under `ram-dump/`:

- `state4.bin`: title screen before opening the title menu.
- `state5.bin`: title screen after opening the title menu.
- `state6.bin`: town screen before opening the town menu.
- `state7.bin`: town screen after opening the town menu.

Title menu diff:

```powershell
node scripts\scan-runtime-resource-hits.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 ram-dump\state5.bin --before ram-dump\state4.bin --sig-len 64 --min-size 1024
```

Newly loaded title-menu candidates:

```text
811, 814, 819, 821, 823, 826,
1195, 1196, 1198, 1200, 1205, 1208, 1209
```

Preview:

```text
tmp/SLPS-01903/runtime-title-menu-candidates-811-1209.html
```

Town menu diff:

```powershell
node scripts\scan-runtime-resource-hits.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 ram-dump\state7.bin --before ram-dump\state6.bin --sig-len 64 --min-size 1024
```

Result: `newHits=0`. The town menu graphics/text appear to be preloaded before
the menu is opened.

Useful town-menu after-state candidates from `state7.bin`, narrowed to the
small label-like `be-hdr` resources:

```text
812, 813, 815, 816, 817, 818, 820, 822, 824, 825, 827, 828,
1189, 1191, 1192, 1193, 1197, 1199, 1203, 1204, 1206, 1207,
1210, 1211, 1212, 1213
```

Additional wider/panel-like town candidates:

```text
1170, 1171, 1172, 1173, 1174, 1175, 1176, 1177, 1178, 1179,
1180, 1181, 1182, 1184, 1185, 1187, 1190, 1214, 1215, 1216,
1217
```

Previews:

```text
tmp/SLPS-01903/runtime-town-menu-small-candidates-812-1213.html
tmp/SLPS-01903/runtime-town-menu-wide-candidates-1170-1217.html
```

## 2026-07-04 be-hdr UI Follow-up

Additional contact sheets were generated with palette indexes
`1,2,224-231`, which cover both the low-index shadow pixels and the normal
white label pixels:

```powershell
python scripts\export-behdr-contact-sheet.py tmp\SLPS-01903\be-hdr-ui-workflow\extracted-FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\be-hdr-ui-workflow\menu-text-contact-811-1213.png 811-828 1189 1191-1200 1203-1213 --indexes 1,2,224-231 --scale 2 --cols 4
python scripts\export-behdr-contact-sheet.py tmp\SLPS-01903\be-hdr-ui-workflow\extracted-FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\be-hdr-ui-workflow\status-panel-contact-1170-1217.png 1170-1182 1184 1185 1187 1190 1214-1217 --indexes 1,2,224-231 --scale 2 --cols 3
```

Current findings:

- `811..826`: short fixed battle/map message-window labels such as enemy defeat
  objectives.
- `827`: shared menu/system/place-name atlas. The title-menu selected row uses
  both `1,2` and `224-231`; erasing only `1,2` leaves a blue Japanese shadow.
- `1170` and `1172`: character information/status label panels (`経験値`,
  `属性`, `体力`, `魔力`, `攻撃力`, `防御力`, `知力`, `魔抗力`, `敏捷さ`, `LV`).
- `1173..1187`, `1190`: equipment, shop, item, and configuration panel labels.
- `1214..1217`: save/memory-card warning panels.

Character names/classes/status strings such as `カリン`, `魔法使い`, and `正常`
were not found as plain Shift-JIS in the EXE or extracted `FS2_FILE.DAT`.
They may be rendered from another runtime table or encoded resource. Capture
RAM dumps immediately before and after opening the character status screen to
pin down that path.

## 2026-07-04 Character Info RAM Dumps

DuckStation RAM dumps were added for character/monster information windows:

- `ram-dump/menu-karin.bin`: Karin information window.
- `ram-dump/menu-al.bin`: Al information window.
- `ram-dump/menu-slime.bin`: Slime monster information window.
- `ram-dump/nomenu.bin`: before opening the information window.

`nomenu.bin` is a 1 MiB dump while the three menu dumps are 2 MiB, so direct
before/after diff output is noisy. A focused scan over known be-hdr UI IDs was
more useful:

```powershell
node scripts\scan-runtime-resource-hits.js tmp\SLPS-01903\be-hdr-ui-workflow\extracted-FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 ram-dump\menu-karin.bin --ids 811-829,1170-1217 --sig-len 64 --min-size 512
node scripts\scan-runtime-resource-hits.js tmp\SLPS-01903\be-hdr-ui-workflow\extracted-FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 ram-dump\menu-al.bin --ids 811-829,1170-1217 --sig-len 64 --min-size 512
node scripts\scan-runtime-resource-hits.js tmp\SLPS-01903\be-hdr-ui-workflow\extracted-FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 ram-dump\menu-slime.bin --ids 811-829,1170-1217 --sig-len 64 --min-size 512
```

All three information-window dumps contain the same focused UI resource set.
Comparing Karin/Al/Slime against each other produced no newly loaded be-hdr
resource IDs, so the window appears to reuse the same fixed label resources and
draw variable values separately.

Generated review sheets:

```text
tmp/SLPS-01903/runtime-menu-info-contact-1170-1217.png
tmp/SLPS-01903/runtime-menu-info-contact-811-829.png
```

Detected information-window text resources:

- `1170`: character status label panel. Contains labels such as `経験値`, `属性`,
  `体力`, `魔力`, `攻撃力`, `防御力`, `知力`, `魔抗力`, `敏捷さ`, and `LV`.
- `1171`: smaller status subpanel variant with `属性` and `LV`.
- `1172`: status/menu variant containing the same core stat labels plus
  `情報` and `キャンセル`.
- `1177`: unit command/status menu labels such as `装備`, `渡す`, `売る`,
  `情報`, `キャンセル`, `能力`, `装備`, `特技`, and `道具`.
- `1183`: item/equipment information panel variant. Contains `買う`, `情報`,
  `ユット`, `帰る`, `装備可能`, `能力`, `所持金`.
- `827`: shared system/menu/place-name atlas. It is still used by map menu and
  place-name labels alongside the information-window flow.

Working export for these IDs:

```powershell
node scripts\export-behdr-ui-translation-table.js tmp\SLPS-01903\be-hdr-ui-workflow\extracted-FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\menu-info-ui-workflow\menu-info-ui-translation.tsv tmp\SLPS-01903\menu-info-ui-workflow\masks --ids 827,1170,1171,1172,1177,1183 --font-size 24 --line-height 24 --pad 1 --threshold 64 --bold 0 --ink-index 15 --bg-index 0 --invert
```

Variable values visible in the information window, such as character names,
classes, status text, and numbers, were not found as plain CP932/Shift-JIS in
the RAM dumps. They are likely encoded or rendered through a separate runtime
table/path rather than stored as ordinary strings in these dumps.

## 2026-07-04 Karin Stat Change RAM Compare

Two additional 2 MiB RAM dumps were compared:

- `ram-dump/karin-mp-13-exp-100.bin`: before action, Karin MP 13 and EXP 100.
- `ram-dump/karin-mp-3-exp-116.bin`: after action, Karin MP 3 and EXP 116.

The strongest matching unit/stat table candidate is at raw RAM dump offset
`0x1eb330` (PSX RAM address `0x801eb330` if the dump starts at `0x80000000`).
The relevant values are little-endian 16-bit words.

Before:

```text
offset 0x1eb330:
0, 0, 27, 27, 27, 13, 100, 23, 18, 27, 17, 22, 1, 0, 0, 0
```

After:

```text
offset 0x1eb330:
0, 0, 27, 27, 27, 3, 116, 23, 18, 27, 17, 22, 1, 0, 0, 0
```

Confirmed field changes:

```text
0x1eb33a: 13 -> 3    Karin current MP
0x1eb33c: 100 -> 116 Karin EXP
```

Other nearby 16-bit changes in the same apparent unit record:

```text
0x1eb316: 2  -> 0
0x1eb318: 36 -> 32
0x1eb31c: 19 -> 20
0x1eb36c: 0  -> 1
0x1eb370: 0  -> 1
```

These are likely position/direction/action-state related fields, matching the
known state changes in the two dumps: Karin moved/acted, action availability
changed, and the encounter state changed after one slime was removed.

Debugger write-breakpoint follow-up:

- Breakpoint: write `0x801eb33a`.
- Stopped at `pc=0x801a668c`, `ra=0x801a6950`.
- Registers at stop:

```text
a0 = 0x801eb310
v0 = 0x00000003
v1 = 0x0000000d
```

The actual MP write is the call delay slot just before the return address:

```text
0x801a6908  lh    v1, 0x396(gp)      ; current unit/index selector
...
0x801a6928  lw    a0, 0x390(gp)      ; active unit record pointer
0x801a692c  lh    v0, 0x2(v0)        ; signed MP delta/effect amount
0x801a6930  lh    v1, 0x2a(a0)       ; current MP
0x801a6934  bltz  v0, 0x801a6944
0x801a6940  subu  v0, v1, v0         ; positive effect subtracts MP
0x801a6944  addu  v0, v1, v0         ; negative effect adds/restores MP
0x801a6948  jal   0x801a668c
0x801a694c  sh    v0, 0x2a(a0)       ; current MP write
0x801a6950  jal   0x801a4fdc         ; post-update handler
```

This confirms `a0 + 0x2a` is Karin's current MP field for this active unit
record, and `0x801a668c` is a post-write update/display helper rather than the
origin of the MP calculation.
