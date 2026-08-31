# Manifest 기반 빌드와 전체 검증

## 결과

여러 SS 대사 PGM을 하나의 Track 1 BIN에 누적 적용하고 결과를 자동 검증하는 빌드 도구를 구현했다.

```text
scripts/ss-fs2-build-message-patch.js
```

빌드 과정에서 다음을 한 번에 처리한다.

- Track 1/2 원본 SHA-256 확인
- message ID 중복 및 sector 범위 확인
- PGM 형식과 pixel index 확인
- 원본 reveal capacity 초과 방지
- 원본 Track 1을 별도 출력으로 복사
- 여러 message mask 누적 patch
- 변경 sector별 Mode 1 EDC/ECC 재계산
- 전체 219,566 sector를 원본과 비교
- 허용 mask 범위 밖 user data 변경 탐지
- sector sync/header 변경 탐지
- 변경된 Mode 1 parity 재검산
- 원본 Track 2를 참조하는 CUE 생성
- 입력·출력 해시와 변경 LBA를 JSON report로 기록

## 원본 고정값

| 입력 | 크기 | SHA-256 |
| --- | ---: | --- |
| Track 1 | 516,419,232 | `267CB97B787E4F3C804CBCB0495977C7F3B309513CA15F918A9C3C6D18996D02` |
| Track 2 | 3,880,800 | `1E3504C775B34E839B52C9DEA95C40D51E3F4DCDAE82CC88A11413D6ED301741` |

manifest에서 해시를 생략해도 도구에 내장된 위 값과 대조한다. 다른 판본이나 손상된 dump에는 빌드를 진행하지 않는다.

## Manifest 형식

재현용 예제:

```text
configs/ss-fs2-build-smoke.json
```

구조:

```json
{
  "version": 1,
  "input": {
    "track1": "../ss/others/... (Track 1).bin",
    "track2": "../ss/others/... (Track 2).bin",
    "track1Sha256": "267C...6D02",
    "track2Sha256": "1E35...1741"
  },
  "output": {
    "track1": "../output/patched.bin",
    "cue": "../output/patched.cue",
    "report": "../output/patched.report.json"
  },
  "patches": [
    {
      "messageId": 1004,
      "pgm": "../tmp/.../message-mask-1004-ko.pgm"
    }
  ]
}
```

모든 상대 경로는 현재 작업 디렉터리가 아니라 manifest 파일이 놓인 디렉터리를 기준으로 해석한다. 따라서 같은 저장소 배치를 유지하면 어느 위치에서 명령을 실행해도 결과가 같다.

안전 조건:

- `version`은 현재 `1`만 지원
- `patches`는 한 개 이상 필요
- 같은 message ID를 두 번 지정할 수 없음
- Track 1 입력과 출력 경로가 같을 수 없음
- BIN, CUE, report 출력 경로는 서로 달라야 함
- 출력이 Track 1, Track 2 또는 manifest 자체를 덮을 수 없음
- 기존 출력은 기본적으로 거부하며 명시적인 `--force`에서만 교체

## Dry run

```powershell
node scripts/ss-fs2-build-message-patch.js `
  configs/ss-fs2-build-smoke.json `
  --dry-run
```

dry run은 대용량 BIN을 복사하지 않고 다음을 검증한다.

- 원본 Track 1/2 해시
- 각 message ID 매핑
- PGM 읽기와 2bpp pack 가능 여부
- reveal count와 capacity
- 번역 mask의 visible entry
- patch 예정 LBA

message `1004` 한국어 PGM 결과:

```text
visibleEntries: 24
revealCount: 4
revealCapacity: 56
touchedLbas: 30238, 30239
```

## 실제 빌드

```powershell
node scripts/ss-fs2-build-message-patch.js `
  configs/ss-fs2-build-smoke.json `
  --force
```

생성물:

```text
output/ss-fs2-build-1004-ko.bin
output/ss-fs2-build-1004-ko.cue
output/ss-fs2-build-1004-ko.report.json
```

검증 결과:

```text
patches=1
changedLbas=30238
userDiffBytes=93
invalidMode1Parity=0
forbiddenChanges=0
outputSha256=17f20e809b971e3a7c7501013285a0f50e2f5b9fd036ffe7b4fa5e1bc269fc53
```

mask는 LBA `30238`, `30239`에 걸치지만 번역 pixel의 실제 변경은 첫 sector에만 존재한다. 두 sector를 처리해도 두 번째 sector의 최종 EDC/ECC가 원본과 같으므로 전체 diff에는 `30238`만 남는다.

## 기존 수동 빌드와 비교

20단계에서 수동 절차로 만든 BIN과 새 manifest 빌드의 SHA-256은 같다.

| 파일 | SHA-256 |
| --- | --- |
| `ss-fs2-message-1004-ko.bin` | `17F20E809B971E3A7C7501013285A0F50E2F5B9FD036FFE7B4FA5E1BC269FC53` |
| `ss-fs2-build-1004-ko.bin` | `17F20E809B971E3A7C7501013285A0F50E2F5B9FD036FFE7B4FA5E1BC269FC53` |

즉 새 빌드 경로가 기존에 실기 확인한 `앗!?` 이미지와 byte-for-byte 동일하다.

## 누적 patch 시험

같은 짧은 한국어 PGM을 message `1004`와 `1106`에 동시에 지정한 임시 manifest로 실제 누적 빌드를 시험했다.

```text
patches=2
changedLbas=30238,36874
changedSectorCount=2
userDiffBytes=151
invalidMode1Parity=0
forbiddenChanges=0
```

두 message의 변경 sector가 서로 분리됐고 전체 검증을 통과했다. 이 시험용 BIN/CUE/report는 검증 후 제거했으며, 정식 단일 smoke build만 남겼다.

## 전체 diff 검증 기준

빌드 도구는 원본과 출력의 모든 raw sector를 순차 비교한다.

허용되는 변경:

```text
각 manifest message의
trackLba * 2048 .. trackLba * 2048 + 0x930
에 해당하는 user data

그리고 해당 sector의 EDC/ECC
```

실패 조건:

- 허용 message LBA 밖의 sector가 달라짐
- sector의 sync 또는 address/mode header가 달라짐
- mask `0x930` 밖의 user data가 달라짐
- 변경 sector의 Mode 1 EDC/ECC 재계산 결과가 저장값과 다름
- 출력 크기가 원본과 다름

ECC 영역의 변경은 허용하지만, 재계산 결과와 정확히 같은 경우에만 통과한다.

## Track 2와 CUE 보존

빌드는 Track 2를 복사하거나 수정하지 않는다. 빌드 시작 시 원본 Track 2 SHA-256을 확인하고 CUE에서 그 파일을 상대 경로로 직접 참조한다.

```cue
FILE "ss-fs2-build-1004-ko.bin" BINARY
  TRACK 01 MODE1/2352
    INDEX 01 00:00:00
FILE "../ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 2).bin" BINARY
  TRACK 02 AUDIO
    INDEX 00 00:00:00
    INDEX 01 00:02:00
```

이에 따라 다음 원본 배치가 유지된다.

- Track 1: 219,566 sectors
- Track 2 pregap: 150 sectors
- Track 2 INDEX 01: 원래 디스크 LBA 219,716
- CDDA 길이: 1,500 sectors

## Report

JSON report에는 다음이 기록된다.

- 해석된 manifest 절대 경로
- Track 1/2 입력 경로, 크기 및 SHA-256
- 출력 BIN/CUE/report 경로
- 출력 BIN 크기 및 SHA-256
- message별 group, index, sector 범위 및 track LBA
- PGM 경로, visible entry, reveal count/capacity
- 처리 대상 LBA
- 실제 변경 LBA, user data 변경 byte 수
- parity 오류와 허용 범위 위반 수

대용량 BIN과 CUE는 `.gitignore` 대상이지만, 빌드 manifest와 도구는 저장소에 남아 같은 결과를 재현할 수 있다.

## 현재 상태

SS 대사 한국어 패치에 필요한 최소 경로가 연결됐다.

```text
번역 PGM
  -> reveal capacity 검사
  -> message ID/LBA 변환
  -> 다중 mask 누적 삽입
  -> Mode 1 EDC/ECC 재계산
  -> 전체 sector diff 검증
  -> 원본 CDDA를 참조하는 CUE
  -> 실행 화면 확인
```

다음 작업은 조사 기반 구축이 아니라 실제 번역 생산 단계다. PS1 번역표에서 SS와 공유되는 message ID를 가져오고, 각 SS reveal capacity에 맞춰 PGM을 일괄 렌더한 뒤 manifest에 등록하는 변환 파이프라인을 구성하면 된다.
