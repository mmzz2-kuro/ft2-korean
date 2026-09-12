# 세가 새턴판 파랜드 사가 2 조사 계획

## 목적

세가 새턴판 《파랜드 사가 2: 시간의 이정표》의 한국어 패치를 제작하기 전에 디스크, 실행 파일, 데이터 컨테이너, 대사 스크립트, 문자 인코딩, 폰트 및 화면 출력 경로를 재현 가능한 방식으로 조사한다.

이 문서는 조사 순서와 판정 기준을 관리하는 시작점이다. 확인되지 않은 내용은 추정으로 명시하고, 새 사실이 확인되면 근거가 되는 파일 오프셋·LBA·RAM 주소·명령어 또는 재현 절차를 함께 기록한다.

## 대상과 보존 원칙

분석 기준 입력은 `ss/others`의 트랙 분리 BIN/CUE 세트다.

| 파일 | 크기 | 역할 |
| --- | ---: | --- |
| `ss/others/Farland Saga - Toki no Michishirube (Japan).cue` | 256 bytes | 트랙 배치 |
| `ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 1).bin` | 516,419,232 bytes | Mode 1 데이터 트랙 |
| `ss/others/Farland Saga - Toki no Michishirube (Japan) (Track 2).bin` | 3,880,800 bytes | pregap 포함 CDDA 트랙 |

두 BIN을 CUE 순서대로 연결한 바이트열의 SHA-256은 `E5DDD15D8638FBDA193312241709FD4245206DD2806C08BE0EC65A0235A28B01`이며, 아래 CloneCD IMG의 SHA-256과 일치한다. 따라서 두 세트는 같은 디스크 데이터의 표현 방식만 다르다.

참조 및 최종 보존 검증용 CloneCD 세트는 다음과 같다.

| 파일 | 크기 | 역할 |
| --- | ---: | --- |
| `ss/Farland Saga Toki no Michishirube.ccd` | 912 bytes | 세션 및 트랙 배치 |
| `ss/Farland Saga Toki no Michishirube.img` | 520,300,032 bytes | 2352-byte raw sector 본체 |
| `ss/Farland Saga Toki no Michishirube.sub` | 21,236,736 bytes | 서브채널 데이터 |

원칙:

- BIN/CUE와 CloneCD 세트를 모두 읽기 전용 원본으로 취급한다.
- 정적 분석과 파일 추출은 구조가 명확한 `ss/others`의 Track 1 BIN을 기준으로 한다.
- 트랙 배치와 서브채널 보존 검증에는 CloneCD 세트를 함께 사용한다.
- 추출물, 변환물 및 패치 이미지는 원본과 다른 경로에 생성한다.
- 모든 도구는 입력 경로와 출력 경로를 명시적으로 받게 한다.
- 원본 식별용 SHA-256을 최초 조사 단계에서 기록한다.
- 조사 스크립트는 특정 PC의 절대 경로에 의존하지 않게 한다.
- 롬 이미지와 대용량 추출물은 저장소에 커밋하지 않는다.

## 현재 확인된 사실

### 디스크 구조

- IMG 크기는 정확히 `2352 × 221,216` bytes이며 잘린 섹터가 없다.
- 단일 세션, 2트랙 구성이다.
- 트랙 1은 LBA 0에서 시작하는 데이터 트랙이다.
- 트랙 2는 LBA 219,716에서 시작하는 오디오 트랙이다.
- 리드아웃은 LBA 221,216이며 오디오 트랙 길이는 1,500섹터, 즉 20초다.
- CCD의 `DataTracksScrambled=0`에 따라 데이터 트랙은 비스크램블 상태다.
- 데이터 섹터는 Mode 1 형식이며 user data는 raw sector의 `+0x10`에서 2,048 bytes다.

### 새턴 부트 및 ISO 정보

| 항목 | 값 |
| --- | --- |
| 하드웨어 식별자 | `SEGA SEGASATURN` |
| 메이커 ID | `SEGA TP T-325` |
| 제품 번호 | `T-32511G` |
| 버전 | `V1.000` |
| 빌드 날짜 | `19981104` |
| 지역 | `J` |
| 게임명 | `FARLANDSAGA2` |
| ISO 시스템 ID | `SEGA SEGASATURN` |
| ISO 볼륨 ID | `FARLAND_SAGA2` |
| PVD | LBA 16 |
| 루트 디렉터리 | LBA 20, 2,048 bytes |

IMG 파일의 파일시스템 수정 시각은 원본 판정 근거로 사용하지 않는다. 디스크 내부 헤더의 제품 번호·버전·빌드 날짜와 앞으로 계산할 해시를 기준으로 삼는다.

## 핵심 조사 질문

조사는 다음 질문에 답하는 것을 목표로 한다.

1. ISO9660 루트와 하위 디렉터리에는 어떤 파일이 있으며 각 파일의 LBA와 크기는 얼마인가?
2. IP.BIN이 지정한 최초 실행 파일, 로드 주소, 실행 주소 및 크기는 무엇인가?
3. 게임 데이터는 개별 파일인가, 하나 이상의 컨테이너인가?
4. 대사·이벤트·메뉴 문자열은 어떤 파일과 형식에 저장되어 있는가?
5. 문자열은 Shift-JIS인가, 게임 고유의 8/16-bit 문자 코드인가?
6. 제어 코드, 포인터, 분기 및 스크립트 명령은 어떤 endian과 단위로 저장되는가?
7. 글꼴은 BIOS 폰트, VDP1 텍스처, VDP2 타일 또는 혼합 경로 중 무엇을 사용하는가?
8. 한글 글리프를 넣을 공간과 문자 코드 범위를 어떻게 확보할 수 있는가?
9. 번역문 증가를 고정 길이 교체로 처리할 수 있는가, 포인터 재배치나 컨테이너 재구축이 필요한가?
10. 파일 교체 후 ISO9660 메타데이터, IP.BIN 필드, Mode 1 EDC/ECC 및 트랙 배치를 어떻게 보존할 것인가?
11. PS1판 번역 자산 중 대사 순서, 고유명사, UI 문구 및 문자표의 어느 부분을 대응시킬 수 있는가?

## 조사 단계

### 0. 기준선 고정

- CCD/IMG/SUB의 크기와 SHA-256을 기록한다.
- CCD의 트랙 시작 LBA와 리드아웃을 표로 보존한다.
- 부트 헤더와 ISO PVD의 원시 바이트를 덤프한다.
- 정상 부팅 가능한 에뮬레이터와 버전을 기록한다.
- 부팅, 타이틀, 새 게임, 첫 대사까지의 기준 스크린샷 또는 세이브 상태를 확보한다.

완료 조건: 다른 작업자가 같은 원본인지 해시로 판정하고 동일한 트랙 구조를 재현할 수 있다.

### 1. 파일시스템 목록화 및 무손실 추출

- Mode 1 raw sector에서 2,048-byte user data를 읽는 추출기를 준비한다.
- ISO9660 디렉터리 레코드를 순회하여 경로, LBA, 논리 크기, 섹터 수를 CSV 또는 JSON으로 출력한다.
- 전체 파일을 별도 작업 경로에 추출한다.
- 추출 파일을 다시 원래 LBA 구간과 비교하여 byte-for-byte 일치 여부를 검증한다.
- 파일명 버전 접미사 `;1`, 패딩, 다중 익스텐트 여부를 보존한다.

산출물 후보:

- `docs/projects/ss/fs2/disc-file-map.md`
- `scripts/ss-fs2-list-iso.*`
- `scripts/ss-fs2-extract-iso.*`

완료 조건: 모든 디렉터리 엔트리의 범위가 IMG 내부에 있고, 추출 파일 전부가 원본 user data와 일치한다.

### 2. 부트 체인과 SH-2 실행 파일 분석

- IP.BIN의 1st read address/size와 진입점을 확인한다.
- 최초 실행 파일을 식별하고 SH-2 big-endian으로 로드한다.
- 코드, 리터럴 풀, 데이터, BSS 후보 영역을 구분한다.
- CD 파일 검색·읽기 함수와 파일명 문자열의 교차 참조를 찾는다.
- `MOV.L @(disp,PC),Rn`의 리터럴 주소 계산과 분기 delay slot을 반영한다.
- 하드코딩된 LBA 또는 파일 크기가 있는지 조사한다.

산출물 후보:

- `docs/projects/ss/fs2/boot-and-executable.md`
- `docs/projects/ss/fs2/cd-loader-xrefs.md`

완료 조건: 디스크 부팅부터 메인 실행 코드까지의 로드 주소와 파일 읽기 경로를 주소 근거와 함께 설명할 수 있다.

### 3. 데이터 파일 및 컨테이너 지도 작성

- 파일별 entropy, 반복 헤더, 정렬 단위, magic, endian 및 압축 후보를 조사한다.
- 실행 코드의 파일 참조와 정적 스캔 결과를 결합한다.
- 컨테이너가 있으면 엔트리 수, 오프셋, 압축 크기, 해제 크기, 타입 필드를 추정한다.
- 경계 판정은 연속된 여러 엔트리와 실제 로더 계산식으로 검증한다.
- 그래픽·오디오·스크립트 후보를 파일 또는 엔트리 단위로 분류한다.

산출물 후보:

- `docs/projects/ss/fs2/resource-map.md`
- `scripts/ss-fs2-scan-resources.*`

완료 조건: 최소한 타이틀/전투/이벤트 각 한 장면에서 읽는 주요 리소스를 디스크 위치까지 역추적할 수 있다.

### 4. 텍스트와 스크립트 형식 규명

- 파일별 Shift-JIS 문자열 스캔은 후보 생성용으로만 사용한다.
- 일본어 화면 문구를 원시 바이트에서 검색하여 실제 인코딩을 판정한다.
- 16-bit 코드라면 big-endian 문자값과 제어 코드 범위를 분리한다.
- 문자열 시작/종료, 줄바꿈, 페이지 전환, 화자, 대기, 선택지 및 변수 삽입 코드를 표로 만든다.
- 포인터가 파일 상대, 블록 상대, RAM 절대 주소 또는 인덱스인지 확인한다.
- 스크립트 재삽입 후 분기 대상과 포인터가 보존되는지 왕복 검증한다.
- PS1판 대사와 장면별로 대조하되, 순서가 같다는 가정은 하지 않는다.

산출물 후보:

- `docs/projects/ss/fs2/text-encoding.md`
- `docs/projects/ss/fs2/dialogue-script-map.md`
- `scripts/ss-fs2-extract-text.*`

완료 조건: 첫 이벤트 대사 한 묶음을 사람이 읽을 수 있게 추출하고, 같은 내용 또는 테스트 문자열을 원래 위치에 재삽입할 수 있다.

### 5. 폰트와 렌더러 추적

- 글꼴 후보를 1bpp/2bpp/4bpp 및 8×8/8×16/16×16 단위로 미리 본다.
- PS1 전용 `Krom2RawAdd`를 SS 분석에 적용하지 않고, 게임 자체 문자 코드/글리프 경로를 찾는다.
- VDP1 VRAM, VDP2 VRAM 및 CRAM으로 향하는 전송을 추적한다.
- 문자 코드에서 글리프 인덱스와 VRAM 위치를 계산하는 SH-2 루틴을 찾는다.
- VDP2라면 PND 형식, character number 비트 수, 팔레트와 투명 타일을 확인한다.
- 글자 폭, 줄바꿈, 박스 폭, 글리프 캐시 및 동시 상주 글리프 수를 측정한다.

산출물 후보:

- `docs/projects/ss/fs2/font-and-renderer.md`
- `scripts/ss-fs2-preview-font.*`

완료 조건: 화면의 일본어 글자 하나에 대해 `스크립트 코드 → 글리프 인덱스 → 원본 데이터 → VRAM → 화면` 경로를 재현할 수 있다.

### 6. 최소 한국어 출력 PoC

- 기존 글리프 하나를 임시 한글 글리프로 교체하는 최소 실험부터 수행한다.
- 그다음 미사용 문자 코드 또는 확장 코드에 한글 1~3자를 배정한다.
- 대사 한 줄에서 한글, 일본어/숫자/기호, 줄바꿈 및 페이지 전환을 함께 검증한다.
- 캐시 충돌, 타일 번호 상한, 팔레트, 글자 잘림 및 간격을 확인한다.
- PoC 변경점은 파일 오프셋과 전후 바이트로 기록하고 언제든 원복 가능하게 한다.

완료 조건: 원본과 분리된 테스트 이미지가 부팅되고, 실제 대사창에서 의도한 한글이 안정적으로 표시된다.

### 7. 재삽입과 디스크 재구축 전략 결정

우선순위는 다음과 같다.

1. 같은 크기 내부 교체
2. 파일 내부 여유 공간을 이용한 재배치
3. 파일 크기를 유지한 컨테이너 재구축
4. 파일 크기 변경과 후속 파일 LBA 조정
5. 전체 데이터 트랙 재구축

검증 항목:

- ISO9660 양 endian LBA/길이 필드
- 경로 테이블과 디렉터리 레코드
- IP.BIN의 1st read 관련 필드
- 코드에 하드코딩된 LBA/크기
- 변경된 Mode 1 섹터의 EDC/ECC
- 트랙 2 시작 LBA 및 SUB와의 정합성

오디오 트랙과 서브채널을 유지해야 하므로, 일반적인 단일 ISO 생성만으로 최종 이미지를 만들지 않는다. 원본 CloneCD 배치를 보존하는 sector-level 패치 또는 검증된 재구축 절차를 사용한다.

완료 조건: 원본에서 패치 이미지를 결정론적으로 만들 수 있고, 변경하지 않은 섹터와 오디오/SUB 데이터가 보존됨을 자동 검증할 수 있다.

## 도구 작성 기준

- 조회, 추출, 삽입, 검증 기능을 가능한 한 분리한다.
- 모든 숫자 필드는 endian과 단위를 이름 또는 도움말에 표시한다.
- `--dry-run` 또는 동등한 무수정 모드를 우선 제공한다.
- 범위 밖 읽기/쓰기, 겹치는 리소스, 정렬 위반은 즉시 오류로 처리한다.
- 삽입기는 예상 원본 바이트 또는 입력 해시가 다르면 중단한다.
- 생성 결과와 원본 사이의 변경 섹터 목록을 출력한다.
- 수동 hex 편집은 탐색 실험에만 사용하고, 확정 변경은 스크립트로 재현한다.

## 문서화 규칙

각 조사 문서는 가능한 경우 다음 정보를 포함한다.

- 대상 파일 및 해시
- 디스크 LBA와 raw IMG byte offset
- 추출 파일 offset과 크기
- SH-2 RAM 주소 및 파일 offset 환산식
- endian, 정렬, 포인터 기준점
- 관찰 사실과 해석/추정의 구분
- 사용한 명령과 도구 버전
- 성공 및 실패한 실험
- 재현 단계와 검증 결과

주소 표기는 `0x` 접두사를 사용한다. raw IMG 위치와 2,048-byte 논리 ISO 위치를 혼용하지 않으며, 다음 관계를 명시적으로 적용한다.

```text
Mode 1 raw sector 시작 = LBA × 2352
해당 sector의 user data 시작 = LBA × 2352 + 0x10
```

## 위험 요소

- 새턴판과 PS1판은 동일한 대사 자산을 공유할 수 있지만 파일 구조와 런타임은 별개일 가능성이 높다.
- 단순 Shift-JIS 검색은 고유 문자 코드나 압축된 스크립트를 놓칠 수 있다.
- SH-2 명령과 데이터가 섞인 영역에서 잘못된 disassembly를 근거로 삼지 않는다.
- VDP2의 타일 번호 범위와 VRAM 배치가 한글 글리프 수의 직접적인 상한이 될 수 있다.
- all-zero 타일이 투명/공백으로 참조되고 있을 수 있으므로 미사용으로 단정하지 않는다.
- 원본의 비정상 EDC/ECC가 복제 방지 또는 판별에 쓰일 가능성을 확인하기 전에는 전체 섹터를 일괄 재계산하지 않는다.
- 파일 확장으로 트랙 2 시작 위치가 바뀌면 CCD/SUB 및 CDDA 재생 시점까지 영향을 받을 수 있다.

## 첫 조사 라운드 체크리스트

- [x] BIN/CUE SHA-256 기록 및 CloneCD IMG 동일성 확인
- [x] 부트 헤더 주요 필드 덤프 및 의미 확인
- [x] ISO9660 전체 파일 목록과 LBA 지도 생성
- [ ] 전체 파일 무손실 추출 및 원본 대조
- [x] 최초 실행 파일과 SH-2 로드 주소 확인
- [ ] 파일명 문자열과 CD 읽기 함수 교차 참조
- [x] 대용량 데이터/컨테이너 후보 식별
- [ ] 화면에서 확인 가능한 일본어 문구 5개 이상 원시 검색
- [ ] 폰트 후보와 BIOS 폰트 사용 여부 확인
- [ ] 에뮬레이터 기준 부팅 및 첫 대사 재현 절차 기록
- [ ] 다음 라운드의 가장 작은 한국어 출력 PoC 범위 결정

## 초기 산출물 배치

```text
docs/projects/ss/fs2/
  01-investigation-plan.md    # 이 문서
  02-initial-survey.md        # 해시, 부트 헤더, ISO 파일 목록 요약
  03-resource-map.md          # 컨테이너와 리소스 분류
  04-executable-analysis.md   # 부트 체인과 SH-2 실행 파일
  05-resource-loader.md       # CD 읽기와 리소스 로더
  06-resource-catalog-and-text-survey.md # 리소스 분류와 텍스트 예비 조사
  07-video-and-font-leads.md  # VDP 참조와 폰트 후보
  08-resource-152-visual-analysis.md # 리소스 152 타일 해석 비교
  09-resource-152-dispatcher.md # 리소스 152 상태/시퀀스 디스패처
  10-audio-stream-ring-buffer.md # 리소스 152의 SCSP 전송 경로
  11-vdp2-pnt-source-and-graphic-container.md # 실제 PNT source와 그래픽 컨테이너
  12-graphic-payload-and-reconstruction.md # 8bpp payload와 이미지 복원
  13-graphic-catalog-and-font-screening.md # 그래픽 전수 목록과 글꼴 후보 선별
  14-raw-font-search-and-pnt-elimination.md # raw 글꼴 검색과 PNT 후보 제거
  15-text-consumer-loop-search.md # 실행 코드의 문자 소비 루프 탐색
  16-script-resource-identification.md # SS 스크립트 뱅크 식별과 PS1 교차 검증
  17-script-vm-and-dialogue-route.md # halfword reader, dispatch, opcode 0x41
  18-message-bank-map.md      # 확장 메시지 sector와 블록 구조
  19-message-mask-tool-and-mode1-ecc.md # SS mask export/patch와 raw sector 검증
  20-korean-smoke-test.md     # 짧은 한국어 대사 출력 시험
  21-reveal-header.md         # SS reveal/control header 재구축
  22-build-and-verify.md      # 이미지 재구축과 전체 검증
  23-ps1-translation-port.md  # PS1 번역 자산 전수 이관과 안전군 빌드
  24-reveal-count-extension-poc.md # SS reveal count 실행 코드 확장 PoC
  25-full-reveal-extension-build.md # reveal 초과 534개 전체 통합 빌드
  26-finale-message-map.md # PS1 finale 주소와 SS group 17 message 매핑
  27-finale-translation-build.md # Finale 220개 번역과 reveal 확장 통합 빌드
  28-ui-mask-resource-map.md # 1bpp UI mask 336개의 PS1→SS 리소스 대응
  29-ui-mask-safe-build.md # 1bpp UI mask 안전군 334개 통합 빌드
  30-name-table-resource-map.md # 이름 테이블 458행의 PS1→SS 리소스 대응
  31-name-table-translation-build.md # 이름 테이블 활성 번역 420개 통합 빌드
  32-behdr-ui-resource-map.md # 8bpp 타일형 UI 66개의 PS1→SS 대응과 안전 이식 범위
  33-behdr-ui-safe-build.md # 원본 동일 8bpp 타일형 UI 54개 통합 빌드와 검증
  34-behdr-ui-latest-ps1-rebuild.md # 최신 PS1 로고 통합판 기준 8bpp UI 재추출·재빌드
  35-behdr-ui-exception-analysis.md # 구조 차이 8bpp UI 5개의 SS 기준 개별 분석
  36-behdr-ui-exception-lossless-poc.md # 예외 UI 3개의 SS 합성과 무손실 타일 용량 검증
  37-deferred-palette-layer-ui.md # 예외 UI 5개의 팔레트 레이어별 추출·재삽입 후속 처리 결정
  38-title-logo-resource-map.md # PS1 타이틀·로고 후보 4개의 SS 대응 조사
  39-title-logo-build.md # 최신 PS1 타이틀·로고 2개 통합 빌드와 검증
  40-remaining-work-audit.md # 최신 PS1 변경 리소스 전수 분류와 잔여 작업 우선순위
  41-speaker-name-resource-map-and-build.md # 초록색 소형 대화 화자명 25개 대응과 통합 빌드
  42-known-unapplied-items.md # 시스템 UI, 플랫폼 차이 대사 등 현재 확인된 미적용 목록
  43-ss-original-ui-816-939.md # 미적용 1bpp UI 2개의 SS 원본 이미지와 원문
  44-ui-mask-platform-difference-build.md # 플랫폼 부가 문구 차이 1bpp UI 2개 적용
  45-ss-platform-dialogue-originals.md # 플랫폼 원본 차이 대사 4개의 SS 이미지와 일본어 원문
  46-platform-dialogue-build.md # SS 전용 조작 안내와 플랫폼 차이 대사 4개 적용
  47-final-patch-gui.md # 최신 PS1 번역 자산에서 SS 최종 BIN/CUE를 재생성하는 GUI와 통합 빌더
  48-palette-layer-postprocess-gui.md # 최종 SS BIN 대상 팔레트 레이어 추출·편집·재삽입 후처리 GUI
  49-ss-behdr-palette-inspector.md # 최종 SS BIN의 be-hdr 팔레트 인덱스와 선택 영역 분포를 확인하는 GUI
  50-yabasanshiro-experience-cheats.md # Yaba Sanshiro RAM 스냅샷 비교와 캐릭터 경험치 치트 주소
  51-dialogue-gui-search.md # 대사 GUI의 한국어 번역·메시지 ID·원문/메모 검색과 결과 이동
  52-ui-mask-editable-png-workflow.md # 1bpp UI의 폰트 렌더링 PNG 추출·수동 편집·PBM 재삽입 흐름
  53-readonly-dialogue-spellcheck-gui.md # 전체 한국어 대사의 읽기 전용 맞춤법·일본어 잔존·표시 형식 QA
```

문서는 조사 결과에 따라 분리한다. 아직 근거가 없는 항목을 빈 문서로 미리 만들지는 않는다.
