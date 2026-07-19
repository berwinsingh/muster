#!/usr/bin/env python3
"""Regenerate Muster extension icons with aspect-ratio preserved center crop."""

from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Pillow required. Run: sudo apt-get install -y python3-pil", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
MEDIA = ROOT / "media"
SOURCE_FILENAME = "muster-mark.png"

SOURCE_CANDIDATES = [ROOT / "assets" / SOURCE_FILENAME]


def find_source() -> Path:
    for candidate in SOURCE_CANDIDATES:
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"Source not found. Checked: {SOURCE_CANDIDATES}")


def read_dims(path: Path) -> tuple[int, int]:
    with Image.open(path) as img:
        return img.size


def center_crop_square(img: Image.Image) -> Image.Image:
    width, height = img.size
    if width == height:
        return img.copy()
    size = min(width, height)
    left = (width - size) // 2
    top = (height - size) // 2
    return img.crop((left, top, left + size, top + size))


def write_icon(square: Image.Image, size: int, output: Path) -> None:
    resized = square.resize((size, size), Image.Resampling.LANCZOS)
    resized.save(output, format="PNG", optimize=True)
    out_w, out_h = read_dims(output)
    print(f"Created {output} ({out_w}x{out_h})")


def main() -> int:
    source = find_source()
    MEDIA.mkdir(parents=True, exist_ok=True)

    before_icon = MEDIA / "icon.png"
    before_256 = MEDIA / "icon-256.png"

    src_w, src_h = read_dims(source)
    print(f"Source: {source}")
    print(f"Source dimensions: {src_w}x{src_h} (aspect {src_w / src_h:.3f})")

    if before_icon.exists():
        b_w, b_h = read_dims(before_icon)
        print(f"Before icon.png: {b_w}x{b_h}")
    else:
        print("Before icon.png: missing")

    if before_256.exists():
        b_w, b_h = read_dims(before_256)
        print(f"Before icon-256.png: {b_w}x{b_h}")
    else:
        print("Before icon-256.png: missing")

    with Image.open(source) as img:
        img = img.convert("RGBA")
        square = center_crop_square(img)
        crop_w, crop_h = square.size
        print(f"Center crop: {crop_w}x{crop_h}")

        write_icon(square, 128, MEDIA / "icon.png")
        write_icon(square, 256, MEDIA / "icon-256.png")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
