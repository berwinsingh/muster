#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
git add src/ package.json src/test/
git commit -m "fix: ensure sidebar providers register even when event tracking fails (v0.1.8)"
git push origin main
git rev-parse HEAD
git status -sb
