# Finale 대사의 SS message 매핑

## 결론

PS1판에서 주소형 `finale`로 분류된 자료는 SS판에서 별도 형식이 아니다. SS message group 17의 표준 ID `17001~17220`에 정확히 통합되어 있다.

| 항목 | 수량 |
| --- | ---: |
| PS1 TSV finale 행 | 257 |
| 번역문이 있는 finale 행 | 228 |
| SS에서 고유 위치가 확인된 행 | 243 |
| 동일 mask로 후보가 여러 개인 행 | 12 |
| SS에 동일 mask가 없는 행 | 2 |
| group 17에 대응하는 행 | 252 |
| 대응되는 고유 SS message ID | 220 |
| 번역문이 확보된 SS ID | 220 |
| 한국어 PGM이 확보된 SS ID | 220 |

따라서 기존 조사에서 말한 “finale 257개 미적용”은 SS에서 257개 별도 블록을 새로 처리해야 한다는 뜻이 아니었다. 반복본과 보조 후보를 정리하면 실제 적용 대상은 message `17001~17220`의 220개이다.

## 매핑 방법

도구:

```text
scripts/ss-fs2-map-finale.js
```

재현 명령:

```powershell
node scripts/ss-fs2-map-finale.js `
  "ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 1).bin" `
  ps1/SLPS-01903/FS2_FILE.DAT `
  trDatas/dialogue-workflow/dialogue-translation.tsv `
  output/ss-fs2-finale-map.json
```

도구는 TSV의 각 PS1 DAT 주소에서 선두 `0x930`바이트 mask를 읽는다. 그 뒤 SS Track 1의 모든 Mode 1 논리 sector 시작점에서 같은 `0x930`바이트를 찾고, 발견 LBA를 SS message offset table과 역대조한다.

출력:

```text
output/ss-fs2-finale-map.json
```

각 match에는 다음 정보가 기록된다.

- SS Track 1 LBA
- raw BIN byte offset
- 해당 LBA에서 시작하는 SS message ID
- PS1 mask SHA-1
- 한국어 번역문

## SS group 17

SS group 17은 다음 구조를 사용한다.

| 항목 | 값 |
| --- | --- |
| ID 범위 | `17001~17220` |
| slot 수 | 220 |
| group base | file `1` sector 200,578 |
| offset table | `0x0602E3F2` |
| Track 1 기준 데이터 시작 | LBA 200,756 이후 |

초기 대응은 다음처럼 연속적이다.

| PS1 DAT 주소 | SS LBA | SS message ID |
| --- | ---: | ---: |
| `0xB998000` | 200,756 | 17001 |
| `0xB99F000` | 200,796 | 17002 |
| `0xB9AC000` | 200,878 | 17003 |
| `0xB9B9000` | 200,958 | 17004 |
| `0xB9BB000` | 200,968 | 17005 |
| `0xB9CC000` | 201,082 | 17006 |

group 17의 220개 ID가 하나도 빠지지 않고 finale 원본 mask에 대응한다.

## PS1 행이 더 많은 이유

PS1 TSV 후반에는 같은 장면의 반복본이 들어 있다. 예를 들어 첫 장면의 대사들이 다른 DAT 주소에서 다시 나타나지만 SS에서는 같은 group 17 ID로 합쳐진다.

짧은 공통 문구는 일반 message bank에도 같은 mask가 많다. `네...`, `.....`, `알!?` 같은 항목은 mask만으로 여러 후보가 나오지만, 앞뒤의 고유 대사 순서와 group 17 LBA를 함께 보면 finale 위치를 결정할 수 있다.

group 17 ID별 번역문을 모았을 때 220개 모두 최소 한 개의 번역문이 있다. 서로 다른 번역 후보가 생기는 ID는 `17006` 하나뿐이다.

```text
괜찮아요. 아까부터 여러 가지
생각했는데, 역시 알을 찾으러
가기로 했어요.
```

두 후보의 차이는 두 번째 줄 끝 공백 하나뿐이며 문장은 같다. 최초 finale 흐름의 `0xB9CC000` 자산을 대표본으로 선택한다.

## 일치하지 않은 2개

다음 두 PS1 행은 SS에서 동일 mask를 찾지 못했다.

```text
0xBBF6800
0xC42D800
```

둘 다 `ko_text`가 비어 있어 실제 번역 적용 대상이 아니다. 장면 구분용 또는 스캔 오탐 후보로 유지한다.

첫 행 `0xB97F800`도 번역문이 비어 있고 여러 group 앞의 공통 빈 mask에 대응하므로 적용 대상에서 제외한다.

`0x49B1000`의 상점 문구는 finale 흐름이 아니라 일반 message `2083` 또는 `2130`과 동일한 추가 후보다. 기존 일반 대사 이관 범위에서 처리된다.

## 한국어 자산 확인

ID별로 첫 번째 유효 번역 행을 선택했을 때 필요한 한국어 PGM 220개가 모두 존재한다.

```text
tmp/SLPS-01903/dialogue-workflow/apply/finale-text-*-ko.pgm
```

다음 단계는 이 220개를 SS message ID manifest로 변환하고, 각 PGM의 유효 entry와 SS 원본 reveal count를 비교하는 것이다. 원래 capacity 안에 드는 항목은 mask만 교체하고, 초과 항목은 이미 검증된 reveal count 확장을 함께 적용한다.
