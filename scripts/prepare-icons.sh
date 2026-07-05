#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MEDIA="$ROOT/media"
SOURCE_FILENAME='c__Users_berwi_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_Gemini_Generated_Image_e3wxete3wxete3wx-c5d86948-00b4-493f-a281-b6b1d909a18b.png'

SOURCE=""
for candidate in \
  "$ROOT/assets/$SOURCE_FILENAME" \
  "/mnt/c/Users/berwi/.cursor/projects/wsl-localhost-Ubuntu-home-berwin-SaaS-docq-one-click-terminal-setup-vscode/assets/$SOURCE_FILENAME"; do
  if [ -f "$candidate" ]; then
    SOURCE="$candidate"
    break
  fi
done

if [ -z "$SOURCE" ]; then
  echo "Source icon not found" >&2
  exit 1
fi

mkdir -p "$MEDIA"

SRC_W=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$SOURCE")
SRC_H=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$SOURCE")
echo "Source: $SOURCE"
echo "Source dimensions: ${SRC_W}x${SRC_H}"

if [ -f "$MEDIA/icon.png" ]; then
  B_W=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$MEDIA/icon.png")
  B_H=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$MEDIA/icon.png")
  echo "Before icon.png: ${B_W}x${B_H}"
fi

if [ "$SRC_W" -le "$SRC_H" ]; then
  CROP_SIZE="$SRC_W"
else
  CROP_SIZE="$SRC_H"
fi

# Center-crop to square, then scale without stretching
FILTER="crop=${CROP_SIZE}:${CROP_SIZE}:(in_w-${CROP_SIZE})/2:(in_h-${CROP_SIZE})/2"

ffmpeg -y -loglevel error -i "$SOURCE" -vf "${FILTER},scale=128:128:flags=lanczos" "$MEDIA/icon.png"
ffmpeg -y -loglevel error -i "$SOURCE" -vf "${FILTER},scale=256:256:flags=lanczos" "$MEDIA/icon-256.png"

O128_W=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$MEDIA/icon.png")
O128_H=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$MEDIA/icon.png")
O256_W=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$MEDIA/icon-256.png")
O256_H=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$MEDIA/icon-256.png")
echo "Created $MEDIA/icon.png (${O128_W}x${O128_H})"
echo "Created $MEDIA/icon-256.png (${O256_W}x${O256_H})"
