# 41. 대화 화자명 리소스 대응과 통합 빌드

## 누락 확인

대화창에서 초록색 작은 글자로 표시되는 화자명은 일반 대사 마스크나 이름 테이블이 아니라 별도의 72×48 8bpp raw 리소스다. 40단계 잔여 작업 점검에서 이 계열을 상위/중첩 범위로 잘못 분류해 독립 자산을 누락했다.

PS1 편집 자산:

- `trDatas/speakers/speaker-name-4278.png` .. `speaker-name-4302.png`
- 총 25개
- 주요 인덱스: `0x01` 부드러운 가장자리, `0x4D` 본문 획, `0x00` 투명 배경

## PS1 → SS 대응

PS1 원본 리소스 25개를 SS 전체 리소스 테이블에서 검색한 결과 각각 하나의 완전 일치 항목을 찾았다.

```text
PS1 4278..4302 -> SS 4164..4188
SS resource ID = PS1 resource ID - 114
```

모든 항목은 4,096바이트, 2섹터이며 원본 할당 영역 전체가 같다. 최신 PS1 통합판에서는 25개 모두 원본과 달라져 있다.

## 적용

최신 PS1 통합판에서 추출한 리소스를 현재 로고 통합판 위에 누적했다.

- 빌드 도구: `scripts/ss-fs2-build-speaker-name-patch.js`
- 입력: `output/ss-fs2-korean-logo.bin`
- 출력 BIN: `output/ss-fs2-korean-speakers.bin`
- 출력 CUE: `output/ss-fs2-korean-speakers.cue`
- 보고서: `output/ss-fs2-korean-speakers.report.json`
- SHA-256: `0DE4551CD282E189E9A45EA37D3D8D23BE3F3757C20134BAC7C799E8D2B8D321`

## 검증

| 항목 | 결과 |
|---|---:|
| 적용 화자명 | 25 |
| 기록한 리소스 영역 섹터 | 50 |
| 실제 변경 섹터 | 31 |
| 변경 user bytes | 10,299 |
| 잘못된 Mode 1 EDC/ECC | 0 |

게임에서는 일반 대화창 위쪽의 작은 초록색 화자명이 한글로 표시되는지 확인한다.

