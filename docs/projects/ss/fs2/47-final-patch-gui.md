# 47. PS1 번역 자산 → SS 최종 패치 GUI

## 목적

지금까지 검증한 한국어 자산을 SS 원본 Track 1에 순서대로 적용하는 최종 빌더와 GUI를 만들었다. 중간 단계의 패치 이미지를 입력하지 않고, 아래 세 원본/기준 파일만으로 동일한 최종 BIN/CUE를 재생성한다.

- SS 원본 Track 1 BIN
- SS 원본 Track 2 BIN
- 최신 PS1 한국어판 BIN (`output/patched-farland-saga-logo.bin`)

Track 2는 오디오 트랙 자체를 다시 쓰지 않으며 최종 CUE에서 참조한다. 입력 BIN은 덮어쓰지 않는다.

## 실행

저장소 루트에서 다음 명령을 실행한다.

```powershell
python tools/ss_fs2_final_patch_gui.py
```

GUI에서 입력 3개, 출력 BIN, 작업 폴더를 확인한 뒤 `최종 패치 만들기`를 누른다. 출력 BIN과 같은 이름의 `.cue`, `.report.json`도 함께 생성된다. 진행 중에는 단계와 하위 도구 로그가 창에 표시되며 `중지`할 수 있다.

통합 CLI를 직접 실행할 수도 있다.

```powershell
node scripts/ss-fs2-build-final.js <SS Track1 BIN> <SS Track2 BIN> <최신 PS1 BIN> <출력 BIN> <출력 CUE> <보고서 JSON> [작업 폴더]
```

## 적용 범위

| 구분 | 적용 수 |
|---|---:|
| 일반 대사 안전군 | 1,899 |
| reveal count 확장 대상 | 534 |
| 종장 대사 | 220 |
| 1bpp 시스템 UI 안전군 | 334 |
| 플랫폼 차이 1bpp UI | 2 |
| 캐릭터·몬스터·도구·마법명 | 420 |
| 8bpp 시스템 UI 안전군 | 54 |
| 타이틀·로고 | 2 |
| 초록색 소형 화자명 | 25 |
| 플랫폼 차이 일반 대사 | 4 |

메시지 `1018`은 SS 버튼 표기에 맞춘 사용자 확정 번역을 GUI 빌드 중 새로 렌더링한다. 메시지 `5040`, `5042`, `6093`은 최신 PS1 자산을 그대로 사용한다.

## 아직 포함하지 않은 항목

팔레트 레이어별 편집이 필요한 시스템 UI 5건은 의도적으로 제외했다.

```text
SS resource 714, 1073, 1074, 1087, 1088
```

이 항목들은 팔레트별 이미지 추출·재삽입 GUI를 만든 뒤 최종 빌더에 추가한다. 따라서 현재 GUI는 지금까지 게임에서 확인한 한국어 적용 상태를 재현하는 1차 최종 빌더다.

## 기준 입력 해시

| 입력 | SHA-256 |
|---|---|
| SS Track 1 | `267CB97B787E4F3C804CBCB0495977C7F3B309513CA15F918A9C3C6D18996D02` |
| SS Track 2 | `1E3504C775B34E839B52C9DEA95C40D51E3F4DCDAE82CC88A11413D6ED301741` |
| 최신 PS1 BIN | `9C2E9571C3B87753DEED2651A559B86F1C638AB63D3A5CEFCB33EA38EC8BD02D` |

GUI와 CLI는 실제 입력 해시를 보고서에 기록한다. 기준과 다른 파일도 즉시 덮어쓰지는 않지만, 동일 결과는 위 해시 조합에서 보장한다.

## 전체 재빌드 검증

SS 원본과 최신 PS1 BIN부터 GUI가 호출하는 통합 CLI를 실제로 끝까지 실행했다.

| 항목 | 결과 |
|---|---:|
| 출력 크기 | 516,419,232 bytes |
| 출력 SHA-256 | `EB9DE6FC464732CED9B2FAA3E1E5DB3BB2B48C50EC164F0C519FCC1229507C69` |
| 기존 수동 최종본과 비교 | SHA-256 완전 일치 |
| 원본 대비 변경 섹터 | 4,208 |
| 원본 대비 변경 user bytes | 2,304,161 |
| 잘못된 Mode 1 EDC/ECC | 0 |

검증 산출물은 `output/ss-fs2-korean-final-gui-test.bin`, `.cue`, `.report.json`이다.

## 환경과 주의사항

- Python 3 및 Tkinter
- Node.js
- PowerShell과 .NET `System.Drawing`
- Python Pillow
- `font/gulim.ttc`

작업 폴더에는 교대 처리용 대형 중간 BIN 두 개와 추출 DAT 등이 만들어진다. 출력 BIN까지 합쳐 여유 공간을 최소 약 2GB 확보하는 편이 안전하다. 빌드 중 중지하면 이미 생성된 중간 파일은 작업 폴더에 남으며, 다음 실행 전에 사용자가 폴더를 바꾸거나 정리할 수 있다.

