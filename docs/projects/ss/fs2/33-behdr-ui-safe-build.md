# 33. Big-endian header UI 안전 이식 빌드

## 결과

32단계에서 안전 대상으로 확정한 8bpp 타일형 UI 리소스 54개를 이름 테이블 통합판 위에 누적 적용했다.

- 입력: `output/ss-fs2-korean-names.bin`
- 출력 BIN: `output/ss-fs2-korean-behdr-ui.bin`
- 출력 CUE: `output/ss-fs2-korean-behdr-ui.cue`
- 보고서: `output/ss-fs2-korean-behdr-ui.report.json`
- SHA-256: `60D537986F97F10D681AB7FD27660B22E22B2E3A828E6B0A29B3BD4FC58B6C74`

## 적용 방법

PS1 작업에서 이미 raw palette index 화면으로 재패킹된 결과
`tmp/SLPS-01903/be-hdr-ui-workflow/direct-apply/working.DAT`를 사용했다.

각 리소스마다 다음 조건을 빌드 도구에서 다시 검사했다.

1. 매핑 결과가 `exactAllocatedMatch=true`일 것
2. 기존 편집 PNG가 존재할 것
3. 현재 SS 입력 이미지의 리소스가 PS1 원본 리소스와 바이트 단위로 같을 것
4. PS1 패치 리소스가 원본과 실제로 다를 것
5. PS1/SS 할당 크기가 같을 것

모든 조건을 통과한 54개만 리소스 할당 영역 단위로 이식했다. 새턴 이미지 기록 시 각 Mode 1 섹터의 EDC/ECC를 다시 계산했다.

사용 도구:

- `scripts/ss-fs2-build-behdr-ui-patch.js`
- `scripts/ss-fs2-verify-patched-bin.js`

## 변경량과 검증

| 항목 | 결과 |
|---|---:|
| 적용 리소스 | 54 |
| 기록한 리소스 영역 섹터 | 225 |
| 입력판과 실제로 달라진 섹터 | 197 |
| 입력판 대비 변경 user bytes | 86,540 |
| 원본판 대비 전체 변경 섹터 | 4,087 |
| 원본판 대비 전체 변경 user bytes | 2,134,916 |
| 잘못된 Mode 1 EDC/ECC | 0 |

기록 영역 225섹터 중 일부는 패치 전후 바이트가 같은 섹터이므로 실제 차이 섹터는 197개다.

## 제외 유지

구조 또는 내용이 다른 다음 5개는 적용하지 않았다.

```text
PS1 828  -> SS 714
PS1 1187 -> SS 1073
PS1 1188 -> SS 1074
PS1 1201 -> SS 1087
PS1 1202 -> SS 1088
```

편집 PNG가 없는 항목도 임의 변경하지 않았다. 이 가운데 이름 테이블을 참조하는 표시는 31단계 패치의 영향을 받는다.

## 실행 확인 항목

이번 빌드에서는 다음 화면을 우선 확인한다.

- 전투/메뉴의 짧은 고정 라벨
- 캐릭터 상태 및 정보 패널
- 장비·도구·마법 관련 보조 패널
- 저장/불러오기 및 각종 선택 화면
- 큰 화면형 UI에서 글자 주변 타일 또는 배경이 깨지지 않는지

예외 5개가 사용되는 화면에 일본어가 남는 것은 현재 단계에서는 정상이다. 게임 진행 정지나 그래픽 손상이 없다면 다음 단계에서 예외 리소스를 SS 원본 기준으로 개별 분석한다.

