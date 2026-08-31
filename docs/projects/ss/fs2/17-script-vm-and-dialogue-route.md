# 스크립트 VM과 대사 경로

## 결론

SS판 스크립트 VM의 중심 경로와 대사 opcode를 확인했다.

```text
script resource 278..295
  -> halfword reader 0x0601FC3C
  -> dispatcher 0x0602162C
  -> dispatch table 0x0605B948
  -> opcode 0x41 handler 0x06021754
  -> message handler 0x06020324
  -> extended message loader 0x0602E8BC
```

opcode 번호와 주요 역할도 PS1판과 동일하게 대응한다. 특히 `0x41`이 대사 메시지 ID를 읽는 주 경로라는 점이 SS 실행 코드에서 직접 확인됐다.

## halfword reader

주소: `0x0601FC3C`

상태:

- 현재 script PC: u16 `0x0606CD1E`
- 현재 script bank 포인터: `*(0x0605B940)`

동작:

```c
uint16_t read_script_word(void) {
    uint16_t oldPc = scriptPc;
    scriptPc = oldPc + 1;
    return *(uint16_t *)(scriptBank + oldPc * 2);
}
```

원본 stream과 SH-2가 모두 big-endian이므로 byte swap 없이 읽는다. 실행 파일에는 이 reader 주소의 PC-relative literal이 78개 있으며, opcode handler 대부분이 이를 통해 인자를 소비한다.

`0x0601FC64`에는 유사한 checked reader가 있다. word를 읽은 뒤 특정 상태에 따라 추가 처리를 하거나 저장된 값을 반환한다. 실행 파일에서 29개 호출이 확인된다.

## opcode dispatcher

주소: `0x0602162C`

```c
opcode = read_script_word();
handler = dispatchTable[opcode];
currentHandler = handler;
handler();
```

핵심 명령:

```text
0x06021632  JSR read_script_word
0x06021636  EXTU.W R0,R0
0x0602163A  SHLL2 R0
0x0602163C  R1 = 0x0605B948
0x0602163E  R1 = *(R1 + R0)
0x06021640  JSR @R1
```

dispatch table은 포인터를 가리키는 전역 변수가 아니라 실행 파일 `0x0605B948`에 직접 포함된 함수 포인터 배열이다. opcode `0x00..0x7D`, 총 126개 entry가 유효하다. 그 다음 `0x7E` 위치의 값은 함수 주소가 아니므로 테이블 끝으로 판정했다.

재현 도구:

```powershell
node scripts/ss-fs2-scan-vm-dispatch.js `
  "ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 1).bin"
```

78개의 reader 호출 중 indexed handler load와 간접 `JSR`을 함께 가진 유일한 호출은 `0x06021632`다.

## 주요 opcode 대응

| opcode | SS handler | 판정 |
| ---: | ---: | --- |
| `0x06` | `0x060206AC` | 인자를 읽어 `0x0606CD50`의 u16 table을 조회하고 상태값에 저장 |
| `0x3F` | `0x060216FC` | portrait/expression slot 0 |
| `0x40` | `0x06021728` | portrait/expression slot 1 |
| `0x41` | `0x06021754` | 주 대사 메시지 표시 |
| `0x76` | `0x06022B44` | 두 인자를 읽고 조건부 UI mask 표시 |
| `0x78` | `0x06022BB0` | `0x1043 + 인자` 일반 리소스를 `0x002EB080`으로 적재 |

`0x3F`와 `0x40`은 같은 보조 함수를 호출하면서 R5만 각각 0과 1로 다르게 전달한다. `0x41` 직전에 이 두 opcode가 인물 표정/초상 슬롯을 설정하는 PS1 경로와 구조적으로 일치한다.

## opcode `0x41`

handler `0x06021754`:

```c
*(uint16_t *)0x06072738 = 0;
messageId = read_script_word();
show_message(messageId); // 0x06020324
```

`0x06020324`는 메시지 표시 상태를 준비한 뒤 `0x0602E8BC`를 호출한다.

```text
R4 = messageId
R5 = 0x0607BC30
call 0x0602E8BC
returned count -> 0x0606CD40
```

이후 상태에 따라 `0x0602026C`, `0x060202A0` 등의 전처리/출력 준비 루틴을 호출한다. 이 흐름은 일반 리소스 로더 `0x0602E724`를 사용하지 않는다.

## 확장 메시지 로더

주소: `0x0602E8BC`

입력 message ID는 일반 리소스 ID가 아니라 `1001`, `2001`, `7004` 같은 그룹화된 메시지 번호다.

코드에서 직접 확인되는 계산:

```text
messageId + 0xFC17 = messageId - 1001
quotient  = floor((messageId - 1001) / 1000)
remainder = (messageId - 1001) % 1000
```

주요 자료:

- 그룹별 offset table 포인터: `0x0602E5AC`
- 런타임 그룹 base 배열: `0x06077B90`
- CD 작업 객체: `0x06077BD4`
- 출력 버퍼: 호출자가 전달한 `0x0607BC30`

선택한 그룹의 `remainder`와 `remainder + 1` offset을 읽어 sector 시작과 길이를 계산하고 CD에서 메시지 블록을 읽는다. 이는 PS1판의 extended message range 구조와 같은 방식이다.

## 확인된 직접 대사 참조

스크립트 18개가 PS1판과 byte-for-byte 동일하고 opcode `0x41` 의미도 동일하므로, PS1에서 수동 화면 확인이 끝난 24개 직접 대사 참조를 SS ID로 변환할 수 있다.

| SS resource | entry | opcode word | message ID |
| ---: | ---: | ---: | ---: |
| 279 | 11 | `0x0A27` | 1004 |
| 279 | 15 | `0x0AB7` | 1001 |
| 280 | 2 | `0x02D2` | 2001 |
| 280 | 3 | `0x0338` | 2004 |
| 280 | 7 | `0x05B6` | 2007 |
| 280 | 8 | `0x05ED` | 2008 |
| 280 | 9 | `0x0619` | 2009 |
| 282 | 5 | `0x0600` | 4003 |
| 282 | 6 | `0x0644` | 4004 |
| 282 | 13 | `0x0786` | 4005 |
| 282 | 20 | `0x0B05` | 4001 |
| 282 | 23 | `0x0C42` | 4007 |
| 284 | 2 | `0x047D` | 6003 |
| 284 | 6 | `0x066D` | 6004 |
| 284 | 8 | `0x079D` | 6005 |
| 284 | 10 | `0x083E` | 6001 |
| 284 | 12 | `0x099C` | 6002 |
| 285 | 2 | `0x02CA` | 7002 |
| 285 | 3 | `0x02FC` | 7003 |
| 285 | 4 | `0x045F` | 7004 |
| 289 | 2 | `0x036F` | 1103 |
| 289 | 3 | `0x0438` | 1104 |
| 289 | 4 | `0x055D` | 1105 |
| 289 | 7 | `0x0659` | 1106 |

이 표의 opcode word는 entry 시작이 아니라 실제 `0x41` 위치다. 기존 근사 parser가 분기와 가변 길이 opcode에서 desync하는 구간은 포함하지 않았다.

## opcode `0x06`

handler `0x060206AC`는 다음 halfword를 읽어 u16 table `0x0606CD50[index]`를 조회하고 결과를 `0x0605B71E`에 저장한다. 직접 메시지 표시 함수를 호출하지 않는다.

따라서 PS1판과 마찬가지로 후반부 메시지 번호를 예약하거나 상태를 선택하는 opcode일 가능성이 높다. 예약값을 소비해 실제 메시지 표시를 호출하는 후속 opcode는 별도 추적이 필요하다.

## 현재 확정 범위와 제한

확정:

- script bank와 entry table
- big-endian halfword reader
- 126-entry opcode dispatch table
- opcode `0x41`의 메시지 ID 소비
- 일반 리소스와 분리된 extended message loader
- 24개 직접 대사 참조 위치

미확정:

- SS extended message range의 각 물리 sector와 PS1 메시지 블록의 byte 동일성
- 메시지 블록 내부 2bpp/마스크 형식과 문자 코드 존재 여부
- opcode `0x06` 예약 상태의 최종 소비자
- 24개 외 parser desync 구간의 추가 직접 대사
- VDP 전송 전 최종 렌더 버퍼 형식

## 다음 단계

다음에는 message ID 1001/1004 등의 실제 SS CD sector 범위를 계산·추출하고 PS1 메시지 블록과 비교한다. 데이터가 동일하면 PS1의 메시지 mask 교체 파이프라인을 SS 이미지 구조에 맞게 이식할 수 있고, 다르면 SS 전용 블록 header와 렌더 경로를 분석한다.

