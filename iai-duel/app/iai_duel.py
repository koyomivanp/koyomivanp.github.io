# /// script
# requires-python = ">=3.11"
# dependencies = ["flet[all]>=0.84.0", "flet-audio>=0.84.0", "httpx>=0.27"]
# ///
#
# 刹那の見切り ― 居合ゴースト対戦（自由課題 / カービィ「刹那の見切り」リスペクト）
#   タイトル画面から CPU戦 / 対人戦 / ランキング を選ぶ。
#   待ち時間は毎回ランダム（緊張感重視）。対戦カード→「いざ、尋常に」→静寂→合図「！」。
#   - CPU 戦＝突破式。1人倒すごとに相手が速くなる。1敗or フライングで終了（何人抜き）
#   - 対人戦（保存された他人のゴーストと勝負・連勝が伸びるほど強敵に）
#   - 保存するのは「戦った人の記録」だけ。ニックネーム未設定なら有名キャラ名を自動付与
#   - 同じ名前は「速い方」で上書き。対人戦の連勝ランキングあり
#   - 風の音BGM（ループ）＋「！」の瞬間にハリセン風SE（wavは自動生成）
#
# 実行: uv run iai_duel.py

import asyncio
import json
import math
import os
import random
import struct
import time
import wave
from pathlib import Path

import flet as ft
import flet.canvas as cv
import flet_audio as fa
import httpx

# Web 配信フラグ（レイアウトや起動モードの参考）。音声はモバイル/Web でも有効にし、
# ユーザー操作後に再生する（autoplay 禁止ポリシー対策）。
IS_WEB = bool(os.getenv("FLET_FORCE_WEB_SERVER") or os.getenv("WEB_MODE"))

# ===== Supabase 設定 =====
SUPABASE_URL = "https://mjattwfxzpefgklbqlpz.supabase.co"
SUPABASE_ANON_KEY = "sb_publishable_d5SnRIbuJGfntfjOObIWWw_iKR0GOt9"
TABLE = "iai_scores"
STREAK_TABLE = "iai_streaks"
AVATAR_TABLE = "iai_avatars"
BUCKET = 1  # 居合（刹那の見切り）の反応時間ランキング
TRACE_BUCKET = 2  # なぞり斬りの斬撃スコアランキング（同じテーブルを pattern_id で分離）
TRACE_BASE = 300  # 斬撃力の基準。斬撃力＝TRACE_BASE−（内部ブレ値）。大きいほど鋭い
CANVAS_SIZE = 260  # 自画像キャンバスの基準サイズ（保存座標もこの基準）
TRACE_SIZE = 300  # なぞり斬りのキャンバス基準サイズ

# なぞり斬りの手本パターン（TRACE_SIZE 基準の折れ線。全員共通＝非同期で公平）
TRACE_PATTERNS = [
    {"name": "袈裟斬り", "pts": [[250, 55], [60, 245]]},
    {"name": "横一文字", "pts": [[45, 150], [255, 150]]},
    {"name": "逆袈裟", "pts": [[55, 250], [245, 60]]},
    {"name": "唐竹割り", "pts": [[150, 45], [150, 255]]},
    {"name": "燕返し", "pts": [[55, 70], [150, 250], [245, 70]]},
    {"name": "稲妻斬り", "pts": [[60, 65], [240, 65], [60, 235], [240, 235]]},
]

# 待ち時間はこの中からランダムに選ぶ（±JITTER でさらにぶらす）
WAITS = [3.0, 5.0, 7.0, 10.0, 15.0]
JITTER = 0.4

CPU_CLEAR = 5           # この人数を倒せばCPU戦クリア
# 突破式CPUの強さ。撃破数 k が増えるほど平均反応が速くなる（5人目が最難関）。
CPU_BASE_MEAN = 520.0   # 1人目（最弱）の平均反応(ms)
CPU_STEP = 58.0         # 1人倒すごとに速くなる量(ms)
CPU_MIN_MEAN = 280.0    # これより速くはならない（5人目で0.3秒を少し切る）


def cpu_params(k: int) -> dict:
    return {"mean": max(CPU_MIN_MEAN, CPU_BASE_MEAN - CPU_STEP * k),
            "sd": max(20.0, 70.0 - 8.0 * k)}

# プレイヤーの自動ニックネーム候補（大衆受けする有名キャラ＋誰でも知る偉人）
NAME_POOL = [
    # ゲーム（国民的）
    "マリオ", "ルイージ", "ピーチ姫", "ヨッシー", "リンク", "カービィ",
    "ピカチュウ", "パックマン", "ソニック", "クッパ",
    # アニメ・漫画（大衆向け）
    "ドラえもん", "のび太", "アンパンマン", "バイキンマン", "孫悟空", "ルフィ",
    "ナルト", "炭治郎", "コナン", "しんちゃん", "サザエさん", "セーラームーン",
    "トトロ", "ジバニャン",
    # 有名キャラ
    "キティ", "ミッキー", "くまモン", "ピングー",
    # 誰でも知る偉人
    "織田信長", "豊臣秀吉", "徳川家康", "坂本龍馬", "ナポレオン",
    "アインシュタイン", "エジソン", "クレオパトラ", "ダ・ヴィンチ", "リンカーン",
]

# CPU（敵）として登場する剣士たち：幕末志士・歴史の剣豪・剣使い
CPU_NAMES = [
    "宮本武蔵", "佐々木小次郎", "柳生宗矩", "柳生十兵衛", "塚原卜伝",
    "伊藤一刀斎", "上泉信綱", "千葉周作", "伊東甲子太郎",
    "沖田総司", "土方歳三", "斎藤一", "永倉新八", "近藤勇",
    "岡田以蔵", "河上彦斎", "田中新兵衛", "桂小五郎", "高杉晋作",
    "坂本龍馬", "武市半平太", "服部半蔵", "前田慶次", "真田幸村",
    "上杉謙信", "本多忠勝", "立花宗茂",
]

ASSETS_DIR = Path(__file__).resolve().parent / "assets"

# ゲーム内の進行状態
VS = "vs"
IZA = "iza"
WAITING = "waiting"
GO = "go"
REVEAL = "reveal"  # 抜刀演出中（タップ無効）
RESULT = "result"
FOUL = "foul"


# ---------- 効果音/BGM の wav を標準ライブラリだけで生成 ----------
def _write_wav(path: Path, samples: list[float], rate: int = 22050) -> None:
    with wave.open(str(path), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = bytearray()
        for s in samples:
            frames += struct.pack("<h", int(max(-1.0, min(1.0, s)) * 32767))
        w.writeframes(bytes(frames))


def _make_wind(rate: int = 22050, dur: float = 4.0) -> list[float]:
    n = int(rate * dur)
    brown, last = [], 0.0
    for _ in range(n):
        last = max(-1.0, min(1.0, (last + 0.02 * random.uniform(-1, 1)) * 0.995))
        brown.append(last)
    mx = max((abs(x) for x in brown), default=1.0) or 1.0
    out = []
    for i in range(n):
        gust = 0.5 + 0.5 * math.sin(2 * math.pi * (i / n) * 2)
        out.append((brown[i] / mx) * (0.3 + 0.7 * gust) * 0.6)
    xf = int(rate * 0.4)
    head, tail, body = out[:xf], out[-xf:], out[xf:-xf]
    mixed = [tail[i] * (1 - i / xf) + head[i] * (i / xf) for i in range(xf)]
    return mixed + body


def _make_slap(rate: int = 22050, dur: float = 0.15) -> list[float]:
    n = int(rate * dur)
    out = []
    for i in range(n):
        env = math.exp(-i / (rate * 0.02))
        noise = random.uniform(-1, 1)
        click = math.sin(2 * math.pi * 180 * (i / rate)) * math.exp(-i / (rate * 0.01))
        out.append((noise * 0.9 + click * 0.5) * env)
    mx = max((abs(x) for x in out), default=1.0) or 1.0
    return [x / mx * 0.95 for x in out]


def _make_win(rate: int = 22050, dur: float = 0.5) -> list[float]:
    """勝利の「シャキーン」。高→低へ滑る金属的な余韻。"""
    n = int(rate * dur)
    out = []
    for i in range(n):
        t = i / rate
        env = math.exp(-t / 0.18)
        f = 1800 * math.exp(-t / 0.25) + 700
        out.append((math.sin(2 * math.pi * f * t)
                    + 0.4 * math.sin(2 * math.pi * f * 1.5 * t)) * env * 0.6)
    mx = max((abs(x) for x in out), default=1.0) or 1.0
    return [x / mx * 0.9 for x in out]


def _make_lose(rate: int = 22050, dur: float = 0.45) -> list[float]:
    """敗北の「ドサッ」。低い衝撃音＋ノイズ。"""
    n = int(rate * dur)
    out = []
    for i in range(n):
        t = i / rate
        env = math.exp(-t / 0.15)
        out.append((math.sin(2 * math.pi * 90 * t) + random.uniform(-1, 1) * 0.5)
                   * env * 0.8)
    mx = max((abs(x) for x in out), default=1.0) or 1.0
    return [x / mx * 0.9 for x in out]


def _make_foul(rate: int = 22050, dur: float = 0.3) -> list[float]:
    """フライングのブザー音（矩形波）。"""
    n = int(rate * dur)
    out = []
    for i in range(n):
        t = i / rate
        sq = 1.0 if math.sin(2 * math.pi * 160 * t) >= 0 else -1.0
        env = 1.0 if t < dur - 0.05 else max(0.0, (dur - t) / 0.05)
        out.append(sq * 0.5 * env)
    return out


def _make_signal(rate: int = 22050, dur: float = 0.1) -> list[float]:
    """合図「！」— 鋭い打音（ハリセンより高く短い）。"""
    n = int(rate * dur)
    out = []
    for i in range(n):
        t = i / rate
        env = math.exp(-t / 0.018)
        tone = math.sin(2 * math.pi * 520 * t) * 0.7
        crack = random.uniform(-1, 1) * 0.45
        out.append((tone + crack) * env)
    mx = max((abs(x) for x in out), default=1.0) or 1.0
    return [x / mx * 0.98 for x in out]


def _make_clear(rate: int = 22050, dur: float = 0.75) -> list[float]:
    """突破クリアのファンファーレ。"""
    notes = [523.25, 659.25, 783.99, 1046.5]
    n = int(rate * dur)
    out = [0.0] * n
    step = n // (len(notes) + 1)
    for j, freq in enumerate(notes):
        start = j * step
        seg = int(rate * 0.14)
        for i in range(seg):
            idx = start + i
            if idx >= n:
                break
            t = i / rate
            env = math.exp(-t / 0.09) * (1.0 - j * 0.08)
            out[idx] += math.sin(2 * math.pi * freq * t) * env * 0.55
    mx = max((abs(x) for x in out), default=1.0) or 1.0
    return [x / mx * 0.92 for x in out]


def generate_assets() -> None:
    ASSETS_DIR.mkdir(exist_ok=True)
    builders = {"wind.wav": _make_wind, "slap.wav": _make_slap,
                "signal.wav": _make_signal, "win.wav": _make_win,
                "lose.wav": _make_lose, "foul.wav": _make_foul,
                "clear.wav": _make_clear}
    for fname, builder in builders.items():
        if not (ASSETS_DIR / fname).exists():
            _write_wav(ASSETS_DIR / fname, builder())


# ---------- Supabase ----------
def online() -> bool:
    return bool(SUPABASE_ANON_KEY)


def _headers(extra: dict | None = None) -> dict:
    h = {"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
         "Content-Type": "application/json"}
    if extra:
        h.update(extra)
    return h


async def sb_submit(name: str, ms: int, bucket: int = BUCKET) -> str:
    if not online():
        return "offline"
    base = f"{SUPABASE_URL}/rest/v1/{TABLE}"
    try:
        async with httpx.AsyncClient(timeout=10) as cli:
            g = await cli.get(base, headers=_headers(), params={
                "pattern_id": f"eq.{bucket}", "name": f"eq.{name}",
                "select": "id,reaction_ms", "limit": "1"})
            rows = g.json() if g.status_code == 200 else []
            if not rows:
                r = await cli.post(base, headers=_headers({"Prefer": "return=minimal"}),
                                   json=[{"pattern_id": bucket, "name": name,
                                          "reaction_ms": ms}])
                return "inserted" if r.status_code in (200, 201, 204) else "error"
            if ms < rows[0]["reaction_ms"]:
                r = await cli.patch(base, headers=_headers({"Prefer": "return=minimal"}),
                                    params={"id": f"eq.{rows[0]['id']}"},
                                    json={"reaction_ms": ms})
                return "updated" if r.status_code in (200, 204) else "error"
            return "kept"
    except httpx.HTTPError:
        return "error"


async def sb_top(limit: int = 10, bucket: int = BUCKET) -> list[dict] | None:
    if not online():
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as cli:
            r = await cli.get(f"{SUPABASE_URL}/rest/v1/{TABLE}", headers=_headers(),
                              params={"pattern_id": f"eq.{bucket}",
                                      "select": "name,reaction_ms",
                                      "order": "reaction_ms.asc", "limit": str(limit)})
        if r.status_code == 200:
            return r.json()
    except httpx.HTTPError:
        pass
    return None


async def sb_rank(ms: int, bucket: int = BUCKET) -> int | None:
    if not online():
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as cli:
            r = await cli.get(f"{SUPABASE_URL}/rest/v1/{TABLE}",
                              headers=_headers({"Prefer": "count=exact"}),
                              params={"pattern_id": f"eq.{bucket}",
                                      "reaction_ms": f"lt.{ms}", "select": "id",
                                      "limit": "1"})
        cr = r.headers.get("content-range", "")
        if "/" in cr and cr.split("/")[-1].isdigit():
            return int(cr.split("/")[-1]) + 1
    except httpx.HTTPError:
        pass
    return None


async def sb_streak_submit(name: str, streak: int) -> None:
    if not online():
        return
    base = f"{SUPABASE_URL}/rest/v1/{STREAK_TABLE}"
    try:
        async with httpx.AsyncClient(timeout=10) as cli:
            g = await cli.get(base, headers=_headers(), params={
                "name": f"eq.{name}", "select": "streak", "limit": "1"})
            rows = g.json() if g.status_code == 200 else []
            if not rows:
                await cli.post(base, headers=_headers({"Prefer": "return=minimal"}),
                               json=[{"name": name, "streak": streak}])
            elif streak > rows[0]["streak"]:
                await cli.patch(base, headers=_headers({"Prefer": "return=minimal"}),
                                params={"name": f"eq.{name}"}, json={"streak": streak})
    except httpx.HTTPError:
        pass


async def sb_streak_top(limit: int = 10) -> list[dict] | None:
    if not online():
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as cli:
            r = await cli.get(f"{SUPABASE_URL}/rest/v1/{STREAK_TABLE}", headers=_headers(),
                              params={"select": "name,streak", "order": "streak.desc",
                                      "limit": str(limit)})
        if r.status_code == 200:
            return r.json()
    except httpx.HTTPError:
        pass
    return None


async def sb_avatar_submit(name: str, strokes_json: str) -> None:
    if not online():
        return
    base = f"{SUPABASE_URL}/rest/v1/{AVATAR_TABLE}"
    try:
        async with httpx.AsyncClient(timeout=10) as cli:
            g = await cli.get(base, headers=_headers(), params={
                "name": f"eq.{name}", "select": "name", "limit": "1"})
            rows = g.json() if g.status_code == 200 else []
            if not rows:
                await cli.post(base, headers=_headers({"Prefer": "return=minimal"}),
                               json=[{"name": name, "strokes": strokes_json}])
            else:
                await cli.patch(base, headers=_headers({"Prefer": "return=minimal"}),
                                params={"name": f"eq.{name}"},
                                json={"strokes": strokes_json})
    except httpx.HTTPError:
        pass


async def sb_avatar_get(name: str) -> str | None:
    if not online():
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as cli:
            r = await cli.get(f"{SUPABASE_URL}/rest/v1/{AVATAR_TABLE}", headers=_headers(),
                              params={"name": f"eq.{name}", "select": "strokes",
                                      "limit": "1"})
        if r.status_code == 200 and r.json():
            return r.json()[0]["strokes"]
    except httpx.HTTPError:
        pass
    return None


async def sb_my_best(name: str, bucket: int = BUCKET) -> int | None:
    if not online():
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as cli:
            r = await cli.get(f"{SUPABASE_URL}/rest/v1/{TABLE}", headers=_headers(),
                              params={"pattern_id": f"eq.{bucket}", "name": f"eq.{name}",
                                      "select": "reaction_ms", "limit": "1"})
        if r.status_code == 200 and r.json():
            return r.json()[0]["reaction_ms"]
    except httpx.HTTPError:
        pass
    return None


def fmt_sec(ms: int) -> str:
    return f"{ms / 1000:.3f}"


# ===== Mobile UI（スマホゲーム風レイアウト）=====
PALETTE = {
    "bg": "#050508",
    "surface": "#120A0C",
    "surface2": "#1A1018",
    "line": "#3A2030",
    "accent": "#FFD54F",
    "accent2": "#FF1744",
    "cyan": "#4DD0E1",
    "indigo": "#7E57C2",
    "green": "#66BB6A",
    "text": "#FFF8F0",
    "muted": "#9A8A8E",
    "blood": "#6B1018",
    "void": "#030305",
}
MIN_TAP = 48
PAGE_W = 390


def mob_w(page: ft.Page, ratio: float = 0.92) -> float:
    w = float(page.width or PAGE_W)
    return max(280.0, min(w, 430.0) * ratio)


def safe_pad(top: float = 8, bottom: float = 20, h: float = 16) -> ft.Padding:
    return ft.Padding(h, top, h, bottom)


def mob_card(content, **kw) -> ft.Container:
    return ft.Container(
        content=content,
        bgcolor=PALETTE["surface"],
        border_radius=16,
        padding=16,
        border=ft.Border.all(1, PALETTE["line"]),
        shadow=ft.BoxShadow(blur_radius=14, color="#00000055", offset=ft.Offset(0, 4)),
        **kw,
    )


def mode_tile(icon, title, subtitle, color, on_click, width=None) -> ft.Container:
    return ft.Container(
        width=width,
        height=112,
        bgcolor=PALETTE["surface2"],
        border_radius=16,
        padding=14,
        border=ft.Border.all(2, color),
        shadow=ft.BoxShadow(blur_radius=12, color=f"{color}44", offset=ft.Offset(0, 3)),
        ink=True,
        on_click=on_click,
        content=ft.Row(
            [
                ft.Container(
                    width=4, height=72, border_radius=2, bgcolor=color,
                ),
                ft.Column(
                    [
                        ft.Icon(icon, color=color, size=28),
                        ft.Text(title, size=16, weight=ft.FontWeight.BOLD, color=PALETTE["text"]),
                        ft.Text(subtitle, size=11, color=PALETTE["muted"]),
                    ],
                    spacing=3,
                    expand=True,
                    horizontal_alignment=ft.CrossAxisAlignment.START,
                ),
            ],
            spacing=10,
        ),
    )


def paper_notice(
    headline: str,
    subline: str,
    stamp: str,
    accent: str,
    width: float,
    height: float,
    rotate_deg: float,
    on_click,
) -> ft.Container:
    """江戸の掲示板に貼られた紙（張り紙）。"""
    rad = rotate_deg * math.pi / 180
    pin = ft.Container(
        width=10, height=10, border_radius=5,
        bgcolor="#8A7A60",
        border=ft.Border.all(1, "#5A4A30"),
        left=width / 2 - 5, top=-5,
    )
    return ft.Container(
        width=width,
        height=height,
        rotate=ft.Rotate(rad),
        ink=True,
        on_click=on_click,
        content=ft.Stack(
            [
                pin,
                ft.Container(
                    width=width,
                    height=height,
                    bgcolor="#F3EBD8",
                    border_radius=3,
                    padding=ft.Padding(10, 14, 10, 10),
                    border=ft.Border.all(1, "#C8B898"),
                    shadow=ft.BoxShadow(blur_radius=10, color="#00000055",
                                        offset=ft.Offset(3, 5)),
                    content=ft.Column(
                        spacing=4,
                        controls=[
                            ft.Row(
                                [
                                    ft.Container(
                                        width=28, height=28, border_radius=14,
                                        bgcolor=accent,
                                        alignment=ft.Alignment(0, 0),
                                        content=ft.Text(stamp, size=11,
                                                        weight=ft.FontWeight.BOLD,
                                                        color="#FFF8F0"),
                                    ),
                                    ft.Text(headline, size=17, weight=ft.FontWeight.BOLD,
                                            color="#2A1810", expand=True),
                                ],
                                spacing=8,
                                vertical_alignment=ft.CrossAxisAlignment.CENTER,
                            ),
                            ft.Container(height=1, bgcolor="#C8A878"),
                            ft.Text(subline, size=11, color="#5A4030"),
                            ft.Text("── 剥がして選ぶ ──", size=9, color="#9A8070"),
                        ],
                    ),
                ),
            ],
        ),
    )


def edo_bulletin_board(page: ft.Page, papers: list[ft.Control]) -> ft.Container:
    """江戸時代風の木製掲示板。"""
    bw = mob_w(page, 0.96)
    bh = max(520, float(page.height or 700) * 0.72)
    return ft.Container(
        width=bw,
        height=bh,
        border_radius=8,
        clip_behavior=ft.ClipBehavior.HARD_EDGE,
        gradient=ft.LinearGradient(
            begin=ft.Alignment(-1, -1),
            end=ft.Alignment(1, 1),
            colors=["#6B4E2E", "#4A3218", "#3A2810", "#5A4028"],
        ),
        border=ft.Border.all(6, "#2A1A08"),
        shadow=ft.BoxShadow(blur_radius=20, color="#00000088", offset=ft.Offset(0, 8)),
        content=ft.Stack(
            controls=[
                # 木目の筋
                ft.Container(
                    left=12, top=0, bottom=0, width=3, bgcolor="#3A2810AA",
                ),
                ft.Container(
                    right=18, top=0, bottom=0, width=2, bgcolor="#2A1808AA",
                ),
                ft.Container(
                    left=0, right=0, top=28, height=2, bgcolor="#2A1808AA",
                ),
                ft.Container(
                    left=0, right=0, top=120, height=1, bgcolor="#2A1808AA",
                ),
                ft.Container(
                    left=0, right=0, bottom=40, height=2, bgcolor="#2A1808AA",
                ),
                # 掲示板の題簽
                ft.Container(
                    left=0, right=0, top=10,
                    content=ft.Text(
                        "── 道場掲示 ──",
                        size=13, weight=ft.FontWeight.BOLD,
                        color="#E8D8B0", text_align=ft.TextAlign.CENTER,
                    ),
                    alignment=ft.Alignment(0, 0),
                ),
                *papers,
            ],
        ),
    )


def rank_card(rank_txt, name, value, mine: bool, value_color) -> ft.Container:
    bg = "#1E2433" if mine else PALETTE["surface2"]
    border = PALETTE["accent"] if mine else PALETTE["line"]
    return ft.Container(
        bgcolor=bg,
        border_radius=14,
        padding=ft.Padding(12, 10, 12, 10),
        border=ft.Border.all(2 if mine else 1, border),
        content=ft.Row(
            [
                ft.Container(
                    width=36,
                    content=ft.Text(rank_txt, size=16, weight=ft.FontWeight.BOLD,
                                    color=PALETTE["accent"]),
                ),
                ft.Text(name, expand=True, size=15,
                        color=PALETTE["cyan"] if mine else PALETTE["text"],
                        weight=ft.FontWeight.BOLD if mine else None),
                ft.Text(value, size=15, weight=ft.FontWeight.BOLD, color=value_color),
            ],
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
        ),
    )


def mobile_top_bar(page, back_label: str, back_fn, right=None) -> ft.Container:
    return ft.Container(
        padding=safe_pad(10, 10, 12),
        bgcolor=PALETTE["surface"],
        content=ft.Row(
            [
                ft.TextButton(
                    back_label,
                    style=ft.ButtonStyle(color=PALETTE["muted"]),
                    on_click=lambda e: page.run_task(back_fn),
                ),
                ft.Container(expand=True),
                *( [right] if right else [] ),
            ],
            alignment=ft.MainAxisAlignment.SPACE_BETWEEN,
        ),
    )


# 反応時間（ms）に応じた段位。速いほど上位。
DAN_TIERS = [
    (180, "免許皆伝", ft.Colors.AMBER),
    (220, "達人", ft.Colors.AMBER_300),
    (260, "師範", ft.Colors.ORANGE_300),
    (300, "目録", ft.Colors.CYAN_300),
    (360, "初伝", ft.Colors.WHITE),
    (460, "一級", ft.Colors.WHITE70),
]


def dan_title(ms: int) -> tuple[str, str]:
    for limit, name, color in DAN_TIERS:
        if ms < limit:
            return name, color
    return "入門", ft.Colors.WHITE54


def parse_avatar(raw) -> list:
    """保存された自画像（JSON文字列 or list）を線データのリストに変換。"""
    if not raw:
        return []
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
        return data if isinstance(data, list) else []
    except (ValueError, TypeError):
        return []


def avatar_control(strokes: list, size: int, bg: str | None = None) -> ft.Control:
    """線データから自画像を描いたコントロールを作る。空ならプレースホルダ。"""
    if not strokes:
        inner = ft.Icon(ft.Icons.PERSON, size=int(size * 0.66),
                        color=ft.Colors.WHITE38)
    else:
        sc = size / CANVAS_SIZE
        shapes: list = []
        for st in strokes:
            pts = st.get("p", [])
            col = st.get("c", "#FFFFFF")
            w = max(1.0, st.get("w", 4) * sc)
            paint = ft.Paint(color=col, stroke_width=w,
                             style=ft.PaintingStyle.STROKE, stroke_cap=ft.StrokeCap.ROUND)
            if len(pts) == 1:
                x, y = pts[0]
                shapes.append(cv.Circle(x * sc, y * sc, w / 2, ft.Paint(color=col)))
            for i in range(1, len(pts)):
                x1, y1 = pts[i - 1]
                x2, y2 = pts[i]
                shapes.append(cv.Line(x1 * sc, y1 * sc, x2 * sc, y2 * sc, paint))
        inner = cv.Canvas(shapes)
    return ft.Container(width=size, height=size, bgcolor=bg, border_radius=6,
                        alignment=ft.Alignment(0, 0), content=inner, clip_behavior=ft.ClipBehavior.HARD_EDGE)


def _seg_dist(px, py, ax, ay, bx, by) -> float:
    """点(px,py)から線分 A-B までの距離。"""
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def poly_dist(px, py, pts) -> float:
    """点から折れ線（手本）への最短距離。"""
    best = float("inf")
    for i in range(1, len(pts)):
        d = _seg_dist(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])
        if d < best:
            best = d
    return best


def poly_length(pts) -> float:
    total = 0.0
    for i in range(1, len(pts)):
        total += math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    return total


def trace_score(duration_ms: float, avg_dist: float, length: float) -> int:
    """斬撃スコア（小さいほど上位）。速さ(px/100あたりのms)に精度ペナルティを掛ける。"""
    pace = duration_ms / max(1.0, length / 100.0)        # 100pxあたりの所要ms
    penalty = 1.0 + min(2.0, avg_dist / 16.0)            # 雑なほど最大3倍
    return max(1, round(pace * penalty))


async def main(page: ft.Page):
    page.title = "居合デュエル ― 刹那の見切り"
    page.theme_mode = ft.ThemeMode.DARK
    page.padding = 0
    page.window.width = PAGE_W
    page.window.height = 844
    page.window_min_width = 320
    page.window_max_width = 480
    page.bgcolor = PALETTE["bg"]
    page.theme = ft.Theme(color_scheme_seed=PALETTE["accent"])

    prefs = ft.SharedPreferences()
    player_name = (await prefs.get("iai.name")) or ""
    if not player_name:
        player_name = random.choice(NAME_POOL)
        await prefs.set("iai.name", player_name)
    muted = bool(await prefs.get("iai.muted"))
    cpu_cleared = bool(await prefs.get("iai.cpu_cleared"))
    my_avatar = parse_avatar(await prefs.get("iai.avatar"))

    # ---- 音声 ----
    # スマホ（特に Chrome）ではユーザー操作前の autoplay が一瞬鳴って止まる。
    # BGM は TAP TO START などジェスチャー後に play() する。
    wind = slap = signal_au = win_au = lose_au = foul_au = clear_au = None
    bgm_started = False
    fade_gen = 0

    def _on_bgm_state(e):
        """LOOP が効かない環境向けに、完了したら自分で再開する。"""
        nonlocal bgm_started
        if wind is None or muted or not bgm_started:
            return
        st = getattr(e, "state", None)
        # STOPPED/PAUSED はミュートや一時停止なので再開しない
        if st == fa.AudioState.COMPLETED or str(st).lower().endswith("completed"):
            try:
                wind.play()
            except Exception:
                pass

    try:
        wind = fa.Audio(
            src="/wind.wav",
            autoplay=False,
            volume=0.35,
            release_mode=fa.ReleaseMode.LOOP,
            on_state_change=_on_bgm_state,
        )
        slap = fa.Audio(src="/slap.wav", autoplay=False, volume=1.0,
                        release_mode=fa.ReleaseMode.STOP)
        signal_au = fa.Audio(src="/signal.wav", autoplay=False, volume=1.0,
                             release_mode=fa.ReleaseMode.STOP)
        win_au = fa.Audio(src="/win.wav", autoplay=False, volume=0.85,
                          release_mode=fa.ReleaseMode.STOP)
        lose_au = fa.Audio(src="/lose.wav", autoplay=False, volume=0.85,
                           release_mode=fa.ReleaseMode.STOP)
        foul_au = fa.Audio(src="/foul.wav", autoplay=False, volume=0.8,
                           release_mode=fa.ReleaseMode.STOP)
        clear_au = fa.Audio(src="/clear.wav", autoplay=False, volume=0.9,
                            release_mode=fa.ReleaseMode.STOP)
        for a in (wind, slap, signal_au, win_au, lose_au, foul_au, clear_au):
            page.services.append(a)
    except Exception:
        wind = slap = signal_au = win_au = lose_au = foul_au = clear_au = None

    def play(a):
        if a is None or muted:
            return
        try:
            a.play()
        except Exception:
            pass

    def play_slap():
        play(slap)

    def play_signal():
        play(signal_au or slap)

    async def ensure_bgm():
        """ユーザー操作の文脈で BGM を開始／再開する（モバイルの音声ロック解除）。"""
        nonlocal bgm_started
        if wind is None or muted:
            return
        try:
            wind.volume = 0.35
            wind.play()
            bgm_started = True
        except Exception:
            bgm_started = False

    async def fade_bgm(target: float, steps: int = 6, delay: float = 0.05):
        nonlocal fade_gen
        if wind is None or muted:
            return
        fade_gen += 1
        my_gen = fade_gen
        try:
            start = getattr(wind, "volume", 0.35) or 0.35
            for i in range(1, steps + 1):
                if my_gen != fade_gen:
                    return
                wind.volume = start + (target - start) * (i / steps)
                await asyncio.sleep(delay)
        except Exception:
            pass

    async def battle_flash(color: str, peak: float = 0.85, hold: float = 0.06):
        flash = ft.Container(expand=True, bgcolor=color, opacity=0.0)
        page.overlay.append(flash)
        page.update()
        flash.opacity = peak
        page.update()
        await asyncio.sleep(hold)
        flash.opacity = 0.0
        page.update()
        await asyncio.sleep(0.04)
        if flash in page.overlay:
            page.overlay.remove(flash)
        page.update()

    async def battle_deploy_banner(label: str, sub_label: str):
        banner = ft.Container(
            expand=True,
            gradient=ft.LinearGradient(
                begin=ft.Alignment(0, -1), end=ft.Alignment(0, 1),
                colors=["#4A0810", "#080408", "#050508"],
            ),
            content=ft.Column(
                [
                    ft.Text("━━ 出陣 ━━", size=14, color=PALETTE["accent2"],
                            weight=ft.FontWeight.BOLD),
                    ft.Text(label, size=42, weight=ft.FontWeight.BOLD,
                            color=PALETTE["accent"]),
                    ft.Text(sub_label, size=16, color=PALETTE["muted"]),
                ],
                alignment=ft.MainAxisAlignment.CENTER,
                horizontal_alignment=ft.CrossAxisAlignment.CENTER,
                spacing=8,
            ),
        )
        page.overlay.append(banner)
        page.update()
        await asyncio.sleep(1.0)
        banner.opacity = 0.0
        banner.animate_opacity = ft.Animation(280, ft.AnimationCurve.EASE_IN)
        page.update()
        await asyncio.sleep(0.3)
        if banner in page.overlay:
            page.overlay.remove(banner)
        page.update()

    # ---- 進行状態 ----
    state = VS
    token = 0
    go_time = 0.0
    mode = "cpu"
    streak = 0
    opponent: dict = {}
    current_opponents: list[dict] = []

    root = ft.Container(expand=True, alignment=ft.Alignment(0, 0), padding=safe_pad())

    # ================= 共通の小物 =================
    def mute_icon():
        return ft.Icons.VOLUME_OFF if muted else ft.Icons.VOLUME_UP

    async def toggle_mute(e):
        nonlocal muted, bgm_started
        muted = not muted
        await prefs.set("iai.muted", muted)
        if wind:
            try:
                if muted:
                    wind.pause()
                else:
                    # resume では「一度も play できていない／OS に止められた」場合に再開できない
                    await ensure_bgm()
            except Exception:
                pass
        for b in mute_buttons:
            b.icon = mute_icon()
        page.update()

    mute_buttons: list[ft.IconButton] = []

    def new_mute_button() -> ft.IconButton:
        b = ft.IconButton(icon=mute_icon(), tooltip="ミュート切替", on_click=toggle_mute)
        mute_buttons.append(b)
        return b

    # ================= ゲーム画面の部品（使い回し）=================
    my_name_text = ft.Text(player_name, size=14, weight=ft.FontWeight.BOLD,
                           color=PALETTE["cyan"])
    opp_name_text = ft.Text("—", size=14, weight=ft.FontWeight.BOLD,
                            color=PALETTE["accent2"], text_align=ft.TextAlign.RIGHT)
    opp_time_text = ft.Text("", size=11, color=ft.Colors.RED_200,
                            text_align=ft.TextAlign.RIGHT)
    my_av_holder = ft.Container(width=52, height=52, border_radius=12,
                                bgcolor=PALETTE["surface2"], alignment=ft.Alignment(0, 0))
    opp_av_holder = ft.Container(width=52, height=52, border_radius=12,
                                 bgcolor=PALETTE["surface2"], alignment=ft.Alignment(0, 0))

    def render_avatar(holder: ft.Container, strokes: list):
        sz = int(holder.width or 52)
        holder.content = avatar_control(strokes, sz)

    versus_banner = ft.Container(
        height=84,
        gradient=ft.LinearGradient(
            begin=ft.Alignment(-1, 0), end=ft.Alignment(1, 0),
            colors=["#1A0810", PALETTE["surface"], "#101828"],
        ),
        border=ft.Border.only(bottom=ft.BorderSide(2, PALETTE["accent2"])),
        content=ft.Stack(
            controls=[
                ft.Container(
                    content=ft.Container(
                        width=48, height=48, border_radius=24,
                        bgcolor="#2A1018",
                        border=ft.Border.all(3, PALETTE["accent2"]),
                        shadow=ft.BoxShadow(blur_radius=16, color="#FF174466"),
                        alignment=ft.Alignment(0, 0),
                        content=ft.Text("VS", size=18, weight=ft.FontWeight.BOLD,
                                        color=PALETTE["accent"]),
                    ),
                    left=0, right=0, top=0, bottom=0, alignment=ft.Alignment(0, 0),
                ),
                ft.Container(
                    left=12, top=8, bottom=8,
                    content=ft.Row([my_av_holder, my_name_text], spacing=8,
                                   vertical_alignment=ft.CrossAxisAlignment.CENTER),
                ),
                ft.Container(
                    right=12, top=8, bottom=8,
                    content=ft.Row([
                        ft.Column([opp_name_text, opp_time_text], spacing=0,
                                  horizontal_alignment=ft.CrossAxisAlignment.END),
                        opp_av_holder], spacing=8,
                        vertical_alignment=ft.CrossAxisAlignment.CENTER),
                ),
            ],
        ),
    )
    render_avatar(my_av_holder, my_avatar)
    render_avatar(opp_av_holder, [])

    info = ft.Text(size=12, color=PALETTE["muted"], text_align=ft.TextAlign.CENTER)
    head = ft.Text(size=22, weight=ft.FontWeight.BOLD, color=PALETTE["text"],
                   text_align=ft.TextAlign.CENTER)
    iza_image = ft.Image(src="/iza.png", fit=ft.BoxFit.CONTAIN, visible=False)
    big = ft.Text(size=100, weight=ft.FontWeight.BOLD, color=PALETTE["text"],
                  text_align=ft.TextAlign.CENTER)
    streak_banner = ft.Container(
        visible=False,
        padding=ft.Padding(14, 6, 14, 6),
        border_radius=20,
        bgcolor="#2A2210",
        border=ft.Border.all(1, PALETTE["accent"]),
        content=ft.Text(size=15, weight=ft.FontWeight.BOLD, color=PALETTE["accent"],
                        text_align=ft.TextAlign.CENTER),
    )
    sub = ft.Text(size=15, color=PALETTE["muted"], text_align=ft.TextAlign.CENTER)

    continue_btn = ft.FilledButton(
        content=ft.Text("続ける", size=16, weight=ft.FontWeight.BOLD),
        width=160, height=MIN_TAP,
        style=ft.ButtonStyle(shape=ft.RoundedRectangleBorder(radius=14)),
        on_click=lambda e: page.run_task(play_round),
    )
    title_btn = ft.OutlinedButton(
        content=ft.Text("タイトルへ", size=16),
        width=160, height=MIN_TAP,
        style=ft.ButtonStyle(shape=ft.RoundedRectangleBorder(radius=14)),
        on_click=lambda e: page.run_task(back_to_title),
    )
    end_buttons = ft.Row([continue_btn, title_btn], visible=False, spacing=12,
                         alignment=ft.MainAxisAlignment.CENTER, wrap=True)

    stage = ft.Container(
        expand=True, alignment=ft.Alignment(0, 0), bgcolor=PALETTE["void"],
        ink=True,
        gradient=ft.LinearGradient(
            begin=ft.Alignment(0, -1), end=ft.Alignment(0, 1),
            colors=["#1A0810", PALETTE["void"], "#080C18"],
        ),
        content=ft.Column(
            alignment=ft.MainAxisAlignment.CENTER,
            horizontal_alignment=ft.CrossAxisAlignment.CENTER,
            spacing=10,
            controls=[info, head, iza_image, big, streak_banner, sub,
                      ft.Container(height=8), end_buttons],
        ),
    )

    def set_streak(text: str, color=PALETTE["accent"], visible: bool = True):
        streak_banner.content.value = text
        streak_banner.content.color = color
        streak_banner.visible = visible and bool(text)

    async def back_to_title(e=None):
        nonlocal token
        token += 1  # 進行中のラウンドを無効化
        await fade_bgm(0.35, steps=4)
        await show_title()

    game_top_bar = mobile_top_bar(page, "◀ タイトル", back_to_title, new_mute_button())

    def sync_game_chrome():
        immersive = state in (IZA, WAITING, GO, REVEAL)
        game_top_bar.visible = not immersive
        versus_banner.visible = not immersive

    game_chrome = ft.Column([game_top_bar, versus_banner], spacing=0)

    game_view = ft.Column(expand=True, spacing=0, controls=[game_chrome, stage])

    # ================= 画面遷移 =================
    splash_active = {"v": False}

    async def show_splash():
        nonlocal state
        state = VS
        splash_active["v"] = True
        tok = id(object())
        splash_active["token"] = tok

        tap_label = ft.Text(
            "TAP TO START",
            size=18,
            weight=ft.FontWeight.BOLD,
            color=PALETTE["accent"],
            text_align=ft.TextAlign.CENTER,
            opacity=1.0,
            animate_opacity=ft.Animation(500, ft.AnimationCurve.EASE_IN_OUT),
        )

        async def blink():
            while splash_active["v"] and splash_active.get("token") == tok:
                tap_label.opacity = 1.0
                page.update()
                await asyncio.sleep(0.75)
                if not splash_active["v"]:
                    break
                tap_label.opacity = 0.25
                page.update()
                await asyncio.sleep(0.75)

        async def on_tap(e):
            splash_active["v"] = False
            # ユーザーのタップで音声セッションを解錠し BGM を開始する
            await ensure_bgm()
            await show_mode_board()

        splash = ft.GestureDetector(
            on_tap=on_tap,
            content=ft.Container(
                expand=True,
                content=ft.Stack(
                    expand=True,
                    controls=[
                        ft.Image(
                            src="/title_bg.png",
                            expand=True,
                            fit=ft.BoxFit.COVER,
                        ),
                        ft.Container(
                            expand=True,
                            gradient=ft.LinearGradient(
                                begin=ft.Alignment(0, -1),
                                end=ft.Alignment(0, 1),
                                colors=["#00000088", "#00000044", "#000000CC"],
                            ),
                        ),
                        ft.Container(
                            expand=True,
                            content=ft.Column(
                                alignment=ft.MainAxisAlignment.CENTER,
                                horizontal_alignment=ft.CrossAxisAlignment.CENTER,
                                spacing=12,
                                controls=[
                                    ft.Text("居合デュエル", size=46, weight=ft.FontWeight.BOLD,
                                            color="#FFF8F0",
                                            text_align=ft.TextAlign.CENTER),
                                    ft.Text("刹那の見切り", size=16, color=PALETTE["accent2"],
                                            text_align=ft.TextAlign.CENTER),
                                    ft.Text("── 一瞬の生死を刻む ──", size=12,
                                            color=PALETTE["muted"],
                                            text_align=ft.TextAlign.CENTER),
                                    ft.Container(height=48),
                                    tap_label,
                                ],
                            ),
                        ),
                    ],
                ),
            ),
        )

        root.content = splash
        page.update()
        page.run_task(blink)

    async def show_mode_board():
        nonlocal state
        splash_active["v"] = False
        state = VS
        bw = mob_w(page, 0.96)

        name_field = ft.TextField(
            label="剣士の名", value=player_name,
            dense=True, expand=True, max_length=16,
            border_radius=8, bgcolor="#F8F0E0",
            border_color="#C8A878",
            color="#2A1810",
        )

        async def on_name_change(e):
            nonlocal player_name
            player_name = (name_field.value or "").strip() or random.choice(NAME_POOL)
            await prefs.set("iai.name", player_name)
            my_name_text.value = player_name
            await load_stats()
        name_field.on_change = on_name_change

        stat_text = ft.Text("自己記録を確認中…", size=12, color="#5A4030",
                            text_align=ft.TextAlign.CENTER, weight=ft.FontWeight.BOLD)

        async def load_stats():
            clr = "　孤城突破：済 ✓" if cpu_cleared else ""
            best = await sb_my_best(player_name)
            if best is None:
                stat_text.value = "未だ一閃なし ― 掲示を選べ" + clr
            else:
                rank = await sb_rank(best)
                dan, _ = dan_title(best)
                rk = f"／ 全国 {rank} 位" if rank else ""
                stat_text.value = f"自己ベスト {fmt_sec(best)}秒（{dan}）{rk}{clr}"
            page.update()

        pw = bw * 0.44
        ph = 108
        papers = [
            ft.Container(
                left=bw * 0.06, top=52,
                content=paper_notice(
                    "孤城突破", "剣豪五人を斬り抜け", "破",
                    PALETTE["accent2"], pw, ph, -4,
                    lambda e: page.run_task(enter_game, "cpu")),
            ),
            ft.Container(
                left=bw * 0.50, top=44,
                content=paper_notice(
                    "死闘", "ゴーストと連勝の戦", "戦",
                    "#1E88E5", pw, ph, 3,
                    lambda e: page.run_task(enter_game, "pvp")),
            ),
            ft.Container(
                left=bw * 0.10, top=178,
                content=paper_notice(
                    "なぞり斬り", "太刀筋を見切れ", "斬",
                    PALETTE["indigo"], pw, ph, 2,
                    lambda e: page.run_task(show_trace)),
            ),
            ft.Container(
                left=bw * 0.48, top=168,
                content=paper_notice(
                    "英名録", "全国の剣士記録", "録",
                    PALETTE["accent"], pw, ph, -2,
                    lambda e: page.run_task(show_ranking)),
            ),
            ft.Container(
                left=bw * 0.28, top=298,
                content=paper_notice(
                    "自画像", "対戦時に相手へ表示", "像",
                    "#6D4C41", pw * 0.92, ph * 0.9, 1,
                    lambda e: page.run_task(show_draw)),
            ),
        ]

        profile_paper = ft.Container(
            width=bw * 0.88,
            bgcolor="#F3EBD8",
            border_radius=4,
            padding=12,
            border=ft.Border.all(1, "#C8B898"),
            shadow=ft.BoxShadow(blur_radius=8, color="#00000044", offset=ft.Offset(2, 4)),
            content=ft.Column(
                spacing=8,
                controls=[
                    ft.Text("剣士登録札", size=13, weight=ft.FontWeight.BOLD, color="#2A1810"),
                    ft.Row([name_field, new_mute_button()],
                           vertical_alignment=ft.CrossAxisAlignment.CENTER),
                    stat_text,
                ],
            ),
        )

        bulletin = edo_bulletin_board(page, papers)

        root.bgcolor = PALETTE["bg"]
        root.content = ft.Column(
            expand=True,
            spacing=0,
            scroll=ft.ScrollMode.AUTO,
            controls=[
                ft.Container(
                    padding=safe_pad(12, 8, 14),
                    content=ft.Row(
                        [
                            ft.TextButton(
                                "◀ タイトルへ",
                                style=ft.ButtonStyle(color=PALETTE["muted"]),
                                on_click=lambda e: page.run_task(show_splash),
                            ),
                            ft.Container(expand=True),
                            ft.Text(
                                "道場掲示板",
                                size=15, weight=ft.FontWeight.BOLD,
                                color=PALETTE["accent"],
                            ),
                        ],
                    ),
                ),
                ft.Container(
                    padding=ft.Padding(12, 0, 12, 8),
                    content=profile_paper,
                    alignment=ft.Alignment(0, 0),
                ),
                ft.Container(
                    content=bulletin,
                    alignment=ft.Alignment(0, 0),
                ),
                ft.Container(
                    padding=safe_pad(8, 24, 14),
                    content=ft.Text(
                        "オンライン: 有効" if online() else "オフライン",
                        size=12,
                        color=PALETTE["green"] if online() else PALETTE["accent"],
                        text_align=ft.TextAlign.CENTER,
                    ),
                ),
            ],
        )
        page.update()
        await load_stats()

    async def show_title():
        await show_mode_board()

    async def show_ranking():
        board = ft.Column(spacing=8, scroll=ft.ScrollMode.AUTO)
        title = ft.Text(size=18, weight=ft.FontWeight.BOLD, color=PALETTE["text"])
        view = {"v": "time"}

        async def render():
            board.controls.clear()
            medals = ["\U0001F947", "\U0001F948", "\U0001F949"]
            if view["v"] == "time":
                title.value = "タイムランキング（速い順）"
                rows = await sb_top(15)
                if not rows:
                    board.controls.append(ft.Text("記録なし / オフライン", color=PALETTE["muted"]))
                else:
                    for i, row in enumerate(rows):
                        rk = medals[i] if i < 3 else f"{i + 1}."
                        mine = row["name"] == player_name
                        board.controls.append(rank_card(
                            rk, row["name"], f"{fmt_sec(row['reaction_ms'])}秒",
                            mine, PALETTE["cyan"]))
            elif view["v"] == "streak":
                title.value = "対人戦 連勝ランキング"
                rows = await sb_streak_top(15)
                if not rows:
                    board.controls.append(ft.Text("記録なし / オフライン", color=PALETTE["muted"]))
                else:
                    for i, row in enumerate(rows):
                        rk = medals[i] if i < 3 else f"{i + 1}."
                        mine = row["name"] == player_name
                        board.controls.append(rank_card(
                            rk, row["name"], f"{row['streak']}連勝",
                            mine, PALETTE["accent"]))
            elif view["v"] == "trace":
                title.value = "なぞり斬り 斬撃力（大きい順）"
                rows = await sb_top(15, bucket=TRACE_BUCKET)
                if not rows:
                    board.controls.append(ft.Text("記録なし / オフライン", color=PALETTE["muted"]))
                else:
                    for i, row in enumerate(rows):
                        rk = medals[i] if i < 3 else f"{i + 1}."
                        mine = row["name"] == player_name
                        board.controls.append(rank_card(
                            rk, row["name"], str(TRACE_BASE - row["reaction_ms"]),
                            mine, PALETTE["indigo"]))
            page.update()

        async def switch(v: str):
            view["v"] = v
            tab_style()
            await render()

        tab_btns: dict[str, ft.Container] = {}

        def tab_style():
            for key, btn in tab_btns.items():
                sel = view["v"] == key
                btn.bgcolor = PALETTE["accent"] if sel else PALETTE["surface2"]
                btn.border = ft.Border.all(2 if sel else 1,
                                           PALETTE["accent"] if sel else PALETTE["line"])
                btn.content.color = "#1A1200" if sel else PALETTE["text"]
                btn.content.weight = ft.FontWeight.BOLD if sel else None

        def tab_btn(label: str, key: str) -> ft.Container:
            btn = ft.Container(
                content=ft.Text(label, size=13, color=PALETTE["text"]),
                width=96, height=MIN_TAP,
                border_radius=12,
                alignment=ft.Alignment(0, 0),
                bgcolor=PALETTE["surface2"],
                border=ft.Border.all(1, PALETTE["line"]),
                ink=True,
                on_click=lambda e, k=key: page.run_task(switch, k),
            )
            tab_btns[key] = btn
            return btn

        root.content = ft.Column(
            expand=True,
            spacing=0,
            controls=[
                mobile_top_bar(page, "◀ タイトル", show_title, new_mute_button()),
                ft.Container(
                    expand=True,
                    padding=safe_pad(8, 20, 16),
                    content=ft.Column(
                        expand=True,
                        spacing=12,
                        controls=[
                            ft.Row(
                                [tab_btn("タイム", "time"), tab_btn("連勝", "streak"),
                                 tab_btn("なぞり斬り", "trace")],
                                alignment=ft.MainAxisAlignment.CENTER,
                                spacing=8,
                                wrap=True,
                            ),
                            title,
                            ft.Container(expand=True, content=board),
                        ],
                    ),
                ),
            ],
        )
        page.update()
        tab_style()
        await render()

    async def show_draw():
        nonlocal state
        state = VS
        draw_size = min(CANVAS_SIZE, int(mob_w(page, 0.88)))
        scale = draw_size / CANVAS_SIZE
        work = [{"c": s.get("c", "#FFFFFF"), "w": s.get("w", 6),
                 "p": [list(p) for p in s.get("p", [])]} for s in my_avatar]
        pen = {"c": "#111111", "w": 3}
        draw_canvas = cv.Canvas([])
        canvas_box = ft.Container(width=draw_size, height=draw_size,
                                  bgcolor=ft.Colors.WHITE,
                                  clip_behavior=ft.ClipBehavior.HARD_EDGE,
                                  border_radius=12,
                                  content=draw_canvas)

        def stroke_shapes(st: dict) -> list:
            out: list = []
            pts = st["p"]
            sw = max(1.0, st["w"] * scale)
            paint = ft.Paint(color=st["c"], stroke_width=sw,
                             style=ft.PaintingStyle.STROKE, stroke_cap=ft.StrokeCap.ROUND)
            if len(pts) == 1:
                out.append(cv.Circle(pts[0][0] * scale, pts[0][1] * scale, sw / 2,
                                     ft.Paint(color=st["c"])))
            for i in range(1, len(pts)):
                out.append(cv.Line(pts[i - 1][0] * scale, pts[i - 1][1] * scale,
                                   pts[i][0] * scale, pts[i][1] * scale, paint))
            return out

        def rebuild():
            shapes: list = []
            for st in work:
                shapes += stroke_shapes(st)
            draw_canvas.shapes = shapes

        rebuild()

        def clamp(v) -> float:
            return max(0.0, min(float(CANVAS_SIZE), float(v)))

        def from_touch(x, y) -> tuple[float, float]:
            return clamp(x / scale), clamp(y / scale)

        def to_disp(x, y) -> tuple[float, float]:
            return x * scale, y * scale

        # このFletではドラッグ開始で tap_down が出ないので pan_start で起点を取り、
        # pan_update の絶対座標 local_position で線を伸ばす
        pos = {"x": 0.0, "y": 0.0, "n": 0}
        MIN_DIST = 3.0   # これ未満の移動は無視（点を間引く）
        FLUSH_EVERY = 3  # 数点ごとにまとめて描画更新（送信回数を削減）

        def start_stroke(x, y):
            x, y = from_touch(x, y)
            pos["x"], pos["y"], pos["n"] = x, y, 0
            dx, dy = to_disp(x, y)
            work.append({"c": pen["c"], "w": pen["w"], "p": [[x, y]]})
            draw_canvas.shapes.append(cv.Circle(dx, dy, pen["w"] * scale / 2,
                                                ft.Paint(color=pen["c"])))
            draw_canvas.update()

        def on_start(e):
            start_stroke(e.local_position.x, e.local_position.y)

        def on_down(e):
            # 単発タップ（点）対応。ドラッグ時は pan_start が起点を作る
            start_stroke(e.local_position.x, e.local_position.y)

        def on_update(e):
            if not work:
                start_stroke(e.local_position.x, e.local_position.y)
                return
            nx, ny = from_touch(e.local_position.x, e.local_position.y)
            if abs(nx - pos["x"]) < MIN_DIST and abs(ny - pos["y"]) < MIN_DIST:
                return
            sw = max(1.0, work[-1]["w"] * scale)
            paint = ft.Paint(color=work[-1]["c"], stroke_width=sw,
                             style=ft.PaintingStyle.STROKE, stroke_cap=ft.StrokeCap.ROUND)
            x1, y1 = to_disp(pos["x"], pos["y"])
            x2, y2 = to_disp(nx, ny)
            draw_canvas.shapes.append(cv.Line(x1, y1, x2, y2, paint))
            work[-1]["p"].append([nx, ny])
            pos["x"], pos["y"] = nx, ny
            pos["n"] += 1
            if pos["n"] % FLUSH_EVERY == 0:
                draw_canvas.update()

        def on_end(e):
            draw_canvas.update()

        gd = ft.GestureDetector(content=canvas_box, on_tap_down=on_down,
                                on_pan_start=on_start, on_pan_update=on_update,
                                on_pan_end=on_end)

        color_dots: list = []

        def select_color(c: str):
            pen["c"] = c
            for col, cont in color_dots:
                sel = (col == c)
                cont.border = ft.Border.all(3 if sel else 1,
                                            ft.Colors.AMBER if sel else ft.Colors.WHITE24)
                cont.scale = ft.Scale(1.2 if sel else 1.0)
            page.update()

        def color_dot(c: str) -> ft.Control:
            cont = ft.Container(width=MIN_TAP, height=MIN_TAP, bgcolor=c, border_radius=24,
                                border=ft.Border.all(1, PALETTE["line"]),
                                animate_scale=ft.Animation(120),
                                on_click=lambda e, col=c: select_color(col))
            color_dots.append((c, cont))
            return cont

        palette = ft.Row([color_dot(c) for c in
                          ["#111111", "#FFFFFF", "#E53935", "#1E88E5", "#43A047",
                           "#FDD835", "#FB8C00", "#8E24AA", "#FFCC80"]],
                         alignment=ft.MainAxisAlignment.CENTER, wrap=True, spacing=8)

        width_chips: list = []

        def select_width(w: int):
            pen["w"] = w
            for ww, chip in width_chips:
                sel = (ww == w)
                chip.bgcolor = ft.Colors.AMBER if sel else ft.Colors.WHITE10
                chip.border = ft.Border.all(2 if sel else 1,
                                            ft.Colors.AMBER if sel else ft.Colors.WHITE24)
                chip.content.color = (ft.Colors.BLACK if sel else ft.Colors.WHITE)
                chip.content.weight = (ft.FontWeight.BOLD if sel else None)
            page.update()

        def width_chip(label: str, w: int) -> ft.Control:
            chip = ft.Container(
                content=ft.Text(label, size=16, color=PALETTE["text"]),
                width=72, height=MIN_TAP, border_radius=12,
                alignment=ft.Alignment(0, 0), bgcolor=PALETTE["surface2"],
                border=ft.Border.all(1, PALETTE["line"]),
                ink=True,
                on_click=lambda e, ww=w: select_width(ww))
            width_chips.append((w, chip))
            return chip

        widths = ft.Row([width_chip("細", 3), width_chip("中", 6),
                         width_chip("太", 12)],
                        alignment=ft.MainAxisAlignment.CENTER, spacing=8)

        def clear_canvas(e):
            work.clear()
            draw_canvas.shapes = []
            page.update()

        async def save_avatar(e):
            nonlocal my_avatar
            my_avatar = [s for s in work if s["p"]]
            data = json.dumps(my_avatar, separators=(",", ":"))
            await prefs.set("iai.avatar", data)
            render_avatar(my_av_holder, my_avatar)
            await sb_avatar_submit(player_name, data)
            await show_title()

        root.content = ft.Column(
            expand=True,
            spacing=0,
            controls=[
                mobile_top_bar(page, "◀ タイトル", show_title, new_mute_button()),
                ft.Container(
                    expand=True,
                    padding=safe_pad(8, 24, 16),
                    content=ft.Column(
                        horizontal_alignment=ft.CrossAxisAlignment.CENTER,
                        spacing=14,
                        scroll=ft.ScrollMode.AUTO,
                        controls=[
                            ft.Text("自画像を描こう", size=22, weight=ft.FontWeight.BOLD,
                                    color=PALETTE["text"]),
                            ft.Text("ドラッグして描く。対戦で相手に表示される",
                                    size=12, color=PALETTE["muted"],
                                    text_align=ft.TextAlign.CENTER),
                            ft.Container(content=gd,
                                         border=ft.Border.all(2, PALETTE["line"]),
                                         border_radius=14),
                            mob_card(palette, width=mob_w(page, 0.92)),
                            mob_card(widths, width=mob_w(page, 0.92)),
                            ft.Row([
                                ft.OutlinedButton("クリア", height=MIN_TAP,
                                                  on_click=clear_canvas),
                                ft.FilledButton(content=ft.Text("保存", size=16),
                                                height=MIN_TAP,
                                                on_click=lambda e: page.run_task(save_avatar, e)),
                            ], alignment=ft.MainAxisAlignment.CENTER, spacing=12, wrap=True),
                        ],
                    ),
                ),
            ],
        )
        page.update()
        select_color(pen["c"])
        select_width(pen["w"])

    async def show_trace():
        # ===== なぞり斬り：一瞬閃く太刀筋に沿って、いかに「まっすぐ」斬れるかで競う =====
        nonlocal state
        await battle_deploy_banner("なぞり斬り", "太刀筋を見切れ")
        state = VS
        rs = {"v": 0, "streak": 0, "guide": None, "opp": {},
              "pts": [], "t0": None, "last": None,
              "active": False, "done": False, "n": 0}
        ghosts: list[dict] = []
        MIN_D = 3.0
        S = float(min(TRACE_SIZE, int(mob_w(page, 0.92))))
        scale_t = S / TRACE_SIZE
        PAD = 48.0 * scale_t  # 白紙の外側にもジェスチャ判定を広げる余白

        you_label = ft.Text(player_name, size=15, weight=ft.FontWeight.BOLD,
                            color=ft.Colors.CYAN_300)
        opp_label = ft.Text("—", size=15, weight=ft.FontWeight.BOLD,
                            color=ft.Colors.RED_300)
        status = ft.Text("", size=18, color=ft.Colors.WHITE, weight=ft.FontWeight.BOLD,
                        text_align=ft.TextAlign.CENTER)
        detail = ft.Text("", size=13, color=ft.Colors.WHITE70,
                        text_align=ft.TextAlign.CENTER)
        streak_t = ft.Text("", size=16, color=ft.Colors.AMBER, weight=ft.FontWeight.BOLD,
                          text_align=ft.TextAlign.CENTER)

        # ===== 結果でドーンと出す斬撃力の比較パネル =====
        you_cap = ft.Text("あなた", size=14, color=ft.Colors.CYAN_200,
                         text_align=ft.TextAlign.CENTER)
        you_num = ft.Text("0", size=72, weight=ft.FontWeight.BOLD,
                         color=ft.Colors.AMBER, text_align=ft.TextAlign.CENTER)
        opp_cap = ft.Text("相手", size=14, color=ft.Colors.RED_200,
                         text_align=ft.TextAlign.CENTER)
        opp_num = ft.Text("0", size=72, weight=ft.FontWeight.BOLD,
                         color=ft.Colors.RED_300, text_align=ft.TextAlign.CENTER)
        vs_mark = ft.Text("VS", size=30, weight=ft.FontWeight.BOLD,
                         color=ft.Colors.WHITE54)
        score_panel = ft.Container(
            visible=False, scale=ft.Scale(0.4),
            animate_scale=ft.Animation(320, ft.AnimationCurve.EASE_OUT),
            content=ft.Row(alignment=ft.MainAxisAlignment.CENTER,
                           vertical_alignment=ft.CrossAxisAlignment.CENTER, spacing=20,
                           controls=[
                               ft.Column([you_cap, you_num], spacing=0,
                                         horizontal_alignment=ft.CrossAxisAlignment.CENTER),
                               vs_mark,
                               ft.Column([opp_cap, opp_num], spacing=0,
                                         horizontal_alignment=ft.CrossAxisAlignment.CENTER),
                           ]))

        board_canvas = cv.Canvas([])
        board = ft.Container(
            width=S, height=S, bgcolor=ft.Colors.WHITE,
            border_radius=12, clip_behavior=ft.ClipBehavior.HARD_EDGE,
            border=ft.Border.all(2, PALETTE["line"]), content=board_canvas)
        # 白紙の外側にも当たり判定を広げる（枠外から始めても枠内に入れば描ける）
        pad_box = ft.Container(width=S + 2 * PAD, height=S + 2 * PAD,
                               bgcolor=ft.Colors.BLACK, alignment=ft.Alignment(0, 0),
                               content=board)

        def line_shapes(pts, color, width, ends=None):
            paint = ft.Paint(color=color, stroke_width=width,
                             style=ft.PaintingStyle.STROKE, stroke_cap=ft.StrokeCap.ROUND)
            out = []
            for i in range(1, len(pts)):
                out.append(cv.Line(pts[i - 1][0], pts[i - 1][1],
                                   pts[i][0], pts[i][1], paint))
            if ends:
                out.append(cv.Circle(pts[0][0], pts[0][1], 9, ft.Paint(color=ends)))
                out.append(cv.Circle(pts[-1][0], pts[-1][1], 9, ft.Paint(color=ends)))
            return out

        def clampt(v):
            return max(0.0, min(S, float(v)))

        def clip_line(cx, cy, ux, uy, margin=10.0):
            """中心(cx,cy)・方向(ux,uy)の直線を、紙の枠[margin, S-margin]に収めた両端を返す。"""
            ts = []
            if abs(ux) > 1e-6:
                for xb in (margin, S - margin):
                    t = (xb - cx) / ux
                    y = cy + t * uy
                    if margin - 1 <= y <= S - margin + 1:
                        ts.append(t)
            if abs(uy) > 1e-6:
                for yb in (margin, S - margin):
                    t = (yb - cy) / uy
                    x = cx + t * ux
                    if margin - 1 <= x <= S - margin + 1:
                        ts.append(t)
            tmin, tmax = min(ts), max(ts)
            return ([cx + tmin * ux, cy + tmin * uy],
                    [cx + tmax * ux, cy + tmax * uy])

        def make_guide():
            angle = random.choice([0, 90, 45, 135, 30, 60, 120, 150])
            th = math.radians(angle)
            ux, uy = math.cos(th), math.sin(th)
            a, b = clip_line(S / 2, S / 2, ux, uy)
            name = {0: "横一文字", 90: "唐竹割り", 45: "袈裟斬り",
                    135: "逆袈裟"}.get(angle, "斜一文字")
            return {"A": a, "B": b, "ux": ux, "uy": uy,
                    "len": math.hypot(b[0] - a[0], b[1] - a[1]), "name": name}

        def begin(x, y):
            if not rs["active"] or rs["done"]:
                return
            x, y = clampt(x), clampt(y)
            if rs["t0"] is None:
                rs["t0"] = time.perf_counter()
            rs["last"] = (x, y)
            rs["pts"].append([x, y])
            board_canvas.shapes.append(cv.Circle(x, y, 6, ft.Paint(color="#1A1A1A")))
            board_canvas.update()

        def extend(x, y):
            if not rs["active"] or rs["done"]:
                return
            if rs["t0"] is None or rs["last"] is None:
                begin(x, y)
                return
            x, y = clampt(x), clampt(y)
            lx, ly = rs["last"]
            if abs(x - lx) < MIN_D and abs(y - ly) < MIN_D:
                return
            # 筆っぽさ：遅い動き＝太く、速い動き＝細く（墨の筆致のように強弱）
            seg = math.hypot(x - lx, y - ly)
            w = max(5.0, min(17.0, 17.0 - seg * 0.38))
            paint = ft.Paint(color="#1A1A1A", stroke_width=w,
                             style=ft.PaintingStyle.STROKE, stroke_cap=ft.StrokeCap.ROUND)
            board_canvas.shapes.append(cv.Line(lx, ly, x, y, paint))
            rs["pts"].append([x, y])
            rs["last"] = (x, y)
            rs["n"] += 1
            if rs["n"] % 3 == 0:
                board_canvas.update()

        def conv(e):
            # pad_box 座標 → 白紙座標（白紙は中央に PAD だけ内側）
            return e.local_position.x - PAD, e.local_position.y - PAD

        def inside(x, y):
            return -1.0 <= x <= S + 1.0 and -1.0 <= y <= S + 1.0

        def on_start(e):
            x, y = conv(e)
            if inside(x, y):
                begin(x, y)
            # 枠外スタートでも pad_box がジェスチャを掴むので update で拾える

        def on_update(e):
            x, y = conv(e)
            if not inside(x, y):
                return  # 枠外は無視（枠内に入った瞬間から描く）
            if rs["t0"] is None or rs["last"] is None:
                begin(x, y)
            else:
                extend(x, y)

        def on_end(e):
            # 描き終わり（離した瞬間）に確定
            if rs["active"] and not rs["done"] and rs["t0"] is not None:
                page.run_task(finish)

        gd = ft.GestureDetector(content=pad_box, on_pan_start=on_start,
                                on_pan_update=on_update, on_pan_end=on_end)

        cont_btn = ft.FilledButton(content=ft.Text("もう一度", size=16), width=168,
                                   height=MIN_TAP, visible=False,
                                   style=ft.ButtonStyle(shape=ft.RoundedRectangleBorder(radius=14)),
                                   on_click=lambda e: page.run_task(run_round))
        back_btn = ft.OutlinedButton(content=ft.Text("タイトルへ", size=16), width=168,
                                     height=MIN_TAP, visible=False,
                                     style=ft.ButtonStyle(shape=ft.RoundedRectangleBorder(radius=14)),
                                     on_click=lambda e: page.run_task(leave))

        def setup():
            rs["guide"] = make_guide()
            sk = rs["streak"]
            if ghosts:
                n = len(ghosts)
                target = min(n - 1, sk)
                lo = max(0, target - 1)
                hi = min(n - 1, target + 1)
                g = random.choice(ghosts[lo:hi + 1])
                rs["opp"] = {"name": g["name"], "score": int(g["reaction_ms"])}
            else:
                # 斬撃スコア＝直線からのブレ基準。連勝が伸びるほど相手の太刀筋が冴える
                rs["opp"] = {"name": random.choice(CPU_NAMES),
                             "score": max(110, round(250 - 14 * sk))}

        async def cut_anim(cur):
            # 白い紙が「ガイドの切り口そのもの」で二片に割れ、回転しながら落ちる。
            # 切り口に沿った大きな回転矩形を2枚作り、紙の枠でクリップして半平面を表現。
            anim = ft.Animation(700, ft.AnimationCurve.EASE_IN)
            g = rs["guide"]
            ux, uy = g["ux"], g["uy"]
            theta = math.atan2(uy, ux)          # 切り口の角度
            nx, ny = -uy, ux                     # 切り口の法線（割れる方向）
            big = S * 1.7
            cx = cy = S / 2.0

            def make_half(sign):
                # 内側の長辺が切り口（中心を通る直線）に一致するよう中心を法線方向へずらす
                mx = cx + sign * nx * (big / 2.0)
                my = cy + sign * ny * (big / 2.0)
                h = ft.Container(width=big, height=big,
                                 left=mx - big / 2.0, top=my - big / 2.0,
                                 bgcolor=ft.Colors.WHITE,
                                 rotate=ft.Rotate(theta, alignment=ft.Alignment(0, 0)),
                                 opacity=1.0, animate_position=anim,
                                 animate_rotation=anim, animate_opacity=anim)
                return h

            h1 = make_half(+1)
            h2 = make_half(-1)
            board.bgcolor = None  # 割れ目から黒（下地）が覗く
            board.content = ft.Stack([h1, h2], width=S, height=S)
            page.update()
            await asyncio.sleep(0.03)

            gap = S * 0.10
            fall = S * 1.05
            h1.left += nx * gap
            h1.top += ny * gap + fall
            h1.rotate = ft.Rotate(theta - 0.22, alignment=ft.Alignment(0, 0))
            h1.opacity = 0.0
            h2.left += -nx * gap
            h2.top += -ny * gap + fall
            h2.rotate = ft.Rotate(theta + 0.22, alignment=ft.Alignment(0, 0))
            h2.opacity = 0.0
            page.update()
            await asyncio.sleep(0.62)
            if cur != rs["v"]:
                return
            # 紙を戻し、相手の太刀筋（赤）と自分の筆を重ねて答え合わせ
            board.bgcolor = ft.Colors.WHITE
            board.content = board_canvas
            board_canvas.shapes = (line_shapes([g["A"], g["B"]], "#E53935", 4)
                                   + board_canvas.shapes)
            page.update()

        async def finish():
            if rs["done"]:
                return
            rs["done"] = True
            rs["active"] = False
            cur = rs["v"]

            g = rs["guide"]
            ax, ay = g["A"]
            ux, uy = g["ux"], g["uy"]
            pts = rs["pts"]
            if len(pts) >= 2:
                devs = [abs((px - ax) * uy - (py - ay) * ux) for px, py in pts]
                avg = sum(devs) / len(devs)
                projs = [(px - ax) * ux + (py - ay) * uy for px, py in pts]
                coverage = (max(projs) - min(projs)) / max(1.0, g["len"])
            else:
                avg, coverage = 99.0, 0.0
            cover_pen = 1.0 + max(0.0, 0.7 - coverage) * 2.0  # 斬り抜き不足は軽めに罰する
            # 内部値は最低50（DBのCHECK制約 reaction_ms>=50 に合わせる＝斬撃力は最大250）
            you = max(50, round(avg * 10.0 * cover_pen))
            opp = rs["opp"]
            beat = you < opp["score"]
            rs["streak"] = rs["streak"] + 1 if beat else 0

            play_slap()  # 斬撃音
            await cut_anim(cur)  # 紙が割れて落ちる
            if cur != rs["v"]:
                return

            status.value = "斬ッ！　会心の一刀" if beat else "斬り負け…"
            status.color = ft.Colors.AMBER if beat else ft.Colors.WHITE
            cov = min(100, coverage * 100)
            you_pow = TRACE_BASE - you
            opp_pow = TRACE_BASE - opp["score"]

            # ドーンと斬撃力を比較表示（勝者を大きく強調）
            opp_cap.value = opp["name"]
            you_num.value = str(you_pow)
            opp_num.value = str(opp_pow)
            you_num.size = 92 if beat else 56
            opp_num.size = 56 if beat else 92
            you_num.color = ft.Colors.AMBER if beat else ft.Colors.WHITE38
            opp_num.color = ft.Colors.WHITE38 if beat else ft.Colors.RED_400
            you_cap.value = "あなた ⚔ 勝" if beat else "あなた"
            opp_cap.value = f"{opp['name']} ⚔ 勝" if not beat else opp["name"]
            score_panel.visible = True

            judge = "相手を上回った→勝ち" if beat else "相手に及ばず→負け"
            detail.value = (f"ブレ{avg:.1f}px・斬り抜き{cov:.0f}%　／　"
                            f"斬撃力＝{TRACE_BASE}−（ブレ×斬り抜き補正）。{judge}")
            if beat:
                streak_t.color = ft.Colors.AMBER
                streak_t.value = f"🔥 {rs['streak']}連勝中！" if rs["streak"] >= 1 else ""
                cont_btn.content.value = "次の相手へ"
            else:
                streak_t.color = ft.Colors.WHITE54
                streak_t.value = "連勝ストップ…再起を期せ"
                cont_btn.content.value = "もう一度"
            play(win_au if beat else lose_au)
            cont_btn.visible = True
            back_btn.visible = True
            score_panel.scale = ft.Scale(0.4)
            page.update()
            await asyncio.sleep(0.03)
            score_panel.scale = ft.Scale(1.0)  # ドーン！
            page.update()

            res = await sb_submit(player_name, you, bucket=TRACE_BUCKET)
            rank = await sb_rank(you, bucket=TRACE_BUCKET)
            tail = {"offline": "オフライン", "updated": "自己ベスト更新！",
                    "inserted": "記録を登録！", "kept": "自己ベストには届かず",
                    "error": "送信失敗"}.get(res, "")
            rk = f"／ 全国 {rank} 位" if rank else ""
            detail.value += f"\n{tail} {rk}"
            page.update()

        async def run_round():
            nonlocal state
            rs["v"] += 1
            cur = rs["v"]
            rs.update({"pts": [], "t0": None, "last": None,
                       "active": False, "done": False, "n": 0})
            cont_btn.visible = False
            back_btn.visible = False
            score_panel.visible = False
            setup()
            you_label.value = player_name
            opp_label.value = rs["opp"]["name"]
            board.bgcolor = ft.Colors.WHITE
            board.clip_behavior = ft.ClipBehavior.HARD_EDGE
            board.content = board_canvas
            board_canvas.shapes = []  # 白紙からスタート
            state = VS
            status.value = f"相手：{rs['opp']['name']}"
            status.color = ft.Colors.WHITE
            detail.value = (f"相手の斬撃力 {TRACE_BASE - rs['opp']['score']} を超えろ"
                            "（大きいほど鋭い）")
            sk = rs["streak"]
            streak_t.color = ft.Colors.AMBER
            streak_t.value = f"🔥 {sk}連勝中" if sk >= 2 else ""
            page.update()
            await asyncio.sleep(1.3)
            if cur != rs["v"]:
                return

            # 構え（白紙）→ ランダム向きの太刀筋が一瞬だけ赤く閃く→消える→斬る
            state = IZA
            status.value = "構え…　太刀筋を見切れ"
            status.color = ft.Colors.WHITE
            detail.value = "斬撃線が一瞬だけ閃く。その筋をまっすぐ斬れ"
            board_canvas.shapes = []
            page.update()
            await asyncio.sleep(random.uniform(0.6, 1.4))
            if cur != rs["v"]:
                return

            play_slap()  # 閃光（相手の太刀筋が赤く走る）
            board_canvas.shapes = line_shapes([rs["guide"]["A"], rs["guide"]["B"]],
                                              "#E53935", 6)
            page.update()
            await asyncio.sleep(0.3)  # ほんの一瞬
            if cur != rs["v"]:
                return
            board_canvas.shapes = []  # すぐ消える
            page.update()

            state = GO
            rs["active"] = True
            status.value = "斬れ！"
            status.color = ft.Colors.RED_300
            detail.value = "太刀筋に沿って、いかにまっすぐ斬れるか。離したら確定"
            page.update()

        async def leave(e=None):
            rs["v"] += 1  # 進行中ラウンドを無効化
            await show_title()

        root.content = ft.Column(
            expand=True,
            spacing=0,
            controls=[
                mobile_top_bar(page, "◀ タイトル", leave, new_mute_button()),
                ft.Container(
                    expand=True,
                    padding=safe_pad(8, 20, 12),
                    content=ft.Column(
                        expand=True,
                        spacing=10,
                        horizontal_alignment=ft.CrossAxisAlignment.CENTER,
                        scroll=ft.ScrollMode.AUTO,
                        controls=[
                            mob_card(
                                ft.Row(
                                    [you_label,
                                     ft.Container(
                                         width=40, height=40, border_radius=20,
                                         bgcolor=PALETTE["surface2"],
                                         border=ft.Border.all(2, PALETTE["accent"]),
                                         alignment=ft.Alignment(0, 0),
                                         content=ft.Text("VS", size=12, weight=ft.FontWeight.BOLD,
                                                         color=PALETTE["accent"]),
                                     ),
                                     opp_label],
                                    alignment=ft.MainAxisAlignment.CENTER,
                                    spacing=12,
                                ),
                                width=mob_w(page, 0.96),
                            ),
                            gd,
                            status,
                            score_panel,
                            ft.Row([cont_btn, back_btn], spacing=12,
                                   alignment=ft.MainAxisAlignment.CENTER, wrap=True),
                            streak_t,
                            detail,
                        ],
                    ),
                ),
            ],
        )
        page.update()

        g_rows = await sb_top(50, bucket=TRACE_BUCKET)
        for row in (g_rows or []):
            if row["name"] != player_name and row["reaction_ms"] < 100000:
                ghosts.append(row)
        ghosts.sort(key=lambda o: o["reaction_ms"], reverse=True)  # 弱い順
        await run_round()

    async def enter_game(m: str):
        nonlocal mode, streak
        mode = m
        streak = 0
        my_name_text.value = player_name
        label = "孤城突破" if m == "cpu" else "死闘"
        sub_label = "剣豪を斬り抜け" if m == "cpu" else "ゴーストと勝負"
        await battle_deploy_banner(label, sub_label)
        root.content = game_view
        sync_game_chrome()
        page.update()
        if mode == "pvp":
            await fetch_opponents()
        page.run_task(play_round)

    async def fetch_opponents():
        rows = await sb_top(50)
        current_opponents.clear()
        for row in (rows or []):
            if row["name"] != player_name and row["reaction_ms"] < 90000:
                current_opponents.append(row)
        # 弱い（遅い）順に並べておく。連勝数でこのリストを上（強い方）へ辿る
        current_opponents.sort(key=lambda o: o["reaction_ms"], reverse=True)

    # ================= 1ラウンドの進行 =================
    def mode_label() -> str:
        if mode == "pvp":
            return "対人戦"
        return f"突破戦 ― {streak}/{CPU_CLEAR}人撃破"

    def setup_opponent():
        nonlocal opponent
        if mode == "cpu":
            # 突破式：撃破数だけ相手が速くなる（敵は剣豪・幕末志士）
            opponent = {"name": random.choice(CPU_NAMES), "is_cpu": True,
                        "cfg": cpu_params(streak), "ms": None}
        elif current_opponents:
            # current_opponents は弱い順。連勝数だけ上（強い方）へ寄せて選ぶ。
            n = len(current_opponents)
            target = min(n - 1, streak)
            lo = max(0, target - 1)
            hi = min(n - 1, target + 1)
            o = random.choice(current_opponents[lo:hi + 1])
            opponent = {"name": o["name"], "is_cpu": False, "ms": o["reaction_ms"]}
        else:
            opponent = {"name": random.choice(CPU_NAMES), "is_cpu": True,
                        "cfg": cpu_params(streak), "ms": None}

    async def reveal_opponent(name: str, strokes: list, cur: int):
        # 抜刀一閃ワイプ：暗転→斬撃の光が走り→その一閃から相手が浮かぶ→フェード
        sc = 300 / CANVAS_SIZE
        shapes: list = []
        for st in strokes:
            pts = st.get("p", [])
            col = st.get("c", "#111111")
            w = max(1.0, st.get("w", 6) * sc)
            paint = ft.Paint(color=col, stroke_width=w,
                             style=ft.PaintingStyle.STROKE, stroke_cap=ft.StrokeCap.ROUND)
            if len(pts) == 1:
                x, y = pts[0]
                shapes.append(cv.Circle(x * sc, y * sc, w / 2, ft.Paint(color=col)))
            for i in range(1, len(pts)):
                x1, y1 = pts[i - 1]
                x2, y2 = pts[i]
                shapes.append(cv.Line(x1 * sc, y1 * sc, x2 * sc, y2 * sc, paint))

        avatar_box = ft.Container(
            width=300, height=300, bgcolor=ft.Colors.WHITE, border_radius=10,
            clip_behavior=ft.ClipBehavior.HARD_EDGE, content=cv.Canvas(shapes),
            opacity=0.0, scale=ft.Scale(0.82),
            animate_opacity=ft.Animation(320, ft.AnimationCurve.EASE_OUT),
            animate_scale=ft.Animation(320, ft.AnimationCurve.EASE_OUT))
        name_text = ft.Text(name, size=26, weight=ft.FontWeight.BOLD,
                            color=ft.Colors.WHITE, opacity=0.0,
                            animate_opacity=ft.Animation(320, ft.AnimationCurve.EASE_OUT))
        slash = ft.Container(
            width=1300, height=5, bgcolor=ft.Colors.WHITE, border_radius=4,
            rotate=ft.Rotate(-0.5), scale=ft.Scale(scale_x=0.0),
            animate_scale=ft.Animation(170, ft.AnimationCurve.EASE_IN),
            animate_opacity=ft.Animation(220, ft.AnimationCurve.EASE_OUT),
            shadow=ft.BoxShadow(blur_radius=26, color=ft.Colors.CYAN_200))
        flash = ft.Container(expand=True, bgcolor=ft.Colors.WHITE, opacity=0.0,
                             animate_opacity=ft.Animation(140, ft.AnimationCurve.EASE_OUT))
        overlay = ft.Container(
            expand=True, bgcolor=ft.Colors.BLACK, opacity=1.0,
            animate_opacity=ft.Animation(520, ft.AnimationCurve.EASE_IN),
            content=ft.Stack(controls=[
                ft.Container(expand=True, alignment=ft.Alignment(0, 0),
                             content=ft.Column([avatar_box, name_text], spacing=14,
                                  alignment=ft.MainAxisAlignment.CENTER,
                                  horizontal_alignment=ft.CrossAxisAlignment.CENTER)),
                ft.Container(expand=True, alignment=ft.Alignment(0, 0), content=slash),
                flash,
            ]))
        page.overlay.append(overlay)
        page.update()

        def cleanup():
            if overlay in page.overlay:
                page.overlay.remove(overlay)
            page.update()

        await asyncio.sleep(0.35)  # 一瞬の静寂
        if token != cur:
            cleanup()
            return

        # 斬撃！ 一閃が走る
        play(slap)
        slash.scale = ft.Scale(scale_x=1.0)
        page.update()
        await asyncio.sleep(0.16)
        flash.opacity = 0.7  # 衝撃の白フラッシュ
        page.update()
        await asyncio.sleep(0.07)
        flash.opacity = 0.0
        # 一閃の軌跡から相手が浮かび上がる
        avatar_box.opacity = 1.0
        avatar_box.scale = ft.Scale(1.0)
        name_text.opacity = 1.0
        slash.opacity = 0.0
        page.update()
        await asyncio.sleep(1.0)
        if token != cur:
            cleanup()
            return

        overlay.opacity = 0.0  # だんだん薄く
        page.update()
        await asyncio.sleep(0.55)
        cleanup()

    async def play_round():
        nonlocal state, token, go_time
        cur = token = token + 1
        setup_opponent()
        opp_name_text.value = opponent["name"]
        opp_time_text.value = "？？？"
        render_avatar(opp_av_holder, [])

        state = VS
        sync_game_chrome()
        stage.bgcolor = PALETTE["bg"]
        iza_image.visible = False
        end_buttons.visible = False
        big.color = PALETTE["accent"]
        if mode == "pvp" and streak >= 2:
            set_streak(f"🔥 {streak}連勝中")
        elif mode == "cpu" and streak >= 1:
            set_streak(f"⚔ {streak}/{CPU_CLEAR}人撃破 ― あと{CPU_CLEAR - streak}人")
        else:
            set_streak("")
        iza_image.width = mob_w(page, 0.9)

        # 相手の自画像を取得
        opp_av = parse_avatar(await sb_avatar_get(opponent["name"]))
        if token != cur:
            return
        render_avatar(opp_av_holder, opp_av)

        if opp_av:
            # 自画像があれば白画面に左上から描き出す演出
            info.value = ""
            head.value = ""
            big.value = ""
            sub.value = ""
            page.update()
            await reveal_opponent(opponent["name"], opp_av, cur)
            if token != cur:
                return
        else:
            # 自画像なし（CPUの剣豪など）は対戦カード
            info.value = "── 強敵襲来 ──"
            head.value = opponent["name"]
            head.color = PALETTE["accent2"]
            big.size = 56
            big.value = "VS"
            big.color = PALETTE["accent"]
            sub.value = f"{my_name_text.value}　挑む"
            sub.color = PALETTE["cyan"]
            stage.gradient = ft.LinearGradient(
                begin=ft.Alignment(0, -1), end=ft.Alignment(0, 1),
                colors=["#3A1018", "#120810", "#0A1020"],
            )
            page.update()
            await asyncio.sleep(1.6)
            if token != cur:
                return

        # いざ、尋常に
        state = IZA
        sync_game_chrome()
        head.value = ""
        head.color = PALETTE["text"]
        big.value = ""
        sub.value = ""
        sub.color = PALETTE["muted"]
        set_streak("")
        stage.gradient = None
        stage.bgcolor = "#0A080C"
        iza_image.visible = True
        page.update()
        await asyncio.sleep(1.2)
        if token != cur:
            return

        # 静寂（画面・音ともに最小限）
        state = WAITING
        sync_game_chrome()
        iza_image.visible = False
        stage.bgcolor = "#030305"
        stage.gradient = None
        info.value = ""
        head.value = ""
        head.color = "#2A2830"
        big.size = 0
        big.value = ""
        sub.value = ""
        sub.color = "#1E1C22"
        page.update()
        page.run_task(fade_bgm, 0.0, 12, 0.05)
        wait_sec = max(0.2, random.uniform(random.choice(WAITS) - JITTER,
                                             random.choice(WAITS) + JITTER))
        await asyncio.sleep(wait_sec)
        if token != cur or state != WAITING:
            return
        page.run_task(fade_bgm, 0.35, 6, 0.04)

        # 合図！
        state = GO
        sync_game_chrome()
        go_time = time.perf_counter()
        await battle_flash("#FF1744", peak=0.75, hold=0.05)
        stage.bgcolor = ft.Colors.WHITE
        stage.gradient = None
        info.value = ""
        head.value = ""
        big.size = 240
        big.value = "！"
        big.color = ft.Colors.RED_700
        sub.value = "斬れ！！"
        sub.color = ft.Colors.RED_900
        play_signal()
        page.update()

    def foul():
        nonlocal state, token, streak
        token += 1
        state = FOUL
        sync_game_chrome()
        prev = streak
        streak = 0  # フライングで終了（突破・連勝ともにリセット）
        play(foul_au)
        page.run_task(fade_bgm, 0.35, 4)
        stage.bgcolor = "#3E2723"
        iza_image.visible = False
        info.value = ""
        head.value = "未熟……"
        big.size = 110
        big.value = "\u2716"
        big.color = ft.Colors.WHITE
        if mode == "cpu" and prev > 0:
            set_streak(f"フライングで終了 ― {prev}人抜き", PALETTE["muted"])
        else:
            set_streak("")
        sub.value = "斬る前に動いた（未熟）"
        opp_time_text.value = ""
        continue_btn.content.value = "再挑戦"
        end_buttons.visible = True
        page.update()

    async def resolve():
        nonlocal state, token, streak, cpu_cleared
        you = round((time.perf_counter() - go_time) * 1000)
        cur = token = token + 1

        # --- 「！」を斬る一閃（白背景の合図を真っ二つにして飛ばす）---
        split_anim = ft.Animation(280, ft.AnimationCurve.EASE_OUT)
        ex_top = ft.Text("！", size=220, weight=ft.FontWeight.BOLD,
                         color=ft.Colors.RED_700, offset=ft.Offset(0, 0),
                         rotate=ft.Rotate(0, alignment=ft.Alignment(0, 0)),
                         animate_offset=split_anim, animate_rotation=split_anim,
                         animate_opacity=split_anim)
        ex_bot = ft.Text("！", size=220, weight=ft.FontWeight.BOLD,
                         color=ft.Colors.RED_700, offset=ft.Offset(0, 0),
                         rotate=ft.Rotate(0, alignment=ft.Alignment(0, 0)),
                         animate_offset=split_anim, animate_rotation=split_anim,
                         animate_opacity=split_anim)
        blade = ft.Container(
            width=1600, height=6, bgcolor=ft.Colors.CYAN_300, border_radius=4,
            rotate=ft.Rotate(-0.62), scale=ft.Scale(scale_x=0.0),
            animate_scale=ft.Animation(110, ft.AnimationCurve.EASE_OUT),
            animate_opacity=ft.Animation(240, ft.AnimationCurve.EASE_OUT),
            shadow=ft.BoxShadow(blur_radius=30, spread_radius=2,
                                color=ft.Colors.CYAN_200))
        cut_overlay = ft.Container(
            expand=True, content=ft.Stack(controls=[
                ft.Container(expand=True, alignment=ft.Alignment(0, 0), content=ex_top),
                ft.Container(expand=True, alignment=ft.Alignment(0, 0), content=ex_bot),
                ft.Container(expand=True, alignment=ft.Alignment(0, 0), content=blade),
            ]))
        big.value = ""  # 元の「！」は割れる演出に置き換える
        page.overlay.append(cut_overlay)
        page.update()
        play_slap()  # 斬撃音
        await asyncio.sleep(0.03)
        blade.scale = ft.Scale(scale_x=1.0)  # 一閃が走る
        page.update()
        await asyncio.sleep(0.11)
        # 真っ二つになって飛ぶ
        ex_top.offset = ft.Offset(-0.18, -0.24)
        ex_top.rotate = ft.Rotate(-0.38, alignment=ft.Alignment(0, 0))
        ex_top.opacity = 0.0
        ex_bot.offset = ft.Offset(0.18, 0.28)
        ex_bot.rotate = ft.Rotate(0.38, alignment=ft.Alignment(0, 0))
        ex_bot.opacity = 0.0
        blade.opacity = 0.0
        page.update()
        await asyncio.sleep(0.26)
        if cut_overlay in page.overlay:
            page.overlay.remove(cut_overlay)
        page.update()
        if token != cur:
            return

        if opponent.get("is_cpu"):
            cfg = opponent["cfg"]
            opp_ms = round(max(120.0, random.gauss(cfg["mean"], cfg["sd"])))
        else:
            opp_ms = int(opponent["ms"])
        opp_time_text.value = f"{fmt_sec(opp_ms)}秒"

        beat = you < opp_ms
        prev = streak
        streak = streak + 1 if beat else 0
        cleared = mode == "cpu" and beat and streak >= CPU_CLEAR
        if cleared and not cpu_cleared:
            cpu_cleared = True
            await prefs.set("iai.cpu_cleared", True)
        dan, dan_color = dan_title(you)

        # --- 抜刀演出（勝った方の刃が一閃）---
        state = REVEAL
        sync_game_chrome()
        iza_image.visible = False
        stage.gradient = None
        stage.bgcolor = "#5A1018" if beat else "#0A1428"
        head.value = "勝利の一閃！" if beat else f"{opponent['name']} の刃が先だった"
        head.color = PALETTE["accent"] if beat else PALETTE["accent2"]
        big.size = 180
        big.value = "斬"
        big.color = PALETTE["accent"] if beat else PALETTE["accent2"]
        set_streak("")
        info.value = ""
        sub.value = "剣が光を裂いた" if beat else "一歩及ばなかった…"
        sub.color = PALETTE["muted"]
        if cleared:
            play(clear_au or win_au)
        else:
            play(win_au if beat else lose_au)
        page.update()
        await asyncio.sleep(0.85)
        if token != cur:
            return

        # --- 結果表示 ---
        state = RESULT
        sync_game_chrome()
        if cleared:
            stage.bgcolor = "#4A3000"
            head.value = "孤城突破！！"
            head.color = PALETTE["accent"]
        else:
            stage.bgcolor = "#5A1018" if beat else "#0A1428"
            head.value = "撃破！" if beat else "討ち死に…"
            head.color = PALETTE["accent"] if beat else PALETTE["muted"]
        big.size = 104
        big.value = f"{fmt_sec(you)}秒"
        big.color = PALETTE["accent"] if beat else PALETTE["text"]
        if mode == "cpu":
            # 突破式：5人抜きでクリア（段位は併記）
            if cleared:
                set_streak(f"🎉 {CPU_CLEAR}人斬り抜き！（段位：{dan}）")
                cont_label = "再び挑む"
                streak = 0  # 次は最初から
            elif beat:
                set_streak(f"⚔ {streak}/{CPU_CLEAR}人撃破！（{dan}）あと{CPU_CLEAR - streak}人")
                cont_label = "次の敵へ"
            else:
                set_streak(f"力尽きた… {prev}人で終わり", PALETTE["muted"])
                cont_label = "再起を期す"
            info.value = (f"あなた {fmt_sec(you)}秒（{dan}） ／ "
                          f"{opponent['name']} {fmt_sec(opp_ms)}秒")
        else:
            # 対人戦は「連勝数」が主役
            head.value = "勝利！" if beat else "敗北…"
            if beat:
                set_streak(f"🔥 {streak}連勝！剣は止まらぬ")
                cont_label = "次の敵へ"
            else:
                set_streak("連勝ストップ…血を拭え", PALETTE["muted"])
                cont_label = "再起を期す"
            info.value = f"あなた {fmt_sec(you)}秒 ／ {opponent['name']} {fmt_sec(opp_ms)}秒"
        sub.value = f"{you} ms　記録を送信中..."
        page.update()

        result = await sb_submit(player_name, you)
        if mode == "pvp" and streak >= 1:
            await sb_streak_submit(player_name, streak)
        rank = await sb_rank(you)

        tail = {"offline": "（オフライン）", "updated": "自己ベスト更新！",
                "inserted": "記録を登録！", "kept": "自己ベストには届かず",
                "error": "送信失敗"}.get(result, "")
        rank_txt = f"／ 全国 {rank} 位" if rank else ""
        sub.value = f"{you} ms　{tail} {rank_txt}"
        continue_btn.content.value = cont_label
        end_buttons.visible = True
        page.update()

    async def handle_tap(e):
        if state == WAITING:
            foul()
        elif state == GO:
            await resolve()
        # VS / IZA / REVEAL / RESULT / FOUL 中のタップは無視
        # （結果後は「続ける／タイトルへ」ボタンで選択）

    stage.on_click = handle_tap

    def on_resize(e):
        root.padding = safe_pad()
        page.update()

    page.on_resize = on_resize
    page.add(root)
    await show_splash()


generate_assets()
ft.run(main, assets_dir=str(ASSETS_DIR))
