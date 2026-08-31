# 45. 플랫폼 차이 일반 대사 4개 SS 원문 추출

## 추출 정보

현재 통합판 `output/ss-fs2-korean-ui-complete.bin`에서 메시지 `1018`, `5040`, `5042`, `6093`의 200×48 2bpp 마스크를 직접 추출했다.

- 도구: `scripts/ss-fs2-message-mask-tool.js`
- 확인용 PNG는 원본 인덱스를 명암으로 변환하고 3배 정수 확대했다.
- 디렉터리: `output/ss-fs2-platform-dialogue-originals/`

## 메시지 1018

```text
左右またはＬＲで選んでＣボタンで決定よ
```

의미:

```text
좌우 또는 L/R로 선택하고 C버튼으로 결정해.
```

기존 PS1 번역:

```text
방향키의 좌우 또는 L1,
R1 버튼으로 선택해서
O버튼으로 결정하면돼.
```

플랫폼 조작 버튼이 실제로 다르므로 SS 전용 번역이 필요하다.

## 메시지 5040

```text
とある大金持の屋敷に、今夜強盗が入るというタレ込みがあった。
```

의미:

```text
어느 큰 부잣집 저택에 오늘 밤 강도가 든다는 제보가 있었다.
```

기존 PS1 번역:

```text
어느 부잣집에, 오늘밤 강도가
들어온다는 편지가 왔다. 그래서,
```

`タレ込み`는 편지 자체보다 제보·밀고에 가깝다. SS 원문에는 기존 번역 끝의 `그래서,`가 없다.

## 메시지 5042

```text
どこの大金持？
```

의미:

```text
어느 부잣집?
```

기존 PS1 번역과 의미가 같다.

## 메시지 6093

```text
水着？そうか、そういえば明日は浜開きだったな
```

의미:

```text
수영복? 그렇군, 그러고 보니 내일은 해변 개장일이었지.
```

기존 PS1 번역:

```text
수영복? 그렇지, 그리고 보니
내일은 해변축제가
열리는 날이군.
```

`浜開き`는 해변 또는 해수욕장 개장 행사를 뜻한다. `해변축제`로 의역할 수도 있지만 `해변 개장일`이 원문에 더 가깝다.

## 산출 이미지

```text
output/ss-fs2-platform-dialogue-originals/message-mask-1018.png
output/ss-fs2-platform-dialogue-originals/message-mask-5040.png
output/ss-fs2-platform-dialogue-originals/message-mask-5042.png
output/ss-fs2-platform-dialogue-originals/message-mask-6093.png
```

번역 문구를 확정한 후 기존 12px 글꼴과 reveal 확장 방식을 그대로 사용해 SS 전용 PGM 4개를 생성한다.

