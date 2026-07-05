# 리소스 로더 xref 조사

## 목적

`FS2_FILE.DAT` 안에서 실제 게임 코드가 읽는 리소스 ID를 좁히기 위해 `SLPS_019.03`의 `jal` 호출을 스캔했다.

사용 도구:

- `scripts/scan-exe-xrefs.js`: EXE 안의 MIPS `jal` 호출을 대상 함수별로 스캔한다.
- `scripts/scan-dynamic-resource-ids.js`: 로더 호출 직전 `a0`의 source를 `const/lhu/andi/addu` 등으로 분류하고, 가능한 경우 정적 halfword table base를 추정한다.
- `scripts/dump-exe-resource-table.js`: EXE 안의 halfword 리소스 ID 테이블을 DAT 오프셋/포맷 판정과 함께 덤프한다.
- `scripts/list-fs2-resource-ids.js`: 리소스 ID를 DAT 오프셋, 크기, 1차 포맷 판정으로 펼친다.
- `scripts/scan-fs2-text-candidates.js`: 지정한 리소스 ID 범위 안에서 Shift-JIS 후보 문자열을 제한적으로 스캔한다.
- `scripts/disasm-exe-range.js`: EXE RAM 주소 기준 MIPS 명령 덤프. 후처리 함수 분해에 사용한다.
- `scripts/scan-call-args.js`: 특정 함수 호출부의 `a0..a3` source와 주변 문맥을 요약한다.
- `scripts/preview-fs2-1bpp.js`: 리소스 ID를 1bpp 마스크로 해석해 ASCII 프리뷰와 bit 통계를 출력한다.
- `scripts/dump-fs2-script-resource.js`: script-like 리소스의 entry table과 big-endian halfword stream을 덤프한다.

실행 예:

```powershell
node scripts\scan-exe-xrefs.js ps1\SLPS-01903\SLPS_019.03 --summary
node scripts\scan-dynamic-resource-ids.js ps1\SLPS-01903\SLPS_019.03
node scripts\dump-exe-resource-table.js ps1\SLPS-01903\SLPS_019.03 ps1\SLPS-01903\FS2_FILE.DAT 0x801c8794 32
node scripts\list-fs2-resource-ids.js ps1\SLPS-01903\FS2_FILE.DAT ps1\SLPS-01903\SLPS_019.03 266 270 271 274
```

## 로더 함수별 호출 요약

간단한 상수 추적은 호출 직전 또는 delay slot에서 `a0`에 들어간 직접 상수만 집계한다. 테이블에서 읽는 동적 ID는 별도 분석이 필요하다.

| 함수 | 역할 후보 | 직접 호출 수 | 상수 ID 확인 |
| --- | --- | ---: | ---: |
| `0x80187A64` | DAT sector read queue 등록 | 7 | 0 |
| `0x80187B8C` | read queue flush/wait | 5 | 0 |
| `0x80187D4C` | 리소스 byte size 계산 | 23 | 19 |
| `0x80187D84` | 비동기 리소스 로드 | 6 | 3 |
| `0x80187DE4` | 리소스 로드 + flush/wait | 65 | 37 |
| `0x80187E14` | 리소스 크기 기반 버퍼 배치 후 로드 | 51 | 49 |
| `0x80187E70` | 대형 구간/부분 read 계열 후보 | 1 | 0 |

## 직접 상수 ID

### `0x80187DE4`

동기식 로드 래퍼로 보인다. 확인된 상수 ID:

`23, 24, 25, 26, 153, 208, 222, 253, 271, 274, 275, 277, 283, 284, 285, 286, 288, 305, 306, 658, 660, 752, 753, 754, 756, 757, 764, 765, 768, 769, 770, 809, 810, 1149, 1150, 1198, 1201`

### `0x80187E14`

리소스 크기를 계산한 뒤 공용 버퍼 끝쪽에 배치하고 로드하는 래퍼로 보인다. 확인된 상수 ID:

`245, 249, 250, 251, 254, 256, 258, 259, 261, 262, 264, 266, 270, 273, 276, 278, 279, 280, 281, 282, 301, 302, 633, 657, 659, 758, 759, 760, 761, 762, 763, 766, 767, 771, 772, 773, 774, 779, 781, 782, 788, 789, 790, 791, 792, 793, 804, 805, 807`

### 기타

- `0x80187D4C`: `255, 257, 263, 265, 271, 272, 274, 275, 277, 283, 284, 285, 286, 658, 660, 764, 765, 768, 769`
- `0x80187D84`: `221, 806, 1169`

## 1차 포맷 판정

확인된 직접 상수 ID 대부분은 그래픽 또는 오디오로 보인다.

| ID 범위/그룹 | 관찰 |
| --- | --- |
| `153, 208, 221, 222, 756` | `VAGp` 매직으로 시작한다. PS1 ADPCM/VAG 오디오 계열 가능성이 높다. |
| `245..302`, `633..660`, `758..807` 일부 | `be-hdr(width,height,payload,...)` 형태가 반복된다. 16-bit 이미지/타일/셀 그래픽 컨테이너 후보. |
| `23..26`, `305, 306, 752..754, 770, 809, 810, 1149, 1150, 1169` | 16-bit 색상 데이터, 팔레트/타일, fill, 또는 별도 raw 데이터로 보인다. |

예시:

| ID | DAT 오프셋 | 크기 | 판정 |
| ---: | ---: | ---: | --- |
| 153 | `0x0EFC800` | `0x0C000` | `VAGp` 오디오 후보 |
| 245 | `0x1100000` | `0x13800` | `be-hdr(40,30,0x12AD0,0xB70)` |
| 266 | `0x12D9800` | `0x13800` | `be-hdr(40,30,0x12690,0xB70)` |
| 271 | `0x1322800` | `0x24000` | `be-hdr(101,30,0x22010,0x19BC)` |
| 275 | `0x136E800` | `0x1C000` | `be-hdr(210,24,0x19290,0x2970)` |
| 756 | `0x2235800` | `0x0D000` | `VAGp` 오디오 후보 |
| 793 | `0x2445800` | `0x44800` | `be-hdr(120,120,0x3CE50,0x7290)` |
| 1169 | `0x273F800` | `0x06000` | `0xFF` fill 계열 |

## 현재 판정

- 직접 상수로 로딩되는 리소스 ID에서는 아직 평문 Shift-JIS 텍스트 후보가 보이지 않는다.
- xref에서 자주 나오는 ID들은 대체로 그래픽/오디오/팔레트성 리소스다.
- 대사/스크립트는 동적 ID 테이블, 압축 블록, 또는 별도 스크립트 VM 경로를 통해 로딩될 가능성이 커졌다.

## 동적 리소스 ID 경로

`scan-dynamic-resource-ids.js`로 로더 호출 직전 `a0` source를 분류했다.

| source kind | 호출 수 | 의미 |
| --- | ---: | --- |
| `const` | 108 | 직접 상수 ID |
| `lhu` | 15 | halfword table 또는 런타임 구조체에서 ID 읽기 |
| `andi` | 12 | 호출자 인자 또는 계산값을 16비트 ID로 마스킹 |
| `addu` | 9 | 레지스터 값을 그대로 ID로 전달 |
| `unknown` | 1 | delay slot/문맥만으로는 추적 미완 |

확인된 정적 table base:

| table base | 호출 지점 | 판정 |
| --- | --- | --- |
| `0x801C4D1C` | `0x8017FB50` | 그래픽 `be-hdr` ID 위주. `307, 308, 288, 626, 627, 739, 758...` |
| `0x801C8794` | `0x8018979C` | `27..68` 등 큰 `raw-0x400` 맵/그래픽성 리소스 |
| `0x801C89CC` | `0x80195C44` | `134..165` 등 `VAGp` 오디오 리소스 |
| `0x801CAC44` | `0x801A5448` | `626..670` 근처 그래픽 `be-hdr` 리소스 |
| `0x801CAD84` | `0x801A567C` | `462..490` 근처 0x800 구조체성 리소스 |
| `0x801CAE24` | `0x801A565C` | `538..566` 근처 구조체/효과 데이터. 일부 zero chunk 포함 |
| `0x801CAFB0` | `0x801AC284` | `327..346` 근처 0x800 구조체성 리소스 |
| `0x801CB07C` | `0x801ACC18` | 앞쪽은 그래픽/맵 ID, 이후는 다른 데이터가 섞여 table 경계 주의 필요 |

동적 계산 ID 범위:

- `+829`, `+1008`, `+1074`, `+1151` 계열은 `0x800` 또는 `0x1000` 크기의 마스크/폰트/그래픽성 데이터로 보인다.
- `829..840`, `1008..1015`, `1074..1080`, `1151..1169`를 확인했지만 평문 텍스트 후보는 없었다.
- `1151..1169`는 `0x801AD190`/`0x8017B500` 경로에서 256x64 1bpp UI mask로 쓰이는 계열로 확정했다.

## 동적 후보 텍스트 스캔

다음 ID 그룹을 대상으로 제한적 Shift-JIS 스캔을 수행했다.

- `raw-0x400` 후보: `28, 31, 33, 37, 42, 45, 47, 51, 57, 60, 66, 68`
- 구조체성 후보: `327..346`, `462..490`, `538..566`
- 계산 ID 후보: `829..840`, `1008..1015`, `1074..1080`, `1151..1169`

결과:

- 읽을 수 있는 일본어 문장 후보는 나오지 않았다.
- `試試試...`처럼 보이는 반복 후보와 일본어처럼 보이는 긴 run은 바이너리 패턴의 Shift-JIS 오탐으로 판단한다.
- 동적 리소스 ID 경로도 현재까지는 맵/그래픽/오디오/구조체성 데이터에 가깝다.

## Script bank 리소스

`docs/projects/SLPS-01903/script-reader.md`에 정리한 대로, `0x8017BFE8`은 `0x80169B30`의 16개 halfword 테이블을 통해 script bank 리소스를 고른다.

확정된 기본 bank:

`309, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319, 320, 321, 322, 323, 324`

관찰:

- 각 리소스는 big-endian halfword stream이며, 로드 후 `0x801881FC`로 16-bit swap된다.
- 앞쪽은 최대 192개 halfword entry pointer table로 보인다.
- `0x8017BFE8(scriptId, entry)`는 `table[entry] >> 1`을 script PC(`gp+478`)로 설정한다.
- `325`, `326`도 같은 `0x0502` entry table 형태지만 기본 bank table에는 포함되지 않는다.
- `309..326`에서 평문 Shift-JIS 텍스트 후보는 나오지 않았다.

## 다음 조사

1. `docs/projects/SLPS-01903/post-load-processing.md`에 정리한 대로, `0x80188118`, `0x8018815C`, `0x801881C4`, `0x801881FC`, `0x8018821C`, `0x80188274`는 endian/record 후처리 계층으로 판정했다.
2. `0x8017B0EC`는 rect 전송/클리어 래퍼로 정정했다. 실제 1bpp UI glyph/icon mask 전개 후보는 `0x8017B13C`, `0x8017B500`, 그리고 래퍼 `0x801AD230`이다.
3. `1151..1169`는 UI 1bpp mask로 확정했다. 나머지 `+829`, `+1008`, `+1074` 계열은 추가 프리뷰로 분류한다.
4. 대사/이벤트 본문은 `docs/projects/SLPS-01903/script-reader.md`의 `0x8017C364` halfword reader와 `309..324` script bank 경로에서 추적한다.
5. `raw-0x400` 맵 리소스와 0x800 구조체성 리소스는 텍스트 후보가 아니라 맵/이벤트/효과 데이터 후보로 분리해 카탈로그화한다.
## Latest be-hdr Visual Review

- `266..286` is no longer considered a system UI candidate. Manual visual
  review identified it as opening character-description graphics and
  background/image material.
- Additional previews were also ruled out as the same opening/image family:
  - `tmp/SLPS-01903/system-ui-next-candidates-245-264-633-660.html`
  - `tmp/SLPS-01903/be-hdr-tilemap-758-807.html`
- Continue with a runtime-guided search: enter the target system
  menu/status/shop/config screen in the emulator and log or infer the resource
  IDs loaded immediately before the UI appears.
