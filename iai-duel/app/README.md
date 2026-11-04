# 居合デュエル ― 刹那の見切り

Flet 製の反射神経＆斬撃ゲーム。Supabase をバックエンドにしたオンラインランキング・非同期対戦つき。

## ポートフォリオ

- 作品ページ: [koyomivanp.github.io/iai-duel/](https://koyomivanp.github.io/iai-duel/)
- リポジトリ: [github.com/koyomivanp/iai-duel](https://github.com/koyomivanp/iai-duel)

## モード
- **CPU戦（突破式）**: 1人倒すごとに相手が速くなる。5人抜きでクリア。
- **対人戦**: 保存された他人のゴースト（反応時間）と勝負。連勝が伸びるほど強敵に。
- **なぞり斬り**: 一瞬だけ閃く「太刀筋」（ランダム向きの直線）を記憶し、いかにまっすぐ斬れるかを競う。斬った後は紙が切り口に沿って割れて落ちる演出つき。斬撃力（大きいほど鋭い）でランキング。
- **自画像を描く**: 描いた自画像が対戦時に相手へ表示される（抜刀一閃ワイプ演出）。

## 実行（ローカル / デスクトップ）

[uv](https://docs.astral.sh/uv/) を使うと依存解決込みで一発起動できる（スクリプト先頭に PEP 723 の依存メタdata を記載）。

```bash
uv run iai_duel.py
```

## スマホ / Web で遊ぶ

BGM・効果音は **「TAP TO START」をタップしたあと** に再生されます（スマホの autoplay 制限対策）。
Web 配信でも `flet-audio` が使えれば音が鳴ります。

### 同じ Wi-Fi の PC から配信してスマホのブラウザで開く

```bash
# PC 側で Web サーバとして起動
set FLET_FORCE_WEB_SERVER=true   # PowerShell: $env:FLET_FORCE_WEB_SERVER="true"
uv run iai_duel.py
# スマホのブラウザで http://<PCのIP>:8550 を開く
# タイトルの TAP TO START を押すと風の BGM がループ再生されます
```

### Docker（Hugging Face Spaces 等）

`Dockerfile` を使って Web サーバとしてデプロイできる（ポート 7860）。

```bash
docker build -t iai-duel .
docker run -p 7860:7860 iai-duel
```

## ランキングのシード（任意）

架空ユーザーをランキングに投入してにぎやかにするスクリプト。

```bash
uv run seed_ranking.py
```

## 構成
- `iai_duel.py` … 本体（ゲーム・UI・Supabase 連携・効果音の自動生成）
- `assets/` … いざ画像（`iza.png`）と自動生成された効果音 wav
- `seed_ranking.py` … ランキング用のダミーデータ投入
- `Dockerfile` / `requirements.txt` … Web デプロイ用

## バックエンド
Supabase（PostgreSQL + REST）。テーブル: `iai_scores`（反応時間 / なぞり斬りスコアを `pattern_id` で分離）、`iai_streaks`（連勝）、`iai_avatars`（自画像）。匿名アクセス用に RLS を設定。コード内のキーは公開可能な publishable キー。
