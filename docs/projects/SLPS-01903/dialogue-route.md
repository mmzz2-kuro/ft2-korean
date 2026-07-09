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

## 2026-07-09 추가: opcode `6` — 후반부(그룹 9~15) 대사 호출

`0x41`은 스크립트 `309..318`(메시지 그룹 0~8)에서만 쓰이고, 후반부 스크립트
`319..326`(그룹 9~15, 전체 대사의 약 절반)를 호출하는 경로는 이전까지
전혀 잡히지 않았다. 이번 조사에서 별도 opcode `6`이 이 역할을 하는 것을
확인했다.

핵심 근거는 "opcode 워드 바로 다음 워드"를 스캔한 결과다. 각 스크립트에서
`6` 다음에 오는 값들이 해당 스크립트가 담당하는 메시지 그룹의 유효
`message_id`와 정확히, 빈틈없이 일치한다.

| 스크립트 | opcode 6 뒤 인자 범위 | 대응 메시지 그룹 |
| ---: | --- | ---: |
| 319 | `10001..10125` | 9 |
| 320 | `11001..11133` | 10 |
| 321 | `12001..12130` | 11 |
| 322 | `13001..13104` | 12 |
| 323 | `14001..14026` | 13 |
| 324 | `15001..15236` | 14 |
| 325 | `16001..16065` | 15 (전반부) |
| 326 | `16066..16108` | 15 (후반부, 게임 전체 마지막 메시지) |

`325`의 마지막 값(`16065`)과 `326`의 첫 값(`16066`)이 정확히 이어진다.
즉 `325`+`326` 두 스크립트가 그룹 15(메시지 `16001..16108`, 108개 슬롯
전체) 를 이어서 담당하며, 그룹 15는 게임에서 가장 마지막 메시지 그룹이다.

opcode `6`의 핸들러는 `0x8017D184`이다(디스패치 테이블 `0x801C4D4C`
기준, `0x41`의 핸들러 `0x8017E638`와는 별개). 디스어셈블 결과:

```text
0x8017D184:
  arg = 0x8017C364()          ; reader로 인자 워드 1개 읽기
  v0 = table[arg]              ; table base = 0x801CF168, halfword lookup
  store v0 at 0x801CBB66       ; 상태 변수에 저장 (즉시 렌더 호출 아님)
```

`0x41`의 핸들러(`0x8017E638`)처럼 바로 `0x8017CD88(messageId)`를 호출하지
않고, 조회한 값을 상태 변수에 저장만 한다. 따라서 opcode `6`은 "메시지 ID를
직접 트리거"하기보다는 "다음에 표시할 메시지 ID를 예약"하는 opcode로
보이며, 실제 렌더 호출은 이 상태 변수를 읽는 다른 opcode에서 이뤄질
가능성이 높다. `table[arg]`가 `arg`를 거의 그대로 반환하는(또는 최소한
그룹 9~15 구간에서는 항등에 가까운) 매핑이라는 점은 위 표의 빈틈없는
연속 값들로 강하게 뒷받침되지만, 라이브 디버깅으로 실제 렌더 호출까지
확인한 것은 아니다.

### 결론(2026-07-09 정정): `16108`이 실제 게임에서 확인되는 마지막 대사이자, 메시지뱅크 구조 전체의 마지막 슬롯이다

당초 이 섹션에서는 "`16001..16108` 전부에 실제 텍스트 픽셀이 들어있으니
17일차 후반부 데이터가 이미 존재한다"고 결론 내렸다. 이는 **틀렸다.**

`16108`은 유저가 실제 플레이에서 확인한 마지막 대사
(`"알은, 아무도 없는 곳에서 혼자서 울고 있었다."`)와 정확히 일치한다.
그런데 `16108`은 동시에 **메시지뱅크 구조 전체를 통틀어 존재하는 마지막
`message_id`이기도 하다** (그룹 포인터 테이블 `0x80169db0`이 정의하는
16개 그룹 중 그룹 15가 마지막 그룹이고, 그룹 15는 `16001..16108`
108개 슬롯으로 끝난다 — `dialogue-translation.tsv` 전체 2440행의 구조적
전수 검증에서도 이 경계 밖에는 유효 슬롯이 없음을 이미 확인했다).

즉 "게임에서 대사가 끊기는 지점"과 "이 주소 체계가 물리적으로 끝나는
지점"이 정확히 겹친다. 이건 우연이라기보다, **이 메시지뱅크 시스템
자체에 17일차 후반부(대사 `"아, 잠 좀 잤어?"` 이후 ~ 엔딩까지) 대사가
들어갈 슬롯이 애초에 없다**는 뜻으로 보는 게 맞다. `16001..16108`의
mask PGM에 실제 텍스트 픽셀이 들어있다는 관찰 자체는 틀리지 않았지만
(전부 빈 이미지가 아닌 건 사실), 그건 "이미 다 있다"는 근거가 아니라
"그 108개 슬롯이 실제로 다 쓰이고 있고, 그 중 마지막이 지금 유저가
아는 마지막 대사"라는 뜻일 뿐이다.

따라서 17일차 후반부 내용은 다음 둘 중 하나로 보인다:

1. **PS1판에서 실제로 컷된 내용**이다 (윈도우판 대비 PS1판이 분량을
   줄인 것). 메시지뱅크 시스템(그룹 0~15, 총 2440슬롯)을 확장하지 않는
   한 이 안에는 더 넣을 자리가 없다.
2. 메시지뱅크 시스템이 아닌 **완전히 다른 경로**로 표시된다 (예: 별도
   텍스트 시스템, 사전 렌더링된 컷신/이미지 등). 이 경우 opcode `0x41`,
   `6`과 무관한 새로운 리소스/opcode를 찾아야 한다.

현재까지 조사로는 opcode `0x41`과 `6` 외에 대사를 표시하는 세번째
경로를 찾지 못했고, `0x8017CD88`(실제 렌더 함수)의 EXE 전체 호출자는
1곳(opcode `0x41` 핸들러)뿐임을 확인했다(`scan-exe-xrefs.js --target
0x8017cd88` 결과 `calls=1`). opcode `6`이 실제로 이 렌더 함수를
트리거하는지조차 아직 라이브 검증되지 않았다 (아래 "다음 조사" 참고).
따라서 현재로서는 (1) 실제 컷 가능성이 유력하며, (2)를 완전히
배제하려면 스크립트 `325`/`326`이 `16108` 호출 이후 실제로 무엇을
하는지(다음 opcode가 무엇인지) 확인이 필요하다.

찾는 방법(재현용):

```powershell
node -e "
const fs = require('fs');
const dat = fs.readFileSync('ps1/SLPS-01903/FS2_FILE.DAT');
const exe = fs.readFileSync('ps1/SLPS-01903/SLPS_019.03');
function sectorOf(id){return exe.readUInt16LE(0x5c768+id*2);}
function resourceBytes(id){const s=sectorOf(id)*2048,e=sectorOf(id+1)*2048;return dat.subarray(s,e);}
function beHalfwords(buf){const w=[];for(let o=0;o+1<buf.length;o+=2)w.push(buf.readUInt16BE(o));return w;}
for (const id of [319,320,321,322,323,324,325,326]) {
  const words = beHalfwords(resourceBytes(id));
  const ids = [];
  for (let i=0;i+1<words.length;i++) if (words[i]===6 && words[i+1]>=1001 && words[i+1]<=16999) ids.push(words[i+1]);
  const uniq=[...new Set(ids)].sort((a,b)=>a-b);
  console.log(id, uniq[0], '..', uniq[uniq.length-1], 'count='+uniq.length);
}
"
```

다음 조사:

1. `0x801CBB66` 상태 변수를 읽어 실제 `0x8017CD88`을 호출하는 opcode를
   찾아 opcode `6`의 "예약 → 트리거" 흐름을 완전히 확정한다.
2. `table[0x801CF168 + arg*2]`의 실제 내용을 덤프해 항등 매핑인지,
   아니면 일부 구간에서 다른 값으로 리매핑되는지 확인한다.

### `16108` 호출 이후: 정적 분석으로는 결론 안 남

`16108` 호출(`6, 16108`)은 스크립트 `326`(전체 `5120`워드, `0x2800`
바이트) 안에서 워드 인덱스 `1232`, 즉 **파일 시작 기준 약 20% 지점**에
있다. 다시 말해 이 호출 뒤로도 스크립트의 나머지 약 80%가 더 남아있다.

이 나머지 구간에 opcode `0x41`/`6`으로 또 다른 유효 대사 호출이 있는지
확인하려 했으나, 결론부터 말하면 **정적 분석만으로는 확정할 수 없다.**

- 스크립트 상단 192워드 안의 엔트리 포인터 테이블 기준으로 PC를 그대로
  걸어보면(`scan-dialogue-opcode-refs.js`와 동일한 방식), `16108` 호출이
  들어있는 엔트리(엔트리 0, `0x502..0xb4a` 구간) 안에서 실제 `6,16066
  ..16108` 호출들 자체를 찾지 못하고, 대신 이미 "파서 노이즈"로 분류돼
  있던 `1707`/`1708`/`1714` 같은 값만 다른 엔트리에서 나온다. 즉 이
  PC-walk가 `16108` 호출 근처에서 이미 어긋나 있다는 뜻이며, "그 이후
  구간에 opcode `0x41`/`6` 호출이 없다"는 관찰은 이 파서의 desync 때문에
  신뢰할 수 없다.
- 다만 이 walk로 스크립트 `326` 전체에서 실제로 등장하는 opcode 목록
  자체는 얻을 수 있었다. 빈도순 상위 opcode:

  | opcode | handler | count |
  | ---: | --- | ---: |
  | `0x0` | `0x8017ced0` | 353 |
  | `0x2` | `0x8017cf48` | 11 |
  | `0x1b` | `0x8017da74` | 11 |
  | `0xa` | `0x8017d358` | 10 |
  | `0x3` | `0x8017d008` | 9 |
  | `0xf` | `0x8017d5fc` | 9 |
  | `0x1c` | `0x8017da8c` | 9 |
  | `0x8` | `0x8017d200` | 8 |
  | `0xe` | `0x8017d5a8` | 8 |
  | `0xc` | `0x8017d474` | 8 |

  (이 외 `0x1,0x4,0x5,0x7,0x9,0xb,0xd,0x10,0x11,0x13,0x14,0x15,0x16,
  0x17,0x19,0x1a,0x1d,0x1f,0x20,0x22,0x23,0x27,0x29,0x2c,0x3a,0x3c,
  0x64`도 낮은 빈도로 등장. `0x41`은 3회, `0x6`은 1회 잡혔지만 위
  desync 문제로 정확한 위치/인자를 신뢰하기 어렵다.)

  이 목록 중 `0x76`(상태 UI 마스크), `0x78`(display-work block)은
  전혀 나오지 않았다. 나머지는 전부 아직 역할이 분류되지 않은 opcode다.

**결론**: `16108` 이후 스크립트 `326`이 실제로 무엇을 하는지는 현재
정적 분석 범위 밖이다. 확정하려면 라이브 디버깅(그 대사 직후 지점에서
PC/opcode 스트림을 직접 추적)이 필요하며, 이번 조사에서는 여기서
멈춘다.

## 2026-07-09 추가: 라이브 디버깅으로 찾은 세 번째 대사 저장 영역

`16108` 이후를 라이브 RAM 덤프로 다시 조사했고, **17일차 후반부 대사가
실제로 PS1 디스크에 존재함을 확인했다.** 그룹 0~15 메시지뱅크
(opcode `0x41`)와도, opcode `6`의 소형 인덱스 테이블과도 다른, 지도화되지
않은 **세 번째 저장 영역**에 들어 있다.

### 찾은 방법

1. GP 레지스터 값을 EXE 시작 코드에서 직접 계산했다
   (`0x8017524C: lui gp,0x801d` / `0x80175250: addiu gp,gp,-17720`
   → **GP = `0x801CBAC8`**). 이후 `gp+44`(스크립트 베이스 포인터),
   `gp+478`(현재 PC, halfword 단위)를 RAM 덤프에서 직접 읽어 현재 실행
   위치를 계산할 수 있다.
2. 대사 렌더 함수 `0x8017CD88`의 디스어셈블에서 실제 "공용 버퍼"
   포인터 주소를 확인했다: `lui a1,0x801d; lw a1,-17388(a1)` →
   **공용 버퍼 포인터는 RAM `0x801CBC14`에 저장되어 있다.** 이 포인터
   값 + `0x1000`이 현재 로드된 메시지의 raw pixel 데이터 시작 지점이다
   (`0x8017CC90`이 여기서부터 `0x930`바이트를 halfword 단위로
   byte-swap 처리한다).
3. 화면에 대사가 떠 있는 순간 RAM을 덤프하면, `공용버퍼+0x1000`에서
   `0x930`바이트를 읽어 그대로(이미 런타임에서 swap된 상태) `200x48`
   2bpp 캔버스로 렌더링하면 **화면에 보이는 그 문장이 그대로 나온다.**
   렌더 알고리즘은 `scripts/render-message-bank-html.js`의
   `renderMessageBlock`과 동일하다(팔레트는 `[0,1,2,3]` →
   `{0:255,1:190,2:100,3:35}` 밝기 매핑).
4. 이 `0x930`바이트를 다시 byte-swap해서(디스크 원본 형태로 복원)
   `FS2_FILE.DAT`에서 `indexOf`로 검색하면, **그 대사가 디스크에서
   저장된 정확한 바이트 오프셋**이 나온다. 이게 이번 조사에서 가장
   결정적인 기법이었다 — 라이브 캡처와 정적 디스크 검색을 1:1로
   대조하니 추측 없이 바로 위치가 나온다.

재현용 스크립트(핵심 부분):

```js
const RAM_BASE = 0x80000000;
const off = (a) => a - RAM_BASE;
const commonBuffer = ram.readUInt32LE(off(0x801CBC14));
const captured = ram.subarray(off(commonBuffer + 0x1000), off(commonBuffer + 0x1000) + 0x930);
const onDisk = swap16(captured); // swap16: 인접 바이트 교환
const diskOffset = datBuffer.indexOf(onDisk);
```

### 확인된 위치와 내용

이 방법으로 확보한 램 덤프 5개가 전부 `FS2_FILE.DAT`에서 정확히
일치하는 위치를 찾았고, 전부 새로운(카탈로그에 없던) 대사였다:

| 덤프 | DAT 오프셋 | 내용 |
| --- | --- | --- |
| `final-text4.bin` | `0xC088000` | `俺は・・・天に還りたかった・・` |
| `final-text4-next1.bin` | `0xC093000` | `行け・・・今なら、お前たちでも戦える・・・彼を・・・取り戻すがいい・・・` |
| `final-text4-next2.bin` | `0xC0B1000` | `アルを助けられるの!?` |
| `final-text4-next3.bin` | `0xC0B6000` | `本当か!?` |
| `final-text4-next4.bin` | `0xC0BA000` | `急げ・・・時間は、・・残り少ない・・` |
| `final-text5-1.bin` | `0xC0CB000` | `誰もいませんね?` |
| `final-text5-2.bin` | `0xC0D1000` | `アルは・・・?` |
| `final-text5-3.bin` | `0xC0D4000` | `ここにいる` |

내용상 확실히 클라이맥스(알의 천사 정체 암시, 알을 되찾기 위한 전투
직전/직후 대화)에 해당한다. 유저 보고에 따르면 이 대사들 이후
경험치 정산 → 다음 씬으로 넘어간다.

이 5개 오프셋은 전부 `0x800`(섹터) 단위로 정렬되어 있고, 항목 사이
간격이 제각각이다(`0xC088000→0xC093000`은 `0xB000`, `→0xC0B1000`은
`0x1E000`, `→0xC0B6000`은 `0x5000`, `→0xC0BA000`은 `0x4000`) — 이는
기존 그룹 0~15 시스템과 같은 "메시지마다 필요한 만큼 섹터를 쓰는"
가변 크기 구조와 일치한다.

### 아직 못 푼 것: 이 영역의 인덱스 테이블

`0xC088000` 메시지의 `0x930`바이트 pixel 데이터 바로 뒤(`0xC088930`)에
16개의 32비트 값으로 된 표가 있다(`0x10, 0, 0x11f8, 0x1ce8, 0x4cd2,
0x7cbd, 0xaca8, 0xbc48, 0xcb20, 0xe4e8, 0xed1c, 0xf550, 0xfbf4,
0x10298, 0x10732, 0x10bcd, 0x11068`). 처음엔 이걸 "이 영역 안 메시지
15개의 오프셋 목록"으로 추정했으나, **실제 확인된 다음 메시지 위치들
(`0xC093000` 등)과 전혀 맞지 않았다** — 즉 이 표는 이 영역의 메시지
인덱스가 아니라 (기존 시스템의 `+0x1930` reveal-timing 테이블처럼)
`0xC088000` 메시지 **자신의** 내부 텍스트-리빌 타이밍 데이터로 보인다.

따라서 이 새 영역 전체를 아우르는 진짜 인덱스 테이블은 아직 못 찾았고,
지금까지는 **라이브 램 덤프로 한 줄씩 위치를 확인하는 방법**만
확실하다. 이 영역이 정확히 어디서 시작하고 끝나는지, 몇 개의 대사가
들어있는지도 아직 모른다.

### 다음 조사

1. 이 영역을 가리키는 진짜 인덱스/포인터가 스크립트 `326`이나 EXE 안에
   어디 있는지 찾는다(opcode `6`의 `table[0x801CF168+arg*2]` 조회와
   연결되는지도 재검토 대상).
2. 유저가 계속 플레이하면서 램 덤프를 더 제공하면, 같은 "캡처→디스크
   검색" 방법으로 이 영역의 나머지 대사를 계속 확보한다.
3. 충분히 확보되면 이 영역 전용 export/patch 도구를 만들어
   `dialogue-translation.tsv`와 같은 워크플로에 편입시킨다.

## 2026-07-09 추가: 전용 도구, 스캔 필터 수정, 엔딩까지 범위 확정

### 전용 도구

이 영역(opcode `0x41`/`6` 어디에도 속하지 않는 세 번째 대사 저장 영역)
전용 워크플로를 만들었다:

- `scripts/finale-text-pgm-tool.js` — `scripts/message-mask-pgm-tool.js`와
  픽셀/리빌헤더 포맷은 동일하지만, `messageId`(그룹 테이블 조회) 대신
  **절대 바이트 오프셋**으로 직접 주소를 받는다. `scan`/`export`/`patch`
  세 모드가 있다.
- `tools/finale_text_workflow_gui.py` — `name_table_workflow_gui.py`와
  같은 구조의 GUI. 스캔 → 후보 이미지 확인/삭제 → 번역 입력/미리보기 →
  DAT/BIN 패치까지 한 화면에서 진행한다.
- 텍스트 렌더링은 기존 `scripts/render-text-to-message-pgm.ps1`을
  그대로 재사용한다(범용, 메시지 체계에 의존하지 않음).

### 스캔 필터 버그: "노이즈와 실제 대사가 섞여 보이는" 원인

처음 스캔 필터는 픽셀 밀도(ink count)만 봤는데, 이 방식은 부정확했다.
실제 관찰된 문제:

- 완전 노이즈인데 우연히 텍스트와 비슷한 밀도로 걸러지는 경우
- **더 헷갈리는 경우**: 실제 짧은 대사 한 줄 + 같은 고정 크기 블록
  (`0x930`바이트) 안의 나머지 공간에 남아있는 무관한 leftover 바이트가
  같은 이미지 안에 같이 나타나는 경우 ("노이즈와 대사가 같이 있음")

해결: 대사 블록 바로 뒤 `0xD0`바이트 리빌(타이핑 효과) 헤더의 segment
count는 실제 대사면 항상 `1..52` 범위다. 노이즈 데이터는 이 범위를
거의 벗어난다. `finale-text-pgm-tool.js`의 `scanCandidates`에 이 구조적
검증(`segmentCount(addr)`가 `1..52`인지)을 ink count 필터와 함께
추가했다.

효과: `0xBFF0000..0xC200000` 구간을 재스캔한 결과 36개 후보 전부가
실제 대사로 확인됨(수동 이미지 확인 100%, 노이즈 0). 기존(필터 수정
전) 스캔으로 만들어졌던 `tmp/SLPS-01903/finale-text-workflow/
finale-text.tsv`의 68행 중 67행이 노이즈였음을 새 필터로 확인하고
정리했다(원본은 `finale-text.tsv.bak`).

**결론: 램 덤프 없이도 이 영역의 대사를 찾을 수 있다.** 정확한 주소
범위만 알면 `finale-text-pgm-tool.js scan`(또는 GUI의 "1. Scan for
candidates")으로 정적 스캔만으로 후보를 찾아낼 수 있다. 램 덤프는
이제 "범위 자체를 모르는 새 구간을 처음 찾을 때"에만 필요하다.

### 엔딩까지 범위 확정

라이브 램 덤프로 이 영역의 끝(게임 엔딩)까지 확인했다:

| 덤프 | DAT 오프셋 | 내용 |
| --- | --- | --- |
| `final-text6-1.bin` | `0xC333000` | `・・・終わったの?` |
| `final-text6-2.bin` | `0xC337000` | `終わったよ・・・すべて` |
| `final-text6-3.bin` | `0xC340000` | `あ、あたいら、本当に天使をやっつけちまったのか!?` |
| `final-text-7-1.bin` | `0xC4A0000` | `一度出たら、もう二度と戻って来れないのね` |
| `final-text-7-2.bin` | `0xC4AD000` | `そうです。さあ、皆さんで行きたい時間、行きたい場所を思い浮かべて下さい・・` |
| `final-text-7-3.bin` | `0xC4CC000` | `そこが、僕たちの帰る場所です` |

`final-text-7-3`(`0xC4CC000`)이 유저가 확인한 **게임 전체의 마지막
대사**다. 게임 제목("시간의 길잡이")과 맞아떨어지는 마무리 대사로
내용상으로도 엔딩이 확실하다.

즉 이 세 번째 대사 영역의 실제 범위는 대략 **`0xC024000`(17일차
후반부 시작, "スマないが、君たちを..." )부터 `0xC4CC000`(엔딩,
"そこが、僕たちの帰る場所です")까지, 약 5MB**다. 이 범위를
`finale-text-pgm-tool.js scan`으로 훑으면 램 덤프 없이 나머지 대사를
전부 찾을 수 있을 것으로 본다.
