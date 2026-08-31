# 1bpp UI mask 안전군 빌드

## 결과

PS1과 SS 원본 mask가 동일하고 `SS ID = PS1 ID - 114`가 확인된 1bpp UI 자산 334개를 finale 포함 통합 이미지에 적용했다.

```text
output/ss-fs2-korean-ui-safe.cue
output/ss-fs2-korean-ui-safe.bin
output/ss-fs2-korean-ui-safe.report.json
```

| 분류 | 적용 수량 |
| --- | ---: |
| 아이템 설명 | 178 |
| 마법·메뉴 설명 | 71 |
| 유닛 도움말 | 67 |
| 날짜·의뢰 화면 | 18 |
| 합계 | 334 |

원본 내용이 다른 PS1 `930→SS 816`과 `1053→SS 939` 두 항목은 제외했다.

## 빌드 도구

```text
scripts/ss-fs2-build-ui-mask-patch.js
```

재현 명령:

```powershell
node scripts/ss-fs2-build-ui-mask-patch.js `
  output/ss-fs2-korean-with-finale.bin `
  output/ss-fs2-korean-ui-safe.bin `
  output/ss-fs2-ui-mask-map.json `
  tmp/SLPS-01903/ui-mask-workflow/apply `
  output/ss-fs2-korean-ui-safe.report.json
```

빌더는 다음 조건을 강제한다.

1. SS 목적 리소스가 PS1 ID에서 정확히 114를 뺀 ID이다.
2. 입력 BIN의 원본 mask SHA-1이 PS1 원본과 일치한다.
3. 한국어 PBM이 TSV의 width와 rows에 맞는 P1 형식이다.
4. PBM을 게임의 `0=ink, 1=background` 1bpp 형식으로 재패킹한다.
5. 출력 후 패킹된 mask를 다시 읽어 byte 일치를 검사한다.
6. 변경 Mode 1 sector의 EDC/ECC를 다시 계산한다.

## 변경 범위

334개 중 316개는 288×64, 2,304바이트로 두 논리 sector에 걸친다. 날짜·의뢰 18개는 256×64, 정확히 2,048바이트이다.

| 항목 | 값 |
| --- | ---: |
| 처리한 LBA | 650 |
| 실제로 달라진 sector | 458 |
| UI 추가 user-data 변경 byte | 238,788 |
| UI LBA 범위 | 18,669~19,346 |
| Mode 1 EDC/ECC 오류 | 0 |

처리 LBA보다 실제 변경 sector가 적은 것은 `#`, `#예비`처럼 한국어 PBM도 원본 빈 mask와 같은 항목이 있기 때문이다.

## 전체 통합 이미지 검증

일본어 원본 Track 1과 비교한 누적 결과:

| 항목 | 값 |
| --- | ---: |
| 누적 변경 sector | 3,836 |
| 누적 user-data 변경 byte | 2,008,469 |
| Mode 1 EDC/ECC 오류 | 0 |
| 출력 크기 | 516,419,232 bytes |
| SHA-256 | `81C08364DB833029E41DE387B60E32E76D1315EFC08B5BBE9AA0D091F544972F` |

Track 2는 수정하지 않는다.

## 실행 확인 항목

- 소지품 또는 상점의 아이템 설명이 한국어로 나오는가.
- 마법·기술 설명의 4줄 문구가 잘리지 않는가.
- 전투 또는 도움말의 유닛 설명이 한국어로 나오는가.
- 날짜·의뢰 제목이 정상 배치되는가.
- 항목을 빠르게 전환할 때 그래픽 잔상이나 정지가 없는가.

다음 구조 조사는 이름 테이블 458행이다. 이름, 아이템명, 기술명처럼 짧은 고정 문자열이 별도의 이미지 테이블에 들어 있으므로 SS의 대응 리소스와 tile 배치를 확인해야 한다. 그 뒤 big-endian header UI 66행을 조사한다.
