#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
SLPS-01903 리소스 829 및 기타 리소스의 고유명사(캐릭터/몬스터/직업/NPC/상태이상/
아이템/마법/장비창 캐릭터명/장비 스탯 라벨/스테이지 명칭) 테이블 export/patch 도구.

포맷 (라이브 디버깅으로 확인됨), 리소스 829 payload 안에 서로 다른 여덟 개의
1bpp 이름 비트맵 테이블이 있다:

  table "char" (캐릭터/NPC 개인 이름):
    오프셋 0x55D0(21968)부터, ID 1..30, 항목당 160바이트 = 80x16 픽셀.
    주소 공식: basePointer + (ID-1)*160 + 21968

  table "mon" (몬스터/직업/기타 종족명):
    오프셋 26960(0x6950)부터, ID 0..75, 항목당 224바이트 = 112x16 픽셀.
    주소 공식: basePointer + ID*224 + 26960

  table "status" (상태이상 이름, 정상/기절/독 등):
    오프셋 0xAAF0(43760)부터, ID 0..11, 항목당 64바이트 = 32x16 픽셀.
    주소 공식: basePointer + ID*64 + 43760

  table "item" (아이템/무기/방어구 이름):
    오프셋 0xADF0(44528, status 테이블 바로 뒤)부터, ID 0..168, 항목당
    240바이트 = 120x16 픽셀. ID 139..153은 미사용 "予備"(예비) 슬롯.
    주소 공식: basePointer + ID*240 + 44528

  table "magic" (마법/스킬 이름):
    오프셋 0x13A0(5024)부터, ID 0..62, 항목당 240바이트 = 120x16 픽셀
    (item 테이블과 같은 15바이트/행 stride). 중간중간(5..7, 14..17,
    35..37, 41..42, 45..48, 55..61 등) 미사용 빈 슬롯이 섞여 있다.
    주소 공식: basePointer + ID*240 + 5024
    be-hdr-ui-1179/1180(둘 다 완전히 동일한 내용) UI가 이 마법명을
    표시할 때, 1179/1180 리소스 자체는 이름 비트맵이 아니라 글자 폭
    등 별도 메타데이터 테이블이었다 — 실제 그림은 여전히 829 안에 있다.

  table "equip_char" (장비 디테일 화면의 캐릭터명 + 장비 대상 필터 라벨):
    오프셋 0xCE0(3296)부터, ID 0..11, 항목당 144바이트 = 72x16 픽셀.
    ID 0..8은 캐릭터명(char 테이블과 다른, 더 작은 크기의 별도 비트맵),
    ID 9..11은 "全員"(전원)/"女性のみ"(여성만)/"魔術師以外"(마술사 제외)
    같은 장비 대상 필터 라벨이다. be-hdr-ui-1176 UI에서 쓰인다.
    주소 공식: basePointer + ID*144 + 3296

  table "equip_stat" (장비 디테일 화면의 스탯 라벨: 공격력/방어력/속성 등):
    오프셋 0x6E0(1760)부터, ID 0..11, 항목당 128바이트 = 64x16 픽셀.
    주소 공식: basePointer + ID*128 + 1760

  table "levelup_char" (레벨업 시 표시되는 "OO는" 전용 이름 비트맵,
  equip_char와 같은 9명 로스터지만 "は" 조사가 붙어 있어 완전히 별도
  비트맵이다):
    오프셋 0x4FA0(20384)부터, ID 0..8, 항목당 176바이트 = 88x16 픽셀.
    주소 공식: basePointer + ID*176 + 20384

  여덟 테이블 모두: 바이트 MSB부터 순서대로 1픽셀씩, bit=0 -> 잉크(글자),
  bit=1 -> 배경. 각 테이블 범위를 벗어나면 렌더링 시 노이즈만 나와 리소스
  829 안의 다른(이름이 아닌) 데이터로 확인되었다.

  table "stage_name" (세이브/로드 화면 등에 쓰이는 스테이지/챕터 명칭,
  리소스 829가 아니라 **리소스 1169**에 있음):
    오프셋 0x4870(18544)부터, ID -61..13 (75개), 항목당 304바이트 =
    152x16 픽셀(19바이트/행 stride). 빈틈 없이 이어지는 하나의 큰 표다.
    주소 공식: resource1169_base + 0x4870 + ID*304
    (이 테이블만 리소스 829가 아니므로 `resource_id` 필드로 별도 지정됨)

usage:
  export FS2_FILE.DAT SLPS_019.03 out.tsv maskDir
  render FontPath out.tsv [--font-size N]
  patch FS2_FILE.DAT SLPS_019.03 out.tsv outDat
"""

import csv
import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

RESOURCE_ID = 829
EXPORT_SCALE = 6

FS2_LBA = 223
FS2_SECTORS = 119472
SECTOR_SIZE = 2352
USER_OFFSET = 24
USER_SIZE = 2048

# 라이브 디버깅 + 시각 확인으로 얻은 원문(참고용, TSV에 기본값으로 채워짐).
KNOWN_JP_TEXT_CHAR = {
    1: "カリン", 2: "アル", 3: "アリス", 4: "サーラ", 5: "ラディッシュ",
    6: "ソフィア", 7: "ルル", 9: "???", 10: "T.T.", 11: "ソーン",
    12: "マクドガル", 13: "ガストン", 15: "マスター", 16: "まっする親父",
    17: "ショップ姉ちゃん", 18: "怒りのカリン", 19: "困ったアリス",
    20: "カトリーヌ", 21: "ベヒモス", 22: "デュマ", 23: "ジャン",
    24: "ドッペルゲンガー", 25: "アルヴィース", 26: "ソーン・ヴァイス",
    27: "ヒーちゃん", 28: "コカちゃん", 29: "ギルドマスター",
}

KNOWN_JP_TEXT_MON = {
    0: "魔法使い", 1: "剣士", 2: "ヒーラー", 3: "シャーマン", 4: "セイレーン",
    5: "盗賊", 6: "精霊使い", 7: "NPC", 8: "宝箱", 9: "金",
    10: "ブルースライム", 11: "グリーンスライム", 12: "アシッドスライム", 13: "グレイウーズ",
    14: "マッドジェリー", 15: "白猫", 16: "黒猫", 17: "三毛猫", 18: "コソドロ",
    19: "ゴロツキ", 20: "虎猫", 21: "ヒドラ", 22: "ハーピー", 23: "ベヒモス",
    24: "アーマゴーレム", 25: "ロックゴーレム", 26: "ストーンゴーレム", 27: "ゴースト",
    28: "スペクター", 29: "フェアリー", 30: "ピクシー", 31: "ネクロマンサー",
    32: "デスウォリアー", 33: "グール", 36: "迷子の子供", 37: "かじ屋見習い",
    38: "囚人", 43: "インプ", 44: "グレムリン", 45: "囚人", 46: "デーモン",
    47: "ハーピー", 48: "レッドクラブ", 49: "ギルドマスター", 50: "コカトリス",
    51: "ソーサラー", 52: "アルケミスト", 53: "スプライト", 55: "チンピラ",
    56: "ウィザード", 57: "ペイルクラブ", 58: "ウォーロック", 60: "デブ猫",
    61: "サッキュバス", 62: "ストレンジャー", 64: "ドッペルゲンガー", 65: "アークデーモン",
    66: "エンジェル", 67: "アークエンジェル", 68: "堕天使", 69: "デモンロード",
    70: "パイレーツ", 71: "バイキング", 72: "セラフ", 73: "セラフ",
}

KNOWN_JP_TEXT_STATUS = {
    0: "正常", 1: "気絶", 2: "毒化", 3: "眠り", 4: "石化",
    5: "凍結", 6: "沈黙", 7: "魅了", 8: "マヒ", 9: "透明",
    10: "俊敏", 11: "浮遊",
}

KNOWN_JP_TEXT_ITEM = {
    0: "薬草", 1: "毒消し", 2: "妖精の涙", 3: "カボチャの種", 4: "回復薬",
    5: "癒しの花", 6: "気付け薬", 7: "ウオッカ", 8: "ブランデー",
    9: "ロングソード", 10: "ブロードソード", 11: "バスタードソード", 12: "クレイモアー",
    13: "フランベルジュ", 14: "グレートソード", 15: "アイスブレード", 16: "フレイムソード",
    17: "サンダーブレード", 18: "ゴッドスレイヤー", 19: "パワーリスト", 20: "ブラスナックル",
    21: "バグナグ", 22: "アイアンフィスト", 23: "シルバーファング", 24: "ドラゴンクロー",
    25: "明鏡止水の拳", 26: "アースバインダー", 27: "スタングラブ", 28: "魔人の手袋",
    29: "魔法使いの杖", 30: "魔術師の杖", 31: "炎術士の杖", 32: "アルケミストの杖",
    33: "縛炎の杖", 34: "賢者の杖", 35: "深紅の杖", 36: "エルシェーラの杖",
    37: "チェーンウィップ", 38: "金槌", 39: "バイク", 40: "ジャベリン",
    41: "トライデント", 42: "バトルフォーク", 43: "ヴージ", 44: "バトルランス",
    45: "ハルバード", 46: "トリトーン", 47: "ヴァルキリア", 48: "グングニル",
    49: "手袋", 50: "ミトン", 51: "手首丈グラブ", 52: "イブニンググラブ",
    53: "ゴーントレット", 54: "ロイヤルグラブ", 55: "ミスリルショーティ", 56: "フェザーコート",
    57: "堕天使の指輪", 58: "ブロンズメイル", 59: "おもちゃの杖", 60: "ステッキ",
    61: "夢見る杖", 62: "妖精さんの杖", 63: "無口な杖", 64: "真っ黒な杖",
    65: "変な色の杖", 66: "お友達の杖", 67: "鳥になる杖", 68: "すごい杖",
    69: "ダガー", 70: "シルバーダガー", 71: "グラディウス", 72: "ポイズンダガー",
    73: "ドリームナイフ", 74: "フライングダガー", 75: "ツインダガー", 76: "小鉄",
    77: "ソウルバスター", 78: "予備", 79: "クロスアーマー", 80: "ソフトレザー",
    81: "ハードレザー", 82: "リングメイル", 83: "スケールアーマー", 84: "ブレストアーマー",
    85: "スプリントメイル", 86: "チェインメイル", 87: "バンデッドメイル", 88: "プレートメイル",
    89: "コールドチェイン", 90: "ミスリルチェイン", 91: "ドラゴンスケール", 92: "ホーリープレート",
    93: "ゴッズメイル", 94: "レオタード", 95: "ハントジャケット", 96: "シェイド",
    97: "シルクローブ", 98: "ファインローブ", 99: "アーミングコート", 100: "武道着",
    101: "龍の道着", 102: "ジンの衣", 103: "バトルスーツ", 104: "ワンピース",
    105: "ドレス", 106: "パーティドレス", 107: "チャイナドレス", 108: "天使の羽衣",
    109: "子供服", 110: "チョッキ", 111: "魔法使いの服", 112: "魔術師の服",
    113: "達人の服", 114: "炎のローブ", 115: "大魔導師の服", 116: "賢者のローブ",
    117: "レジストリング", 118: "プロテクトリング", 119: "灼熱の指輪", 120: "氷雪の指輪",
    121: "疾風の指輪", 122: "大地の指輪", 123: "降魔の指輪", 124: "慈愛の指輪",
    125: "ジンの腕輪", 126: "破魔の腕輪", 127: "煉獄の腕輪", 128: "時空の腕輪",
    129: "敵剣A", 130: "敵剣B", 131: "敵剣C", 132: "敵剣D", 133: "敵剣E",
    134: "敵槍A", 135: "敵槍B", 136: "敵槍C", 137: "敵槍D", 138: "敵槍E",
    139: "予備", 140: "予備", 141: "予備", 142: "予備", 143: "予備",
    144: "予備", 145: "予備", 146: "予備", 147: "予備", 148: "予備",
    149: "予備", 150: "予備", 151: "予備", 152: "予備", 153: "予備",
    154: "マッシュルーム", 155: "魔導書", 156: "力の実", 157: "守護石",
    158: "百科事典", 159: "タリスマン", 160: "魔力回復剤", 161: "ソーマの花",
    162: "エリクサー", 163: "何か(体験版用)", 164: "焦熱の首飾り", 165: "水晶の首飾り",
    166: "稲妻の首飾り", 167: "地脈の首飾り", 168: "祝福の首飾り",
}

KNOWN_JP_TEXT_MAGIC = {
    0: "フレイムバースト", 1: "メルト", 2: "ヒートブレード", 3: "エクスプロージョン",
    4: "フラッシュ", 8: "イフリート", 9: "ピュリファイ", 10: "フリーズ",
    11: "ブリザード", 12: "レストア", 13: "マカブルダンス", 18: "スノードラゴン",
    19: "ライトニング", 20: "ヘイスト", 21: "エイド", 22: "ミュート",
    23: "ララバイ", 24: "チアリング", 25: "サンダードラゴン", 27: "サイレンス",
    28: "バニッシュ", 29: "ストーンエッジ", 30: "オーダー", 31: "アース",
    32: "プロテクション", 33: "ガスクラウド", 34: "レビテート", 38: "メテオ",
    39: "ヒーリング", 40: "リザレクション", 43: "マジックシールド", 44: "リカバリー",
    49: "ベトロクラウド", 50: "ホールド", 51: "パペット", 52: "ダークフォース",
    53: "滅神乱舞", 54: "ライフスティール", 62: "デス・モーメント",
}

KNOWN_JP_TEXT_EQUIP_CHAR = {
    0: "カリン", 1: "アル", 2: "アリス", 3: "サーラ", 4: "ラディッシュ",
    5: "ソフィア", 6: "ルル", 7: "ソーン", 8: "ジャン", 9: "全員",
    10: "女性のみ", 11: "魔術師以外",
}

KNOWN_JP_TEXT_LEVELUP_CHAR = {
    0: "カリンは", 1: "アルは", 2: "アリスは", 3: "サーラは", 4: "ラディッシュは",
    5: "ソフィアは", 6: "ルルは", 7: "ソーンは", 8: "ジャンは",
}

KNOWN_JP_TEXT_EQUIP_STAT = {
    0: "攻撃力", 1: "防御力", 2: "知力", 3: "魔抗力", 4: "敏捷さ",
    5: "火の属性", 6: "水の属性", 7: "風の属性", 8: "土の属性",
    9: "光の属性", 10: "闇の属性", 11: "移動力",
}

KNOWN_JP_TEXT_STAGE_NAME = {
    -61: "仕事をください", -60: "初仕事", -59: "夜は更けて", -58: "ギルドマスター",
    -57: "ババは心配性", -56: "家出娘はいずこ", -55: "アリス誘拐!?", -54: "倉庫での戦闘",
    -53: "街は眠る", -52: "家出お嬢様参戦", -51: "泥だらけの戦い", -50: "乙女の怒り",
    -49: "私お嫁に行くわ", -48: "押し掛け爆弾娘参戦", -47: "ストーカーにご用心",
    -46: "ガストンの災難", -45: "愛しのカトリーヌ", -44: "カトリーヌ安静",
    -43: "カリン、スカウトに行く", -42: "想いを歌に", -41: "ホールでの戦い",
    -40: "屋根の上の戦い", -39: "アリス奪還作戦!", -38: "ボートハウスの死闘",
    -37: "アリス救出の夜", -36: "お気楽羽娘参戦", -35: "水着が欲しい",
    -34: "カトリーヌ逆襲!", -33: "今夜見る夢は・・・?", -32: "心の傷",
    -31: "鉱山の魔獣", -30: "地底の支配者", -29: "光を求めて", -28: "トロッコでGO!",
    -27: "二日ぶりの帰還", -26: "祭の朝", -25: "栄冠は誰の手に", -24: "カニが来た",
    -23: "宴の後", -22: "ある親方の死", -21: "サウナで汗を流そう", -20: "男は強く逞しく",
    -19: "ジャンの凱旋", -18: "朝風呂で爽やか", -17: "あなたはだあれ?",
    -16: "闘いすんで日が暮れて", -15: "遠い日の約束", -14: "ゴーストバスターズ出動",
    -13: "堕天使v.s.堕天使", -12: "嵐の前夜", -11: "最後の休日", -10: "出港直前",
    -9: "灯台1階の戦闘", -8: "灯火再び", -7: "灯台2階の戦闘", -6: "灯台3階の戦闘",
    -5: "海上の決戦", -4: "ギルドの人さらい?", -3: "アリス危機一髪!", -2: "暗黒街",
    -1: "地下牢を目指せ", 0: "炊事場でバトル", 1: "二階突入!", 2: "低血圧な人々",
    3: "ギルド大決戦!", 4: "ただ一つの真実", 5: "裁きを下す者", 6: "時を視る者",
    7: "アルのいない朝", 8: "仲間と共に", 9: "天空へと駆ける", 10: "長き彷徨の果てに",
    11: "復讐の天使", 12: "アルの戦い", 13: "時と空間の狭間で",
}

TABLES = {
    "char": {
        "offset": 0x55D0,
        "entry_size": 160,
        "start_id": 1,
        "count": 30,
        "width": 80,
        "height": 16,
        "id_delta": -1,
        "jp_text": KNOWN_JP_TEXT_CHAR,
    },
    "mon": {
        "offset": 26960,
        "entry_size": 224,
        "start_id": 0,
        "count": 76,
        "width": 112,
        "height": 16,
        "id_delta": 0,
        "jp_text": KNOWN_JP_TEXT_MON,
    },
    "status": {
        "offset": 0xAAF0,
        "entry_size": 64,
        "start_id": 0,
        "count": 12,
        "width": 32,
        "height": 16,
        "id_delta": 0,
        "jp_text": KNOWN_JP_TEXT_STATUS,
    },
    "item": {
        "offset": 0xADF0,
        "entry_size": 240,
        "start_id": 0,
        "count": 169,
        "width": 120,
        "height": 16,
        "id_delta": 0,
        "jp_text": KNOWN_JP_TEXT_ITEM,
    },
    "magic": {
        "offset": 0x13A0,
        "entry_size": 240,
        "start_id": 0,
        "count": 63,
        "width": 120,
        "height": 16,
        "id_delta": 0,
        "jp_text": KNOWN_JP_TEXT_MAGIC,
    },
    "equip_char": {
        "offset": 0xCE0,
        "entry_size": 144,
        "start_id": 0,
        "count": 12,
        "width": 72,
        "height": 16,
        "id_delta": 0,
        "jp_text": KNOWN_JP_TEXT_EQUIP_CHAR,
    },
    "levelup_char": {
        "offset": 0x4FA0,
        "entry_size": 176,
        "start_id": 0,
        "count": 9,
        "width": 88,
        "height": 16,
        "id_delta": 0,
        "jp_text": KNOWN_JP_TEXT_LEVELUP_CHAR,
    },
    "equip_stat": {
        "offset": 0x6E0,
        "entry_size": 128,
        "start_id": 0,
        "count": 12,
        "width": 64,
        "height": 16,
        "id_delta": 0,
        "jp_text": KNOWN_JP_TEXT_EQUIP_STAT,
    },
    "stage_name": {
        "resource_id": 1169,
        "offset": 0x4870,
        "entry_size": 304,
        "start_id": -61,
        "count": 75,
        "width": 152,
        "height": 16,
        "id_delta": 0,
        "jp_text": KNOWN_JP_TEXT_STAGE_NAME,
    },
}


def unescape_tsv(value):
    marker = ""
    return (value or "").replace("\\\\", marker).replace("\\n", "\n").replace("\\t", "\t").replace(marker, "\\")


def escape_tsv(value):
    return (value or "").replace("\\", "\\\\").replace("\t", "\\t").replace("\r", "").replace("\n", "\\n")


def read_tsv_rows(tsv_path):
    with open(tsv_path, encoding="utf-8", newline="") as f:
        reader = csv.reader(f, delimiter="\t")
        rows = list(reader)
    if not rows:
        return [], []
    headers = rows[0]
    dict_rows = [{h: unescape_tsv(row[i] if i < len(row) else "") for i, h in enumerate(headers)} for row in rows[1:] if any(row)]
    return headers, dict_rows


def write_tsv_rows(tsv_path, headers, rows):
    Path(tsv_path).parent.mkdir(parents=True, exist_ok=True)
    with open(tsv_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, delimiter="\t", lineterminator="\n")
        writer.writerow(headers)
        for row in rows:
            writer.writerow([escape_tsv(row.get(h, "")) for h in headers])


def read_dat_payload(path):
    data = Path(path).read_bytes()
    expected_size = FS2_SECTORS * USER_SIZE
    if len(data) == expected_size:
        return data
    last_read_end = (FS2_LBA + FS2_SECTORS - 1) * SECTOR_SIZE + USER_OFFSET + USER_SIZE
    if last_read_end > len(data):
        raise ValueError(f"{path} is neither FS2_FILE.DAT ({expected_size} bytes) nor a raw BIN containing FS2 at LBA {FS2_LBA}")
    out = bytearray(expected_size)
    for sector in range(FS2_SECTORS):
        src_off = (FS2_LBA + sector) * SECTOR_SIZE + USER_OFFSET
        dst_off = sector * USER_SIZE
        out[dst_off:dst_off + USER_SIZE] = data[src_off:src_off + USER_SIZE]
    print(f"extracted FS2 payload from raw BIN input {path} ({len(out)} bytes)")
    return bytes(out)


def resource_byte_start(exe_bytes, resource_id):
    load_addr = struct.unpack_from("<I", exe_bytes, 0x18)[0]
    table_off = 0x801C4F68 - load_addr + 0x800
    off = table_off + resource_id * 2
    start_sector = struct.unpack_from("<H", exe_bytes, off)[0]
    return start_sector * 0x800


def entry_offset(exe_bytes, table_key, entry_id):
    cfg = TABLES[table_key]
    base = resource_byte_start(exe_bytes, cfg.get("resource_id", RESOURCE_ID))
    return base + cfg["offset"] + (entry_id + cfg["id_delta"]) * cfg["entry_size"]


def unpack_bits(chunk, width, height):
    width_bytes = width // 8
    pixels = []
    for row in range(height):
        for colbyte in range(width_bytes):
            b = chunk[row * width_bytes + colbyte]
            for bit in range(8):
                pixels.append((b >> (7 - bit)) & 1)
    return pixels


def pack_bits(pixels, width, height):
    width_bytes = width // 8
    out = bytearray(width_bytes * height)
    for row in range(height):
        for colbyte in range(width_bytes):
            byte_val = 0
            for bit in range(8):
                idx = row * width + colbyte * 8 + bit
                byte_val |= (pixels[idx] & 1) << (7 - bit)
            out[row * width_bytes + colbyte] = byte_val
    return bytes(out)


def chunk_to_image(chunk, width, height):
    pixels = unpack_bits(chunk, width, height)
    img = Image.new("L", (width, height))
    img.putdata([0 if v == 0 else 255 for v in pixels])
    return img


def image_to_chunk(img, width, height):
    if img.size != (width, height):
        img = img.convert("L").resize((width, height), Image.NEAREST)
    else:
        img = img.convert("L")
    pixels = [0 if p < 128 else 1 for p in img.getdata()]
    return pack_bits(pixels, width, height)


def export_tsv(dat_path, exe_path, out_tsv, mask_dir):
    dat = read_dat_payload(dat_path)
    exe = Path(exe_path).read_bytes()
    mask_dir = Path(mask_dir)
    mask_dir.mkdir(parents=True, exist_ok=True)

    headers = ["enabled", "table", "id", "jp_text", "source_png", "replacement_png", "ko_text", "font_size"]

    existing = {}
    if Path(out_tsv).exists():
        _, existing_rows = read_tsv_rows(out_tsv)
        for row in existing_rows:
            existing[(row.get("table", ""), row.get("id", ""))] = row

    rows = []
    total = 0
    for table_key, cfg in TABLES.items():
        for entry_id in range(cfg["start_id"], cfg["start_id"] + cfg["count"]):
            off = entry_offset(exe, table_key, entry_id)
            chunk = dat[off:off + cfg["entry_size"]]
            img = chunk_to_image(chunk, cfg["width"], cfg["height"])
            source_png = mask_dir / f"name-{table_key}-{entry_id:02d}.png"
            img.resize((cfg["width"] * EXPORT_SCALE, cfg["height"] * EXPORT_SCALE), Image.NEAREST).save(source_png)
            old = existing.get((table_key, str(entry_id)), {})
            rows.append({
                "enabled": old.get("enabled", "0"),
                "table": table_key,
                "id": str(entry_id),
                "jp_text": cfg["jp_text"].get(entry_id, ""),
                "source_png": str(source_png),
                "replacement_png": old.get("replacement_png", ""),
                "ko_text": old.get("ko_text", ""),
                "font_size": old.get("font_size", ""),
            })
            total += 1

    write_tsv_rows(out_tsv, headers, rows)
    print(f"wrote {out_tsv} ({total} rows across {len(TABLES)} tables) and source PNGs to {mask_dir}")


def fit_font(draw, text, font_path, max_width, max_height):
    for size in range(max_height, 5, -1):
        font = ImageFont.truetype(font_path, size, index=0)
        bbox = draw.textbbox((0, 0), text, font=font)
        if bbox[2] - bbox[0] <= max_width:
            return font, bbox
    font = ImageFont.truetype(font_path, 6, index=0)
    return font, draw.textbbox((0, 0), text, font=font)


def render_name_image(text, font_path, width, height, font_size=None):
    """Render text into an unscaled WIDTHxHEIGHT 'L' image (0=ink, 255=background)."""
    img = Image.new("L", (width, height), color=255)
    draw = ImageDraw.Draw(img)
    if font_size:
        font = ImageFont.truetype(font_path, int(font_size), index=0)
        bbox = draw.textbbox((0, 0), text, font=font)
    else:
        font, bbox = fit_font(draw, text, font_path, width, height)
    th = bbox[3] - bbox[1]
    x = -bbox[0]
    y = max(0, (height - th) // 2 - bbox[1])
    draw.text((x, y), text, font=font, fill=0)
    return img


def render_name_png(text, font_path, out_path, width, height, font_size=None, scale=EXPORT_SCALE):
    img = render_name_image(text, font_path, width, height, font_size)
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    img.resize((width * scale, height * scale), Image.NEAREST).save(out_path)
    return out_path


def render_replacement_pngs(font_path, tsv_path, font_size=None):
    headers, rows = read_tsv_rows(tsv_path)

    rendered = 0
    for row in rows:
        text = row.get("ko_text", "").strip()
        if not text:
            continue
        table_key = row.get("table", "char")
        cfg = TABLES[table_key]
        entry_id = int(row["id"])
        out_path = row.get("replacement_png", "").strip()
        if not out_path:
            source_png = Path(row["source_png"])
            out_path = str(source_png.with_name(f"name-{table_key}-{entry_id:02d}-ko.png"))
            row["replacement_png"] = out_path

        row_font_size = row.get("font_size", "").strip() or font_size
        render_name_png(text, font_path, out_path, cfg["width"], cfg["height"], row_font_size)
        rendered += 1
        print(f"{table_key} id {entry_id}: rendered '{text}' -> {out_path}")

    write_tsv_rows(tsv_path, headers, rows)
    print(f"rendered {rendered} replacement PNGs, updated {tsv_path}")


def patch(dat_path, exe_path, tsv_path, out_dat):
    dat = bytearray(read_dat_payload(dat_path))
    exe = Path(exe_path).read_bytes()
    applied = 0
    _, rows = read_tsv_rows(tsv_path)
    for row in rows:
        if row.get("enabled", "0").strip() != "1":
            continue
        table_key = row.get("table", "char")
        cfg = TABLES[table_key]
        entry_id = int(row["id"])
        replacement_png = row.get("replacement_png", "").strip()
        if not replacement_png or not Path(replacement_png).exists():
            print(f"[skip] {table_key} id {entry_id}: replacement_png missing or not found ({replacement_png})")
            continue
        off = entry_offset(exe, table_key, entry_id)
        img = Image.open(replacement_png)
        chunk = image_to_chunk(img, cfg["width"], cfg["height"])
        dat[off:off + cfg["entry_size"]] = chunk
        applied += 1
        print(f"patched {table_key} id {entry_id}: {replacement_png}")

    Path(out_dat).parent.mkdir(parents=True, exist_ok=True)
    Path(out_dat).write_bytes(dat)
    print(f"applied {applied} entries, wrote {out_dat}")


def main(argv):
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        raise SystemExit(2)
    mode = argv[1]
    if mode == "export":
        if len(argv) < 6:
            print(__doc__, file=sys.stderr)
            raise SystemExit(2)
        export_tsv(argv[2], argv[3], argv[4], argv[5])
    elif mode == "render":
        if len(argv) < 4:
            print(__doc__, file=sys.stderr)
            raise SystemExit(2)
        font_size = None
        if "--font-size" in argv:
            font_size = int(argv[argv.index("--font-size") + 1])
        render_replacement_pngs(argv[2], argv[3], font_size)
    elif mode == "patch":
        if len(argv) < 6:
            print(__doc__, file=sys.stderr)
            raise SystemExit(2)
        patch(argv[2], argv[3], argv[4], argv[5])
    else:
        print(__doc__, file=sys.stderr)
        raise SystemExit(2)


if __name__ == "__main__":
    main(sys.argv)
