# sourced by run.sh / run.command: use the portable Node from .runtime if present
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for d in "$KIT_DIR"/.runtime/node-v*/bin; do [ -x "$d/node" ] && export PATH="$d:$PATH"; done
# launchd jobs and Finder apps get a minimal PATH (/usr/bin:/bin): find the Node that install used
if ! command -v node >/dev/null 2>&1; then
  ND0=""; [ -f "$KIT_DIR/.runtime/node-dir" ] && ND0="$(< "$KIT_DIR/.runtime/node-dir")"
  for d in "$ND0" /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin" "$HOME/.volta/bin" $(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1); do
    [ -n "$d" ] && [ -x "$d/node" ] && { export PATH="$d:$PATH"; break; }
  done
fi
export PLAYWRIGHT_BROWSERS_PATH="$KIT_DIR/.runtime/browsers"
