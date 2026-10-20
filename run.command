#!/usr/bin/env bash
# macOS: dublu-click pentru meniu.
cd "$(dirname "$0")" || exit 1
bash ./run.sh "$@"
echo; read -r -p "Apasa Enter pentru a inchide fereastra..." _ || true
