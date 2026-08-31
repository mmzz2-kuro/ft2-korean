# VDP2 PNT source와 그래픽 컨테이너

## 결론

`0x25E40E24`에 쓰이는 실제 source는 리소스 152가 아니라 Work RAM `0x0609AC30`에 생성된 **32-bit VDP2 pattern name table(PNT)**이다.

이 PNT의 원본은 일반 리소스 ID 665이며, 해당 리소스는 `35×7` 타일맵을 가진 그래픽 컨테이너다. 런타임은 이를 일곱 개의 `5×7` 프레임으로 보고 선택된 프레임만 `0x25E40E24`에 복사한다.

확정된 경로:

```text
resource 665: 35×7 tilemap
  → 0x0602E7A4: Work RAM으로 적재
  → 0x0602F490: u16 tile index를 u32 PNT로 변환
  → Work RAM 0x0609AC30
  → 0x0601107C: 선택된 5×7 사각형 복사
  → VDP2 VRAM 0x25E40E24
```

따라서 이 주소는 고정된 폰트 원본의 전송점이라기보다 작은 UI 애니메이션 또는 상태 표시용 PNT 갱신점이다.

## 그래픽 컨테이너 구조

리소스 645, 646, 665는 같은 big-endian 헤더와 레이아웃을 가진다.

```c
struct graphic_resource {
    be32 width;          // +0x00, tile columns
    be32 height;         // +0x04, tile rows
    be32 payload_bytes;  // +0x08
    be32 payload_offset; // +0x0C
    be16 palette[256];   // +0x10, 0x200 bytes
    be16 tilemap[];      // +0x210, width × height entries
    // 4-byte alignment padding when needed
    uint8_t payload[payload_bytes];
};
```

`payload_offset`은 다음 식과 정확히 일치한다.

```text
align4(0x10 + 0x200 + width × height × 2)
```

| ID | 크기 | width×height | PNT entries | payload offset | payload bytes | 끝 padding |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 645 | `0x13800` | 40×30 | 1,200 | `0x0B70` | `0x12C10` | `0x80` |
| 646 | `0x0B800` | 63×22 | 1,386 | `0x0CE4` | `0x0A810` | `0x30C` |
| 665 | `0x03000` | 35×7 | 245 | `0x03FC` | `0x02450` | `0x7B4` |

헤더 네 필드와 팔레트·타일맵 경계는 세 리소스에서 모두 수식으로 검증됐다. 후속 분석에서 payload는 압축되지 않은 8bpp 8×8 pattern으로 확인됐으며, 자세한 내용은 `12-graphic-payload-and-reconstruction.md`를 참조한다.

## 리소스 적재 함수 `0x0602E7A4`

이 함수는 리소스 ID를 받아 크기를 구하고 `0x0607AC30`부터 `0x6C000` bytes인 작업 영역의 뒤쪽에 맞춰 적재한다.

```c
size = resource_size(id);
offset = 0x6C000 - size;
destination = 0x0607AC30 + offset;
load_resource(id, destination);
return offset / 4;
```

호출자는 반환값을 다시 4배하고 `0x0607AC30`을 더해 실제 포인터를 복원한다. 이 때문에 정적 분석에서는 리소스 포인터가 직접 literal로 나타나지 않는다.

## PNT 생성 함수 `0x0602F490`

호출 규약은 다음과 같이 좁혀졌다.

```c
build_pnt(graphic_resource *resource,
          uint32_t pattern_vram_base,
          uint32_t *pnt_destination);
```

함수는 `resource + 0x210`에서 `width × height`개의 big-endian/u16 tile index를 읽고, pattern VRAM base에 해당하는 character-number bias를 더해 32-bit PNT entry로 쓴다.

두 대표 pattern base의 bias:

| pattern base | character-number bias |
| ---: | ---: |
| `0x25E00000` | `0x0000` |
| `0x25E20000` | `0x1000` |
| `0x25E30000` | `0x1800` |

계산은 코드의 상수 `0xDA200000`과 5-bit 우측 이동으로 구현된다.

```c
bias = (pattern_vram_base + 0xDA200000) >> 5; // 32-byte character unit
pnt[y][x] = bias + resource->tilemap[y][x];
```

리소스 645의 PNT는 `0x25E40000`에 직접 만들어지고, 리소스 665의 PNT는 동적 부분 갱신을 위해 `0x0609AC30`에 먼저 만들어진다.

## 사각형 복사 함수 `0x0601107C`

이 함수는 source와 destination의 stride가 다른 32-bit 사각형 복사 루프다.

```c
copy_pnt_rect(uint32_t *source,
              uint32_t *destination,
              uint32_t source_stride,
              uint32_t rows,
              uint32_t width,
              uint32_t horizontal_frame);
```

내부 계산:

```c
source += width * horizontal_frame;

for (y = 0; y < rows; y++) {
    copy width 32-bit entries;
    source += source_stride - width;
    destination += 64 - width;
}
```

`0x060345xx` 호출에서는 다음 값이 사용된다.

- source: `0x0609AC30`
- destination: `0x25E40E24`
- width: 5 PNT entries
- source stride: 35 entries 후보
- rows: 7 후보
- frame: 계산값 또는 고정값 3
- destination stride: 64 PNT entries, 함수 내부 고정

리소스 665가 `35×7`이므로 `35 = 5 × 7`이다. 즉 수평으로 배치된 일곱 개의 `5×7` 프레임 중 하나를 목적 PNT에 복사하는 구조와 정확히 맞는다.

## 팔레트 경로

`0x06040160(resource + 0x10, palette_index, option)`은 `0x200` bytes를 팔레트 staging 영역 `0x060797D0 + palette_index × 0x200`으로 복사한다. 이는 컨테이너의 `be16 palette[256]` 해석을 뒷받침한다.

함수는 복사 후 `0x06040048` 등을 호출하므로 최종 CRAM 반영은 하위 함수에서 수행되는 것으로 보인다.

## 글꼴 조사에 미치는 영향

- `0x25E40E24`는 5×7 PNT 애니메이션 갱신 영역으로 분류한다.
- 리소스 665는 글꼴이 아니라 7-frame UI 그래픽 후보로 분류한다.
- `0x0601107C`는 범용 PNT 사각형 복사 함수이므로 다른 호출 지점은 여전히 글꼴 또는 대화창 갱신 경로일 수 있다.
- 다음 폰트 조사는 `0x0601107C`의 나머지 호출 중 문자 수에 따라 width 또는 source offset이 변하는 경로를 우선 추적한다.

## 재현 도구

```powershell
node scripts/ss-fs2-inspect-graphic-resource.js `
  "ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 1).bin" `
  645,646,665
```

추가된 스크립트는 리소스 테이블을 통해 지정 ID를 읽고 헤더, 팔레트, 타일맵, payload 경계를 검증한다.

## 다음 조사

1. 같은 그래픽 컨테이너를 전수 검색해 글꼴 후보를 선별한다.
2. `0x0601107C`의 다른 호출을 분류해 대화창·폰트 관련 호출 후보를 찾는다.
3. `0x25E40E00`, `0x25E41E00`, `0x25E420A0`의 source도 같은 방식으로 연결한다.
