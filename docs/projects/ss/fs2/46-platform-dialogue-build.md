# 46. 플랫폼 차이 일반 대사 4개 적용

## 확정 번역

메시지 `1018`은 SS 조작 버튼에 맞춰 다음 3줄로 새로 렌더링했다.

```text
방향키의 좌우 또는
L, R버튼으로 선택해서
C버튼으로 결정하면돼.
```

- 글꼴: `font/gulim.ttc`
- 크기: 12px
- 줄 높이: 15px
- 기존 대사와 같은 2bpp anti-alias/shadow 설정
- PGM: `output/ss-fs2-platform-dialogue-ko/message-mask-1018-ko.pgm`
- 확인 PNG: `output/ss-fs2-platform-dialogue-ko/message-mask-1018-ko.png`

메시지 `5040`, `5042`, `6093`은 사용자 결정에 따라 기존 PS1 한국어 PGM을 수정 없이 사용했다.

## reveal 처리

| 메시지 | 표시 한계 | 원본 count | 필요 count | 확장 |
|---:|---:|---:|---:|---:|
| 1018 | 517 | 19 | 37 | 37 |
| 5040 | 373 | 30 | 27 | 없음 |
| 5042 | 72 | 7 | 6 | 없음 |
| 6093 | 472 | 22 | 34 | 34 |

`1018`, `6093`은 기존 reveal count 확장 trampoline을 사용한다. 글꼴 크기나 자간을 줄이지 않았으며, 원본 count의 low 16-bit는 보존했다.

## 산출물

- 입력: `output/ss-fs2-korean-ui-complete.bin`
- BIN: `output/ss-fs2-korean-dialogue-complete.bin`
- CUE: `output/ss-fs2-korean-dialogue-complete.cue`
- SHA-256: `EB9DE6FC464732CED9B2FAA3E1E5DB3BB2B48C50EC164F0C519FCC1229507C69`

## 검증

| 항목 | 결과 |
|---|---:|
| 적용 메시지 | 4 |
| 실제 변경 섹터 | 6 |
| 변경 user bytes | 3,802 |
| 잘못된 Mode 1 EDC/ECC | 0 |
| reveal trampoline | 기존 패치 인식·재사용 |

이 단계로 알려진 플랫폼 차이 일반 대사 4개는 모두 적용됐다.

