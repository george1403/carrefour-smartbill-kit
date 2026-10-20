#!/usr/bin/env bash
# Linux/macOS: ./run.sh            (meniu)   ./run.sh orders   ./run.sh fill <nr>
source "$(cd "$(dirname "$0")" && pwd)/scripts/env-unix.sh"
[ $# -eq 0 ] && set -- menu
if ! command -v node >/dev/null 2>&1 || [ ! -d "$KIT_DIR/node_modules/playwright" ]; then
  echo "Programul nu este instalat complet (lipseste Node.js sau bibliotecile)."
  echo "Da dublu-click o data pe install.command, apoi incearca din nou."
  exit 9
fi
cd "$KIT_DIR" && exec node bin/kit.js "$@"
