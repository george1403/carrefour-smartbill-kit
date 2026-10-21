#!/usr/bin/env bash
# Instalare pentru macOS (Intel + Apple Silicon) si Linux. Fara drepturi de administrator:
# Node.js portabil (daca lipseste sau e prea vechi) se descarca in .runtime/, browserul Chromium in .runtime/browsers.
# Se poate rula de oricate ori (idempotent).
set -euo pipefail
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KIT_DIR"
NODE_VERSION="$(tr -d ' \r\n' < .node-version)"
RT="$KIT_DIR/.runtime"
[ "${KIT_TEST_MODE:-0}" = 1 ] || unset KIT_SETUP_MOCK KIT_CARREFOUR_DOCS_URL KIT_DEMO_MOCK_MODE KIT_STOP_BEFORE_FINAL KIT_BULK_CONFIRM KIT_IMPORT_CONFIRM KIT_RATE_MS KIT_RETRY_MS KIT_SUBMIT_WAIT KIT_NAV_TIMEOUT KIT_MANUAL_TIMEOUT_MS KIT_SLOW KIT_SUPPORT_NO_SELFTEST KIT_TEST_CLOSE_MS KIT_TEST_HEADLESS KIT_TEST_DESKTOPS KIT_TEST_DIALOG KIT_TEST_SAC   # stale test hooks never reach a real install
say() { printf '%s\n' "$*"; }
fail() {
  say ""; say "EROARE: $*"
  [ "${LOCAL_ERR:-0}" = 1 ] || say "Verifica legatura la internet. Daca firma foloseste proxy, cere ajutor persoanei tehnice a firmei, apoi da din nou dublu-click pe install.command."
  say "Daca tot nu merge, fa o poza acestei ferestre si trimite-o lui George (WhatsApp/email)."
  exit 1
}
dl() { curl -fL --retry 3 --connect-timeout 20 -o "$2" "$1"; }

case "$(uname -s)" in Darwin) PLAT=darwin; EXT=tar.gz ;; Linux) PLAT=linux; EXT=tar.xz ;; *) fail "Sistem de operare necunoscut: $(uname -s)" ;; esac
case "$(uname -m)" in x86_64|amd64) ARCH=x64 ;; arm64|aarch64) ARCH=arm64 ;; *) fail "Procesor necunoscut: $(uname -m)" ;; esac
command -v curl >/dev/null || fail "Lipseste programul curl."

# macOS: remove the "downloaded from internet" flag from the kit folder, so run.command opens with a plain double-click
[ "$PLAT" = darwin ] && xattr -dr com.apple.quarantine "$KIT_DIR" 2>/dev/null || true
say "== Instalare Carrefour -> SmartBill ($PLAT-$ARCH) in: $KIT_DIR"
# common traps, checked before downloading anything
( : > "$KIT_DIR/.scriere-test-$$" ) 2>/dev/null && rm -f "$KIT_DIR/.scriere-test-$$" || LOCAL_ERR=1 fail "Nu pot scrie in folderul programului ($KIT_DIR). Mutati folderul in folderul personal (Finder: Mergi > Acasa) si porniti din nou install.command."
FREE_KB="$(df -Pk "$KIT_DIR" 2>/dev/null | awk 'NR==2{print $4}')"
NEED_KB=1000000; ls -d "$KIT_DIR"/.runtime/browsers/chromium* >/dev/null 2>&1 && NEED_KB=300000   # reinstall: browser already downloaded
if [ -n "$FREE_KB" ] && [ "$FREE_KB" -lt "$NEED_KB" ] 2>/dev/null; then LOCAL_ERR=1 fail "Pe disc mai sunt doar $((FREE_KB/1024)) MB liberi; programul are nevoie de aproximativ $((NEED_KB/1000)) MB. Eliberati spatiu, apoi porniti din nou install.command."; fi
case "$KIT_DIR" in *"/Library/Mobile Documents/"*|*"/Library/CloudStorage/"*) say "ATENTIE: folderul programului este intr-un folder sincronizat (iCloud/OneDrive/Google Drive). Sincronizarea poate bloca sau dubla jurnalele facturilor. Recomandat: mutati folderul in folderul personal (Acasa) si porniti din nou install.command." ;; esac
# Mac: from Desktop/Documents/Downloads/iCloud macOS silently blocks the automatic check -> copy the kit to the home folder
# (Acasa) and continue the install from there. The original folder is left untouched (only a note is added).
mac_protected() { case "$1/" in "$HOME/Desktop/"*|"$HOME/Documents/"*|"$HOME/Downloads/"*|"$HOME/Library/Mobile Documents/"*|"$HOME/Library/CloudStorage/"*|/Volumes/*) return 0 ;; esac; return 1; }
if [ "$PLAT" = darwin ] && [ "${KIT_NO_RELOCATE:-0}" != 1 ] && mac_protected "$KIT_DIR"; then
  DEST="$HOME/carrefour-smartbill-kit"; n=2
  while [ -e "$DEST" ] && [ "$(cat "$DEST/.kit-origine" 2>/dev/null)" != "$KIT_DIR" ]; do DEST="$HOME/carrefour-smartbill-kit $n"; n=$((n+1)); done
  say ""; say "Programul este in: $KIT_DIR"
  say "De acolo macOS nu lasa verificarea automata sa porneasca. Il copiez in folderul personal (Acasa):"
  say "   $DEST"
  mkdir -p "$DEST" && (cd "$KIT_DIR" && tar --exclude node_modules --exclude .runtime -cf - .) | (cd "$DEST" && tar -xf -) \
    || LOCAL_ERR=1 fail "Nu pot copia programul in $DEST. Mutati singur folderul in folderul personal (Finder: Mergi > Acasa) si porniti din nou install.command."
  printf '%s\n' "$KIT_DIR" > "$DEST/.kit-origine"
  printf 'Programul a fost copiat in:\n%s\n\nFolositi scurtatura "Carrefour SmartBill" de pe Desktop.\nAcest folder nu mai este folosit si poate fi sters.\n' "$DEST" > "$KIT_DIR/PROGRAMUL-ESTE-IN-ACASA.txt" 2>/dev/null || true
  say "Gata. Continui instalarea din folderul nou."; say ""
  exec bash "$DEST/scripts/install-unix.sh" "$@"
fi

# Desktop shortcuts are made FIRST (before any download), so the producer always gets them; the shortcut itself explains
# in Romanian if the install is not finished (scripts/mac-ui-launch.sh). Another kit's shortcut is never overwritten.
DESK="${KIT_DESKTOP:-$HOME/Desktop}"; UI_APP=""; SC_MSG=""
sc_points() { [ -e "$1" ] || return 1; grep -qsxF "$KIT_DIR" "$1/Contents/Resources/kit-dir.txt" 2>/dev/null && return 0; grep -rqaF "$KIT_DIR/" "$1" 2>/dev/null; }
sc_name() { if [ ! -e "$DESK/$1$2" ] || sc_points "$DESK/$1$2"; then printf '%s' "$1"; return; fi
  local t; t="$(basename "$KIT_DIR" | tr -d '()/:\\')"; printf '%s (%s)' "$1" "$t"; }
if [ "$PLAT" = darwin ] && [ "${KIT_NO_SHORTCUT:-0}" != 1 ]; then
  mkdir -p "$DESK" 2>/dev/null
  UIN="$(sc_name "Carrefour SmartBill" .app)"; MNN="$(sc_name "Carrefour SmartBill - Meniu text" .command)"
  ESC_DIR="$(printf '%s' "$KIT_DIR" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  rm -rf "$DESK/$UIN.app"
  if osacompile -o "$DESK/$UIN.app" -e "do shell script \"cd \" & quoted form of \"$ESC_DIR\" & \" && /bin/bash scripts/mac-ui-launch.sh > /dev/null 2>&1 &\"" >/dev/null 2>&1; then
    printf '%s\n' "$KIT_DIR" > "$DESK/$UIN.app/Contents/Resources/kit-dir.txt"; rm -f "$DESK/$UIN.command"; UI_APP="$DESK/$UIN.app"
  else SC="$DESK/$UIN.command"; printf '#!/bin/bash\nexec "%s/run.command" ui\n' "$KIT_DIR" > "$SC" && chmod +x "$SC" && UI_APP="$SC"; fi
  SM="$DESK/$MNN.command"; printf '#!/bin/bash\nexec "%s/run.command"\n' "$KIT_DIR" > "$SM" && chmod +x "$SM"
  if [ -n "$UI_APP" ] && [ -e "$UI_APP" ]; then SC_MSG="Scurtatura programului este pe Desktop: \"$(basename "$UI_APP")\"   (folderul $DESK)"; say "$SC_MSG"
  else say "ATENTIE: nu am putut pune scurtatura pe Desktop ($DESK). Programul se porneste si cu dublu-click pe run.command (folderul $KIT_DIR)"; fi
fi
USE_SYSTEM=0
if [ "${KIT_FORCE_PORTABLE_NODE:-0}" != 1 ] && command -v node >/dev/null 2>&1; then
  MAJ="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$MAJ" -ge 20 ] 2>/dev/null && USE_SYSTEM=1
fi
if [ "$USE_SYSTEM" = 0 ]; then
  ND="$RT/node-v$NODE_VERSION-$PLAT-$ARCH"
  if [ ! -x "$ND/bin/node" ]; then
    mkdir -p "$RT"
    F="node-v$NODE_VERSION-$PLAT-$ARCH.$EXT"
    say "Descarc Node.js $NODE_VERSION (o singura data, ~30 MB)..."
    dl "https://nodejs.org/dist/v$NODE_VERSION/$F" "$RT/$F" || fail "Nu pot descarca Node.js."
    dl "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" "$RT/SHASUMS256.txt" || fail "Nu pot descarca sumele de control Node.js."
    EXP="$(grep " $F\$" "$RT/SHASUMS256.txt" | awk '{print $1}')"
    if command -v sha256sum >/dev/null; then ACT="$(sha256sum "$RT/$F" | awk '{print $1}')"; else ACT="$(shasum -a 256 "$RT/$F" | awk '{print $1}')"; fi
    [ -n "$EXP" ] && [ "$EXP" = "$ACT" ] || { rm -f "$RT/$F"; fail "Fisierul Node.js descarcat e incomplet/corupt."; }
    tar -xf "$RT/$F" -C "$RT" || fail "Nu pot dezarhiva Node.js."
    rm -f "$RT/$F"
  fi
  export PATH="$ND/bin:$PATH"
fi
mkdir -p "$RT" && dirname "$(command -v node)" > "$RT/node-dir"  # remembered for launchd / Finder (minimal PATH)
say "Node.js: $(node -v)  npm: $(npm -v)"

export PLAYWRIGHT_BROWSERS_PATH="$RT/browsers"
say "Instalez bibliotecile programului..."
npm ci --no-audit --no-fund --loglevel=error || fail "Nu pot instala bibliotecile programului."
say "Instalez browserul Chromium (o singura data, ~150 MB)..."
npx --no-install playwright install chromium || fail "Nu pot descarca browserul Chromium."
if [ "$PLAT" = linux ]; then
  if ! node -e "require('playwright').chromium.launch().then(b=>b.close()).catch(e=>{console.error(e.message.split('\n')[0]);process.exit(1)})" 2>/dev/null; then
    if [ "${KIT_INSTALL_DEPS:-0}" = 1 ]; then sudo -E env "PATH=$PATH" npx --no-install playwright install-deps chromium || fail "Nu pot instala bibliotecile de sistem pentru Chromium.";
    else say "ATENTIE (Linux): lipsesc biblioteci de sistem pentru Chromium. Ruleaza o data, cu drepturi de administrator:"; say "  sudo \"$(command -v npx)\" playwright install-deps chromium"; say "  (sau: KIT_INSTALL_DEPS=1 ./install.sh)"; exit 2; fi
  fi
fi
node bin/kit.js selftest || fail "Testul de verificare a esuat."
say "== Instalare reusita."
[ -n "$SC_MSG" ] && say "$SC_MSG"
if [ -f "$KIT_DIR/.env" ] && [ "${KIT_FORCE_SETUP:-0}" != 1 ]; then echo "Configurarea exista deja. Pentru a o schimba: dublu-click pe scurtatura Carrefour SmartBill de pe Desktop (sau pe run.command), apoi apasa Configurare."; exit 0; fi
if [ "${KIT_NO_SETUP:-0}" != 1 ] && [ -n "$UI_APP" ]; then say "Se deschide programul in browser: apasa Configurare."; open "$UI_APP"; exit 0; fi
if [ "${KIT_NO_SETUP:-0}" != 1 ]; then exec "$KIT_DIR/run.sh" setup; fi
