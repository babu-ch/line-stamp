#!/usr/bin/env bash
# scripts/process-set.sh <set-name> [font-path]
#
# raw/NN.jpeg を緑キー除去 → 370x320内フィット → 文字合成 → processed/NN.png
#
# フォントの優先順位:
#   1. 第2引数 [font-path] が渡されたらそれを使う
#   2. manifest.json の .font.path
#   3. $HOME/Library/Fonts/851_kanaA.ttf （フォールバック）
set -euo pipefail

SET="${1:?usage: process-set.sh <set-name> [font-path]}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SET_DIR="$ROOT/user/sets/$SET"
RAW="$SET_DIR/raw"
OUT="$SET_DIR/processed"
MANIFEST="$SET_DIR/manifest.json"

[ -f "$MANIFEST" ] || { echo "manifest not found: $MANIFEST" >&2; exit 1; }

if [ -n "${2:-}" ]; then
  FONT="$2"
else
  manifest_font=$(jq -r '.font.path // empty' "$MANIFEST")
  FONT="${manifest_font:-$HOME/Library/Fonts/851_kanaA.ttf}"
fi

[ -f "$FONT" ] || { echo "font not found: $FONT" >&2; exit 1; }
mkdir -p "$OUT"
echo "font: $FONT"

pointsize_for_len() {
  local len="$1"
  if   [ "$len" -le 2 ]; then echo 90
  elif [ "$len" -le 3 ]; then echo 78
  elif [ "$len" -le 4 ]; then echo 66
  elif [ "$len" -le 5 ]; then echo 56
  else echo 48
  fi
}

jq -c '.stickers[]' "$MANIFEST" | while read -r row; do
  id=$(jq -r '.id' <<<"$row")
  cap=$(jq -r '.caption' <<<"$row")
  dst="$OUT/$id.png"

  src=""
  for ext in png jpeg jpg webp; do
    if [ -f "$RAW/$id.$ext" ]; then
      src="$RAW/$id.$ext"
      break
    fi
  done
  if [ -z "$src" ]; then
    echo "SKIP $id (no raw in $RAW)"
    continue
  fi

  len=$(printf '%s' "$cap" | wc -m | tr -d ' ')
  pt=$(pointsize_for_len "$len")

  # 1) 左上ピクセルを背景色とみなし、4隅から fuzz 8% で floodfill 透明化
  #    (緑バック/白バック両対応。fuzz抑えめでキャラ内侵食を防ぐ。
  #     4隅ガードで足元・腕の隙間など独立連結部も抜ける)
  # 2) despill: 緑チャンネルが max(r,b)*1.05 を超えてたら抑制 → 緑フリンジ除去
  # 3) edge smooth: alphaに軽blur+levelでジャギー軽減
  # 4) trim → 340x290 fit (Lanczos) → 370x320 padding
  # 5) caption: 白縁取り+黒塗り
  bg=$(magick "$src" -format "%[pixel:p{0,0}]" info:)
  W=$(magick "$src" -format "%w" info:)
  H=$(magick "$src" -format "%h" info:)
  magick "$src" \
    -alpha set \
    -bordercolor "$bg" -border 1 \
    -fuzz 8% -fill none -floodfill +0+0 "$bg" \
    -fuzz 8% -fill none -floodfill +$((W+1))+0 "$bg" \
    -fuzz 8% -fill none -floodfill +0+$((H+1)) "$bg" \
    -fuzz 8% -fill none -floodfill +$((W+1))+$((H+1)) "$bg" \
    -shave 1x1 \
    -channel G -fx "min(g, max(r,b)*1.05)" +channel \
    -channel A -blur 0x0.7 -level 30%,90% +channel \
    -trim +repage \
    -filter Lanczos -resize 340x290 \
    -background none -gravity center -extent 370x320 \
    -font "$FONT" -pointsize "$pt" -kerning 2 \
    -gravity south \
    -stroke white -strokewidth 10 -fill white -annotate +0+10 "$cap" \
    -stroke none -fill "#1a1a1a" -annotate +0+10 "$cap" \
    "$dst"

  # 1MB超なら最適化
  size=$(stat -f%z "$dst")
  if [ "$size" -gt 1000000 ]; then
    magick "$dst" -strip -define png:compression-level=9 "$dst"
    size=$(stat -f%z "$dst")
  fi

  printf 'OK  %s  "%s"  %dpt  %dB\n' "$id" "$cap" "$pt" "$size"
done

echo "---"
echo "processed: $(ls "$OUT"/*.png 2>/dev/null | wc -l | tr -d ' ') file(s) in $OUT"
