# 리소스 152 SCSP 스트림 링 버퍼 분석

## 결론

리소스 152는 글꼴이나 VDP2 UI 타일이 아니다. `0x0601AEAC`가 이 데이터를 `0x1000` bytes씩 복사하는 목적지는 VDP VRAM이 아니라 **SCSP 사운드 RAM `0x05A6C000`~`0x05A6FFFF`**이다.

리소스 크기 `0x5000`과 초기화 호출의 두 번째 인자 `5`가 정확히 일치한다.

```text
0x5000 bytes = 5 × 0x1000-byte blocks
```

따라서 `0x0601B00C(data, 5, 0)`의 두 번째 인자는 선택 번호가 아니라 **남은 4KB 블록 수**다. 세 번째 인자는 네 칸짜리 SCSP 목적지 링의 초기 슬롯 번호다.

## Saturn 메모리 영역

| 주소 | 용도 |
| ---: | --- |
| `0x00280000` | Low Work RAM의 대체/공백 소스 버퍼 |
| `0x05A6C000` | SCSP sound RAM 내 링 버퍼 시작 |
| `0x05A6D000` | 링 슬롯 1 |
| `0x05A6E000` | 링 슬롯 2 |
| `0x05A6F000` | 링 슬롯 3 |

목적지는 다음 식으로 계산된다.

```c
destination = 0x05A6C000 + (slot << 12);
slot = (slot + 1) & 3;
```

즉 네 개의 `0x1000`-byte 슬롯을 순환한다.

## `0x0601AEAC` 처리 흐름

전역 상태의 의미가 다음과 같이 정정됐다.

| 전역 주소 | 역할 |
| ---: | --- |
| `0x06061FB8` | 현재 source 포인터 |
| `0x06061FC0` | 현재 SCSP 링 슬롯 번호 |
| `0x06061FC4` | 대기/복제 source 포인터 |
| `0x06061FCC` | 대기 상태 존재 여부 또는 교체 제어값 |
| `0x06061FD0` | 남은 `0x1000`-byte 블록 수 |
| `0x06061FD2` | 입력이 끝난 뒤 대체 블록을 보낸 횟수 |
| `0x06061FDC` | 대기/복제 블록 수 |

핵심 경로는 다음 의사 코드로 표현할 수 있다.

```c
void stream_tick(void) {
    if (pending_control != 0 && remaining_blocks == 0) {
        source = pending_source;
        remaining_blocks = pending_blocks;
    }

    void *dst = (void *)(0x05A6C000 + (ring_slot << 12));

    if (remaining_blocks > 0) {
        copy32(dst, source, 0x1000);
        source += 0x1000;
        remaining_blocks--;
    } else {
        copy32(dst, (void *)0x00280000, 0x1000);
        fallback_blocks++;
    }

    ring_slot = (ring_slot + 1) & 3;
}
```

`0x06078F38`의 halfword는 각 복사 직전에 1, 직후에 0으로 설정된다. 복사 중임을 나타내는 잠금/상태 플래그 후보지만 정확한 소비자는 아직 확인하지 않았다.

## 복사 함수 `0x06010A00`

`0x06010A00`은 변환 함수가 아니라 정방향 32-bit 메모리 복사 루프다.

```text
0x06010A02  SHLR2 R6       ; byte length / 4
0x06010A08  MOV.L @R5+,R0
0x06010A0A  MOV.L R0,@R4
0x06010A0C  DT R6
0x06010A0E  BF/S 0x06010A08
0x06010A10  ADD #4,R4
```

호출 규약:

```c
copy32(void *destination, const void *source, uint32_t byte_length);
```

`0x0601AEAC`의 두 경로 모두 `R6=0x1000`으로 이 함수를 부른다. 압축 해제, 타일 재배열 또는 픽셀 변환은 전혀 수행하지 않는다.

## 리소스 152와의 일치

| 항목 | 값 |
| --- | ---: |
| 리소스 ID | 152 |
| file `1` sector | `3780..3789` |
| 크기 | `0x5000` bytes |
| Work RAM 적재 주소 | `0x060BAC30` |
| 스트림 초기화 | `0x0601B00C(0x060BAC30, 5, 0)` |
| 블록 수 | 5 |
| 블록 크기 | `0x1000` bytes |

시각화에서 높은 고유 타일 비율과 불규칙한 패턴이 나타난 이유도 오디오 데이터였기 때문으로 설명된다. 첫 바이트의 signed delta처럼 보이는 분포는 PCM 또는 사운드 드라이버용 인코딩과 부합할 수 있지만, 구체적인 코덱은 아직 확인하지 않았다.

## 기존 가설 정정

다음 연결은 폐기한다.

```text
resource 152 → 글꼴/UI 타일 → VDP2
```

`0x060BAC30` 참조가 `0x060345xx`의 VDP2 UI 코드와 같은 큰 함수 범위에 존재한다는 사실은 데이터 경로를 뜻하지 않았다. 해당 버퍼는 화면 처리 도중 별도의 사운드 스트림 호출에 재사용된다.

확정된 연결은 다음과 같다.

```text
resource 152
  → Work RAM 0x060BAC30
  → 0x0601B00C 스트림 상태 등록
  → 0x0601AEAC, 한 번에 0x1000 bytes
  → 0x06010A00 copy32
  → SCSP sound RAM 0x05A6C000 + ring_slot × 0x1000
```

## 도구

SH-2 명령과 PC-relative literal을 재현하기 위해 다음 덤퍼를 추가했다.

```powershell
node scripts/ss-fs2-disasm-sh2.js `
  "ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 1).bin" `
  0x0601aeac 168

node scripts/ss-fs2-disasm-sh2.js `
  "ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 1).bin" `
  0x06010a00 24
```

스크립트는 현재 조사에 필요한 SH-2 opcode 부분집합을 해석한다. 알려지지 않은 opcode는 `DATA.W`로 남기므로 완전한 범용 디스어셈블러로 취급하지 않는다.

## 다음 조사

1. 리소스 152의 샘플 형식, 채널 수, 샘플레이트 또는 사운드 드라이버 헤더를 판별한다.
2. `0x00280000`이 무음 버퍼인지 런타임 초기화 코드를 추적한다.
3. 글꼴 조사는 리소스 152와 분리하고 다른 VDP 전송 source를 역추적한다.
4. `0x25E40E24` PNT 갱신 루틴에서 실제 source 포인터를 새로 찾는다.

## 확정되지 않은 부분

- 리소스 152의 구체적인 오디오 코덱
- SCSP CPU가 이 링 버퍼를 소비하는 방식
- `0x06061FCC`와 `0x06061FD2`의 정확한 상태명
- `0x00280000` 버퍼의 초기 내용
