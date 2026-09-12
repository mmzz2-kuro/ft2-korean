# PS1 오프닝 캐릭터 소개 수동 PNG 작업 흐름

## 방침

자동 렌더링 이미지는 초안으로만 사용한다. 최종 이미지는 사용자가 직접 편집한
PNG를 적용한다.

## 편집 파일

기본 GUI 작업 폴더에서는 다음 위치를 사용한다.

`tmp/SLPS-01903/opening-character-workflow/gui-build/edit`

파일 이름은 다음과 같다.

- `be-hdr-ui-255-ko-edit.png`
- `be-hdr-ui-257-ko-edit.png`
- `be-hdr-ui-263-ko-edit.png`
- `be-hdr-ui-265-ko-edit.png`
- `be-hdr-ui-268-ko-edit.png`
- `be-hdr-ui-269-ko-edit.png`
- `be-hdr-ui-286-ko-edit.png`

255, 263, 265, 268, 269, 286은 160×240이고 257은 320×120이다. 이미지 크기를
바꾸면 적용을 중단한다.

## 적용 방식

GUI 빌드 시 Windows BMP 기반 초안을 먼저 만들되, `edit` 폴더에 대응하는
`-ko-edit.png`가 있으면 그 파일을 우선 사용한다. 편집 PNG의 명도는 해당 PS1
리소스에서 실제로 사용되는 가장 가까운 팔레트 인덱스로 변환된다.

루루와 소피아는 편집 PNG를 리소스 268·269에 넣은 뒤 리소스 306의 런타임 시트에도
자동으로 같은 픽셀을 기록한다.

## 관련 도구

- GUI: `tools/ps1_fs2_opening_character_gui.py`
- PNG 변환: `scripts/ps1-fs2-opening-edit-png.py`
- 런타임 시트 적용: `scripts/ps1-fs2-patch-opening-runtime-sheet.py`
