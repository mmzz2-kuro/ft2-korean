# 44. 플랫폼 원문 차이 1bpp UI 2개 적용

## 결정

SS 원문 이미지를 확인한 결과 PS1/SS의 설명 대상 아이템과 마법은 같고 일부 부가 문구의 유무만 다르다. 사용자 확인에 따라 기존 PS1 한국어 설명을 SS판에도 그대로 적용했다.

## 적용 항목

| PS1 ID | SS ID | SS LBA | 한국어 PBM |
|---:|---:|---:|---|
| 930 | 816 | 18869 | `tmp/SLPS-01903/ui-mask-workflow/apply/ui-mask-930-ko.pbm` |
| 1053 | 939 | 19115 | `tmp/SLPS-01903/ui-mask-workflow/apply/ui-mask-1053-ko.pbm` |

각 마스크는 288×64, 36바이트/행, 총 `0x900`바이트다.

## 산출물

- 입력: `output/ss-fs2-korean-speakers.bin`
- BIN: `output/ss-fs2-korean-ui-complete.bin`
- CUE: `output/ss-fs2-korean-ui-complete.cue`
- 보고서: `output/ss-fs2-korean-ui-complete.report.json`
- SHA-256: `C346D96C7BFD488CA3EC30D5198CD3918D5F862C960150BF70627B0B8E6F9E68`

## 검증

| 항목 | 결과 |
|---|---:|
| 적용 리소스 | 2 |
| 실제 변경 섹터 | 3 |
| 변경 user bytes | 2,095 |
| 잘못된 Mode 1 EDC/ECC | 0 |

이 단계로 42번 문서의 `1bpp 설명 UI 차이 2개`는 미적용 목록에서 해소됐다.

