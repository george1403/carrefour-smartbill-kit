#!/usr/bin/env bash
# macOS: dublu-click. Daca macOS blocheaza fisierul: click-dreapta > Deschide (vezi ghidul).
cd "$(dirname "$0")" || exit 1
bash ./scripts/install-unix.sh "$@"
status=$?
echo; read -r -p "Apasa Enter pentru a inchide fereastra..." _ || true
exit $status
