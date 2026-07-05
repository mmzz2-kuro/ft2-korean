# SLPS-01903 EXE/System Text Workflow

Some system-adjacent strings are stored directly in `SLPS_019.03` as
CP932/Shift-JIS text. One confirmed example is the memory-card save metadata
string at EXE file offset `0x6328c`:

```text
ファーランドサーガ　時の道標　セーブデータ１　ステージ００
```

This is different from the dialogue and 1bpp UI mask workflows. These strings
are byte strings inside the PS-X EXE, so replacements must:

- fit in the original byte slot, and
- be encodable as CP932/Shift-JIS.

Plain Korean is not CP932 encodable, so this workflow is currently best for
ASCII or Japanese-width system metadata unless the runtime font/encoding path
is patched separately.

## GUI

Run:

```powershell
python tools\exe_text_workflow_gui.py
```

Flow:

1. Set `Input EXE or BIN` to either `SLPS_019.03` or the raw game `.bin`.
2. Click `1. Export TSV`.
3. Fill `ko_text` for the rows to replace and check those rows.
4. Click `2. Apply`.

If the input is a raw BIN, the tool finds the embedded `PS-X EXE` sector and
patches the EXE bytes back into the BIN while preserving the original BIN size.

The GUI uses a keyword filter by default:

```text
セーブ,ロード,システム,設定,オプション,コンフィグ,終了,ステータス,アイテム,装備,魔法
```

This avoids hundreds of false positives where binary data happens to decode as
CP932-looking text. Clear the Terms field or enable `Loose` only when doing a
wide exploratory scan.

## CLI

Export:

```powershell
python scripts\exe_sjis_string_tool.py export ps1\SLPS-01903\SLPS_019.03 tmp\SLPS-01903\exe-system-text.tsv --min-bytes 6
```

Filtered export result created during verification:

```text
tmp/SLPS-01903/exe-system-text-filtered.tsv
tmp/SLPS-01903/exe-system-text-filtered-from-bin.tsv
```

With the default system keywords, the current confirmed output is a single
row at `0x6328c`.

Patch a raw BIN:

```powershell
python scripts\exe_sjis_string_tool.py patch "ps1\SLPS-01903\bincue\Farland Saga - Toki no Michishirube.bin" tmp\SLPS-01903\exe-system-text.tsv output\patched-exe-system-text.bin
```

Smoke test performed with an ASCII replacement for `0x6328c`; the output raw
BIN kept the original size `281875440` bytes.
