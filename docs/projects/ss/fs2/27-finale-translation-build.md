# Finale 번역 통합 빌드

## 결과

SS message group 17의 `17001~17220` 전체 220개에 PS1 finale 한국어 PGM을 적용했다. 기존 일반 대사 통합 이미지 위에 적용했으므로 현재 이미지에는 일반 대사 2,433개와 finale 220개, 합계 2,653개의 한국어 message mask가 들어 있다.

```text
output/ss-fs2-korean-with-finale.cue
output/ss-fs2-korean-with-finale.bin
```

| 항목 | 수량 |
| --- | ---: |
| 일반 대사 안전군 | 1,899 |
| 일반 대사 reveal 확장군 | 534 |
| finale group 17 | 220 |
| 한국어 적용 합계 | 2,653 |
| 남은 SS/PS1 원본 차이 일반 대사 | 4 |

## Finale 적용 방식

`scripts/ss-fs2-reveal-extension-poc.js`에 다음 입력 모드를 추가했다.

```powershell
node scripts/ss-fs2-reveal-extension-poc.js `
  output/ss-fs2-korean-reveal-all.bin `
  output/ss-fs2-korean-with-finale.bin `
  --finale-map `
  output/ss-fs2-finale-map.json `
  tmp/SLPS-01903/dialogue-workflow/apply
```

도구는 `17001~17220` 각각에 대해 다음 절차를 수행한다.

1. finale map에서 해당 SS message ID에 대응하는 번역 행을 찾는다.
2. 첫 번째 유효 번역 행의 `finale-text-*-ko.pgm`을 선택한다.
3. SS 원본 count의 하위 16비트와 한국어 유효 entry를 비교한다.
4. capacity 안이면 mask만 교체하고 확장 필드를 0으로 둔다.
5. capacity를 넘으면 상위 16비트에 확장 count를 기록한다.
6. 출력 후 mask header와 실행 코드 상태를 다시 검사한다.

입력 이미지에는 reveal 트램펄린이 이미 있으므로 실행 파일을 다시 수정하지 않았다. 주입 코드, 임시 헤더 포인터, 호출 포인터가 기존 PoC와 정확히 같은 경우에만 `already-patched` 상태로 인정한다.

## Reveal 집계

| 분류 | 수량 |
| --- | ---: |
| 원본 capacity 이내 | 153 |
| 확장 count 사용 | 67 |
| 최대 확장 count | 39 |
| 최대 count 대상 | message 17052 |

최대값 39는 현재 설계 상한 42와 mask 최대 588 entry 안에 있다.

## 검증

Finale 적용 전 이미지와 비교:

| 항목 | 값 |
| --- | ---: |
| 변경 sector | 303 |
| user-data 변경 byte | 170,637 |
| Mode 1 EDC/ECC 오류 | 0 |

일본어 원본 Track 1과 비교한 전체 누적 결과:

| 항목 | 값 |
| --- | ---: |
| 변경 sector | 3,378 |
| user-data 변경 byte | 1,769,681 |
| Mode 1 EDC/ECC 오류 | 0 |
| 출력 크기 | 516,419,232 bytes |
| SHA-256 | `9C63B8FAEF29D757C32464D06FDF5135ABAC91730BCB483570E7D6109DC2EBE1` |

Track 2는 수정하지 않으며 CUE가 원본 CDDA 파일을 참조한다.

## 실행 확인 항목

Finale는 게임 후반부이므로 전체 플레이 또는 후기 세이브에서 다음을 확인해야 한다.

- `17001`부터 마지막 `17220`까지 한국어가 표시되는가.
- count 확장을 사용하는 67개 대사의 마지막 부분이 잘리지 않는가.
- 음성, 장면 전환, 전투 전후 진행이 정상인가.
- 반복 장면에서 선택한 대표 번역이 문맥상 자연스러운가.
- 마지막 message 이후 엔딩 진행과 크레딧이 정상인가.

현재 자동 적용 대상에서 남은 것은 PS1/SS 원본 mask가 다른 일반 message `1018`, `5040`, `5042`, `6093` 네 개뿐이다. 이들은 추후 GUI에서 SS 원본 기준으로 편집한다.
