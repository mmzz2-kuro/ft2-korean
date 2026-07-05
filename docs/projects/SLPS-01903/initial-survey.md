# SLPS-01903 초기 조사

## 범위

대상은 `ps1/SLPS-01903/`에 둔 일본어 PS1 게임 파일이다. 현재 보유한 입력은 전체 BIN/CUE 이미지와 ISO 파일시스템에서 추출한 파일 3개다.

| 파일 | 크기 | MD5 | 역할 |
| --- | ---: | --- | --- |
| `SYSTEM.CNF` | 61 | `7373750EDDC7F773742B082532CB7F1D` | 부트 설정 |
| `SLPS_019.03` | 407,552 | `89C704B7BBB2C75D2F6D40D93BA06C9B` | PSX-EXE 실행 파일 |
| `FS2_FILE.DAT` | 244,678,656 | `C138A366D5C97F67A5D658DAE26BFD82` | 대형 데이터 파일. 컨테이너 또는 리소스 묶음으로 추정 |

원본 이미지:

| 파일 | 크기 | MD5 | 역할 |
| --- | ---: | --- | --- |
| `bincue/Farland Saga - Toki no Michishirube.bin` | 281,875,440 | `EB61B1C745D77AEFCAB2DB21B02353F6` | 단일 데이터 트랙 raw BIN |
| `bincue/Farland Saga - Toki no Michishirube.cue` | 101 | `99823D29FCB548C48CD812F796E6A4A8` | CUE 시트 |

## 매체 상태

확인된 사실:

- `SYSTEM.CNF`의 부트 대상은 `cdrom:\SLPS_019.03;1`이다.
- `SYSTEM.CNF`의 스택 설정은 `STACK=801FFFF0`이다.
- `SLPS_019.03`은 `PS-X EXE` 헤더를 가진다.
- EXE 헤더 기준 초기 PC는 `0x801751D0`, 로드 주소는 `0x80169000`, text size는 `0x63000`이다.
- EXE 내부 문자열에서 `BISLPS-01903FLSAGA20`와 `ファーランドサーガ　時の道標　セーブデータ１　ステージ００`가 확인된다.
- EXE 내부의 `FS2_FILE.DAT;1` 문자열은 파일 오프셋 `0x5ff75`에 있다.
- EXE 내부의 `BISLPS-01903FLSAGA20` 문자열은 파일 오프셋 `0x6317c`, `0x63194`에 있다.
- EXE 내부의 `ファーランドサーガ　時の道標　セーブデータ１　ステージ００` 문자열은 파일 오프셋 `0x6328c`에 있다.
- CUE는 단일 `TRACK 01 MODE2/2352`, `INDEX 01 00:00:00` 구조다.
- BIN 크기는 281,875,440바이트이며 2352바이트 raw 섹터 119,845개로 정확히 나뉜다.
- ISO9660 PVD는 LBA 16에서 확인된다(`CD001`).
- 루트 디렉터리는 LBA 22, 크기 2048바이트다.
- ISO9660 루트 파일 배치는 다음과 같다.

| 파일 | LBA | 크기 | 기존 추출 파일과 비교 |
| --- | ---: | ---: | --- |
| `SYSTEM.CNF;1` | 23 | 61 | MD5 일치, 바이트 동일 |
| `SLPS_019.03;1` | 24 | 407,552 | MD5 일치, 바이트 동일 |
| `FS2_FILE.DAT;1` | 223 | 244,678,656 | MD5 일치, 바이트 동일 |
- 위 세 파일을 같은 LBA의 raw 섹터 user data 영역(Mode2/2352의 섹터 오프셋 24, 길이 2048)에 무수정 재삽입하면 BIN MD5가 원본과 동일하다.
- EXE의 `0x80187D20` 근처에서 `a1 = 0x801C8774`를 만들고 `jal 0x801882F4`를 호출한다. 이 주소는 EXE 안의 `\FS2_FILE.DAT;1` 문자열 주소로 보인다.
- `0x801882F4`는 경로 첫 문자가 `\`인지 검사하고 파일 경로 조각을 처리하는 CD 파일 검색 함수 후보다.
- `0x80179884`는 CD 위치 3바이트를 BCD에서 LBA로 변환하는 함수로 보인다.
- EXE의 `0x801C4F68`에는 `FS2_FILE.DAT` 내부 섹터 오프셋 테이블 후보가 있다. 첫 값 `0, 4, 10, 13, 34...`가 DAT 블록 시작 오프셋 `0x0`, `0x2000`, `0x5000`, `0x6800`, `0x11000...`와 일치한다.

아직 닫히지 않은 항목:

- 파일 크기를 바꾸는 재삽입, ISO9660 디렉토리 레코드 갱신, EDC/ECC 재계산은 아직 검증하지 못했다.
- `FS2_FILE.DAT`의 시작부는 PS1 플랫폼 문서의 VDD 엔트리 테이블 형태와 다르다. 파일 앞부분은 16-bit 색상/팔레트 또는 그래픽성 데이터처럼 보이며, 실제 파일 테이블 위치는 별도 탐색이 필요하다.
- `FS2_FILE.DAT`의 크기는 244,678,656바이트, 즉 119,472섹터이며 2048바이트에 정확히 정렬된다.
- `FS2_FILE.DAT` 앞부분은 16바이트 big-endian 헤더 + payload + 0x800 정렬 패딩으로 이어지는 블록 나열처럼 보인다.

초기 블록 후보:

| 오프셋 | 필드 1 | 필드 2 | payload 크기 | 필드 4 | 다음 후보 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `0x0` | 37 | 3 | `0x1b10` | `0x2f0` | `0x2000` |
| `0x2000` | 28 | 6 | `0x29d0` | `0x360` | `0x5000` |
| `0x5000` | 25 | 4 | `0x1250` | `0x2d8` | `0x6800` |
| `0x6800` | 28 | 23 | `0xa0d0` | `0x718` | `0x11000` |
| `0x11000` | 28 | 23 | `0xa110` | `0x718` | `0x1b800` |

도구:

- `scripts/scan-fs2-file.js`: `FS2_FILE.DAT`의 섹터 정렬 big-endian 블록 후보와 TIM-like 후보를 출력한다.
- 실행 예: `node scripts/scan-fs2-file.js ps1/SLPS-01903/FS2_FILE.DAT --exe ps1/SLPS-01903/SLPS_019.03 --limit 30`
- 현재 TIM-like 후보는 오탐 가능성이 높다. 실제 TIM 확정에는 블록 경계, 길이 필드, 이미지 rect, 주변 컨테이너 구조의 추가 검증이 필요하다.
- `docs/projects/SLPS-01903/fs2-file-map.md`: EXE 로더 함수, `0x801C4F68` 섹터 테이블, 일반 리소스 범위, 대형 구간 쌍을 정리한 현행 맵 문서.
- `scripts/scan-exe-xrefs.js`: EXE 안의 MIPS `jal` 호출을 대상 로더 함수별로 스캔한다. `--summary`로 상수 리소스 ID 요약을 출력한다.
- `scripts/list-fs2-resource-ids.js`: 지정한 리소스 ID의 DAT 오프셋, 크기, 1차 포맷 판정을 출력한다.
- `docs/projects/SLPS-01903/resource-xrefs.md`: 실제 코드에서 직접 참조되는 리소스 ID와 1차 포맷 판정을 정리한 문서.
- `scripts/disasm-exe-range.js`: EXE RAM 주소 기준으로 MIPS 명령을 덤프한다.
- `docs/projects/SLPS-01903/post-load-processing.md`: 로드 후 endian 변환 함수와 표시/마스크 렌더 후보를 정리한 문서.
- `scripts/scan-call-args.js`: 특정 함수 호출부의 `a0..a3` source와 주변 문맥을 요약한다.
- `scripts/preview-fs2-1bpp.js`: 리소스 ID를 1bpp 마스크로 해석해 ASCII 프리뷰와 bit 통계를 출력한다.
- `docs/projects/SLPS-01903/script-reader.md`: script/event halfword reader 후보와 VM 상태 변수를 정리한 문서.
- `scripts/dump-fs2-script-resource.js`: script-like 리소스의 entry table과 big-endian halfword stream을 덤프한다.

판정:

- 원본 BIN/CUE 기준 파일 추출과 무수정 재삽입 라운드트립은 닫혔다.
- 동일 크기 파일 교체는 raw 섹터 user data 재삽입 경로로 설계 가능하다.
- 파일 크기가 바뀌면 ISO9660 메타데이터와 후속 파일 LBA, EDC/ECC 처리까지 별도 검증해야 한다.

## 다음 조사 게이트

1. `FS2_FILE.DAT`의 내부 구조를 식별한다.
   - 매직, 오프셋 테이블, 압축 블록, TIM/그래픽 블록, Shift-JIS 텍스트 후보를 분리한다.
   - 첫 4바이트 `00 00 00 25`가 엔트리 수인지, 그래픽 데이터인지 확인한다.
2. EXE의 참조 문자열과 파일명/오프셋 상수를 찾는다.
   - `FS2_FILE.DAT` 접근 루틴 후보는 `0x80187D20` 호출부와 `0x801882F4` 함수로 좁혔다.
   - EXE 안의 CD/file read 호출과 DAT offset 계산 루틴은 `fs2-file-map.md`에 1차 정리했다.
   - `0x801C4F68` 섹터 오프셋 테이블은 일반 리소스 `0..4449`와 17개 대형 구간 쌍으로 1차 해석했다.
3. 대표 일본어 텍스트 후보를 좁혀 표본 추출한다.
   - 전체 바이너리 정규식 검색은 잡음이 과도하므로 오프셋 범위별로 제한한다.
   - 후보 블록은 Shift-JIS 디코드 성공률, 제어코드 패턴, 주변 포인터 후보로 판정한다.
   - 직접 상수로 로딩되는 리소스 ID는 대체로 그래픽/오디오로 보였다.
   - 현재 대사/이벤트 본문 후보는 `0x8017C364` halfword reader와 `309..324` script bank 리소스 경로로 좁혀졌다.
   - `309..326` script-like 리소스에서는 평문 Shift-JIS 텍스트 후보가 나오지 않았다.
4. 폰트 경로를 판정한다.
   - BIOS `Krom2RawAdd` 호출을 쓰는지, 자체 폰트/텍스처를 쓰는지 확인한다.
   - `FS2_FILE.DAT`에 TIM/폰트성 타일이 들어 있으면 그래픽 텍스트 경로도 함께 분리한다.
   - 현재 `+829`, `+1008`, `+1074` 계열 리소스는 1bpp UI glyph/icon mask 후보로 남아 있다.
   - `1151..1169` 리소스는 256x64 1bpp UI mask 계열로 확정했다.
   - `0x8017B0EC`는 rect 전송/클리어 래퍼로 정정했고, 실제 1bpp 전개 후보는 `0x8017B13C`, `0x8017B500`, `0x801AD230` 계층으로 좁혔다.

## 현재 위험

- 원본 추출 파일이 저장소 안에 있으므로 커밋 방지가 중요하다. `.gitignore`에 `*.DAT`, `SYSTEM.CNF`, `SLPS_*`를 추가했다.
- 전체 이미지 기준 무수정 라운드트립은 닫혔지만, 수정 섹터의 EDC/ECC 재계산과 크기 변경 재삽입은 아직 검증하지 않았다.
- `FS2_FILE.DAT`가 단일 대형 아카이브라면 텍스트보다 먼저 컨테이너 파서와 라운드트립 검증이 필요하다.
