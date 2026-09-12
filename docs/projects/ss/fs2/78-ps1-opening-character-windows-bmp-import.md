# PS1 오프닝 캐릭터 Windows BMP 이식

## 구현 결과

Windows판 한글 BMP 7개를 PS1의 대응 BE-HDR 리소스로 변환하는 도구를 추가했다.

- 변환기: `scripts/ps1-fs2-import-windows-opening-profiles.py`
- GUI: `tools/ps1_fs2_opening_character_gui.py`
- 대상: 255, 257, 263, 265, 268, 269, 286

GUI는 입력 PS1 BIN에서 최신 `FS2_FILE.DAT`를 추출한 뒤 다음 작업을 자동 수행한다.

1. 원본 PS1 팔레트 인덱스 이미지 추출
2. Windows BMP를 정확히 절반 크기로 축소
3. Windows 배경·글자·장식 계조를 각 PS1 리소스가 이미 사용하는 인덱스로 변환
4. 7개 리소스를 순서대로 타일 패킹
5. Mode 2/2352 BIN에 재삽입
6. 변경 섹터의 EDC/ECC 갱신과 CUE 생성

## 타일 용량 검증

| 리소스 | 최종 고유 타일 | 용량 | 처리 |
|---:|---:|---:|---|
| 255 | 395 | 453 | 무손실 |
| 257 | 369 | 421 | 무손실 |
| 263 | 403 | 421 | 무손실 |
| 265 | 259 | 325 | 무손실 |
| 268 | 296 | 389 | 무손실 |
| 269 | 389 | 389 | 하단 배경의 1픽셀 차이 타일 3개 통합 |
| 286 | 444 | 453 | 무손실 |

269의 자동 조정 좌표는 `(128,136)`, `(152,152)`, `(24,160)`이며 캐릭터명과
설명 글자 영역 밖이다. 각 타일은 기존 타일과 단 1픽셀만 달랐다. 일반적인
`--lossy-fit`은 사용하지 않는다.

## 생성된 시험 자료

- 변환 PGM: `tmp/SLPS-01903/opening-character-workflow/windows-ko-pgm/`
- 미리보기: `tmp/SLPS-01903/opening-character-workflow/windows-ko-preview/`
- 7개 적용 DAT: `tmp/SLPS-01903/opening-character-workflow/ps1-opening-profiles-windows-ko.dat`

시험 패킹 후 재추출 검증에서 255, 257, 263, 265, 268, 286은 입력 PGM과 완전히
일치했다. 269는 위에서 명시한 배경 타일 3개 조정만 포함한다.
