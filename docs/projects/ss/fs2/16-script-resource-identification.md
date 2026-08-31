# 스크립트 리소스 식별

## 결론

SS판 이벤트 스크립트 뱅크를 확정했다.

```text
SS resource 278..295
PS1 resource 309..326
mapping: ssId = psId - 31
```

두 범위의 18개 리소스는 크기뿐 아니라 **할당 영역 전체가 각각 byte-for-byte 동일**하다. SHA-1도 모든 쌍에서 일치했다. 따라서 PS1판에서 확인한 big-endian halfword opcode/인자 스트림과 192-entry 포인터 테이블 구조를 SS판에도 그대로 적용할 수 있다.

이 결과는 SS판 대사 조사에서 처음 확보한 직접적인 스크립트 데이터 경로다. 플랫폼별 실행 코드는 다르지만 스크립트 원본 데이터 자체는 공유된다.

## 구조 후보 탐색

도구 `scripts/ss-fs2-scan-structured-resources.js`를 추가했다. 그래픽 컨테이너 241개를 제외한 4,094개 리소스에 다음 지표를 계산한다.

- active byte 범위와 trailing zero padding
- byte entropy와 zero 비율
- big-endian 16/32-bit 선두 offset table
- 192-entry sparse 16-bit pointer table
- 16-bit 값의 종류와 작은 값 비율
- 고정 stride별 byte 반복률

실행:

```powershell
node scripts/ss-fs2-scan-structured-resources.js `
  "ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 1).bin"
```

결과 카탈로그:

```text
output/ss-fs2-structured-resource-catalog.json
```

192-entry sparse pointer 규칙을 적용하면 ID 278~295가 모두 점수 18로 연속 최상위에 나타난다. ID 4297과 211도 형태상 후보로 잡히지만, PS1 대응과 실행 파일의 뱅크 테이블까지 동시에 확인되는 범위는 278~295다.

## 리소스 형식

각 리소스 앞쪽에는 192개의 big-endian u16 entry pointer가 있다.

- entry 개수: 192
- pointer 단위: byte offset
- 0: 해당 entry 없음
- 유효값: 짝수이며 리소스 내부 opcode stream을 가리킴
- 공통 entry 0 pointer: `0x0502`
- stream word index: `pointer >> 1`

포인터 테이블의 물리 크기는 `0x180`바이트지만 첫 stream이 `0x0502`에서 시작하므로 사이에 예약 영역이 있다. `0x0502 / 2 = 0x0281`은 entry 0의 시작 word index다.

SS 278 entry 0의 시작은 다음과 같다.

```text
0034 0000 000e ffff 0033 0032 0016 0000
0010 0065 0001 0fa0 0003 0010 0009 0033
0003 0000 0029 0000 0001 0000 0006 0000
```

이는 PS1 309 entry 0과 정확히 같다.

## SS 스크립트 뱅크 목록

| script ID | SS resource | PS1 resource | 크기 | 유효 entry |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 278 | 309 | `0x1000` | 32 |
| 1 | 279 | 310 | `0x2000` | 17 |
| 2 | 280 | 311 | `0x2800` | 41 |
| 3 | 281 | 312 | `0x2000` | 34 |
| 4 | 282 | 313 | `0x2000` | 25 |
| 5 | 283 | 314 | `0x2000` | 15 |
| 6 | 284 | 315 | `0x1800` | 17 |
| 7 | 285 | 316 | `0x1800` | 14 |
| 8 | 286 | 317 | `0x1800` | 5 |
| 9 | 287 | 318 | `0x1800` | 12 |
| 10 | 288 | 319 | `0x1800` | 21 |
| 11 | 289 | 320 | `0x2000` | 20 |
| 12 | 290 | 321 | `0x1800` | 20 |
| 13 | 291 | 322 | `0x1800` | 19 |
| 14 | 292 | 323 | `0x1000` | 6 |
| 15 | 293 | 324 | `0x3000` | 30 |
| 별도 경로 후보 | 294 | 325 | `0x1800` | 6 |
| 별도 경로 후보 | 295 | 326 | `0x2800` | 24 |

PS1판과 마찬가지로 앞의 16개가 기본 script ID 0~15 뱅크이고, 마지막 두 개는 동일 형식이지만 별도 참조 경로를 갖는 후보로 구분한다.

## 바이트 단위 교차 검증

도구:

```powershell
node scripts/ss-fs2-compare-script-resources.js `
  "ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 1).bin" `
  "ps1/SLPS-01903/FS2_FILE.DAT" `
  "ps1/SLPS-01903/SLPS_019.03"
```

결과:

```text
identical=18/18
```

대표 쌍:

| SS | PS1 | SHA-1 |
| ---: | ---: | --- |
| 278 | 309 | `8c35b230d67b54953a613110e1d8d97c88b1b0db` |
| 279 | 310 | `a24fcb9ed1e9510b8e939b31f3b9c6d4f6f49226` |
| 293 | 324 | `b5db3193980200a0ac310c32cdfb9e4ad457db99` |
| 295 | 326 | `cb174c2bea923ec03da1747fc4a932b0f917da2b` |

비교는 meaningful data만 자른 것이 아니라 각 리소스에 할당된 sector padding까지 포함한 전체 영역을 대상으로 했다.

## SS 실행 코드의 뱅크 로더

SS 실행 파일 offset `0xFA30`, RAM `0x0601FA30`에 다음 18개 big-endian u16 값이 연속으로 있다.

```text
0116 0117 0118 0119 011a 011b 011c 011d
011e 011f 0120 0121 0122 0123 0124 0125
0126 0127
```

십진수로 278~295다.

`0x0601FA54` 루틴은 다음 흐름으로 script ID에 해당하는 리소스를 적재한다.

```text
R4 = script ID
copy 36 bytes from 0x0601FA30 to stack
resource ID = stackTable[script ID]
destination = *(0x0605B940)
call resource loader 0x0602E724
```

이후 `0x0601FA98` 계열은 entry가 191 이하인지 확인하고, 로드된 뱅크의 `entry * 2` 위치에서 u16 pointer를 읽는다. 값이 0이 아니면 상태 변수에 저장하고 VM 실행 상태를 초기화한다. 이는 PS1판의 기본 뱅크 선택과 192-entry 진입 규칙에 대응한다.

SS는 SH-2 big-endian 환경이므로 원본 big-endian halfword를 그대로 읽는다. PS1판에서 필요했던 로드 후 16-bit byte swap은 SS 경로에는 필요하지 않다.

## 기존 예비 판정의 정정

초기 조사에서는 SS ID 309~326을 PS1의 동일 번호와 비교해 형식이 다르다고 판단했다. 그 관찰 자체는 맞지만, 스크립트가 없다는 결론으로 확대하면 안 된다. SS판에서는 앞쪽 플랫폼 전용 리소스 수가 달라져 스크립트 뱅크가 31칸 앞당겨졌다.

```text
잘못된 동일-ID 비교: SS 309..326 vs PS1 309..326
확정된 대응 비교:    SS 278..295 vs PS1 309..326
```

향후 플랫폼 간 리소스 대응은 ID가 아니라 내용 hash와 실행 파일의 ID 테이블을 함께 사용한다.

## 다음 단계

스크립트 데이터가 완전히 동일하므로 다음 조사에서는 PS1판에서 확인한 opcode `0x41`과 `0x0006`의 위치를 SS ID로 변환해 사용할 수 있다. 다만 SS 실행 코드의 opcode 번호와 handler 의미까지 동일하다고 가정해서는 안 된다.

1. SS 278~295에서 PS1판의 유효 대사 참조 위치를 재현한다.
2. SS VM의 halfword reader와 opcode dispatch table을 찾는다.
3. 동일 stream 위치에서 SS handler를 연결한다.
4. 메시지 리소스 ID 매핑이 SS에서도 일정한 shift인지 검증한다.
5. 실제 텍스트/글꼴 경로를 SS VDP 출력 코드까지 추적한다.

