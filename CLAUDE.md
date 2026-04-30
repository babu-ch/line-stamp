# stamps — LINE スタンプ生成プロジェクト

画像生成 API を使って LINE スタンプを作る。デフォは **nano-banana-2** (Gemini 3.1 Flash Image)、`--provider openai` で **gpt-image-1**（OpenAI 既定）/ `gpt-image-2` にも切り替えられる。
Claude Code との対話で進めることが前提。手順をガチガチに固めず、フェーズの境界だけ揃える。

## セットアップ

```bash
./scripts/setup.sh   # 冪等。ffmpeg/imagemagick/bun + .env 生成
# .env に GEMINI_API_KEY か OPENAI_API_KEY のどちらか（両方でも可）を入れる
#   Gemini: https://aistudio.google.com/apikey
#   OpenAI: https://platform.openai.com/api-keys
```

## 4 フェーズ

| # | フェーズ | モード | Claude の振る舞い |
|---|---|---|---|
| 1 | 参照画像（キャラ）作り | **ループ** | モチーフ/画風/雰囲気をユーザーから言葉で引き出し、`ref.png` が確定するまで反復 |
| 2 | スタンプ一覧（manifest）＋フォント決定 | **ループ** | captions+prompt のドラフト＆**フォント比較画像**を提示し、ユーザー編集で確定 |
| 3 | 量産＋後処理 | **自動** | manifest を読んで全枚数生成 → 後処理（**目の透過チェック含む**）→ main(240×240)/tab(96×74) を ref から自動派生 |
| 4 | 提出 ZIP | **自動** | LINE 仕様の最終チェック → `png/` 構造の ZIP → **フルパスを 1 行で返す** |

原則: **1, 2 はユーザー判断を待ち、3, 4 は無指示で続行**。
ただし対象（キャラ / セット）が**複数あって一意に決まらない**時は確認を取る。
3 で main/tab を別カットにしたい等の希望は、ユーザーが言ってきたら受ける。

`user/character/<name>/` と `user/sets/<set>/` は **複数並存できる**（1 キャラに複数セット、別キャラに別セット、いずれも可）。新規セッション開始時は全部スキャンしてから動く。

## LINE スタンプ仕様（通常 / Static）

| 項目 | 値 |
|---|---|
| スタンプ画像 | 最大 370×320 px / PNG / 透過 / 偶数px / 1MB以下 / 周囲10px程度のマージン |
| メイン画像 | 240×240 px |
| トークルームタブ | 96×74 px |
| セット個数 | 8 / 16 / 24 / 32 / 40 |
| ZIP 全体 | 60MB 以下 |
| ファイル名 | `01.png`, `02.png`, ... フォルダ名は `png`（小文字） |
| 解像度 | 72 DPI 以上 / RGB |

## フェーズ 1：参照画像（ループ）

ユーザーから引き出す: モチーフ / 画風・色味 / 用途・雰囲気 / 案出しは Claude かユーザー指定か / **どの provider で生成するか**（未指定なら nano）。

- 候補は **並列生成**（`xargs -P 4`）。
- 採用案を `user/character/<name>/ref.png` にコピー、確定プロンプトを `style.md` に保存。
- **目の描き方を意識**: 後段の緑バック透過処理で**目の中も抜けがち**（白目・ハイライト・緑寄りの瞳）。プロンプトで `solid black dot eyes`, `dark eyes outlined in black` のように **緑から十分離れた色** で描かせる。白目を入れる場合は黒で輪郭を閉じておく。

## フェーズ 2：manifest ＋ フォント決定（ループ）

ユーザーから引き出す: 対象キャラ / セット個数 / 全体テーマ / provider 選択（未指定なら nano）。

**手順**:
1. Claude が captions+prompt の JSON ドラフトを提示 → ユーザー編集で確定。
2. **フォント比較画像を生成**: 既存 raw が無ければ ref.png をベースに、代表 caption（例: 一番長いやつ + 一番短いやつ）を **候補フォント数本で焼いた `font-test/comparison.png`** を作成して提示。
   - 候補（macOS デフォルト）: `851_kanaA`, `851_kanaB`, `Hiragino Maru Gothic ProN W4`, `Hiragino Sans W6/W9`, `cinecaption`, `huifont`, `ketai-dot`。新規追加はユーザー指定。
3. ユーザーがフォント採用 → `manifest.json` の `font.path` に絶対パスを書く。
4. すべて確定したら `user/sets/<set>/manifest.json` に保存。

```json
{
  "set": { "name": "string", "count": 8 },
  "character": { "ref": "user/character/<name>/ref.png", "style_md": "user/character/<name>/style.md" },
  "font": { "path": "/Users/<you>/Library/Fonts/851_kanaA.ttf" },
  "provider": "nano",
  "model": "flash",
  "stickers": [
    { "id": "01", "caption": "おはよう", "prompt": "waving hand, morning vibes" }
  ],
  "output": { "margin_px": 12, "max_file_size_mb": 1 }
}
```

`provider` / `model` はセット単位デフォ。スタンプ個別に上書きしたい時は `stickers[].provider` / `stickers[].model` を書く（混在 OK、後処理は同一フロー）。

## フェーズ 3：量産＋後処理（自動）

manifest（font 含む）が揃ったら追加指示なしで進める。

1. 各スタンプを `bun run gen` で個別生成 → `raw/NN.<ext>`（並列で）。manifest の `provider` / `model` を引き渡し。
2. `scripts/process-set.sh <set>` で後処理（透過 / 余白 ≥10px / 偶数 / 370×320 内フィット / caption 焼き込み / 1MB 以下）→ `processed/NN.png`。フォントは manifest.json の `font.path` を使用。raw の拡張子は png/jpeg/jpg/webp 自動検出（provider 違いを吸収）。
3. **目の透過チェック**: `processed/*.png` を Read で目視し、目の中（瞳・白目）が抜けてないか確認。抜けが出ていれば該当 ID だけ:
   - プロンプトに `solid black filled eyes` を強調して再生成、または
   - process-set.sh の緑判定 fuzz をその画像だけ厳しくして再処理。
4. **main/tab は ref.png を ImageMagick で trim→fit→extent して派生**。コスト 0。別カットを使いたい時だけユーザーから言われる。
5. `processed/01..NN.png` を `submit/` にコピー、`main.png`/`tab.png` も `submit/` に置く。

## フェーズ 4：提出 ZIP（自動）

1. `submit/` 全ファイルに対し LINE 仕様の最終チェック（寸法・偶数・透過・1MB 以下）。
2. `png/` フォルダに 01.png〜NN.png + main.png + tab.png を入れた ZIP を作成 → `user/sets/<set>/<set>.zip`。
3. ZIP 合計 60MB 以下を確認。
4. **最後の出力は ZIP のフルパス 1 行**。前置き不要。

## 画像生成コマンドリファレンス

統一ラッパー: `bun run gen "<prompt>" --provider nano|openai <options>`。
provider 共通で**緑バック背景指示が自動で suffix される**（`--no-green-bg` で抑制）。後段の `process-set.sh` が緑を抜く前提。

### 共通オプション

| オプション | 意味 |
|---|---|
| `--provider` | `nano`（既定） / `openai` |
| `--model` | provider 別の既定あり |
| `-r, --ref` | 参照画像（複数可） |
| `-o, --output` | 出力ファイル名（拡張子なし） |
| `-d, --dir` | 出力ディレクトリ |
| `--no-green-bg` | 緑バック自動付与を抑制 |

### provider 別

| | nano (nano-banana-2) | openai (gpt-image-*) |
|---|---|---|
| 既定モデル | `flash` | `gpt-image-1`（`OPENAI_MODEL` env で上書き可） |
| 他モデル | `pro` | `gpt-image-1.5` / `gpt-image-2`（要 org verify） / `gpt-image-1-mini` |
| `-s, --size` | `512`（既定）/ `1K` / `2K` / `4K` | `1024x1024`（既定）/ `1536x1024` / `2048x2048` 等（16の倍数） |
| `--quality` | （無効） | `low` / `medium`（既定）/ `high` |
| `-a, --aspect` | `1:1` / `16:9` / `4:3` | （無効） |
| `-t, --transparent` | flag（緑除去まで CLI 内で完結） | **無視**（gpt-image-2 は透過非対応、`process-set.sh` 側で緑除去） |
| 参照画像 | `-r` を nano-banana CLI に転送 | `/v1/images/edits` を使用 |
| 出力 | nano-banana に従う | `<dir>/<output>.png`（PNG 固定） |

### 並列例

```bash
seq -w 1 4 | xargs -P 4 -I{} bun run gen "<prompt>" --provider nano -o cand-{} -d user/character/<name>/candidates
seq -w 1 4 | xargs -P 4 -I{} bun run gen "<prompt>" --provider openai --model gpt-image-2 --quality low -o cand-{} -d user/character/<name>/candidates
```

### コスト目安

| provider | モデル | サイズ | $/枚 | 40 枚 |
|---|---|---|---|---|
| nano | flash | 512 | $0.045 | $1.80 |
| nano | flash | 1K | $0.067 | $2.68 |
| nano | flash | 2K | $0.101 | $4.04 |
| nano | flash | 4K | $0.151 | $6.04 |
| nano | pro | (× 2 程度) | — | — |
| openai | gpt-image-1 | 1024 low | $0.011 | $0.44 |
| openai | gpt-image-1 | 1024 medium | $0.042 | $1.68 |
| openai | gpt-image-1 | 1024 high | $0.167 | $6.68 |
| openai | gpt-image-2 | 1024 low | $0.006 | $0.24 |
| openai | gpt-image-2 | 1024 medium | $0.053 | $2.12 |
| openai | gpt-image-2 | 1024 high | $0.211 | $8.44 |

**nano-banana 単独で叩きたい時**は `bun run nano-banana "<prompt>" -s 512 -m flash -t -o ... -d ...` も従来通り使える（`bun run nano-banana --costs` で累積コスト）。

## ディレクトリ構造

```
stamps/
├── CLAUDE.md
├── package.json / bun.lock / .env.example / .env
├── .claude/settings.json          # 壊れ画像 Read ガード等の hook
├── scripts/
│   ├── setup.sh
│   ├── cli.ts                     # bun start のメニュー
│   ├── gen.ts                     # 画像生成ラッパー (provider 切替)
│   ├── process-set.sh             # 緑除去 / フィット / caption / 1MB化
│   └── check-image-magic.sh       # PreToolUse hook 本体
└── user/                          # 全 .gitignore
    ├── character/<name>/
    │   ├── ref.png                # 参照画像
    │   ├── style.md               # 確定プロンプト
    │   └── candidates/            # 試作
    └── sets/<set>/
        ├── manifest.json
        ├── raw/                   # 生出力 (拡張子は provider 依存)
        ├── processed/             # 後処理中間
        ├── submit/                # 01..NN.png + main.png + tab.png
        └── <set>.zip              # 最終成果物
```

`user/` を自分で履歴管理したい場合は別 repo / submodule で。

## 既知の落とし穴

- **nano `-t`（透過）が CLI 内で失敗する環境がある**: ローカル ffmpeg の x265 dylib 未解決などで、nano-banana の colorkey + despill ステップが落ちて **空の/壊れた JPEG が `raw/` に残る**ことがある。残ったゴミファイルを Claude が Read すると Anthropic API が `400 Could not process image` を返してセッションが詰む。
  - 予防: `.claude/settings.json` の PreToolUse hook → `scripts/check-image-magic.sh` がマジックバイト不正の画像を Read 前にブロックする。
  - 復旧: 壊れた `raw/NN.<ext>` を削除して個別再生成。透過処理は ImageMagick 側でやり直す（`magick <src> -fuzz 30% -transparent "rgb(0,255,0)" -trim +repage <dst>.png`）。
- **gpt-image-2 は透過非対応**: `background: "transparent"` が API レベルで弾かれる。`bun run gen --provider openai` は緑バック付き prompt を自動生成して `process-set.sh` で抜く方針。透過対応モデルが必要なら `--model gpt-image-1` か `gpt-image-1.5`。
- **OpenAI 新世代モデルは organization verification (KYC) 必須**: OpenAI は新世代 / フロンティアモデル全般に対して org verification を要求するポリシーで、現時点では `gpt-image-2` が該当（`Your organization must be verified to use the model ...` で弾かれる）。今後 `gpt-image-3` 等の新モデルが出ても同じ扱いになる可能性が高い。verify 手順: https://platform.openai.com/settings/organization/general → "Verify Organization" → Persona 経由で ID + 顔認証（5〜15 分）、1 org 1 回で全 verify 必須モデル解禁。verify 不要モデル（`gpt-image-1` / `gpt-image-1.5` 等の旧世代）はそのまま使えるため、**デフォは `gpt-image-1` にしてある**。
- **gpt-image-1 はテキスト焼き込みが強い**: プロンプト中の英単語（特に caption 候補）をそのまま画像内テキストとして描き込みがち。process-set.sh で別途 caption を焼くと二重になるので、量産時は manifest の `prompt` から caption 系の語句を抜くか、`, no text, no letters, no words` を suffix に追加する。
- **OpenAI billing hard limit**: dashboard で hard limit を超えると `billing_hard_limit_reached` で全画像生成が弾かれる。Billing → Limits を確認。

## ガードレール

- **画像生成コマンドの前に見積もりを 1 行**: `N枚 × $X.XX = $Y.YY 程度（+20% 想定）`。合意とってから実行。provider / model / size に応じて上のコスト表を参照。
- **provider 既定**: `nano` (`flash` / `512`)。OpenAI への切替は明示依頼時のみ。
- **API キーを画面に出さない**。`.env` の中身を読み上げない。
- **ユーザー生成物は `user/` 配下にのみ書き込む**。ツール部分には触れない。
- **ノーヒントで始まったとき**: `user/character/*` と `user/sets/*` を全部スキャンして、各セットの進行度（`manifest.json` のみ / `raw/` 途中 / `processed/` 途中 / `submit/` 揃い / `<set>.zip` 完成）を **1 行ずつ列挙して報告**。そのうえで:
  - キャラもセットも 0 個 → フェーズ 1 に入る
  - **未完了の対象が 1 個だけ**（ref 未確定キャラ 1 / 未着手 manifest 1 / 量産途中セット 1 のいずれか）→ そのフェーズを自動で進める
  - **未完了が複数** or **どれを進めたいか曖昧** → どれを進めるか / 新規追加するかをユーザーに聞く
  - 全部完成済み → 「全セット zip 済み」と報告して指示を待つ

## Git 管理方針

**管理する**: `package.json`, `bun.lock`, `.env.example`, `.gitignore`, `CLAUDE.md`, `scripts/`, `.claude/settings.json`

**管理しない**（`.gitignore`）: `node_modules/`, `.env`, `.env.local`, `user/`, `.DS_Store`, `*.log`, `.vscode/`, `.idea/`, `*.swp`, `Thumbs.db`, `.claude/*.lock`
