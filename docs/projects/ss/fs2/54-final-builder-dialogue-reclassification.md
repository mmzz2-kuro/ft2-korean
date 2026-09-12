# SS 최종 빌더 대사 재분류 갱신

## 문제

최종 패치 빌더가 과거에 생성된 `configs/ss-fs2-korean-safe.json`과
`output/ss-fs2-translation-preflight.json`을 재사용하고 있었다. 이후 GUI에서
대사 PGM을 다시 렌더링하면 실제 reveal 사용량과 저장된 safe/overflow 분류가
달라질 수 있었다.

실제 실패 항목은 message 2147이었다.

- 현재 visible entries: 256
- 원본 reveal capacity: 238
- 기존 분류: safe
- 올바른 분류: reveal-overflow

## 변경

`scripts/ss-fs2-build-final.js`가 매 빌드 시작 시 다음 현재 자료를 이용해
`ss-fs2-prepare-translation-build.js`를 실행하도록 변경했다.

- `trDatas/dialogue-workflow/dialogue-translation.tsv`
- `tmp/SLPS-01903/dialogue-workflow/apply/message-mask-*-ko.pgm`
- 원본 SS Track 1/2

생성된 작업 폴더의 `safe-manifest.json`은 safe 대사 삽입에 사용하고,
같이 생성된 `translation-preflight.json`은 reveal overflow 삽입에 사용한다.
최종 보고서의 safe/overflow 개수도 이 preflight 결과에서 계산한다.

## 검증 결과

GUI 기본 입력값과 동일한 조건으로 전체 최종 빌드를 실행했다.

- candidate messages: 2,437
- safe dialogue: 1,895
- reveal overflow: 538
- platform mask difference: 4
- message 2147: `visible=256`, `originalCount=17`, `desiredCount=19`
- Mode 1 invalid parity: 0
- 최종 BIN 크기: 516,419,232 bytes
- 최종 BIN SHA-256: `E38147E7C3C8E6D4C2F2EF38C2DD6322ECB10EE16B6D8D01D8A15628F30C5CE1`

생성 파일:

- `output/ss-fs2-korean-final.bin`
- `output/ss-fs2-korean-final.cue`
- `output/ss-fs2-korean-final.report.json`

앞으로 대사 번역이나 PGM 배치를 수정한 뒤에도 최종 빌더가 최신 상태를
자동으로 재분류하므로 stale safe manifest에 의한 동일 오류는 발생하지 않는다.
