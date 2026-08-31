# 확장 메시지 뱅크 지도

## 결론

SS판 message ID의 물리 sector 계산법을 확인하고, 직접 대사 24개의 블록을 PS1판과 비교했다.

- SS와 PS1의 전체 메시지 블록 크기 및 후속 데이터는 다르다.
- SS 블록은 같은 메시지에서 PS1보다 대체로 2~4배 많은 sector를 차지한다.
- 그러나 24개 모두 블록 선두 `0x930`바이트가 PS1 원본과 **byte-for-byte 동일**하다.
- 이 `0x930`바이트는 200×48, 2bpp 대사 mask의 packed source다.
- SS 렌더러도 588회 반복하며 매번 4바이트를 읽으므로 `588 × 4 = 0x930` 구조가 실행 코드와 일치한다.

따라서 PS1판에서 확립한 대사 mask 추출·한글 렌더·재패킹 로직을 SS판에도 재사용할 수 있다. 차이는 message ID→sector 매핑과 BIN의 raw-sector 갱신 방식이다.

## 메시지 뱅크가 놓인 위치

일반 리소스 테이블 뒤의 경계열은 다음과 같이 교차 배치된다.

```text
large/platform range
zero separator: 882 sectors
message/media group data
zero separator: 882 sectors
message/media group data
...
```

초기 조사에서 index `4335/4336`, `4337/4338`처럼 짝을 묶어 대형 range 17개를 확인했다. 메시지 로더는 한 칸 어긋난 `4336/4337`, `4338/4339` 등의 17쌍을 사용한다. 이 어긋난 쌍은 모두 882-sector zero separator이며, 각 쌍의 **끝 sector**가 해당 메시지 그룹의 base다.

예:

```text
table[4336] = 29018   zero separator start
table[4337] = 29900   zero separator end = message group 0 base
table[4338] = 42432   next zero separator start
table[4339] = 43314   next end = message group 1 base
```

17개 zero separator는 PS1판과 위치는 다르지만 내용과 길이가 같다. 모두 882 sectors의 0이며 SHA-1은 공통으로 다음과 같다.

```text
213c53043f6d990e8c552ea411b52075b9dc08c1
```

## 그룹 base와 offset table

| 그룹 | message ID 범위 | SS base sector | offset table | message slot 수 |
| ---: | --- | ---: | ---: | ---: |
| 0 | 1001~ | 29,900 | `0x0602D0C2` | 196 |
| 1 | 2001~ | 43,314 | `0x0602D24C` | 292 |
| 2 | 3001~ | 64,012 | `0x0602D496` | 179 |
| 3 | 4001~ | 75,184 | `0x0602D5FE` | 166 |
| 4 | 5001~ | 85,748 | `0x0602D74C` | 209 |
| 5 | 6001~ | 99,886 | `0x0602D8F0` | 155 |
| 6 | 7001~ | 108,584 | `0x0602DA28` | 117 |
| 7 | 8001~ | 115,802 | `0x0602DB14` | 148 |
| 8 | 9001~ | 125,026 | `0x0602DC3E` | 116 |
| 9 | 10001~ | 133,414 | `0x0602DD28` | 125 |
| 10 | 11001~ | 143,072 | `0x0602DE24` | 133 |
| 11 | 12001~ | 152,410 | `0x0602DF30` | 130 |
| 12 | 13001~ | 162,036 | `0x0602E036` | 104 |
| 13 | 14001~ | 169,450 | `0x0602E108` | 26 |
| 14 | 15001~ | 172,488 | `0x0602E13E` | 236 |
| 15 | 16001~ | 190,674 | `0x0602E318` | 108 |
| 16 | 17001~ | 200,578 | `0x0602E3F2` | 220 |

offset table 포인터 배열은 `0x0602E5AC`에 있다. 각 table은 big-endian u16 sector offset 경계 배열이다. slot 수는 경계 수보다 하나 작다.

## message ID 계산식

```text
n = messageId - 1001
group = floor(n / 1000)
index = n % 1000

relativeStart = offsetTable[group][index]
relativeEnd   = offsetTable[group][index + 1]

startSector = groupBase[group] + relativeStart
endSector   = groupBase[group] + relativeEnd
```

여기서 sector는 ISO 파일 `1` 내부의 2,048-byte 논리 sector다.

Track 1 raw BIN 위치:

```text
trackLba = 178 + startSector
rawByteOffset = trackLba * 2352 + 16
```

message block의 논리 크기:

```text
(endSector - startSector) * 2048
```

## 직접 대사 24개의 SS sector

| message ID | SS sector 범위 | sectors | PS1 sectors | 선두 `0x930` 동일 |
| ---: | ---: | ---: | ---: | --- |
| 1001 | 29900..29986 | 86 | 26 | 예 |
| 1004 | 30060..30072 | 12 | 6 | 예 |
| 1103 | 36538..36582 | 44 | 16 | 예 |
| 1104 | 36582..36676 | 94 | 30 | 예 |
| 1105 | 36676..36696 | 20 | 8 | 예 |
| 1106 | 36696..36702 | 6 | 4 | 예 |
| 2001 | 43314..43424 | 110 | 34 | 예 |
| 2004 | 43526..43582 | 56 | 18 | 예 |
| 2007 | 43744..43768 | 24 | 8 | 예 |
| 2008 | 43768..43874 | 106 | 32 | 예 |
| 2009 | 43874..43912 | 38 | 12 | 예 |
| 4001 | 75184..75226 | 42 | 14 | 예 |
| 4003 | 75258..75350 | 92 | 28 | 예 |
| 4004 | 75350..75410 | 60 | 20 | 예 |
| 4005 | 75410..75472 | 62 | 20 | 예 |
| 4007 | 75502..75552 | 50 | 16 | 예 |
| 6001 | 99886..99934 | 48 | 16 | 예 |
| 6002 | 99934..99984 | 50 | 16 | 예 |
| 6003 | 99984..100024 | 40 | 14 | 예 |
| 6004 | 100024..100032 | 8 | 4 | 예 |
| 6005 | 100032..100088 | 56 | 18 | 예 |
| 7002 | 108650..108676 | 26 | 10 | 예 |
| 7003 | 108676..108698 | 22 | 8 | 예 |
| 7004 | 108698..108822 | 124 | 38 | 예 |

## mask payload 구조

SS의 메시지 표시 경로 `0x0602026C`는 인덱스 0부터 `0x024B`(587)까지 `0x0601FEF4`를 호출한다.

```text
반복 횟수 = 588
source stride = 4 bytes
총 source = 588 * 4 = 2352 bytes = 0x930
```

`0x0601FEF4`는 `0x0607BC30 + index * 4`에서 두 big-endian u16을 읽고, 각 2-bit pixel을 VDP용 작업 영역에 전개한다. 세로 16-pixel 묶음 3개와 가로 196-column 유효 영역을 사용해 PS1판과 같은 200×48 mask를 만든다.

원시 블록 비교 결과 `0x930` payload는 byte swap한 결과가 아니라 **디스크에 저장된 바이트 자체가 동일**하다. PS1은 little-endian CPU라 로드 후 halfword swap을 하지만 SS SH-2는 이를 그대로 big-endian u16으로 읽는다.

## 블록 전체가 다른 이유

첫 차이는 메시지마다 `0x93E..0x9D1` 부근에서 발생한다. 즉 mask 뒤의 header/reveal/control 일부까지 공통 prefix가 이어지지만, 전체 블록은 동일하지 않다.

현재 확인된 차이:

- SS sector span이 더 크다.
- `0x930` 이후 platform-specific 데이터가 들어 있다.
- SS loader는 계산된 전체 block을 읽되 표시 루틴은 선두 mask와 뒤쪽 제어 자료를 별도로 사용한다.

따라서 번역 patch는 우선 고정 크기 `0x930` mask만 제자리 교체해야 한다. 뒤쪽 데이터나 sector table을 변경할 필요가 없다.

## 비교 도구

zero separator 전체 비교:

```powershell
node scripts/ss-fs2-compare-message-banks.js `
  "ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 1).bin" `
  "ps1/SLPS-01903/FS2_FILE.DAT" `
  "ps1/SLPS-01903/SLPS_019.03"
```

개별 message block과 mask 비교:

```powershell
node scripts/ss-fs2-compare-messages.js `
  "ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 1).bin" `
  "ps1/SLPS-01903/FS2_FILE.DAT" `
  "ps1/SLPS-01903/SLPS_019.03"
```

결과 요약:

```text
full block identical = 0/24
raw 0x930 mask identical = 24/24
```

## 다음 단계

다음에는 SS raw BIN을 직접 대상으로 다음 기능을 갖춘 mask 도구를 만든다.

1. message ID→raw BIN 위치 계산
2. `0x930` packed 2bpp mask를 200×48 PGM으로 export
3. 수정 PGM을 원래 위치에 재패킹
4. 변경 영역이 해당 message block의 첫 `0x930`에만 한정되는지 검증
5. 수정된 Mode 1 sector의 EDC/ECC 재계산

