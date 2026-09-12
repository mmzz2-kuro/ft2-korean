# PS1 런타임 엔딩 타이틀 최종 BIN 검증

## 미반영 원인

기존 최종 BIN에는 BE-HDR 리소스 0, 1, 2, 12만 변경되어 있었고, 실제 출력 원본인 리소스 23 수정본은 작업 폴더에 존재하지 않았다.

## 처리

- 기존 `ps1-fs2-resource-12-ko-edit.png`의 상단 320x48을 실제 런타임 프레임으로 이관했다.
- 파일명: `ps1-fs2-runtime-frame-00-ko-edit.png`
- 리소스 23에 재삽입했다.
- DAT를 BIN에 삽입한 뒤 변경 섹터의 EDC/ECC를 다시 계산했다.
- 최종 출력: `output/patched-farland-saga-ending.bin`
- SHA-256: `E61F64B41723F31DBE6598A6F99482C89F2DD19F70CE27C84DC77E02E2A2395B`

최종 BIN을 다시 추출하여 만든 검증 이미지는 다음 파일이다.

`tmp/SLPS-01903/ending-resource-workflow/final-bin-runtime-verify/ps1-fs2-runtime-frame-00.png`

이 검증 이미지와 원래 `ps1-fs2-resource-12-ko-edit.png`의 상단 320x48을 비교한 결과 픽셀 차이는 0이었다.

## GUI 보완

PS1 엔딩 GUI는 앞으로 다음 조건에서 자동 이관한다.

- `ps1-fs2-resource-12-ko-edit.png`가 있음
- `ps1-fs2-runtime-frame-00-ko-edit.png`가 없음

이 경우 12번 수정본의 상단 320x48을 런타임 프레임 0 수정본으로 생성하고 리소스 23에 적용한다.

