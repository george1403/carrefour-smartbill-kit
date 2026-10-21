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
# stale test hooks (mock/demo variables) never reach a real run
[ "${KIT_TEST_MODE:-0}" = 1 ] || unset KIT_SETUP_MOCK KIT_CARREFOUR_DOCS_URL KIT_DEMO_MOCK_MODE KIT_STOP_BEFORE_FINAL KIT_BULK_CONFIRM KIT_IMPORT_CONFIRM KIT_RATE_MS KIT_RETRY_MS KIT_SUBMIT_WAIT KIT_NAV_TIMEOUT KIT_MANUAL_TIMEOUT_MS KIT_SLOW KIT_SUPPORT_NO_SELFTEST KIT_TEST_CLOSE_MS KIT_TEST_HEADLESS KIT_TEST_DESKTOPS KIT_TEST_DIALOG KIT_TEST_SAC
export PLAYWRIGHT_BROWSERS_PATH="$KIT_DIR/.runtime/browsers"
