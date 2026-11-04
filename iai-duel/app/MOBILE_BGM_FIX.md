# スマホで BGM が一瞬鳴って止まる問題 — 修正内容

## 原因

1. **`autoplay=True` で起動直後に BGM を開始していた**  
   iOS / Android Chrome などは、ユーザー操作なしの自動再生を拒否します。一瞬聞こえてすぐ止まると報告されがちです。
2. **「TAP TO START」でも `play()` し直していなかった**  
   自動再生が止まると、その後ずっと無音のままになっていました。
3. **ミュート解除が `resume()` のみ**  
   一度も正常に `play()` できていない／OS に止められた場合、`resume()` では再開できません。
4. **Web では音を丸ごと無効化していた**  
   スマホブラウザ経由で遊ぶと音が出ない設計でした（`flet-audio` は現在 Web 対応）。

## 修正

- `autoplay=False` に変更
- タイトルの **TAP TO START**（およびミュート解除）で `ensure_bgm()` → `play()` する
- SE は `ReleaseMode.STOP`、BGM は `LOOP` + `completed` 時の再開フォールバック
- Web でも音声を有効化（初期化失敗時のみ無効）

## 上流リポジトリへの反映

このディレクトリは `koyomivanp/iai-duel` の修正版スナップショットです。  
本体リポジトリへは、この `iai_duel.py` / `README.md` をコピーしてマージしてください。
