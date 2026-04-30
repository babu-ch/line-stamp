#!/usr/bin/env bash
# PreToolUse hook for Read tool.
# 画像ファイル(.jpg/.jpeg/.png/.gif/.webp) を Read する直前に
# マジックバイトを検査し、壊れていたら deny を返す。
# nano-banana の透過処理失敗で壊れた JPEG が残った時、
# Claude Code が Anthropic API の "Could not process image" 400 で
# 止まらないようにするためのガード。
set -uo pipefail

input=$(cat)
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')

case "$file" in
  *.jpg|*.jpeg|*.JPG|*.JPEG|*.png|*.PNG|*.gif|*.GIF|*.webp|*.WEBP) ;;
  *) exit 0 ;;
esac

[ -f "$file" ] || exit 0

magic=$(xxd -p -l 4 "$file" 2>/dev/null || true)

ok=0
case "$magic" in
  ffd8ff*)   ok=1 ;;  # JPEG
  89504e47)  ok=1 ;;  # PNG
  47494638)  ok=1 ;;  # GIF
  52494646)  ok=1 ;;  # RIFF (WebP)
esac

if [ "$ok" -eq 1 ]; then
  exit 0
fi

reason="壊れた画像ファイル '$file' の Read を中止しました（マジックバイト不正: '${magic:-empty}'）。nano-banana の透過処理失敗で残ったゴミファイルの可能性が高いです。削除して再生成するか、別ファイルを参照してください。Read を再試行しないでください。"

jq -nc --arg r "$reason" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $r
  }
}'
exit 0
