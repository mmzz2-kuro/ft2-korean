# 그래픽 payload와 이미지 복원

## 결론

그래픽 컨테이너의 payload는 압축 데이터가 아니라 **8bpp, 8×8, 64 bytes/tile의 raw VDP2 character pattern**이다. 컨테이너의 256색 RGB555 팔레트와 u16 타일맵을 결합해 리소스 645, 646, 665를 원본 화면 형태로 복원했다.

복원 결과:

| ID | 출력 크기 | 내용 |
| ---: | ---: | --- |
| 645 | 320×240 | 항구 도시와 묘지가 포함된 전체 배경 |
| 646 | 504×176 | 도시 배경 위 폭발 효과 프레임 모음 |
| 665 | 280×56 | 배경 위 인물 동작이 수평으로 배열된 7-frame 애니메이션 |

리소스 665의 `35×7` 타일맵은 실제로 `5×7` 타일 크기의 프레임 일곱 개가 수평으로 연결된 이미지다. `0x0601107C`가 여기서 한 프레임씩 `0x25E40E24` PNT 영역으로 복사한다는 이전 분석이 시각적으로 검증됐다.

## payload 형식 판정

세 리소스의 tilemap character number는 모두 짝수다.

| ID | 최대 character number | 실제 pattern 수 | payload bytes | raw pattern bytes | 끝 padding |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 645 | 2,398 | 1,200 | `0x12C10` | `1200 × 64 = 0x12C00` | `0x10` |
| 646 | 1,342 | 672 | `0x0A810` | `672 × 64 = 0x0A800` | `0x10` |
| 665 | 288 | 145 | `0x02450` | `145 × 64 = 0x02440` | `0x10` |

VDP2의 character number는 32-byte 단위다. 8bpp 8×8 pattern 하나는 64 bytes이므로 character number 두 칸을 차지한다.

```text
tile byte offset = character_number × 32
character_number = 0, 2, 4, 6, ...
```

payload 크기는 항상 필요한 raw pattern bytes보다 `0x10` 크다. 마지막 `0x10` bytes는 세 샘플에서 모두 0이며 정렬/안전 padding으로 판단된다.

## 코드 근거

`0x06033514`는 컨테이너의 두 필드를 읽는다.

```text
0x0603351E  MOV.L @(8,R4),R6    ; payload bytes
0x06033520  MOV.L @(12,R4),R5   ; payload offset
0x06033524  SHLR2 R5
0x06033526  SHLL2 R5            ; 4-byte align down
0x06033528  ADD R4,R5           ; source
0x0603352C  MOV.L ...,R4        ; 0x25E60000 destination
0x06033530  JSR 0x06010A00      ; raw copy32
```

`0x06010A00`은 앞서 확인한 32-bit memcpy다. 즉 이 경로에는 압축 해제나 픽셀 변환이 없다.

같은 필드 접근과 raw copy 구조는 `0x06023180` 계열에서도 나타나며, 목적 VRAM 주소만 호출 문맥에 따라 달라진다.

## 팔레트 형식

팔레트는 컨테이너 `+0x10`에 있는 256개의 big-endian u16 값이다. 복원에는 Saturn RGB555 배치를 적용했다.

```c
red   = value & 0x1F;
green = (value >> 5) & 0x1F;
blue  = (value >> 10) & 0x1F;
```

각 5-bit 채널을 0~255로 확장했다. 복원된 하늘, 지붕, 잔디, 폭발과 인물 색이 자연스럽게 나타나므로 endian과 채널 순서도 함께 검증됐다.

## 리소스별 해석

### 리소스 645

- `40×30` tiles, 320×240 pixels
- 타일맵 항목 1,200개가 모두 고유하다.
- 항구 도시, 바다, 교회, 묘지가 한 장면으로 복원된다.
- 전체 화면 배경용 리소스다.

### 리소스 646

- `63×22` tiles, 504×176 pixels
- 동일한 도시 일부 위에 폭발이 진행되고 사라지는 프레임들이 배열돼 있다.
- 효과 애니메이션의 source sheet다.

### 리소스 665

- `35×7` tiles, 280×56 pixels
- 각 프레임은 `5×7` tiles, 즉 40×56 pixels다.
- 일곱 프레임에 걸쳐 인물 동작이 변한다.
- 런타임 PNT 복사 폭 `5`, 높이 `7`, source stride `35`와 완전히 일치한다.

## 복원 도구

```powershell
node scripts/ss-fs2-export-graphic-resource.js `
  "ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 1).bin" `
  665 output/ss-fs2-resource-665.bmp
```

도구 동작:

1. 실행 파일의 big-endian 리소스 섹터 테이블 조회
2. file `1`에서 컨테이너 추출
3. RGB555 팔레트 변환
4. `character_number × 32`로 8bpp pattern 조회
5. 타일맵 순서대로 24-bit BMP 생성

생성 파일:

- `output/ss-fs2-resource-645.bmp`
- `output/ss-fs2-resource-646.bmp`
- `output/ss-fs2-resource-665.bmp`

## 글꼴 조사에 미치는 영향

그래픽 컨테이너의 완전한 복원식이 확보됐다. 따라서 전체 리소스를 같은 구조로 검색한 뒤 다음 특징을 가진 리소스를 폰트 후보로 선별할 수 있다.

- tilemap보다 pattern 집합 자체가 중요한 작은 컨테이너
- 8×8 또는 16×16 셀이 규칙적으로 배열됨
- 반복 배경이 아니라 문자 획 형태가 나타남
- 메뉴나 대화 초기화 코드에서 팔레트·pattern VRAM으로 적재됨

다음 단계에서는 컨테이너 전수 목록을 만들고 작은 크기·높은 pattern 재사용률·문자형 셀 배치를 기준으로 후보를 시각화한다.
