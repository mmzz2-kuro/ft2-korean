# PS1 번역 자산의 SS 이관

## 결과

PS1판에서 완성된 일반 대사 번역 PGM을 SS판 message bank에 전수 대조하고, 자동 이관 가능한 안전군을 실제 BIN으로 빌드했다.

| 분류 | 수량 |
| --- | ---: |
| 일반 message 번역 후보 | 2,437 |
| 자동 이관 통과 | 1,899 |
| SS reveal capacity 초과 | 534 |
| PS1/SS 원본 mask 차이 | 4 |

안전군 1,899개는 다음 조건을 모두 만족한다.

1. SS message slot이 존재한다.
2. 현재 PS1 `FS2_FILE.DAT`의 원본 mask와 SS 원본 mask가 raw `0x930`바이트 단위로 같다.
3. 한국어 PGM이 P2 200×48, palette index 0..3 형식이다.
4. 한국어 mask의 마지막 유효 entry가 SS 원본 `revealCount × 14` 이내다.

## 번역 자료 현황

입력 TSV:

```text
trDatas/dialogue-workflow/dialogue-translation.tsv
```

통계:

| 항목 | 수량 |
| --- | ---: |
| 전체 TSV 행 | 2,697 |
| `ko_text`가 있는 행 | 2,665 |
| 일반 message 행 | 2,440 |
| finale 주소형 행 | 257 |
| 고유한 일반 message 번역/PGM | 2,437 |

`kind=finale`인 257개는 message ID 기반 bank가 아니라 별도 주소 기반 자산이므로 이번 이관에서 제외했다.

TSV의 `enabled` 값은 `0`이 2,695개, `1`이 2개뿐이다. 현재 PS1 작업에서 선택 적용용으로 사용된 상태값이며, 이미 렌더된 전체 한국어 PGM의 완성 여부를 나타내지 않는다. 따라서 이번 이관은 `enabled`가 아니라 다음 조건으로 후보를 선택했다.

```text
kind가 비어 있음
message_id가 정수
ko_text가 비어 있지 않음
message-mask-{ID}-ko.pgm 존재
```

## 오래된 PS1 mask cache 발견

처음에는 다음 디렉터리의 원본 PGM을 SS와 비교했다.

```text
tmp/SLPS-01903/dialogue-workflow/masks
```

그러나 2,437개가 모두 불일치했다. 대표 message `1004`를 확인한 결과:

| 자료 | 비투명 pixel 수 |
| --- | ---: |
| 기존 cache PGM | 104 |
| 현재 PS1 DAT 재추출 | 146 |
| SS 원본 재추출 | 146 |

현재 PS1 DAT에서 다시 추출한 PGM과 SS PGM은 9,600개 pixel이 모두 같았다. 즉 `masks` 디렉터리는 현재 원본과 맞지 않는 과거 작업 cache이며 플랫폼 차이의 근거로 사용할 수 없다.

전수 검사 도구는 이 문제를 피하기 위해 cache PGM을 읽지 않고 다음 원본에서 raw mask를 직접 비교한다.

```text
ps1/SLPS-01903/FS2_FILE.DAT
ps1/SLPS-01903/SLPS_019.03
ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 1).bin
```

## 전수 검사 및 manifest 생성 도구

```text
scripts/ss-fs2-prepare-translation-build.js
```

재현 명령:

```powershell
node scripts/ss-fs2-prepare-translation-build.js `
  "ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 1).bin" `
  "ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 2).bin" `
  "ps1/SLPS-01903/FS2_FILE.DAT" `
  "ps1/SLPS-01903/SLPS_019.03" `
  "trDatas/dialogue-workflow/dialogue-translation.tsv" `
  "tmp/SLPS-01903/dialogue-workflow/apply" `
  "configs/ss-fs2-korean-safe.json" `
  "output/ss-fs2-translation-preflight.json"
```

출력 요약:

```text
candidateMessageRows=2437
ready=1899
rejected=538
rejectedCategory=reveal-overflow count=534
rejectedCategory=platform-mask-difference count=4
```

산출물:

- `configs/ss-fs2-korean-safe.json`: 자동 이관 가능한 1,899개 patch manifest
- `output/ss-fs2-translation-preflight.json`: 전체 통과/제외 사유와 message별 수치

## PS1/SS 원본이 다른 4개

| message ID | 한국어 문장 요약 |
| ---: | --- |
| 1018 | 방향키 좌우/L1/R1 및 O버튼 조작 설명 |
| 5040 | 부잣집에 강도 예고장이 왔다는 대사 |
| 5042 | 어느 부잣집인지 묻는 대사 |
| 6093 | 수영복과 해변축제 대사 |

이 네 항목은 같은 message ID라도 원본 화면 내용이나 레이아웃이 플랫폼별로 달라졌을 가능성이 있다. PS1 한국어 PGM을 자동 이식하지 않고 SS 원본을 기준으로 문장과 배치를 개별 확인해야 한다.

## Reveal 초과 534개

기존 한국어 PGM은 PS1용 reveal header 확장 기능을 전제로 렌더된 것이 많다. SS에서는 후속 플랫폼 데이터를 보존하기 위해 count를 늘리지 않으므로 534개가 원본 capacity를 넘는다.

대표적인 큰 초과:

| message | visible | capacity | 초과 |
| ---: | ---: | ---: | ---: |
| 11008 | 320 | 42 | 278 |
| 6129 | 276 | 42 | 234 |
| 12061 | 353 | 140 | 213 |
| 1020 | 248 | 42 | 206 |
| 10007 | 496 | 294 | 202 |
| 1021 | 252 | 56 | 196 |
| 2217 | 488 | 294 | 194 |
| 2018 | 304 | 112 | 192 |

초과 항목은 단순히 마지막 pixel을 자르면 문장이 유실되므로 자동 patch하지 않는다. 다음 순서로 재렌더해야 한다.

1. 불필요한 좌측/행별 공백을 제거한다.
2. 문장을 원래 reveal 구간 안에서 더 앞쪽에 배치한다.
3. 줄바꿈을 조정해 세로 band 전환으로 생기는 큰 entry 증가를 피한다.
4. 글꼴 크기·자간·문장 표현을 조정한다.
5. 새 PGM을 다시 전수 검사한다.

특히 capacity가 28~84처럼 작은 대사는 원문 자체가 짧은 경우가 많아 문장 축약이 필요할 수 있다.

## 안전군 manifest dry run

```powershell
node scripts/ss-fs2-build-message-patch.js `
  configs/ss-fs2-korean-safe.json `
  --dry-run `
  --summary
```

결과:

```text
status=dry-run-ok patches=1899 touchedLbas=3798
track1Sha256=267cb97b787e4f3c804cbcb0495977c7f3b309513ca15f918a9c3c6d18996d02
track2Sha256=1e3504c775b34e839b52c9dea95c40d51e3f4dcdae82cc88a11413d6ed301741
```

`touchedLbas=3798`은 각 `0x930` mask가 걸치는 두 sector의 최대 처리 대상 수다. 실제 byte가 바뀐 sector 수는 이보다 적다.

## 1,899개 실제 빌드

```powershell
node scripts/ss-fs2-build-message-patch.js `
  configs/ss-fs2-korean-safe.json `
  --force `
  --summary
```

산출물:

```text
output/ss-fs2-korean-safe.bin
output/ss-fs2-korean-safe.cue
output/ss-fs2-korean-safe.report.json
```

검증 결과:

| 항목 | 값 |
| --- | ---: |
| patch 수 | 1,899 |
| 실제 변경 raw sector | 2,005 |
| 변경 user-data bytes | 1,121,845 |
| Mode 1 EDC/ECC 오류 | 0 |
| 허용 범위 밖 변경 | 0 |
| 출력 크기 | 516,419,232 bytes |
| 출력 SHA-256 | `B61AD000224E9A27882E29A027780A8437A13ADF379880A2057572243D40750E` |

빌드는 원본과 같은 크기를 유지하고 Track 2를 수정하지 않는다. 생성 CUE는 원본 CDDA Track 2를 상대 경로로 참조한다.

## 검증 범위와 한계

정적으로 확정된 항목:

- 1,899개 모두 PS1과 SS의 원본 raw mask가 동일
- 1,899개 한국어 PGM 모두 SS reveal capacity 이내
- 변경은 지정한 message mask와 해당 sector parity에만 한정
- 전체 변경 sector의 Mode 1 EDC/ECC 정상
- `1004`에 사용하는 동일한 렌더링 및 build 경로는 실제 SS 화면에서 한글 출력 확인

아직 남은 런타임 검증:

- 1,899개 장면 전체의 문장 잘림과 줄바꿈
- 화자별 색상 및 특수 palette 사용
- 음성과 reveal 동기
- 극단적으로 긴 대사와 3줄 배치
- 저장/로드 및 장시간 진행 안정성

따라서 `ss-fs2-korean-safe.bin`은 대규모 실기 검증용 빌드이며 아직 배포용 완성판으로 판정하지 않는다.

## 다음 단계

다음은 제외된 534개 reveal 초과 PGM을 SS capacity에 맞게 자동 재배치하는 작업이다. 먼저 현재 PGM의 실제 bounding box와 행별 사용 범위를 분석해 공백 제거만으로 해결되는 항목, 글꼴 축소가 필요한 항목, 문장 수정이 필요한 항목으로 나눈다. 플랫폼 차이 4개는 별도 수동 검토 목록으로 유지한다.
