#!/usr/bin/env bash
# Instalare pentru macOS (Intel + Apple Silicon) si Linux. Fara drepturi de administrator:
# Node.js portabil (daca lipseste sau e prea vechi) se descarca in .runtime/, browserul Chromium in .runtime/browsers.
# Se poate rula de oricate ori (idempotent).
set -euo pipefail
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KIT_DIR"
NODE_VERSION="$(tr -d ' \r\n' < .node-version)"
RT="$KIT_DIR/.runtime"
say() { printf '%s\n' "$*"; }
fail() {
  say ""; say "EROARE: $*"
  say "Verifica legatura la internet. Daca firma foloseste proxy, cere ajutor persoanei tehnice a firmei, apoi da din nou dublu-click pe install.command."
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
# shortcuts on the Desktop (Mac): "Carrefour SmartBill" opens the graphical interface in the browser (an app, no Terminal window);
# "Carrefour SmartBill - Meniu text" opens the old numbered menu (fallback)
UI_APP=""
if [ "$PLAT" = darwin ] && [ -d "$HOME/Desktop" ] && [ "${KIT_NO_SHORTCUT:-0}" != 1 ]; then
  mkdir -p "$RT"; rm -rf "$HOME/Desktop/Carrefour SmartBill.app"
  ESC_DIR="$(printf '%s' "$KIT_DIR" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  if osacompile -o "$HOME/Desktop/Carrefour SmartBill.app" -e "do shell script \"cd \" & quoted form of \"$ESC_DIR\" & \" && KIT_NO_PAUSE=1 /bin/bash ./run.sh ui > .runtime/ui.log 2>&1 &\"" >/dev/null 2>&1; then
    rm -f "$HOME/Desktop/Carrefour SmartBill.command"; UI_APP="$HOME/Desktop/Carrefour SmartBill.app"
  else SC="$HOME/Desktop/Carrefour SmartBill.command"; printf '#!/bin/bash\nexec "%s/run.command" ui\n' "$KIT_DIR" > "$SC" && chmod +x "$SC"; fi
  SM="$HOME/Desktop/Carrefour SmartBill - Meniu text.command"; printf '#!/bin/bash\nexec "%s/run.command"\n' "$KIT_DIR" > "$SM" && chmod +x "$SM"
  say "Am pus pe Desktop scurtaturile: Carrefour SmartBill (programul) si Carrefour SmartBill - Meniu text (rezerva)"
fi
if [ -f "$KIT_DIR/.env" ] && [ "${KIT_FORCE_SETUP:-0}" != 1 ]; then echo "Configurarea exista deja. Pentru a o schimba: dublu-click pe scurtatura Carrefour SmartBill de pe Desktop (sau pe run.command), apoi apasa Configurare."; exit 0; fi
if [ "${KIT_NO_SETUP:-0}" != 1 ] && [ -n "$UI_APP" ]; then say "Se deschide programul in browser: apasa Configurare."; open "$UI_APP"; exit 0; fi
if [ "${KIT_NO_SETUP:-0}" != 1 ]; then exec "$KIT_DIR/run.sh" setup; fi
