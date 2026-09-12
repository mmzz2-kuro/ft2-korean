# PS1 리소스 16 런타임 프레임 매핑

## 매핑

BE-HDR 리소스 16은 런타임 프레임 19~21에 대응한다.

| 리소스 16 영역 | 런타임 프레임 | 프레임 영역 |
| --- | ---: | --- |
| y=0..15 | 19 | y=16..31 |
| y=16..31 | 20 | y=16..31 |
| y=32..47 | 21 | y=16..31 |

원본 픽셀 비교 결과 세 구간 모두 차이가 0이었다.

## 반영

- `ps1-fs2-runtime-strip-tool.py`에 `map-resource16` 명령을 추가했다.
- GUI는 BE-HDR 16번 패킹을 생략하고 `ps1-fs2-resource-16-ko-edit.png` 또는 `ss-fs2-resource-16-ko-edit.png`를 프레임 19~21로 자동 이관한다.
- 최종 BIN에서 리소스 23을 다시 추출하여 세 프레임의 한글 반영을 확인했다.

## 결과

- 검증 이미지: `tmp/SLPS-01903/ending-resource-workflow/final-resource16-verify/resource16-runtime-19-21-verify.png`
- 출력 BIN: `output/patched-farland-saga-ending.bin`
- SHA-256: `E24936DD234BDF3F3B655D748118C24A81678BD585A91C5783AA20E980A4B25F`

