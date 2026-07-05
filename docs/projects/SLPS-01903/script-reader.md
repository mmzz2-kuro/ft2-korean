# 스크립트 reader 후보 조사

## 2026-06-30 정정: 2-word 코드 경로는 대사 폰트가 아님

`0x8017C6F4 -> 0x8017C4F0 -> 0x80188090` 경로는 처음에는 폰트/글리프
후보로 보았지만, 16bpp rectangle preview 결과 캐릭터 초상/표정 이미지로
확인되었다. 이 경로의 2-word 코드는 일본어 본문 글자가 아니라
portrait/expression 선택 코드로 취급한다.

실제 대사/폰트 조사는 다른 script handler를 우선한다. 현재 가장 강한
후보는 `0x8017FF00`이다.

```text
scriptWord = read16()
resourceId = 4277 + scriptWord
load resource to common buffer
replace 0x00 with 0xFE over 0xD80 bytes
copy 0xD80 bytes to 0x8005B000
```

리소스 `4277..4449` 구간에는 `0x800`, `0x1000`, `0x3000` 크기의 블록이
연속 배치되어 있으며, 이 경로가 텍스트/문자 표시 데이터 또는 관련 타일맵을
준비할 가능성이 높다.

## 목적

UI 1bpp 마스크 경로가 대사 본문이 아니라 숫자/아이콘 표시 계층에 가깝다고 판정했기 때문에, 별도 script/event reader 후보를 추적했다.

사용 도구:

- `scripts/disasm-exe-range.js`: EXE RAM 주소 기준 MIPS 명령 덤프.
- `scripts/scan-exe-xrefs.js`: 특정 함수 호출자 요약.
- `scripts/scan-call-args.js`: 호출부 주변 문맥 요약.
- `scripts/dump-fs2-script-resource.js`: FS2 script-like 리소스를 big-endian halfword/entry table 기준으로 덤프한다.

실행 예:

```powershell
node scripts\disasm-exe-range.js ps1\SLPS-01903\SLPS_019.03 0x8017c320 0xe0
node scripts\scan-exe-xrefs.js ps1\SLPS-01903\SLPS_019.03 --summary --target 0x8017c364
node scripts\scan-call-args.js ps1\SLPS-01903\SLPS_019.03 0x8017c364 --context 8
node scripts\dump-fs2-script-resource.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 309 --entry 0 --words 96
```

## 핵심 reader

`0x8017C364`는 현재까지 가장 강한 script/event halfword reader 후보다.

동작:

1. `gp+478`의 halfword PC를 읽는다.
2. PC를 1 증가시켜 다시 `gp+478`에 저장한다.
3. `gp+44`의 script base pointer에 `PC * 2`를 더한다.
4. 해당 위치의 signed halfword를 읽어 반환한다.

요약:

| 주소 | 판정 |
| --- | --- |
| `0x8017C364` | signed 16-bit script word를 1개 읽고 PC를 증가시키는 기본 reader. 호출 103개. |
| `gp+44` | script base pointer. |
| `gp+478` | halfword 단위 script PC. |
| `gp+480` | 실행 상태/종료 플래그 후보. 여러 opcode handler가 `1`을 쓴다. |
| `gp+446` | return PC 저장 슬롯 후보. |

## 관련 제어 흐름

| 주소 | 판정 |
| --- | --- |
| `0x8017BFE8` | 인자 `(scriptId, offset)` 계열. 필요하면 리소스/스크립트를 로드하고, `gp+44 + offset*2`에 있는 halfword를 읽어 `gp+478`로 점프한다. |
| `0x8017FA08` | reader로 인덱스를 읽고, `gp+44 + index*2`의 halfword를 `>> 1` 처리해 `gp+478`로 점프한다. 현재 PC를 `gp+446`에 저장한다. 서브루틴 호출/분기 후보. |
| `0x8017FA4C` | `gp+446`에 저장한 PC를 `gp+478`로 복원한다. return 후보. |
| `0x8017FAA0` | 현재 opcode/word가 10 미만인지 보고 다른 처리 루틴을 호출한 뒤, reader가 0을 반환할 때까지 스킵한다. 조건 분기/선택지 블록 처리 후보. |
| `0x8017FE80` | reader로 code와 flag를 읽고, flag가 0이 아니면 `0x801AD190`을 호출한다. `0x801AD190`은 code를 1bpp UI mask 리소스 `1151+index`에 매핑해 표시한다. |

`0x8017C364` 호출은 103개로 매우 많고, 주변 핸들러들이 좌표, 플래그, 리소스 ID, 분기 offset, 상태값을 읽어 처리한다. 따라서 이 함수군은 대사/이벤트 VM의 중심부일 가능성이 높다.

## Script bank 리소스

`0x8017BFE8`은 `0x80169B30`의 16개 halfword 테이블에서 FS2 리소스 ID를 고른다. 이 주소는 처음에 `0x80179B30`으로 착각했으나, 실제 명령 `lui 0x8017; addiu -25808`의 결과는 `0x80169B30`이다.

| scriptId | resource ID | DAT offset | size |
| ---: | ---: | ---: | ---: |
| 0 | 309 | `0x157D800` | `0x1000` |
| 1 | 310 | `0x157E800` | `0x2000` |
| 2 | 311 | `0x1580800` | `0x2800` |
| 3 | 312 | `0x1583000` | `0x2000` |
| 4 | 313 | `0x1585000` | `0x2000` |
| 5 | 314 | `0x1587000` | `0x2000` |
| 6 | 315 | `0x1589000` | `0x1800` |
| 7 | 316 | `0x158A800` | `0x1800` |
| 8 | 317 | `0x158C000` | `0x1800` |
| 9 | 318 | `0x158D800` | `0x1800` |
| 10 | 319 | `0x158F000` | `0x1800` |
| 11 | 320 | `0x1590800` | `0x2000` |
| 12 | 321 | `0x1592800` | `0x1800` |
| 13 | 322 | `0x1594000` | `0x1800` |
| 14 | 323 | `0x1595800` | `0x1000` |
| 15 | 324 | `0x1596800` | `0x3000` |

로드 후 `0x801881FC`가 고정 `0x4000` bytes를 16-bit swap한다. 원본 DAT는 big-endian halfword stream이고, 런타임 메모리에서는 little-endian halfword로 읽힌다.

각 script bank 앞쪽은 최대 192개 halfword entry pointer table이다. `0x8017BFE8(scriptId, entry)`는 `entry < 192`일 때 `table[entry]`를 읽고, 값이 0이 아니면 `table[entry] >> 1`을 `gp+478` PC로 설정한다. 엔트리 값은 byte offset이고 항상 짝수로 보인다.

예시:

| resource | entry | raw pointer | PC word index |
| ---: | ---: | ---: | ---: |
| 309 | 0 | `0x0502` | `0x0281` |
| 309 | 21 | `0x0CB4` | `0x065A` |
| 310 | 0 | `0x0502` | `0x0281` |
| 324 | 0 | `0x0502` | `0x0281` |

`325`, `326`도 같은 `0x0502` entry table 형태를 가지므로 script-like 리소스로 보인다. 다만 기본 `0x8017BFE8` bank table에는 포함되지 않으므로 별도 참조 경로를 더 추적해야 한다.

## Stream 관찰

resource 309, entry 0의 시작:

```text
0034 0000 000e ffff 0033 0032 0016 0000
0010 0065 0001 0fa0 0003 0010 0009 0033
0003 0000 0029 0000 0001 0000 0006 0000
```

resource 309, entry 21의 시작:

```text
000f 03e8 0000 0003 0010 0009 001b 000a
ffff 002c 000a 0001 0027 0001 0016 000e
```

resource 310, entry 0의 시작:

```text
0029 0002 0000 0000 0004 0001 0001 0000
0004 0002 0001 003c 0000 0002 ffff 002c
```

평문 Shift-JIS 스캔에서는 `309..326` 모두 hit가 없었다. 현재로서는 문자열이 평문 byte열로 섞인 구조가 아니라, halfword opcode/인자 스트림 안에서 별도 코드값 또는 다른 리소스를 통해 표시되는 구조로 본다.

## 1bpp UI 마스크와의 접점

`0x8017FE80` 경로:

```text
code = read16()
flag = read16()
if flag != 0:
  draw_ui_mask(code)
```

`draw_ui_mask`에 해당하는 `0x801AD190`은 RAM `0x801DB098` 테이블에서 `code`를 찾고, 인덱스 `0..18`을 `resourceId = 1151 + index`로 바꿔 로드한다. 이후 `0x8017B500`을 다음 고정 인자로 호출한다.

| 인자 | 값 | 의미 후보 |
| --- | ---: | --- |
| `a0` | `4` | VRAM/화면 x tile |
| `a1` | `11` | VRAM/화면 y tile |
| `a2` | `32` | source bytes per row |
| `a3` | `8` | height block. 실제 row 수는 `8 * 8 = 64` |
| stack `+0x10` | loaded buffer | 1bpp source |
| stack `+0x14` | `2` | foreground color byte |
| stack `+0x18` | `0` | background color byte |

따라서 `1151..1169`는 256x64 1bpp UI mask 리소스 계열로 확정한다.

## 다음 조사

1. `0x8017C364` 호출부 103개를 opcode handler 단위로 묶고, 각 handler가 몇 개의 halfword 인자를 소비하는지 표로 만든다.
2. `309..324` bank의 entry pointer table을 모두 덤프해 실제 사용되는 entry 번호와 호출부의 `entry` 인자를 대조한다.
3. `325`, `326` script-like 리소스가 어떤 경로로 로드되는지 찾는다.
4. 대사 표시 후보 opcode를 찾기 위해 `0x8017C364` 반환값이 UI 렌더, glyph/mask, 또는 메시지 버퍼 처리로 이어지는 handler를 우선 분류한다.
## 2026-06-30 추가: 2-word portrait/expression 코드 경로

`0x8017C4F0`와 그 앞단 `0x8017C6F4`를 따라가면, 스크립트 안의 표시 코드는
Shift-JIS 원문 바이트가 아니라 2개의 halfword를 조합한 내부 코드로 보였다.
이후 preview로 이 경로는 대사 폰트가 아니라 초상/표정 이미지 선택 경로로
정정했다.

도구:

```powershell
node scripts\dump-exe-code-table.js ps1\SLPS-01903\SLPS_019.03
node scripts\scan-script-code-table-refs.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 --ids 309-326 --top 80
node scripts\summarize-script-reader-calls.js ps1\SLPS-01903\SLPS_019.03 --brief
```

핵심 함수:

| 주소 | 역할 추정 |
| --- | --- |
| `0x8017C6F4` | reader를 1~2회 호출한다. 첫 값이 0이면 0을 반환하고, 0이 아니면 둘째 값을 더 읽어 `((first + 64) << 8) + second` 형태의 16-bit portrait/expression 코드를 만든다. |
| `0x8017C4F0(code, slot)` | 표시 코드를 `0x80169A08` 코드표에서 찾고, 찾은 인덱스를 `0x80188090`에 넘겨 6-sector 초상/표정 rectangle chunk를 읽은 뒤 화면 전송 루틴으로 보낸다. `slot=0`과 `slot=1`은 서로 다른 표시 위치/상태 저장 슬롯을 사용한다. |
| `0x8017E5D8` | `0x8017C6F4` -> `0x8017C4F0(code, 0)` 호출. |
| `0x8017E608` | `0x8017C6F4` -> `0x8017C4F0(code, 1)` 호출. |
| `0x80188090(index, dst)` | 현재 선택된 초상/표정 page에서 `index * 6` sectors 위치를 계산하고, 6 sectors를 CD/DAT read queue로 읽는다. |

코드표:

- 위치: RAM `0x80169A08`, EXE file offset `0x1208`
- 항목 수: 148개
- 마지막 `0x0000` sentinel을 제외하면 실제 표시는 147개로 보인다.
- 값은 2바이트 ASCII 계열 코드이다. 예: `AA`, `AB`, `AC`, ..., `ZA`.
- `0x8017C4F0`는 이 표를 선형 탐색하고, 인덱스가 147 미만일 때만
  portrait/expression chunk 로드/전송을 수행한다.

`scan-script-code-table-refs.js`의 기본 `pairs` 모드는 `0x8017C6F4`의 조합 방식을 따라 연속된 두 halfword를 코드로 합성해 센다. `--mode words`는 원본 halfword와 코드표를 그대로 비교하는 모드인데, 이 방식으로는 거의 hit가 나오지 않았다. 따라서 script bank 안에는 `0x4141` 같은 완성 코드가 직접 저장된 것이 아니라, `0x0001 0x0041 => AA` 같은 2-word 형태가 섞여 있다고 보는 쪽이 맞다.

스크립트 뱅크 `309..326`에서 합성 코드 후보는 총 2324개 hit가 나왔다. 자주 나오는 코드는 다음과 같다.

| code | hits | first example |
| --- | ---: | --- |
| `AA` | 179 | `id309@word0x0387` |
| `MA` | 137 | `id310@word0x0330` |
| `AE` | 90 | `id309@word0x02D5` |
| `AL` | 85 | `id309@word0x0342` |
| `BB` | 79 | `id310@word0x0992` |
| `AB` | 77 | `id309@word0x02C8` |
| `BA` | 64 | `id309@word0x06B7` |
| `JA` | 62 | `id310@word0x05EB` |
| `BH` | 61 | `id310@word0x0931` |
| `AD` | 58 | `id310@word0x033F` |

예시로 resource `309`, entry `0`의 stream 안에서는 `0x0001 0x0043`이 `AC`, `0x0001 0x0042`가 `AB`, `0x0001 0x0045`가 `AE`, `0x0001 0x0047`이 `AG` 후보가 된다. 이 값들은 단독으로는 평문이 아니고, 해당 opcode handler가 `0x8017C6F4`를 호출하는 위치에서만 실제 표시 코드로 해석되어야 한다.

다음 우선순위:

1. `0x8017E5D8`, `0x8017E608`는 portrait/expression opcode로 분류한다.
2. 텍스트 후보는 `0x8017FF00`과 `4277+n` 리소스 경로에서 다시 추적한다.
3. `0x8005B000`에 복사된 `0xD80` 바이트 블록의 소비자를 찾아 실제
   글자/타일맵 포맷을 판정한다.
4. 메시지 후보 리소스가 확정되면 script bank `309..326`에 대해
   opcode-aware 텍스트 추출기를 만든다.
## 2026-06-30 추가: 확장 raw range와 6-sector 표시 chunk

`0x80188090`의 인자 해석을 다시 확인했다. 이전에는 `index * 6`을 6바이트 글리프 조각으로 보았지만, `0x80187A64` 디스어셈블 결과 이 함수의 `a1`은 DAT/CD의 sector 계열 위치이고 `a2`는 sector count다. 따라서 `0x80188090`의 `index * 6`은 6바이트가 아니라 **6 sectors = `0x3000` bytes** 단위다.

관련 함수:

| 주소 | 역할 |
| --- | --- |
| `0x80187A64(dst, sector, count)` | read queue 등록. `sector`와 `count`를 큐에 저장하고 CD read로 넘긴다. |
| `0x80187C6C` | FS2 sector table 뒤쪽의 17개 확장 range pair를 읽어 wrap/carry를 보정하고, 런타임 range table을 만든다. |
| `0x80188090(index, dst)` | 현재 page(`0x801CBC58`)를 고르고, `rangeBase + index * 6` sector부터 6 sectors를 읽는다. |

주소 보정:

- `lui 0x801d; lh/lhu -17320`은 `0x801CBC58`이다. 이전에 `0x801DBC58`로 적은 것은 오기다.
- `lui 0x801d; lw -17388`은 `0x801CBC14`이며, 공용 작업 버퍼 포인터 전역이다.
- `0x801D0BD8`은 `0x80187C6C`가 만든 확장 raw range start-sector table이다.
- `0x801D0B90`은 확장 range 보조/end-sector table로 보인다.

확장 range 덤프 도구:

```powershell
node scripts\dump-fs2-extended-ranges.js ps1\SLPS-01903\SLPS_019.03 ps1\SLPS-01903\FS2_FILE.DAT
node scripts\export-fs2-extended-rect-html.js ps1\SLPS-01903\SLPS_019.03 ps1\SLPS-01903\FS2_FILE.DAT tmp\SLPS-01903\rect-page0-16bpp.html --page 0 --width 60 --height 96 --bpp 16 --columns 7 --scale 3
```

확장 range 17개는 모두 `0x1B9000` bytes 크기다. 각 page는 882 sectors이고,
`882 / 6 = 147`이므로 `0x80169A08` 코드표의 sentinel 제외 147개 표시 코드와
정확히 맞는다. 즉 `AA..ZA` 코드표 index 하나가 확장 page 안의 6-sector
초상/표정 chunk 하나에 대응한다.

| page | start sector | end sector | DAT offset | size |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 29948 | 30830 | `0x3A7E000` | `0x1B9000` |
| 1 | 34844 | 35726 | `0x440E000` | `0x1B9000` |
| 2 | 42016 | 42898 | `0x5210000` | `0x1B9000` |
| 3 | 46226 | 47108 | `0x5A49000` | `0x1B9000` |
| 4 | 50232 | 51114 | `0x621C000` | `0x1B9000` |
| 5 | 55340 | 56222 | `0x6C16000` | `0x1B9000` |
| 6 | 58790 | 59672 | `0x72D3000` | `0x1B9000` |
| 7 | 61742 | 62624 | `0x7897000` | `0x1B9000` |
| 8 | 65332 | 66214 | `0x7F9A000` | `0x1B9000` |
| 9 | 68622 | 69504 | `0x8607000` | `0x1B9000` |
| 10 | 72298 | 73180 | `0x8D35000` | `0x1B9000` |
| 11 | 75894 | 76776 | `0x943B000` | `0x1B9000` |
| 12 | 79554 | 80436 | `0x9B61000` | `0x1B9000` |
| 13 | 82526 | 83408 | `0xA12F000` | `0x1B9000` |
| 14 | 84084 | 84966 | `0xA43A000` | `0x1B9000` |
| 15 | 90442 | 91324 | `0xB0A5000` | `0x1B9000` |
| 16 | 94142 | 95024 | `0xB7DF000` | `0x1B9000` |

표시 코드 경로는 이제 다음처럼 정리된다.

```text
script words
-> 0x8017C6F4: ((first + 64) << 8) + second
-> 0x8017C4F0: 0x80169A08 코드표에서 index 검색
-> 0x80188090: pageBaseSector + index * 6 에서 6 sectors 읽기
-> 0x8016C8C8 등 화면 전송
```

표시 초기화 쪽에서 `0x801CBB00`의 첫 세 halfword `827, 828, 829`도
확인됐다. 이들은 표시 시스템 보조 리소스로 보이며, 특히 `829`는 raw-like
1bpp 패턴을 가진다. 다만 `AA/AB/...` index별 6-sector 초상/표정 chunk는
`827..829` 리소스가 아니라 위 확장 raw range 쪽에서 직접 읽는다.

다음 단계:

1. 확장 range는 초상/표정 atlas로 보관한다.
2. `0x8017FF00`의 `4277+n` 리소스 로드 경로와 `0x8005B000` 소비자를
   추적한다.
3. 실제 메시지/폰트 후보가 확정되면 opcode-aware text extractor에 반영한다.
