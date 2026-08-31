# 세가 새턴판 파랜드 사가 2 리소스 로더

## 범위

실행 파일 `0`의 `0x0602E724` 함수를 중심으로 리소스 ID가 파일 `1`의 섹터 위치와 크기로 변환되고 메모리에 적재되는 과정을 분석한다.

주소 기준:

- 실행 파일 base: `0x06010000`
- 리소스 섹터 테이블: `0x0602AE9C`
- 파일 `1` ISO 시작: LBA 178
- 논리 섹터 크기: `0x800`

## 함수 인터페이스

`0x0602E724`의 현재 확인된 인터페이스:

```c
void load_resource(uint16_t resource_id, void *destination);
```

| 입력 | 의미 | 근거 |
| --- | --- | --- |
| `R4` | 리소스 ID | 함수 진입 직후 `EXTU.W R4,R8`, 크기 함수 호출 및 테이블 인덱스에 사용 |
| `R5` | 목적지 주소 | 진입 직후 `R9`에 보존되고 CD 읽기 요청 시 `R6`으로 전달 |

저장 레지스터는 `R8`, `R9`, `R10`, `PR`이다.

## 단계별 동작

### 1. 할당 크기 계산

```text
0x0602E730  MOV   R5,R9       ; destination 보존
0x0602E732  EXTU.W R4,R8      ; resource_id
0x0602E734  MOV.L ...,R0      ; 0x0602E700
0x0602E736  JSR   @R0
0x0602E738  MOV   R8,R4       ; delay slot
0x0602E73A  MOV   R0,R10      ; allocated bytes
```

`0x0602E700`은 다음 계산을 수행한다.

```c
allocated_bytes = (sector_table[id + 1] - sector_table[id]) << 11;
```

반환값은 `R10`에 보존된다.

### 2. 시작 섹터 조회

```text
0x0602E73C  ADD   R8,R8
0x0602E73E  MOV.L ...,R1      ; 0x0602AE9C
0x0602E740  MOV   R8,R0
0x0602E742  MOV.W @(R0,R1),R5
0x0602E744  EXTU.W R5,R5
```

의사 코드:

```c
start_sector = sector_table[resource_id];
```

테이블은 big-endian u16이고 SH-2가 big-endian으로 직접 읽으므로 별도 byte swap이 없다.

### 3. 파일 위치 설정

```text
0x0602E746  MOV.L ...,R8      ; 0x06077BD4
0x0602E748  MOV.L @R8,R4      ; CD/file handle
0x0602E74A  MOV.L ...,R0      ; 0x060417A4
0x0602E74C  JSR   @R0
0x0602E74E  MOV   #0,R6       ; delay slot
```

호출 시 인자:

```text
R4 = *(uint32_t *)0x06077BD4
R5 = start_sector
R6 = 0
```

`0x060417A4`는 현재 파일 위치를 리소스의 시작 섹터로 맞추는 함수로 분류한다. core loader 안에서 ISO LBA 178이나 CD FAD 보정값 150을 더하지 않으므로, 이 핸들은 이미 ISO 파일 `1`을 연 상태이며 섹터값은 파일 상대 위치일 가능성이 높다.

### 4. 섹터 수 계산

```text
0x0602E750  MOV   R10,R5
0x0602E752  SHLR8 R5
0x0602E754  SHLR  R5
0x0602E756  SHLR2 R5
```

전체 shift는 11비트다.

```c
sector_count = allocated_bytes >> 11;
```

리소스 테이블 경계가 `0x800` 단위이므로 나머지 반올림은 필요하지 않다.

### 5. 읽기 요청

```text
0x0602E758  MOV.L @R8,R4      ; CD/file handle
0x0602E75A  MOV   R10,R7      ; allocated bytes
0x0602E75C  MOV.L ...,R0      ; 0x06041C5C
0x0602E75E  JSR   @R0
0x0602E760  MOV   R9,R6       ; destination, delay slot
```

호출 시 인자:

```text
R4 = file handle
R5 = sector_count
R6 = destination
R7 = allocated_bytes
```

`0x06041C5C`는 파일 핸들에서 목적지 메모리로 비동기 읽기를 시작하는 함수로 분류한다.

### 6. 완료 polling

```text
0x0602E762  MOV.L ...,R9      ; 0x06077BD4
0x0602E764  MOV.L ...,R8      ; 0x06041F30
0x0602E766  JSR   @R8
0x0602E768  MOV.L @R9,R4      ; handle, delay slot
0x0602E76A  TST   R0,R0
0x0602E76C  BT/S  done
...
0x0602E770  MOV.L ...,R1      ; 0x0602E5F0
0x0602E772  JSR   @R1
0x0602E774  NOP
0x0602E776  BRA   poll
```

`0x06041F30`의 반환값이 0이 될 때까지 기다린다. 대기 중 `0x0602E5F0`을 호출하므로, 이 함수는 프레임 대기, CD 서비스 또는 시스템 task yield 후보로 둔다.

따라서 `0x0602E724`는 읽기 요청만 넣고 즉시 반환하는 함수가 아니라 완료까지 기다리는 동기 리소스 로더다.

## 전체 의사 코드

```c
void load_resource(uint16_t id, void *destination) {
    uint32_t allocated_bytes = resource_allocated_bytes(id);
    uint16_t start_sector = sector_table[id];
    FileHandle *handle = *(FileHandle **)0x06077BD4;

    file_seek_sector(handle, start_sector, 0);       // 0x060417A4
    file_read_async(                                 // 0x06041C5C
        handle,
        allocated_bytes >> 11,
        destination,
        allocated_bytes
    );

    while (file_read_status(handle) != 0) {          // 0x06041F30
        service_or_yield();                          // 0x0602E5F0
    }
}
```

함수 이름은 역할을 설명하기 위한 임시 이름이며 원본 심볼이 아니다.

## 관련 함수

| 주소 | 현재 역할 |
| ---: | --- |
| `0x0602E700` | 리소스 할당 크기 계산 |
| `0x0602E724` | 단일 리소스 동기 로드 |
| `0x0602E7A4` | 리소스 크기에 따라 특정 메모리 위치를 계산하는 래퍼 후보 |
| `0x0602E7EC` | 다단계 또는 분할 전송 로더 후보 |
| `0x060417A4` | 파일 상대 섹터 위치 설정 후보 |
| `0x06041C5C` | 비동기 읽기 시작 후보 |
| `0x06041F30` | 읽기 상태 polling 후보 |
| `0x0602E5F0` | 대기 중 service/yield 후보 |
| `0x06077BD4` | 열린 파일 `1`의 핸들 포인터 저장 위치 후보 |

## 파일 `1` open과 핸들 설정

로더 초기화 함수는 `0x0602E620`에서 시작한다. 이 함수는 관련 전역/작업 영역을 준비한 뒤 다음 흐름을 수행한다.

```text
0x0602E64A  MOV.L ...,R0      ; 0x060416BC
0x0602E64C  JSR   @R0
0x0602E64E  MOV   #3,R4       ; delay slot
0x0602E650  MOV.L ...,R1      ; 0x06077BD4
0x0602E652  MOV.L R0,@R1      ; 반환 핸들 저장
```

의사 코드:

```c
file1_handle = function_060416BC(3);
*(void **)0x06077BD4 = file1_handle;
```

반환된 핸들은 이후 `0x0602E724`의 모든 seek/read/status 호출에서 사용되므로 파일 `1`의 핸들임이 확실하다. 상수 3은 세가 파일 시스템 라이브러리가 루트 엔트리에 부여한 file ID로 판단한다. ISO 디렉터리의 사용자 파일 순번과 file ID가 동일한지는 라이브러리 초기화 규칙을 추가 확인해야 한다.

같은 초기화 함수는 이후 섹터 테이블 index 4335부터 17개의 대형 range pair를 읽어 u16 wrap을 보정한다. 자세한 범위 표는 `03-resource-map.md`에 기록했다.

## `0x0602E7EC`에서 확인된 추가 CD 함수

복합 로더의 literal pool에는 다음 주소가 있다.

```text
0x060417A4
0x06041D68
0x06042198
0x06041C5C
0x06041F30
0x06041E84
0x06041E18
```

`0x060417A4`, `0x06041C5C`, `0x06041F30`은 단일 리소스 로더와 공통이다. 나머지는 분할 전송 준비, 전송량 조회, 전송 종료 또는 버퍼 진행 함수일 가능성이 있다. 정확한 역할은 복합 로더의 loop와 각 라이브러리 함수의 반환값 사용을 더 해석해야 한다.

## 패치 설계에 미치는 영향

- 일반 리소스의 읽기 크기는 내부 payload 길이가 아니라 섹터 테이블의 다음 경계로 결정된다.
- 같은 섹터 할당량 안에서는 payload를 늘려도 로더 변경이 필요하지 않을 수 있다.
- 할당 섹터 수가 바뀌면 해당 경계 이후의 테이블 값을 갱신해야 한다.
- 일반 로더는 파일 상대 섹터를 사용하므로 파일 `1`의 ISO LBA가 유지되는 한 개별 리소스 재배치는 테이블 변경으로 처리할 가능성이 있다.
- u16 경계 테이블은 65,535섹터를 넘는 위치를 직접 표현할 수 없다. 후반 데이터는 별도 range pair/고위 비트 보정 경로를 사용하므로 일반 리소스와 같은 방식으로 재배치하면 안 된다.

## 다음 확인 항목

1. 파일 `1` 핸들이 `0x06077BD4`에 설정되는 open 루틴을 찾는다. **완료: `0x060416BC(3)`.**
2. file ID 3과 ISO 엔트리 `1`의 대응 규칙을 확인한다.
3. `0x0602E620`의 range 초기화 결과가 저장되는 전역 배열 구조를 확정한다.
4. `0x060417A4` 등 CD 라이브러리 함수의 호출부를 비교해 임시 함수명을 확정한다.
5. 대표 상위 호출부에서 상수 리소스 ID와 목적지 RAM 주소를 추적한다.
