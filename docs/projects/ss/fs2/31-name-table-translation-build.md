# 이름 테이블 번역 통합 빌드

## 결과

이름 테이블의 활성 번역 420개를 현재 SS 통합 이미지에 적용했다. 누락됐던 주연 캐릭터명 PNG 12개도 기존 설정으로 복원했다.

```text
output/ss-fs2-korean-names.cue
output/ss-fs2-korean-names.bin
output/ss-fs2-korean-names.report.json
```

| table | 적용 수량 |
| --- | ---: |
| `char` | 27 |
| `mon` | 65 |
| `status` | 12 |
| `item` | 169 |
| `magic` | 39 |
| `equip_char` | 12 |
| `levelup_char` | 9 |
| `equip_stat` | 12 |
| `stage_name` | 75 |
| 합계 | 420 |

420개 모두 원본과 실제로 다른 한국어 entry로 기록됐다.

## 누락 PNG 복원

`scripts/name-table-tool.py`에 `render-missing` 모드를 추가했다.

```powershell
python scripts/name-table-tool.py render-missing `
  font/gulim.ttc `
  trDatas/name-table-workflow/name-table.tsv
```

이 모드는 replacement PNG가 이미 있는 행은 건드리지 않고 누락 파일만 생성한다. 다음 12개를 80×16 원본 크기, TSV 지정 12px 글꼴로 렌더링했다.

```text
char 1~7
char 9~13
```

출력 위치:

```text
tmp/SLPS-01903/name-table-workflow/masks/name-char-*-ko.png
```

대표 `char 1` PNG에서 `카린`이 정상 한글 픽셀로 생성된 것을 시각 확인했다.

## SS 빌드 방법

먼저 기존 PS1 이름 패처로 420개 entry의 기준 데이터를 생성했다.

```powershell
python scripts/name-table-tool.py patch `
  ps1/SLPS-01903/FS2_FILE.DAT `
  ps1/SLPS-01903/SLPS_019.03 `
  trDatas/name-table-workflow/name-table.tsv `
  output/ps1-name-table-patched.dat
```

그 뒤 SS 전용 빌더가 변경 entry만 SS 리소스의 같은 offset에 기록했다.

```powershell
node scripts/ss-fs2-build-name-table-patch.js `
  output/ss-fs2-korean-ui-safe.bin `
  output/ss-fs2-korean-names.bin `
  ps1/SLPS-01903/FS2_FILE.DAT `
  output/ps1-name-table-patched.dat `
  ps1/SLPS-01903/SLPS_019.03 `
  trDatas/name-table-workflow/name-table.tsv `
  output/ss-fs2-korean-names.report.json
```

빌더는 기록 전에 PS1 리소스 `829/1169`와 SS 리소스 `715/1055`가 전체 byte-for-byte 동일한지 다시 검사한다. 그 뒤 활성 TSV entry만 기록하고 출력 chunk를 다시 읽어 일치를 확인한다.

## 검증

이름 적용 전 이미지와 비교:

| 항목 | 값 |
| --- | ---: |
| 변경 sector | 54 |
| 변경 entry | 420 |
| user-data 변경 byte | 39,907 |
| LBA 범위 | 18,627~19,358 |
| Mode 1 EDC/ECC 오류 | 0 |

일본어 원본 Track 1과 비교한 전체 누적 결과:

| 항목 | 값 |
| --- | ---: |
| 누적 변경 sector | 3,890 |
| 누적 user-data 변경 byte | 2,048,376 |
| Mode 1 EDC/ECC 오류 | 0 |
| 출력 크기 | 516,419,232 bytes |
| SHA-256 | `6B071AE9BBE81E2537214BEE02739F28D6E5668A56FBB7C42AA3C7EF4272D518` |

## 실행 확인 항목

- 상태창과 대화 화자의 캐릭터명이 한국어로 표시되는가.
- 소지품·상점의 아이템명이 한국어로 표시되는가.
- 마법과 기술명이 한국어로 표시되는가.
- 상태이상 명칭과 몬스터명이 정상인가.
- 장비 상세 화면의 캐릭터명과 능력치 라벨이 정상인가.
- 레벨업 시 `OO는` 형태의 이름이 정상인가.
- 저장·로드 또는 날짜 진행 화면의 스테이지명이 정상인가.
- 빠른 목록 이동에서 잔상이나 잘림이 없는가.

다음 단계는 big-endian header UI 번역 66행의 SS 리소스 대응 조사이다.
