# 한국어 대사 smoke test

## 결과

SS판 message `1004`의 대사 mask를 한국어 `앗!?`로 교체한 실행용 BIN/CUE 세트를 생성했다.

```text
output/ss-fs2-message-1004-ko.bin
output/ss-fs2-message-1004-ko.cue
```

정적 검증 결과:

- 원본과 출력의 크기 동일
- 변경된 raw sector는 LBA `30238` 하나
- user data 변경량 93 bytes
- 변경 범위는 message `1004`의 첫 `0x930` mask 내부
- 수정 sector의 Mode 1 EDC/ECC 검증 성공
- 패치 BIN에서 재추출한 PGM과 입력 한국어 PGM의 pixel data 동일
- 실행 파일, 스크립트, sector table, 후속 reveal/control 데이터는 변경하지 않음

사용자가 Saturn 실행 환경에서 실제 대사 화면을 확인했으며 `앗!?`가 한글로 정상 출력됐다. 따라서 mask 위치, 2bpp palette index, CUE 구성, reveal 동작까지 런타임 검증을 통과했다.

## 입력 한국어 mask

기존 PS1판 번역 작업에서 생성·검증한 PGM을 재사용했다.

```text
tmp/SLPS-01903/dialogue-workflow/apply/message-mask-1004-ko.pgm
```

번역 문자열:

```text
앗!?
```

PGM:

```text
P2
200 48
max value 3
```

SS와 PS1의 message mask 선두 `0x930`바이트가 동일하므로 platform 변환 없이 같은 pixel indices를 사용할 수 있다.

## Patch 명령

```powershell
node scripts/ss-fs2-message-mask-tool.js patch `
  "ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 1).bin" `
  "output/ss-fs2-message-1004-ko.bin" `
  1004 `
  "tmp/SLPS-01903/dialogue-workflow/apply/message-mask-1004-ko.pgm"
```

도구는 mask가 걸치는 LBA `30238`, `30239`를 읽고 Mode 1 EDC/ECC를 재계산한다. 한국어 mask의 실제 변경 pixel은 첫 sector에만 들어 있으므로 최종 BIN diff에서는 `30239`가 원본과 같고 `30238`만 달라진다.

## CUE

생성한 CUE는 패치된 데이터 track과 원본 오디오 track을 함께 참조한다.

```cue
FILE "ss-fs2-message-1004-ko.bin" BINARY
  TRACK 01 MODE1/2352
    INDEX 01 00:00:00
FILE "../ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 2).bin" BINARY
  TRACK 02 AUDIO
    INDEX 00 00:00:00
    INDEX 01 00:02:00
```

CUE를 다른 디렉터리로 이동할 경우 두 번째 `FILE` 경로도 원본 Track 2 위치에 맞게 수정해야 한다.

## BIN diff 검증

재현 도구:

```powershell
node scripts/ss-fs2-verify-patched-bin.js `
  "ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 1).bin" `
  "output/ss-fs2-message-1004-ko.bin"
```

결과:

```text
changedLbas=30238
changedSectorCount=1
userDiffBytes=93
logicalFirst=0x3b0f008
logicalLast=0x3b0f0d1
invalidMode1Parity=0
```

`logicalFirst/Last`는 Track 1 전체를 2,048-byte user data만 연속시킨 좌표다. raw byte offset이 아니다.

## 출력 BIN checksum

| 항목 | 값 |
| --- | --- |
| 크기 | 516,419,232 bytes |
| CRC32 | `49393E5B` |
| MD5 | `227d358a63e8016dfdacb55368846957` |
| SHA-1 | `1456ac08165d4206787a3ce7da3e7b6887594c4f` |

## 재추출 검증

패치 BIN에서 message `1004`를 다시 export했다.

```powershell
node scripts/ss-fs2-message-mask-tool.js export `
  "output/ss-fs2-message-1004-ko.bin" `
  "output/ss-fs2-message-1004-ko-verify" `
  1004
```

PGM comment 문자열 차이 때문에 파일 checksum은 다르지만 header를 제외한 9,600개 pixel value는 입력 PGM과 전부 동일하다.

```text
pixelDataSame=true
```

## 에뮬레이터 확인 결과

`output/ss-fs2-message-1004-ko.cue`를 실행하고 해당 대사 장면에서 `앗!?`가 한글로 정상 출력됨을 확인했다.

## 현재 판정

한국어 mask가 정확한 raw 위치에 삽입되고 디스크 오류 정정 정보도 유효하며, 실제 화면에서도 한글이 정상 출력된다는 점까지 확정됐다.

현재 문자열은 짧고 원래 message `1004`의 reveal 범위 안에 충분히 들어가므로 후속 header를 보존해도 smoke test에는 적합하다. 전체 번역에서는 긴 문장을 위해 SS 전용 reveal/control header 갱신 규칙을 분석해야 한다.

## 다음 단계

다음 조사에서는 SS와 PS1 message block의 `0x930` 이후 공통 prefix와 첫 차이를 구조적으로 비교한다. segment count와 pointer table을 찾아 긴 한국어 문장에 필요한 reveal 범위를 안전하게 재구축한다.
