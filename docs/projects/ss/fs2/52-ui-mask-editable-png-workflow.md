# 52. 1bpp UI mask 편집용 PNG 왕복 작업

## 목적

`tools/ui_mask_workflow_gui.py`에서 폰트로 생성한 한국어 1bpp PBM을 일반 이미지 편집기에서 수정할 수 있도록 PNG 왕복 경로를 추가했다. 우선 사용 대상은 `day_1151_1168` 프리셋이며, 동일한 1bpp 구조를 사용하는 다른 프리셋에도 사용할 수 있다.

내부 패치 형식은 계속 PBM이다. PNG는 사용자 편집용 형식이며 적용 직전에 검증된 크기의 1bpp PBM으로 변환된다.

## 작업 순서

1. `day_1151_1168` 프리셋을 선택하고 `Use Preset`을 누른다.
2. 기존 `Load TSV`로 `day_1151_1168.tsv`를 불러온다.
3. 필요하면 한국어 문구와 폰트 옵션을 수정하고 TSV를 저장한다.
4. `1b. Export Filled Edit PNGs`를 누른다.
5. 다음 폴더의 PNG를 이미지 편집기로 수정한다.

```text
tmp/SLPS-01903/ui-mask-workflow/day_1151_1168-masks/edit/
  ui-mask-1151-ko-edit.png
  ...
  ui-mask-1168-ko-edit.png
```

6. 크기와 파일명을 유지한 채 저장한다.
7. 실제 반영할 행만 체크한다.
8. `2. Apply to BIN`을 실행한다. 이미 규칙에 맞는 PNG가 있으면 `1b` 버튼을 다시 누를 필요가 없다.

선택한 행의 PNG는 `Open Edit PNG`로 바로 열 수 있다.

## 픽셀 규칙

```text
검은색 = 1bpp 글자/그림 픽셀
흰색 또는 투명 = 빈 픽셀
```

- `day_1151_1168` PNG 크기는 반드시 256×64다.
- 적용 변환 임계값은 밝기 128이다.
- 회색 픽셀은 128보다 어두우면 검은 픽셀, 밝으면 흰 픽셀로 변환된다.
- 투명 픽셀은 흰 배경 위에 합성하므로 빈 픽셀이 된다.
- 잘못된 크기의 PNG는 패치 전에 오류로 중단한다.

## TSV와 우선순위

TSV에 `replacement_png` 열을 추가했다. 편집 PNG가 존재하는 활성 행은 해당 PNG를 우선 사용한다. 경로가 비어 있거나 파일이 없으면 기존처럼 `ko_text`와 글꼴 옵션으로 PBM을 렌더링한다.

```text
replacement_png 존재 → PNG를 PBM으로 변환 → 삽입
replacement_png 없음  → ko_text를 폰트로 PBM 렌더링 → 삽입
```

단, `replacement_png`가 비어 있어도 다음 규칙의 파일이 존재하면 자동으로 찾아서 사용한다.

```text
<mask_pbm 폴더>/edit/ui-mask-<resource_id>-ko-edit.png
```

따라서 이미 편집 PNG를 만든 뒤에는 GUI를 다시 실행하거나 TSV를 새로 불러와도 바로 `2. Apply to BIN`을 누르면 된다. `1b. Export Filled Edit PNGs`는 편집 PNG를 처음 만들거나 누락된 파일을 생성할 때만 사용한다.

`1b. Export Filled Edit PNGs`는 기존 PNG를 덮어쓰지 않는다. 이미 수정한 파일이 있으면 건너뛰며, 새로 렌더링하려면 해당 PNG를 직접 삭제한 뒤 다시 실행한다.

## 검증

- `day_1151_1168` 번역 18개를 256×64 편집 PNG로 생성했다.
- 리소스 1151의 `PBM → PNG → PBM` 왕복 픽셀이 완전히 일치했다.
- 리소스 1151의 `replacement_png` 우선 적용 경로로 실제 DAT 패치를 완료했다.
- PNG 크기 검증과 임계값 변환이 정상 동작했다.
- 기존 PNG가 없는 행의 폰트 렌더링 경로는 유지했다.
