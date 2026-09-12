# PS1 리소스 15 런타임 프레임 매핑

## 매핑

BE-HDR 리소스 15의 실제 출력 대상은 런타임 프레임 13~17이다.

| 리소스 15 영역 | 런타임 프레임 | 프레임 영역 |
| --- | ---: | --- |
| y=0..31 | 13 | y=8..39 |
| y=32..63 | 14 | y=8..39 |
| y=64..95 | 15 | y=8..39 |
| y=96..127 | 16 | y=8..39 |
| y=128..159 | 17 | y=8..39 |

원본 이미지끼리의 픽셀 비교에서 다섯 구간 모두 차이가 0이었다.

## 도구와 GUI

- `scripts/ps1-fs2-runtime-strip-tool.py`에 `map-resource15` 명령을 추가했다.
- PS1 엔딩 GUI는 리소스 15의 기존 BE-HDR 패킹을 생략한다.
- `ps1-fs2-resource-15-ko-edit.png` 또는 `ss-fs2-resource-15-ko-edit.png`를 발견하면 프레임 13~17로 자동 분할한다.
- 실제 리소스 23에 삽입한 뒤 기존 BIN 생성 및 EDC/ECC 보정을 수행한다.

## 최종 검증

- 최종 BIN에서 리소스 23을 다시 추출해 프레임 13~17의 한글 이미지를 확인했다.
- 검증 이미지: `tmp/SLPS-01903/ending-resource-workflow/final-cast15-verify/resource15-runtime-13-17-verify.png`
- 출력 BIN: `output/patched-farland-saga-ending.bin`
- SHA-256: `40B05F3F436D2C57A31639C1BA0AFFAC9220C75DF97FD45E23F0292DE740DFA0`
