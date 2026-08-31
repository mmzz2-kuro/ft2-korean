# 1bpp UI mask의 PS1→SS 리소스 매핑

## 결론

PS1판에서 번역된 아이템 설명, 마법·메뉴 설명, 유닛 도움말, 날짜·의뢰 화면의 1bpp UI mask 336개를 SS판 전체 Track 1과 대조했다.

```text
SS resource ID = PS1 resource ID - 114
```

이 규칙으로 336개 중 334개 원본 mask가 byte-for-byte 일치한다. 나머지 2개도 SS에 같은 크기와 1bpp 배치로 존재하지만 일본어 원문 내용이 달라 원본 mask가 다르다.

| 분류 | PS1 ID 범위 | 수량 | SS ID 범위 |
| --- | ---: | ---: | ---: |
| 아이템 설명 | 830~1008 | 179 | 716~894 |
| 마법·메뉴 설명 | 1009~1080 | 72 | 895~966 |
| 유닛 도움말 | 1081~1147 | 67 | 967~1033 |
| 날짜·의뢰 화면 | 1151~1168 | 18 | 1037~1054 |
| 합계 |  | 336 |  |

한국어 문구와 `*-ko.pbm`은 336개 모두 존재한다.

## 매핑 도구

```text
scripts/ss-fs2-map-ui-masks.js
```

재현 명령:

```powershell
node scripts/ss-fs2-map-ui-masks.js `
  "ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 1).bin" `
  ps1/SLPS-01903/FS2_FILE.DAT `
  ps1/SLPS-01903/SLPS_019.03 `
  output/ss-fs2-ui-mask-map.json `
  trDatas/ui-mask-workflow/item_830_1008.tsv `
  trDatas/ui-mask-workflow/menu_1009_1080.tsv `
  trDatas/ui-mask-workflow/unit_help_1081_1147.tsv `
  trDatas/ui-mask-workflow/day_1151_1168.tsv
```

출력:

```text
output/ss-fs2-ui-mask-map.json
```

도구는 각 PS1 리소스에서 TSV가 지정한 `bytes_per_row × rows` 크기의 원본 mask를 읽는다. SS Track 1의 모든 Mode 1 논리 sector에서 같은 바이트를 찾고, 발견 LBA를 SS 실행 파일의 리소스 sector table과 역대조한다.

## 검색 결과

| 결과 | 수량 |
| --- | ---: |
| 고유 mask 위치 | 291 |
| 동일 mask 다중 위치 | 43 |
| 동일 mask 없음 | 2 |

다중 위치 43개는 실제 매핑 실패가 아니다.

- 아이템의 `#예비` 8개는 같은 예비용 빈 mask를 공유한다.
- `#`로 표시된 미사용 메뉴·유닛 설명 35개는 같은 빈 mask를 공유한다.
- ID 차이 `-114`를 적용하면 각 항목의 SS 리소스가 결정된다.

따라서 ID 규칙까지 포함하면 334개가 정확히 단일 대응한다.

## 원본이 다른 2개

### PS1 930 → SS 816

```text
움직이기 쉽도록 설계된 격투용 옷
사라가 장비가능
방어력 +20
```

| 항목 | 값 |
| --- | --- |
| SS LBA | 18,869 |
| mask 크기 | 2,304 bytes, 288×64 1bpp |
| 다른 byte | 174 |
| 차이 범위 | `0x14~0x1D2` |
| PS1 SHA-1 | `73f0ceb3885713208214a604cbde313aef9c56f0` |
| SS SHA-1 | `1f4b611df0049e0e4325f31620638db32c292b6d` |

### PS1 1053 → SS 939

```text
성스러운 힘으로 기절을 제외한
모든 아군의 상태이상을 회복시키지만
체력은 회복시킬 수 없다
레벨이 올라가면 범위가 넓어진다
```

| 항목 | 값 |
| --- | --- |
| SS LBA | 19,115 |
| mask 크기 | 2,304 bytes, 288×64 1bpp |
| 다른 byte | 257 |
| 차이 범위 | `0x0E~0x1E0` |
| PS1 SHA-1 | `946f07f47e3d6f29a3941ecb9bd02e452751a2b6` |
| SS SHA-1 | `158c0981737f88070c841e8207fd5f51ede8d68d` |

두 항목 모두 차이가 mask 앞쪽의 글자 영역에만 있고 크기, stride, 전체 배치는 같다. 플랫폼별 설명 문구 차이로 판단된다. 한국어 PBM을 기술적으로 삽입할 수 있지만 SS 원문 화면과 번역 의미를 GUI에서 함께 확인한 뒤 적용하는 것이 안전하다.

## 한국어 자산

```text
tmp/SLPS-01903/ui-mask-workflow/apply/ui-mask-830-ko.pbm
...
tmp/SLPS-01903/ui-mask-workflow/apply/ui-mask-1168-ko.pbm
```

네 TSV의 336행에 대응하는 한국어 PBM이 모두 존재한다. 파일명은 PS1 ID를 유지하므로 SS 패치 시 ID에서 114를 빼서 목적 리소스를 계산해야 한다.

## 다음 단계

1. 안전군 334개의 SS BIN 패치 manifest를 생성한다.
2. 2,048 또는 2,304바이트 mask가 걸치는 Mode 1 sector의 EDC/ECC를 재계산한다.
3. 아이템·마법 설명과 유닛 도움말을 실제 화면에서 시험한다.
4. 원본 차이 2개는 SS 원본 미리보기와 함께 GUI 검토 대상으로 둔다.
5. 이후 이름 테이블 458행과 big-endian header UI 66행의 SS 대응을 조사한다.

Finale 220개 실행 확인은 후기 세이브 또는 전체 플레이 회귀 시험 항목으로 보류한다.
