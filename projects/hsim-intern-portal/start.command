#!/usr/bin/env bash
# Double-click launcher for macOS (rename to start.command if you prefer) / Linux.
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null || { echo "Install Node.js (LTS) from https://nodejs.org first."; read -r -p "Press Enter…"; exit 1; }
[ -d node_modules ] || npm install || exit 1
npx tsx scripts/local.ts
