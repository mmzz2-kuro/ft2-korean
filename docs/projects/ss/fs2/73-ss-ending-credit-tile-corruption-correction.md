# SS 엔딩 크레딧 타일 깨짐 원인과 수정

## 증상

14/15 성우 크레딧 시험판에서 한글 음절의 일부가 다른 글자 조각으로 바뀌고, 여러 이름의 타일이 섞여 출력됐다.

## 원인

SS BE-HDR PNT 엔트리의 최하위 비트를 수평 반전 플래그로 간주하고 좌우 반전 관계의 타일을 하나로 합쳤던 것이 원인이다. 원본 추출에서는 이 비트를 타일 번호 계산에서 제외하기만 했으며, 실제 화면에서 패커가 기대한 수평 반전 복원이 이루어지지 않았다.

이 잘못된 재사용으로 리소스 14의 필요 타일 수가 286개에서 275개로 축소되어 보였고, 14/15 경계를 1섹터 이동한 시험판이 만들어졌다. 결과 BIN 재추출과 인게임 화면 모두에서 타일 손상이 확인되었으므로 해당 결과는 유효하지 않다.

## 수정

`scripts/ss-fs2-palette-layer-resource.js`에서 다음 처리를 제거했다.

- 수평 반전 타일 중복 제거
- 새 PNT 엔트리에 임의의 반전 비트 기록
- 14/15 1섹터 경계 이동

현재 패커는 64바이트 타일 내용이 완전히 동일할 때만 재사용한다. 리소스 용량을 초과하면 출력 BIN을 만들기 전에 중단한다.

안전 검사 결과:

```text
resource 14: needs 286 unique tiles, capacity is 250
```

## 폐기한 결과물

다음 손상 시험판은 삭제했다.

- `output/ss-fs2-korean-ending-credits-stage1.bin`
- `output/ss-fs2-korean-ending-credits-stage1.report.json`
- `tmp/ss-fs2-ending-resource-workflow/credit-14-15-test.bin`
- `tmp/ss-fs2-ending-resource-workflow/credit-14-15-test.report.json`

## 다음 조사 방향

PS1처럼 화면 단위 최종 이미지를 기존 BE-HDR 용량에 억지로 재패킹해서는 안 된다. SS에서 엔딩 화면을 VRAM으로 전개하는 로더와 리소스 14~21의 로드 호출을 추적해, 타일 데이터 확장 영역 또는 런타임 전개 버퍼를 별도로 확보해야 한다.
