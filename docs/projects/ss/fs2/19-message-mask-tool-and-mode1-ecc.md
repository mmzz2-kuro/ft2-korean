# 대사 마스크 도구와 Mode 1 EDC/ECC

## 결과

SS Track 1 BIN을 직접 대상으로 하는 대사 mask 도구를 구현했다.

지원 기능:

- message ID를 실제 raw BIN 위치로 변환
- 선두 `0x930`바이트를 200×48, 2bpp PGM으로 export
- PGM을 원본 packed byte열로 왕복 검증
- 입력 ROM을 보존하고 새 BIN 복사본에만 patch
- 변경된 Mode 1/2352 sector의 EDC와 ECC P/Q 재계산

직접 대사 24개 전부 pack/unpack 무손실 왕복에 성공했다. message `1004`의 원본 PGM을 새 BIN에 다시 patch한 무변경 시험에서는 출력 BIN의 CRC32, MD5, SHA-1이 원본과 모두 같았다.

## 도구

```text
scripts/ss-fs2-message-mask-tool.js
```

### Export

```powershell
node scripts/ss-fs2-message-mask-tool.js export `
  "ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 1).bin" `
  "output/ss-fs2-message-masks" `
  1001 1004 1103 1104 1105 1106
```

출력:

```text
message-mask-1001.pgm
message-mask-1004.pgm
...
message-mask-manifest.json
```

PGM 규격:

```text
P2
width  = 200
height = 48
maxval = 3
pixel  = palette index 0..3
```

### Verify

```powershell
node scripts/ss-fs2-message-mask-tool.js verify `
  "ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 1).bin" `
  1001 1004 7004
```

검증은 다음 순서다.

```text
raw packed 0x930
  -> 200x48 pixel indices
  -> big-endian 2bpp pack
  -> original 0x930과 byte 비교
```

### Patch

```powershell
node scripts/ss-fs2-message-mask-tool.js patch `
  "ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 1).bin" `
  "output/Farland-Saga-2-SS-patched.bin" `
  1004 `
  "output/ss-fs2-message-masks/message-mask-1004.pgm"
```

입력 BIN과 출력 BIN 경로가 같으면 도구가 중단한다. 먼저 전체 입력을 출력 경로로 복사한 뒤 해당 message mask만 수정한다.

## 2bpp pack 규칙

mask source는 588개의 4-byte entry다.

```text
entry 0..195   -> y 0..15
entry 196..391 -> y 16..31
entry 392..587 -> y 32..47
column         -> entry % 196
```

각 entry에는 big-endian u16 두 개가 있고 각 word는 8개의 2-bit pixel을 가진다. 낮은 2bit부터 꺼내지만 화면의 y는 word 내부에서 역순으로 배치된다.

```text
pixel = word & 3
word >>= 2
y = rowBase + wordIndex * 8 + (7 - pairIndex)
```

논리 canvas 폭은 200이지만 packed entry는 각 16-pixel band마다 196 columns를 사용한다. 나머지 4 columns는 0으로 유지된다.

## Mode 1 raw sector patch

SS Track 1은 `MODE1/2352`다.

| 구간 | sector offset | 크기 |
| --- | ---: | ---: |
| sync + header | `0x000` | 16 |
| user data | `0x010` | 2048 |
| EDC | `0x810` | 4 |
| reserved | `0x814` | 8 |
| ECC P/Q | `0x81C` | 276 |

`scripts/cdrom-eccedc.js`에 다음 기능을 추가했다.

```js
isMode1(sector)
recomputeMode1Sector(sector)
```

재계산 순서:

1. sector `0x000..0x80F`를 대상으로 EDC 계산
2. EDC를 little-endian으로 `0x810`에 기록
3. reserved 8 bytes를 0으로 설정
4. header address와 user data/EDC/reserved를 대상으로 ECC P/Q 생성
5. parity 276 bytes를 `0x81C`에 기록

원본 sector 검증은 다음 LBA를 포함해 수행했다.

```text
0, 16, 21, 178,
30078, 30238, 36716, 43492,
75362, 100064, 108876, 219412
```

12개 모두 원본에 저장된 EDC/ECC와 재계산 결과가 일치했다.

## 실제 왕복 시험

message `1004`:

```text
file 1 sectors: 30060..30072
track LBA:       30238..
mask bytes:      0x930
modified LBAs:   30238, 30239
```

원본에서 export한 PGM을 그대로 새 BIN에 patch하고 두 sector의 EDC/ECC를 재계산했다.

| 항목 | 원본 | 왕복 출력 |
| --- | --- | --- |
| 크기 | 516,419,232 | 516,419,232 |
| CRC32 | `98EBC3FF` | `98EBC3FF` |
| MD5 | `5c5bb788648e0b2cc3bc575c80683f19` | 동일 |
| SHA-1 | `58ed09b28c56afb510f68ee4e90509727eb66ac2` | 동일 |

검증용 516MB BIN 복사본은 확인 후 제거했다. export한 소형 PGM 시험 자료는 `output/ss-fs2-message-mask-test`에 남겼다.

## 현재 제한

- 현재 patch 모드는 선두 `0x930` mask만 교체한다.
- `0x930` 뒤의 reveal/control header는 보존한다.
- 원문보다 훨씬 긴 번역은 원래 reveal entry 수보다 길어질 수 있다.
- SS 후속 header는 PS1과 블록 전체가 같지 않으므로 아직 자동 재구축하지 않는다.
- 완성 BIN을 CUE와 함께 구동하는 에뮬레이터 실기 검증은 아직 수행하지 않았다.

짧은 한국어 smoke test에는 현재 고정 크기 교체가 안전하다. 전체 번역에는 SS reveal/control header를 분석해 노출 길이를 새 mask에 맞게 갱신해야 한다.

## 다음 단계

1. message `1004`에 짧은 한국어 mask를 생성한다.
2. SS BIN 복사본에 patch하고 diff sector가 2개뿐인지 확인한다.
3. 에뮬레이터에서 대사 위치, 색상, 줄 높이, reveal 동작을 확인한다.
4. 결과를 바탕으로 SS reveal header 갱신 규칙을 확정한다.

