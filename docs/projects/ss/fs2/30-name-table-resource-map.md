# 이름 테이블의 PS1→SS 리소스 매핑

## 결론

캐릭터명, 몬스터명, 상태이상, 아이템명, 마법명, 장비 화면 라벨, 레벨업 이름, 스테이지명을 담은 PS1 이름 테이블은 SS에서도 같은 구조와 바이트를 사용한다.

| PS1 리소스 | SS 리소스 | 크기 | 결과 |
| ---: | ---: | ---: | --- |
| 829 | 715 | 86,016 bytes, 42 sectors | 전체 byte-for-byte 동일 |
| 1169 | 1055 | 24,576 bytes, 12 sectors | 전체 byte-for-byte 동일 |

두 리소스 모두 앞 단계에서 확인한 규칙을 따른다.

```text
SS resource ID = PS1 resource ID - 114
```

따라서 PS1용 `name-table-tool.py`의 table offset, entry size, 1bpp packing 규칙을 SS에 그대로 재사용할 수 있다. 달라지는 것은 리소스 ID와 raw Track 1 기록 방식뿐이다.

## SS 위치

| SS 리소스 | Track 1 LBA | sector 수 | SHA-1 |
| ---: | ---: | ---: | --- |
| 715 | 18,627 | 42 | `bcb4aa330714534b5cf3bdf1a97bf3975a91e71c` |
| 1055 | 19,347 | 12 | `0a599334af81d8ef631f14347d55c689fe7842d1` |

## 테이블 구성

SS 리소스 715 내부:

| table | offset | ID 범위 | 수량 | entry | 화면 크기 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `equip_stat` | `0x6E0` | 0~11 | 12 | 128 bytes | 64×16 |
| `equip_char` | `0xCE0` | 0~11 | 12 | 144 bytes | 72×16 |
| `magic` | `0x13A0` | 0~62 | 63 | 240 bytes | 120×16 |
| `levelup_char` | `0x4FA0` | 0~8 | 9 | 176 bytes | 88×16 |
| `char` | `0x55D0` | 1~30 | 30 | 160 bytes | 80×16 |
| `mon` | `0x6950` | 0~75 | 76 | 224 bytes | 112×16 |
| `status` | `0xAAF0` | 0~11 | 12 | 64 bytes | 32×16 |
| `item` | `0xADF0` | 0~168 | 169 | 240 bytes | 120×16 |

SS 리소스 1055 내부:

| table | offset | ID 범위 | 수량 | entry | 화면 크기 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `stage_name` | `0x4870` | -61~13 | 75 | 304 bytes | 152×16 |

전체 TSV 행은 458개이다.

## 비트맵 형식

모든 entry는 높이 16픽셀의 1bpp 고정 폭 비트맵이다.

```text
bit 0 = 글자 잉크
bit 1 = 배경
각 byte는 MSB부터 왼쪽→오른쪽 픽셀
```

entry 크기는 `width / 8 × 16`과 일치한다. 리소스 전체가 동일하므로 endian 변환이나 SS 전용 타일 재배치는 필요하지 않다.

## 번역 자산 현황

```text
trDatas/name-table-workflow/name-table.tsv
```

| 항목 | 수량 |
| --- | ---: |
| 전체 행 | 458 |
| 활성 번역 | 420 |
| `ko_text` 존재 | 420 |
| 한국어 replacement PNG 존재 | 408 |
| 활성 상태지만 PNG 누락 | 12 |

누락된 12개는 다음과 같다.

```text
char 1~7
char 9~13
```

해당 이름은 카린, 알, 아리스, 사라, 라딧슈, 소피아, 루루, `? ? ?`, `T. T.`, 손, 마크도갈, 가스톤이다. TSV의 replacement 경로는 `tmp/.../name-char-*-ko.png`를 가리키지만 실제 파일은 없다.

나머지 408개 한국어 PNG는 다음 경로에 존재한다.

```text
trDatas/name-table-workflow/masks/*-ko.png
```

## 적용 판단

원본 리소스 전체가 동일하므로 구조적 자동 이관 예외는 없다. 안전한 전체 빌드를 위해서는 먼저 누락된 12개 PNG를 현재 TSV의 `ko_text`와 동일한 글꼴 설정으로 다시 렌더링해야 한다.

그 뒤 SS 빌더는 다음을 수행한다.

1. PS1 ID 829/1169를 SS ID 715/1055로 변환한다.
2. table별 offset과 entry size를 적용한다.
3. replacement PNG를 원래 크기의 1bpp chunk로 변환한다.
4. 해당 entry 범위만 교체한다.
5. 변경 Mode 1 sector의 EDC/ECC를 재계산한다.
6. 출력에서 420개 entry를 다시 읽어 패킹 결과를 검증한다.

## 다음 단계

1. 누락된 주연 캐릭터명 PNG 12개를 복원한다.
2. 활성 번역 420개 전체를 현재 SS 통합 BIN에 적용한다.
3. 캐릭터 상태창, 소지품명, 마법명, 장비 화면, 레벨업, 저장·로드 스테이지명을 실행 확인한다.
4. 이후 big-endian header UI 66행의 SS 대응을 조사한다.

앞 단계의 설명·도움말·날짜 화면 실행 확인은 통과로 기록한다.
