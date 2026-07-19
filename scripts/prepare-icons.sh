#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MEDIA="$ROOT/media"
SOURCE_FILENAME='muster-mark.png'
SOURCE="$ROOT/assets/$SOURCE_FILENAME"

if [ ! -f "$SOURCE" ]; then
  echo "Source icon not found: $SOURCE" >&2
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
