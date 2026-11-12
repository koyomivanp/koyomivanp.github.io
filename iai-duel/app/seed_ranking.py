# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx>=0.27"]
# ///
#
# ランキングに架空ユーザーを約100人投入するシード用スクリプト。
#   実行: uv run seed_ranking.py
#   - iai_scores  (pattern_id=1) … タイムランキング（reaction_ms）
#   - iai_scores  (pattern_id=2) … なぞり斬り（内部ブレ値。斬撃力=300-値）
#   - iai_streaks               … 対人戦の連勝ランキング
# 重複しても安全なように on_conflict + merge-duplicates で upsert する。

import random

import httpx

SUPABASE_URL = "https://mjattwfxzpefgklbqlpz.supabase.co"
SUPABASE_ANON_KEY = "sb_publishable_d5SnRIbuJGfntfjOObIWWw_iKR0GOt9"
TRACE_BASE = 300

random.seed(20260611)


def headers(extra=None):
    h = {"apikey": SUPABASE_ANON_KEY,
         "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
         "Content-Type": "application/json"}
    if extra:
        h.update(extra)
    return h


# ---- SNSユーザーがよく使いそうな名前を生成 ----
ADJ = ["yuki", "haru", "sora", "rin", "aki", "mio", "ken", "ryo", "nao", "kei",
       "shun", "tomo", "yui", "kai", "ren", "mei", "saki", "taku", "hina", "jun",
       "neko", "inu", "tori", "kuma", "usagi", "panda", "fox", "wolf", "shadow",
       "lunar", "solar", "frost", "blaze", "storm", "ghost", "cyber", "retro",
       "pixel", "mochi", "ramen", "sushi", "matcha", "sakura", "ame", "kaze"]
NOUN = ["chan", "kun", "san", "lover", "master", "hunter", "gamer", "dreamer",
       "ninja", "samurai", "knight", "rider", "walker", "maker", "777", "0v0",
       "x", "z", "tv", "ch", "pro", "fan", "club", "world", "life", "days",
       "note", "log", "diary", "room", "lab", "works", "style", "mode"]
KANA = ["ぴよ", "もち", "ぷりん", "うさ", "ねこ", "ぽち", "たま", "みけ",
       "ちゃちゃ", "こてつ", "むぎ", "あずき", "きなこ", "だいふく", "わさび",
       "ゆず", "れもん", "みかん", "ぶどう", "いちご"]
KANA_SUF = ["丸", "之介", "ちゃん", "さん", "先生", "大将", "侍", "P", "氏", ""]


def make_names(n):
    names = set()
    styles = ["adj_noun", "adj_num", "adj_noun_num", "kana", "kana_suf",
              "adj_und_noun", "noun_adj"]
    while len(names) < n:
        s = random.choice(styles)
        if s == "adj_noun":
            nm = random.choice(ADJ) + random.choice(NOUN)
        elif s == "adj_num":
            nm = random.choice(ADJ) + str(random.randint(0, 9999))
        elif s == "adj_noun_num":
            nm = random.choice(ADJ) + random.choice(NOUN) + str(random.randint(1, 99))
        elif s == "kana":
            nm = random.choice(KANA) + random.choice(KANA)
        elif s == "kana_suf":
            nm = random.choice(KANA) + random.choice(KANA_SUF)
        elif s == "adj_und_noun":
            nm = random.choice(ADJ) + "_" + random.choice(NOUN)
        else:
            nm = random.choice(NOUN) + "_" + random.choice(ADJ)
        if 2 <= len(nm) <= 16:
            names.add(nm)
    return list(names)


def reaction_ms():
    # 多くは200-450ms、少数の達人140-200、遅い人450-650
    r = random.random()
    if r < 0.15:
        return random.randint(140, 200)
    if r < 0.85:
        return int(random.gauss(320, 70))
    return random.randint(450, 650)


def trace_value():
    # 内部ブレ値（DBのCHECK制約に合わせ最低50）。斬撃力=300-値。人間はブレやすいので弱め
    r = random.random()
    if r < 0.15:
        v = random.randint(90, 140)      # 達人（斬撃力 160-210）
    elif r < 0.7:
        v = int(random.gauss(195, 28))   # 平均的（斬撃力 80-130 あたり）
    else:
        v = random.randint(235, 262)     # 初心者（斬撃力 38-65）
    return max(50, min(262, v))


def streak():
    r = random.random()
    if r < 0.6:
        return random.randint(1, 6)
    if r < 0.9:
        return random.randint(7, 15)
    return random.randint(16, 30)


def upsert(table, rows, on_conflict):
    url = f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={on_conflict}"
    h = headers({"Prefer": "resolution=merge-duplicates,return=minimal"})
    with httpx.Client(timeout=30) as cli:
        r = cli.post(url, headers=h, json=rows)
        print(f"  {table}: status={r.status_code} rows={len(rows)}"
              + ("" if r.status_code in (200, 201, 204) else f" body={r.text[:300]}"))


def main():
    names = make_names(100)
    print(f"生成した名前 {len(names)} 件。例: {', '.join(names[:8])} ...")

    time_rows = [{"pattern_id": 1, "name": nm,
                  "reaction_ms": max(120, reaction_ms())} for nm in names]
    trace_rows = [{"pattern_id": 2, "name": nm,
                   "reaction_ms": max(50, trace_value())} for nm in names]
    streak_rows = [{"name": nm, "streak": streak()} for nm in names]

    print("投入中...")
    upsert("iai_scores", time_rows, "pattern_id,name")
    upsert("iai_scores", trace_rows, "pattern_id,name")
    upsert("iai_streaks", streak_rows, "name")
    print("完了。アプリのランキングを開いて確認してね。")


if __name__ == "__main__":
    main()
