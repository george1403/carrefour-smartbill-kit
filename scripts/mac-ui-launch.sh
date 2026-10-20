#!/bin/bash
# Started by the "Carrefour SmartBill" app on the Mac Desktop. Runs the browser interface; when it cannot start
# (Node.js / libraries missing, damaged install) it shows a dialog in Romanian instead of doing nothing silently.
cd "$(dirname "$0")/.." || exit 1
mkdir -p .runtime
KIT_NO_PAUSE=1 /bin/bash ./run.sh ui > .runtime/ui.log 2>&1
rc=$?
[ "$rc" -eq 0 ] && exit 0
if [ "$rc" -eq 9 ]; then
  msg="Programul nu este instalat complet (lipseste Node.js sau bibliotecile programului). Deschideti folderul programului si dati dublu-click pe install.command. Conturile si istoricul raman."
else
  msg="Programul nu a putut porni (cod $rc). Incercati inca o data. Daca se repeta, deschideti folderul programului, dati dublu-click pe run.command si alegeti 13 (Raport suport), apoi trimiteti fisierul lui George."
fi
[ -n "$KIT_TEST_DIALOG" ] && { printf '%s\n' "$msg" > "$KIT_TEST_DIALOG"; exit "$rc"; }
/usr/bin/osascript -e "display dialog \"$msg\" with title \"Carrefour SmartBill\" buttons {\"OK\"} default button 1 with icon caution" >/dev/null 2>&1
exit "$rc"
