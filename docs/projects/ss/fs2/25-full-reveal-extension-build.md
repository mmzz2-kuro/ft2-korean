# Reveal 초과 전체 빌드

## 결과

1차와 2차 실행 시험에서 확인한 reveal count 확장 방식을 초과 대사 534개 전부에 적용했다. 기존 안전군 1,899개가 들어 있는 BIN을 기반으로 빌드했으므로 일반 message 번역 후보 2,437개 중 2,433개가 한국어로 적용된 통합 시험 이미지이다.

```text
output/ss-fs2-korean-reveal-all.cue
output/ss-fs2-korean-reveal-all.bin
```

| 항목 | 값 |
| --- | ---: |
| 기존 안전군 | 1,899 |
| reveal 확장 적용 | 534 |
| 합계 | 2,433 |
| 남은 플랫폼 원본 차이 | 4 |
| 출력 크기 | 516,419,232 bytes |
| SHA-256 | `7B4B53E80DEF83DD8E5CAF8E0712C61D72DB91B5E090A1EBAFCDD2901EF2EA2E` |

## 대량 빌드 방법

PoC 도구에 preflight의 `reveal-overflow` 항목을 전부 읽는 입력 모드를 추가했다.

```powershell
node scripts/ss-fs2-reveal-extension-poc.js `
  output/ss-fs2-korean-safe.bin `
  output/ss-fs2-korean-reveal-all.bin `
  --overflow-preflight `
  output/ss-fs2-translation-preflight.json `
  tmp/SLPS-01903/dialogue-workflow/apply
```

도구는 534개 각각에 대해 PGM 형식, message 위치, 원본 count, 확장 count, 출력 헤더를 검사한다. 실행 코드 트램펄린과 포인터는 전체 BIN에 한 번만 주입한다.

최대 확장 count는 42이다. message `5119`가 유효 entry 576으로 count 42를 사용한다. mask 출력 테이블의 최대 588 entry와 임시 경계표 범위 안이다.

## 섹터 검증

안전군 BIN과 비교한 결과:

| 항목 | 값 |
| --- | ---: |
| 변경 sector | 1,070 |
| user-data 변경 byte | 477,199 |
| Mode 1 EDC/ECC 오류 | 0 |

일본어 원본 Track 1과 비교한 통합 결과:

| 항목 | 값 |
| --- | ---: |
| 변경 sector | 3,075 |
| user-data 변경 byte | 1,599,044 |
| Mode 1 EDC/ECC 오류 | 0 |

출력 BIN은 원본과 같은 크기를 유지하고 Track 2는 수정하지 않는다.

## 남은 4개

다음 message는 reveal 초과가 아니라 PS1판과 SS판의 원본 mask 자체가 다른 항목이다.

```text
1018, 5040, 5042, 6093
```

이들은 플랫폼별 조작 설명이나 화면 배치 차이일 가능성이 있어 PS1 한국어 PGM을 자동 이식하지 않았다. SS 원본을 기준으로 별도 번역 화면을 만들어야 한다.

## 전체 플레이 확인 항목

- 긴 대사 끝부분이 잘리지 않는가.
- 확장 부분이 마지막 시점에 한꺼번에 나타나더라도 진행과 음성이 정상인가.
- count 42를 사용하는 긴 대사가 정상인가.
- 장면 전환, 저장, 전투, 음성 재생에서 정지나 화면 깨짐이 없는가.
- 일본어가 남는 위치가 위 네 message 또는 별도 finale 자산인지 기록한다.

현재 빌드는 reveal 확장 방식의 전체 회귀 시험용이다. 전체 플레이 결과가 안정적이면 확장 경계의 시간 재분배와 남은 4개 SS 전용 화면 번역을 다음 작업으로 진행한다.
