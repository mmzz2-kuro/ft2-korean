# PS1 엔딩 resource 12 런타임 타일 로드 범위 수정

## 증상

PS1 BIN에서 resource 12를 다시 추출하면 한글 이미지가 정확히 들어 있지만 게임에서는 아래 제목 `時の道標`가 계속 일본어로 표시됐다. 같은 빌드의 resource 0~2는 정상 적용됐다.

## 중복 조사

- PS1 ISO에는 `FS2_FILE.DAT`, `SLPS_019.03`, `SYSTEM.CNF`만 존재한다.
- resource 12의 전체 할당 데이터는 DAT에서 한 번만 존재한다.
- `時の道標` 부분만 80×24 크기로 잘라 모든 해석 가능한 BE-HDR 화면 내부를 검색해도 resource 12 한 곳만 일치했다.

따라서 동일 이미지의 다른 리소스가 원인은 아니다.

## 원인

resource 12에는 서로 다른 두 용량 값이 있다.

- 섹터 할당 기준 물리 용량: 90타일
- 헤더 `payloadSize=0x10D0`: 런타임 로드 타일 67개 (`0x10 + 67×64`)

원본 화면은 67타일이라 두 값의 차이가 드러나지 않는다. 한글 편집 화면은 77개 고유 타일이 필요했고 기존 패커는 물리 슬롯 90개만 검사해 새 타일을 기록했다. 그러나 헤더를 그대로 두어 게임은 67번 이후의 새 타일 10개를 로드하지 않았다.

resource 0~2는 편집 후 필요한 타일이 기존 런타임 로드 범위를 넘지 않아 정상 표시됐다.

## 수정

`scripts/be-hdr-ui-tile-tool.js`가 최종 타일맵의 가장 높은 타일 번호를 계산하고, 필요할 때 헤더의 런타임 타일 payload를 다음 값으로 확장한다.

```text
requiredPayloadSize = 0x10 + (highestReferencedTile + 1) × 64
```

resource 12의 새 값은 `0x1350`이며 77타일을 모두 로드한다. 물리 할당 범위 안이므로 다음 리소스를 침범하지 않는다.

## 검증 빌드

- `output/patched-farland-saga-ending-payload-fixed.bin`
- `output/patched-farland-saga-ending-payload-fixed.cue`
- 변경 섹터: 16개, resource 0·1·2·12
- 전체 Mode 2 Form 1 EDC/ECC 검사: 오류 0건
# 정정

payload size 보정 자체는 패커 안전성 개선이지만, 리소스 12 미적용의 원인은 아니다. 리소스 12 전체 타일을 제거해도 일본어 화면이 유지되었으며 최신 결과는 `64-ps1-ending-title-runtime-image-search.md`에 정리했다.
