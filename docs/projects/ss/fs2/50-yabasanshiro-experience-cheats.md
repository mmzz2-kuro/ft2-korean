# 50. Yaba Sanshiro 캐릭터 경험치 치트 조사

## 환경

- 에뮬레이터: Windows Yaba Sanshiro `1.20.37`
- 대상: `output/ss-fs2-korean-palette-final.bin`
- 새턴 High Work RAM: `0x06000000..0x060FFFFF`
- Yaba 호스트 메모리 저장 방식: 16-bit byte swap

실행 중 프로세스에서 게임 실행 파일의 세 지점과 일치하는 바이트열을 찾아 High Work RAM의 호스트 매핑을 확인했다. 스냅샷은 게스트 SH-2 바이트 순서로 복원한 뒤 비교한다.

## 확인된 경험치 주소

| 캐릭터 | 변경 | SH-2 주소 | 형식 | 200 고정 AR 코드 |
|---|---:|---:|---|---|
| 카린 | 100 → 116 | `0x06063A7C` | big-endian u16 | `16063A7C 00C8` |
| 알 | 100 → 116 | `0x06063AF8` | big-endian u16 | `16063AF8 00C8` |

두 비교에서 100에서 116으로 변한 u16 후보는 각각 정확히 하나였다. 카린 코드로 실제 게임 정보 화면의 경험치 변경도 확인했다.

## 캐릭터 레코드 간격

```text
0x06063AF8 - 0x06063A7C = 0x7C
```

따라서 카린과 알의 캐릭터 상태 레코드는 124바이트 간격으로 배치된 것으로 판단한다. 후속 캐릭터 주소는 `+0x7C` 간격 후보를 우선 검사하되, 실제 경험치 변화 전후 스냅샷으로 반드시 확인한 후 코드로 확정한다.

## Yaba Sanshiro 코드 형식

```text
1AAAAAAA VVVV  # 16-bit word write
3AAAAAAA 00VV  # 8-bit byte write
```

경험치는 16비트 값이므로 `1` 형식을 사용한다. 코드를 계속 활성화하면 값이 매 프레임 고정될 수 있으므로 QA에서는 세이브스테이트를 먼저 만들고, 원하는 값이 반영된 뒤 코드를 비활성화하는 편이 안전하다.

## 도구와 스냅샷

- `scripts/yabasanshiro-find-saturn-ram.py`: 실행 중 Yaba Sanshiro의 High Work RAM 탐색·덤프
- `scripts/ss-fs2-compare-ram-values.py`: 두 RAM 스냅샷의 정확값 변화 비교
- `tmp/yabasanshiro-cheat/karin-exp-before-100.bin`
- `tmp/yabasanshiro-cheat/karin-exp-after-116.bin`
- `tmp/yabasanshiro-cheat/al-exp-before-100.bin`
- `tmp/yabasanshiro-cheat/al-exp-after-116.bin`

