# PS1 엔딩 문구·성우 크레딧 편집 GUI

## 목적

PS1판도 이번에 처음 처리하는 별도 대상이므로 SS판과 같은 범위의 엔딩 이미지 리소스를 PS1 BIN에서 직접 추출하고 재삽입하는 GUI를 추가했다.

## 실행

```powershell
python tools/ps1_fs2_ending_resource_gui.py
```

기본 입력은 `output/patched-farland-saga-logo.bin`, 기본 출력은 `output/patched-farland-saga-ending.bin`이다.

## 대상 리소스

- `0`, `1`, `2`: 엔딩 질문·선택 문구
- `11`, `12`, `16`, `18`, `19`, `20`, `21`: 엔딩 크레딧
- `14`, `15`: 성우 캐스팅

## 작업 흐름

1. `편집 PNG 추출`은 PS1 BIN의 LBA 223에서 `FS2_FILE.DAT`를 추출한다.
2. 선택한 리소스의 raw-index PGM과 `ps1-fs2-resource-ID.png`를 만든다.
3. PNG를 `ps1-fs2-resource-ID-ko-edit.png`라는 이름으로 복사해 편집한다.
4. `-ko-edit.png 자동 적용`은 존재하는 편집 PNG만 감지한다.
5. 각 PNG를 원래 팔레트 인덱스로 변환하고 리소스에 순차 적용한다.
6. 완성 DAT를 PS1 BIN에 재삽입하고 MODE2/2352 CUE를 생성한다.

## 관련 파일

- GUI: `tools/ps1_fs2_ending_resource_gui.py`
- PNG 변환기: `scripts/ps1-fs2-ending-png-tool.py`
- 기존 무손실 타일 패커: `scripts/be-hdr-ui-tile-tool.js pack-raw`

## 검증

최신 PS1 패치에서 resource 14를 추출해 PNG 왕복 후 다시 패킹했다.

- 화면 크기: 320×240
- PNG 왕복 변경 픽셀: 0
- 고유 타일: 244
- 용량: 250
- 변경된 타일 슬롯: 0

편집 결과가 슬롯 용량을 넘으면 근사 병합하지 않고 오류로 중단한다.
