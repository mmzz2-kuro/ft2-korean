# 엔딩 선택 문구와 성우 캐스팅 리소스 조사

## 결론

사용자가 실기에서 확인한 엔딩 선택 문구와 성우 캐스팅 크레딧은 모두
SS 일반 리소스 테이블의 초반부에 있다. 일반 대사 message/group 17 자료가
아니므로 기존 dialogue/finale 패치에는 포함되지 않았다.

## 엔딩 선택 문구

### 리소스 0

- SS resource ID: `0`
- 컨테이너 sector: `0..3`
- 화면 크기: `296x24`
- 원문: `あなたはどこへ行きたいですか？`
- 뜻: `어디로 가고 싶습니까?`
- 확인 이미지: `tmp/ss-fs2-ending-audit/resource-0.png`

### 리소스 1

- SS resource ID: `1`
- 컨테이너 sector: `4..9`
- 화면 크기: `224x48`
- 원문 1: `私たちが生きている時間`
- 원문 2: `私たちが生きていた場所`
- 직역 1: `우리가 살아가고 있는 시간`
- 직역 2: `우리가 살아왔던 장소`
- 확인 이미지: `tmp/ss-fs2-ending-audit/resource-1.png`

두 리소스는 내장 RGB555 팔레트, 16비트 타일맵, raw 8bpp 타일을 사용하는
기존 그래픽 컨테이너이므로 기존 8bpp UI 패치 방식으로 교체할 수 있다.

## 성우 캐스팅 크레딧

엔딩용 320x240 특수 타일 화면 묶음은 resource `12..22`이다. 이 중 성우
이름이 표시되는 화면은 다음 두 리소스다.

| SS ID | 컨테이너 sector | 화면 크기 | 내용 |
|---:|---:|---:|---|
| 14 | 204..212 | 320x240 | 성우 캐스팅 첫 화면 |
| 15 | 213..227 | 320x240 | 성우 캐스팅 다음 화면 |

확인 이미지:

- `tmp/ss-fs2-ending-audit/resource-14.png`
- `tmp/ss-fs2-ending-audit/resource-15.png`

화면에서 확인되는 이름에는 `神宮司弥生`, `浅川悠`, `天野由梨`,
`河本明子`, `森川智之`, `徳丸完`, `千葉一伸`, `山野井仁` 등이 있다.

## 기존 추출에서 누락된 이유

resource `12..22`는 일반 그래픽 컨테이너와 비슷하지만 팔레트를 화면 밖에서
공급하고 PNT 값에 타일 반전 플래그를 함께 기록한다. 기존 일반 그래픽
스캐너는 플래그가 포함된 값을 그대로 타일 번호로 계산하여 범위 밖 참조로
판정했고, 그 결과 그래픽 후보 241개 목록에서 제외됐다.

조사용으로 다음 추출기를 추가했다.

```text
scripts/ss-fs2-export-ending-screen.js
```

사용법:

```powershell
node scripts/ss-fs2-export-ending-screen.js `
  "ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 1).bin" `
  14 `
  tmp/ss-fs2-ending-audit/resource-14.pgm
```

현재 추출기는 위치 식별과 글자 확인을 위한 흑백 조사본이다. 실제 재삽입은
resource 0/1과 resource 14/15를 두 계열로 나누어 처리해야 한다. 특히 14/15는
화면 외부 팔레트와 PNT 반전 플래그를 보존하는 전용 pack 과정이 필요하다.

## 다음 작업

1. resource 0/1용 편집 PNG 추출·재삽입 경로 작성
2. resource 14/15의 전체 PNT 플래그와 외부 팔레트 적용 방식 확정
3. 성우명 번역안을 확정한 뒤 14/15 전용 재삽입 도구 작성
4. 두 계열을 SS final patch builder에 추가
