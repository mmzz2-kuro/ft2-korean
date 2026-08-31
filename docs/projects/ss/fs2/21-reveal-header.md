# SS 대사 reveal 헤더

## 결론

SS판 대사 mask 뒤의 reveal 구조와 안전한 패치 조건을 확인했다.

- reveal header는 message block의 `+0x930`에서 시작한다.
- 첫 4바이트는 big-endian `u32` segment count다.
- 한 segment는 mask entry 14개를 순차적으로 노출한다.
- 원본 mask의 유효 범위는 조사한 직접 대사 24개 모두 `count × 14` 이내다.
- count와 활성 경계값은 SS와 PS1에서 같지만, 활성 영역 직후부터 플랫폼별 데이터가 달라진다.
- 따라서 SS에서는 기존 count를 늘리거나 PS1용 고정 `0xD0` 헤더 재구축을 그대로 적용하면 안 된다.

현 단계의 안전한 번역 방법은 원본 reveal header를 보존하고, 번역 mask의 마지막 유효 entry가 원본 `count × 14`를 넘지 않게 제한하는 것이다. 패치 도구에 이 검사를 추가해 초과 입력은 BIN 복사 전에 중단하도록 했다.

## 런타임 소비 루틴

주소 `0x060202A0`은 reveal 보간 테이블을 만든다.

주요 버퍼:

```text
mask base:   0x0607BC30
header base: 0x0607C560 = 0x0607BC30 + 0x930
output base: 0x0607AC30
```

핵심 동작:

```text
count = be32(header + 0x00)
source = header + 0x04
output[0] = count * 14

각 segment:
  start = be32(source + 0x00)
  end   = be32(source + 0x04)
  start..end 사이를 14단계로 보간
  source += 4
```

SH-2는 big-endian이므로 코드에서는 header `+2`를 `MOV.W`로 읽어 count의 하위 16비트를 취한다. 원본 count는 최대 39로 이 방식에 문제가 없다.

루틴에서 확인되는 상수:

| 주소 | 값 | 역할 |
| --- | ---: | --- |
| `0x060202BA` | `14` | segment당 reveal entry 수 |
| `0x060202CA` | `0x24924925` | 14단계 보간 계산의 나눗셈 계열 상수 |
| `0x060202CE` | `13` | segment 내부 마지막 index |
| `0x060202D0` | `0x59493E15` | pointer를 reveal mark로 환산하는 곱셈 상수 |

결과 테이블의 총 entry 수는 다음과 같다.

```text
reveal capacity = min(588, count * 14)
```

588은 200×48 mask를 저장하는 packed entry의 총수다.

## 디스크 구조

message block 기준:

```text
+0x000..+0x92F  200x48 2bpp mask, 588 entries
+0x930..+0x933  big-endian u32 segment count
+0x934..        big-endian u32 경계값 배열
```

segment 하나를 보간하려면 현재 경계와 다음 경계가 모두 필요하다. 따라서 런타임은 count개의 구간에 대해 `count + 1`개의 경계 위치를 참조한다.

SS와 PS1 비교에서 다음이 확인됐다.

- 24개 모두 count 동일
- 24개 모두 count개 활성 시작 경계 동일
- SS의 다음 경계 및 후속 데이터는 PS1과 다름
- SS의 다음 경계는 활성 마지막 값보다 크거나 같아 런타임 보간에 유효
- PS1의 같은 위치는 0으로 나타나므로 저장 및 소비 방식이 SS와 동일하지 않음

즉 mask와 reveal 시작 시점 자료는 공유하지만, 그 뒤의 음성·미디어 또는 플랫폼 전용 자료 배치는 공유하지 않는 구조다. SS block이 PS1보다 2~4배 큰 현상과도 일치한다.

## 24개 직접 대사 검증

`visible`은 mask에서 palette index가 0이 아닌 마지막 packed entry의 다음 위치다. `capacity`는 `count × 14`다.

| message | count | visible | capacity | 여유 |
| ---: | ---: | ---: | ---: | ---: |
| 1001 | 7 | 93 | 98 | 5 |
| 1004 | 4 | 53 | 56 | 3 |
| 1103 | 7 | 98 | 98 | 0 |
| 1104 | 22 | 305 | 308 | 3 |
| 1105 | 5 | 70 | 70 | 0 |
| 1106 | 2 | 25 | 28 | 3 |
| 2001 | 26 | 364 | 364 | 0 |
| 2004 | 18 | 249 | 252 | 3 |
| 2007 | 7 | 95 | 98 | 3 |
| 2008 | 39 | 546 | 546 | 0 |
| 2009 | 10 | 140 | 140 | 0 |
| 4001 | 7 | 93 | 98 | 5 |
| 4003 | 12 | 160 | 168 | 8 |
| 4004 | 25 | 347 | 350 | 3 |
| 4005 | 16 | 219 | 224 | 5 |
| 4007 | 17 | 234 | 238 | 4 |
| 6001 | 13 | 182 | 182 | 0 |
| 6002 | 8 | 112 | 112 | 0 |
| 6003 | 11 | 153 | 154 | 1 |
| 6004 | 4 | 51 | 56 | 5 |
| 6005 | 12 | 167 | 168 | 1 |
| 7002 | 8 | 107 | 112 | 5 |
| 7003 | 9 | 121 | 126 | 5 |
| 7004 | 28 | 387 | 392 | 5 |

모든 원본이 조건을 만족하며, 7개 메시지는 여유가 0이다. 따라서 count와 mask 사용 범위의 관계는 우연한 정렬이 아니라 실제 reveal 범위 제약으로 판정한다.

## 분석 도구

```text
scripts/ss-fs2-analyze-reveal-header.js
```

재현 명령:

```powershell
node scripts/ss-fs2-analyze-reveal-header.js `
  "ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 1).bin" `
  "ps1/SLPS-01903/FS2_FILE.DAT" `
  "ps1/SLPS-01903/SLPS_019.03"
```

이 도구는 각 메시지에 대해 다음을 비교한다.

- SS/PS1 block sector 수
- segment count
- 활성 시작 경계값
- SS 종단 경계값
- 경계 단조 증가 여부
- SS/PS1 공통 header prefix
- mask visible entry와 reveal capacity

## 패치 도구 안전장치

`scripts/ss-fs2-message-mask-tool.js`의 `export`, `verify`, `patch`에 reveal 검사를 추가했다.

`verify` 출력 예:

```text
OK 1004: mask round-trip, reveal 53/56, sectors 30060..30072
OK 2008: mask round-trip, reveal 546/546, sectors 43768..43874
```

`patch`는 입력 PGM의 visible entry를 계산한 뒤 다음 조건을 적용한다.

```text
visible <= original count * 14
```

조건을 넘으면 다음 형식의 오류를 내고 출력 BIN을 만들거나 덮어쓰기 전에 중단한다.

```text
message N uses X reveal entries, exceeding original capacity Y
```

조건을 만족하면 기존처럼 mask `0x930`바이트만 교체한다. count, 경계값, 플랫폼별 후속 데이터는 바꾸지 않는다.

## PS1 로직을 직접 이식하지 않는 이유

기존 PS1 도구는 `+0x930`부터 고정 `0xD0` 영역을 재작성하며 count를 늘릴 수 있게 되어 있다. SS에서는 활성 경계 직후부터 원본 플랫폼 데이터가 나타나고 런타임이 다음 경계값을 참조한다.

PS1 방식을 그대로 적용하면 다음 위험이 있다.

- SS 종단 경계 손상
- 음성 또는 후속 미디어 시작부 손상
- 늘어난 count가 원래 block의 유효 경계 배열 밖을 참조
- 잘못된 reveal 보간값 또는 런타임 범위 초과

SS에서 count 확장을 지원하려면 후속 자료의 정확한 형식, 경계 재계산법, 데이터 이동 및 block sector 재배치까지 함께 해결해야 한다. 현재 번역은 고정 200×48 canvas 안에서 원본 capacity를 지키는 방식이 더 안전하다.

## 번역 작업 규칙

1. 번역 렌더러는 각 message의 `revealCapacity`를 입력받는다.
2. 마지막 비투명 pixel이 속한 packed entry가 capacity 미만이 되게 줄바꿈과 배치를 조정한다.
3. capacity가 부족하면 글자 폭 축소, 문장 축약 또는 앞쪽 배치를 우선한다.
4. count나 경계값은 수정하지 않는다.
5. patch 후 Mode 1 EDC/ECC와 changed LBA를 검증한다.

한국어 `앗!?` smoke test는 원본 message `1004`의 capacity 안에 있으며 실제 SS 실행 화면에서도 정상 출력됐다.

## 다음 단계

다음은 `22-build-and-verify.md` 단계다. 여러 message patch를 한 번의 출력 BIN에 누적 적용할 수 있는 build manifest, 원본 해시 확인, 변경 sector 목록, EDC/ECC 및 CUE/Track 2 보존 검증을 자동화한다.
