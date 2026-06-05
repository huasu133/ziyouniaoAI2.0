#!/bin/bash
# ─── generate-icons.sh ────────────────────────────────────────────────────
# 使用 macOS 内置的 sips + iconutil 从 512x512 PNG 生成 .icns 图标
# 要求: assets/icon.png (512x512)
#
# 用法: bash scripts/generate-icons.sh
# ──────────────────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS_DIR="$SCRIPT_DIR/assets"
SOURCE_PNG="$ASSETS_DIR/icon.png"
ICONSET_DIR="$ASSETS_DIR/icon.iconset"
ICNS_OUTPUT="$ASSETS_DIR/icon.icns"

echo "[icons] Generating macOS icons from $SOURCE_PNG"

if [ ! -f "$SOURCE_PNG" ]; then
  echo "[icons] WARNING: $SOURCE_PNG not found. Creating a minimal placeholder."
  # 创建一个 512x512 的占位 PNG（纯色背景）
  if command -v python3 &>/dev/null; then
    python3 -c "
import struct, zlib

def create_png(width, height, r, g, b):
    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack('>I', zlib.crc32(c) & 0xffffffff)
        return struct.pack('>I', len(data)) + c + crc

    header = b'\\x89PNG\\r\\n\\x1a\\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
    raw = b''
    for y in range(height):
        raw += b'\\x00'  # filter byte
        for x in range(width):
            raw += bytes([r, g, b])
    idat = chunk(b'IDAT', zlib.compress(raw))
    iend = chunk(b'IEND', b'')
    return header + ihdr + idat + iend

png_data = create_png(512, 512, 108, 77, 255)  # #6c4dff accent color
with open('$SOURCE_PNG', 'wb') as f:
    f.write(png_data)
print('[icons] Created placeholder icon.png')
"
  else
    echo "[icons] WARNING: python3 not found, cannot create placeholder. Create assets/icon.png manually."
    exit 0
  fi
fi

# 创建 iconset 目录
mkdir -p "$ICONSET_DIR"

# 用 sips 生成各种尺寸
echo "[icons] Generating icon sizes..."

# macOS 需要的图标尺寸
sizes=(
  "16,16,icon_16x16.png"
  "32,32,icon_16x16@2x.png"
  "32,32,icon_32x32.png"
  "64,64,icon_32x32@2x.png"
  "128,128,icon_128x128.png"
  "256,256,icon_128x128@2x.png"
  "256,256,icon_256x256.png"
  "512,512,icon_256x256@2x.png"
  "512,512,icon_512x512.png"
)

for entry in "${sizes[@]}"; do
  IFS=',' read -r w h name <<< "$entry"
  sips -z "$h" "$w" "$SOURCE_PNG" --out "$ICONSET_DIR/$name" &>/dev/null
done

# 生成 icon_512x512@2x.png (1024x1024)
sips -z 1024 1024 "$SOURCE_PNG" --out "$ICONSET_DIR/icon_512x512@2x.png" &>/dev/null

echo "[icons] Running iconutil..."
iconutil -c icns "$ICONSET_DIR" -o "$ICNS_OUTPUT"

# 清理 iconset 临时目录
rm -rf "$ICONSET_DIR"

echo "[icons] Done! Generated: $ICNS_OUTPUT"
