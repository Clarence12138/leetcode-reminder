#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/store-assets/source"
ICON_DIR="$ROOT_DIR/public/icons"

if ! command -v magick >/dev/null 2>&1; then
  echo "错误：生成素材需要 ImageMagick 7（magick）。" >&2
  exit 1
fi
if ! command -v qlmanage >/dev/null 2>&1; then
  echo "错误：中文商店素材需要 macOS Quick Look（qlmanage）渲染。" >&2
  exit 1
fi

mkdir -p "$ICON_DIR"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/xiaoshuaji-assets.XXXXXX")"
trap 'rm -rf -- "$TEMP_DIR"' EXIT

render_text_svg() {
  local source="$1"
  local output="$2"
  local width="$3"
  local height="$4"
  local staged="$TEMP_DIR/$(basename "$source")"
  local preview="$staged.png"

  cp "$source" "$staged"
  qlmanage -t -s "$width" -o "$TEMP_DIR" "$staged" >/dev/null
  magick "$preview" \
    -crop "${width}x${height}+0+0" +repage \
    -resize "${width}x${height}!" -strip "$output"
}

for size in 16 32 48 128; do
  magick -background none -density 384 "$SOURCE_DIR/icon.svg" \
    -resize "${size}x${size}" -strip "PNG32:$ICON_DIR/icon-$size.png"
done

render_text_svg \
  "$SOURCE_DIR/promo-440x280.svg" \
  "$ROOT_DIR/store-assets/promo-440x280.png" \
  440 \
  280

echo "图标和商店宣传图已生成；商店截图需从最终扩展真实界面采集。"
