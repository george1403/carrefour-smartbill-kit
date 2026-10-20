# sourced by run.sh / run.command: use the portable Node from .runtime if present
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for d in "$KIT_DIR"/.runtime/node-v*/bin; do [ -x "$d/node" ] && export PATH="$d:$PATH"; done
export PLAYWRIGHT_BROWSERS_PATH="$KIT_DIR/.runtime/browsers"
