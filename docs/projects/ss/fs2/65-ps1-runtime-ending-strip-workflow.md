# PS1 런타임 엔딩 이미지 추출·재삽입

## 실제 원본 확정

인게임에서 표시되는 `~ FARLAND SAGA ~ / 時の道標` 이미지는 BE-HDR 리소스 12가 아니다.

엔딩 코드는 리소스 23을 로드한 뒤 `0x801BE59C`에서 320x8 크기의 조각을 조립하여 VRAM `(768,208)`의 320x48 영역을 만들고, `0x801BED28`에서 그 영역을 화면 y=184에 출력한다.

- 리소스 23: `0x50000` bytes
- 조각 하나: `2560` bytes = 320x8 8bpp
- 프레임 표: EXE RAM `0x8016B320`
- 프레임 수: 47
- 프레임 0: 조각 0부터 6개를 사용하며 실제 타이틀 이미지와 일치
- 프레임 1 이후: 성우·스태프 크레딧과 FIN 화면

## 도구

`scripts/ps1-fs2-runtime-strip-tool.py`

추출:

```powershell
python scripts/ps1-fs2-runtime-strip-tool.py export FS2_FILE.DAT SLPS_019.03 작업폴더
```

`ps1-fs2-runtime-frame-00.png`부터 `46.png`까지 생성된다. 수정본은 다음 이름으로 저장한다.

```text
ps1-fs2-runtime-frame-00-ko-edit.png
```

재삽입:

```powershell
python scripts/ps1-fs2-runtime-strip-tool.py apply FS2_FILE.DAT SLPS_019.03 작업폴더 출력.DAT
```

PNG는 320x48을 유지해야 한다. 흑·회·백 픽셀은 원본 인덱스 0·1·2로 변환된다. 여러 수정 프레임이 같은 원본 조각에 서로 다른 값을 쓰면 충돌로 중단한다.

## GUI 연동

`tools/ps1_fs2_ending_resource_gui.py`에 연동했다.

- `1. 편집 PNG 추출` 실행 시 기존 BE-HDR 이미지와 함께 런타임 프레임 47개를 추출한다.
- 작업 폴더에 `ps1-fs2-runtime-frame-NN-ko-edit.png`가 있으면 `2. -ko-edit.png 자동 적용`에서 리소스 23에 자동 삽입한다.
- 이후 기존과 동일하게 BIN 삽입과 EDC/ECC 보정을 수행한다.

## 검증

프레임 0을 수정 없이 export→apply한 결과 DAT SHA-256이 원본과 완전히 일치했다.

