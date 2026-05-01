# line-stamp

LINE スタンプを画像生成 AI で量産するためのツール。Gemini (nano-banana-2 / Flash Image) と OpenAI (gpt-image-*) を `--provider` で切り替え可能。**Claude Code との対話で進める前提**で、手順をガチガチに固めず 4 フェーズの境界だけを揃えた構成。

## セットアップ

```bash
./scripts/setup.sh           # ffmpeg / imagemagick / bun を冪等インストール、.env を生成
# .env に GEMINI_API_KEY か OPENAI_API_KEY のどちらか（両方可）を入れる
#   Gemini: https://aistudio.google.com/apikey
#   OpenAI: https://platform.openai.com/api-keys
bun start                    # 対話メニュー (Claude Code 経由で各フェーズに入る)
```

## 4 フェーズ

| # | フェーズ | 内容 |
|---|---|---|
| 1 | 参照画像（キャラ）作り | モチーフ・画風を対話で詰めて `ref.png` を確定 |
| 2 | manifest + フォント決定 | 全スタンプの caption / prompt とフォントを決定 |
| 3 | 量産 + 後処理 | 全枚数を生成 → 緑バック透過処理 → caption 焼き込み |
| 4 | 提出 ZIP | LINE 仕様チェック → `<set>.zip` 出力 |

## 画像生成コマンド

```bash
bun run gen "<prompt>" -o cand-01 -d user/character/foo/candidates
# --provider openai で OpenAI に切替、PROVIDER env で常用デフォを変更可
```

## 詳細

仕様・ガードレール・既知の落とし穴・コスト目安・manifest スキーマは **[CLAUDE.md](./CLAUDE.md)** に集約。

## ライセンス

[MIT](./LICENSE)
