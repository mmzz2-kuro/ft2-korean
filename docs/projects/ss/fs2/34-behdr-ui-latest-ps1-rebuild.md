# 34. 최신 PS1 통합판 기준 8bpp UI 재빌드

## 기준 파일 교정

33단계에서는 다음의 오래된 `be-hdr-ui` 중간 DAT를 사용했다.

```text
tmp/SLPS-01903/be-hdr-ui-workflow/direct-apply/working.DAT
2026-07-11 17:38:20
SHA-256 826A1BACF4A33B18FC89356EA3CFA3195AFAAC7F9EA03E28860E08D4938DC41E
```

사용자 확인에 따라 기준을 최신 PS1 통합판으로 변경했다.

```text
output/patched-farland-saga-logo.bin
2026-07-17 13:07:03
SHA-256 9C2E9571C3B87753DEED2651A559B86F1C638AB63D3A5CEFCB33EA38EC8BD02D
```

## 최신 DAT 추출

PS1 BIN은 Mode 2/2352 형식이므로 사용자 데이터 시작 오프셋 `0x18`, FS2_FILE.DAT 시작 LBA `223`을 사용했다.

```text
tmp/SLPS-01903/ss-port/latest-logo-FS2_FILE.DAT
크기 244,678,656 bytes
SHA-256 E5104B03680D04DE0EFD9CEB464B9DAB8607C2AB6E6AA81DF74BA89A6CA33C0C
```

추출 명령:

```powershell
node scripts/extract-dat-from-raw-bin.js output/patched-farland-saga-logo.bin tmp/SLPS-01903/ss-port/latest-logo-FS2_FILE.DAT --lba 223 --bytes 244678656
```

최신 DAT에서 조사 대상 66개 중 58개가 PS1 원본과 달랐다. 이 58개는 기존 작업표의 편집 PNG 보유 항목과 일치한다.

## SS 재빌드

32단계의 안전 조건을 그대로 유지했다. 즉, PS1과 SS 원본 할당 영역이 완전히 같은 54개만 최신 PS1 리소스로 교체했다. 구조가 다른 5개와 편집 결과가 없는 8개는 여전히 제외했다.

- 기반: `output/ss-fs2-korean-names.bin`
- 새 BIN: `output/ss-fs2-korean-behdr-ui-latest.bin`
- 새 CUE: `output/ss-fs2-korean-behdr-ui-latest.cue`
- 보고서: `output/ss-fs2-korean-behdr-ui-latest.report.json`
- SHA-256: `368D659835C33E5AB1228C0295951B7265FC4E9B8C1D8CC3DC30A5BD70A2D58E`

## 검증 결과

| 항목 | 결과 |
|---|---:|
| 적용 리소스 | 54 |
| 이름 통합판 대비 변경 섹터 | 200 |
| 이름 통합판 대비 변경 user bytes | 95,713 |
| 33단계 구버전 UI 빌드와 다른 섹터 | 181 |
| 33단계 구버전 UI 빌드와 다른 user bytes | 43,025 |
| 잘못된 Mode 1 EDC/ECC | 0 |

33단계 파일은 비교용으로 보존하며, 이후 테스트 기준은 `ss-fs2-korean-behdr-ui-latest.cue`로 변경한다.

