# Carrefour → SmartBill (kit producatori)

Doar 2 conturi: SmartBill + portal furnizori Carrefour. Restul se descopera automat. Vezi `docs/GHID_CONFIGURARE.md`.

**Producatori:** scurtatura *Carrefour SmartBill* de pe Desktop deschide **interfata grafica in browser** (`node bin/kit.js ui`: server local pe 127.0.0.1, port aleator, token pe sesiune; aceleasi comenzi ca meniul). Scurtatura *Meniu text* = rezerva. In meniul text: totul se face cu dublu-click (install, apoi scurtatura *Carrefour SmartBill* de pe Desktop) si numere din meniu
(1-9 neschimbate; 10 lista ciorne in bloc, 11 verificare la fiecare ora, 12 reciteste datele, 13 raport suport, 14 reparare, 15 dezinstalare).
Ghidul `docs/GHID_CONFIGURARE.md` nu contine nicio comanda. Sectiunea de mai jos e **doar pentru tehnicieni**.

### Pentru tehnicieni (linie de comanda)

```
npm install
node bin/kit.js setup          # 4 intrebari + alegi seria
node bin/kit.js orders
node bin/kit.js fill <nr>      # doar completeaza + poza; NU salveaza/emite
node bin/kit.js auto           # comenzi noi din portal -> ciorne (sau facturi, daca ai ales 'automat')
node bin/kit.js bulk-ciorne --check   # (meniu 9) lista TUTUROR comenzilor nefacturate, oricat de vechi; nu creeaza nimic
node bin/kit.js bulk-ciorne           # aceeasi lista + confirmare "da" -> ciorne in loturi de 10; NU emite niciodata
node bin/kit.js schedule       # porneste 'auto' singur (Task Scheduler / launchd / cron)  (meniu 11)
node bin/kit.js support        # (meniu 13) RAPORT-SUPORT-<data>.zip fara secrete
node bin/kit.js repair         # (meniu 14) reinstaleaza browserul
node bin/kit.js uninstall      # (meniu 15)
```
Siguranta: dupa login, orice cerere de scriere catre SmartBill/Carrefour e blocata in browser (src/smartbillWeb.js, src/carrefourPortal.js).
Profilul fiecarui producator se creeaza la `setup` in `profiles/<firma>.json` (local, nu intra in ZIP/git).

## Autentificare Carrefour (meniu 5) si coduri de iesire
Sesiune salvata → CAPTCHA simplu citit local (tesseract, fara AI) → daca nu se poate (reCAPTCHA/hCaptcha/alt tip, sesiune expirata):
la calculator se deschide O fereastra vizibila, producatorul se autentifica, sesiunea se salveaza si rularea continua;
in rularile programate (`KIT_UNATTENDED=1`) programul se opreste cu cod 3, notificare + `ATENTIE-autentificare-Carrefour.txt`.
Dupa login se verifica furnizorul (`carrefour.expectedSupplierCode`, confirmat la setup): alt furnizor → cod 12, sesiunea se arhiveaza.

Coduri: 0 ok · 1 eroare · 2 dubla refuzata · 3 autentificare Carrefour (optiunea 5) · 4 parola gresita · 5 internet/portal cazut ·
6 portal schimbat · 7 autentificare manuala neterminata · 8 disc/permisiuni · 9 instalare incompleta · 10 configurare · 11 necesita verificare · 12 cont altui furnizor.

Teste: `node bin/kit.js selftest` (rapid), `node scripts/test-ui.js` (interfata: token, CSRF, fara secrete, ciorne in bloc cu confirmare, lock), `node scripts/test-install-safety.js` (programare per folder, preluare doar cu confirmare), `node scripts/test-ux.js` (meniu, culori, CE FACI, raport suport fara secrete), `node scripts/test-bulk.js` (ciorne in bloc) si `node scripts/test-scenarios.js` (matricea de scenarii, portal simulat local, ~4 min).
Actualizare: `node bin/kit.js import-config [folder-vechi]` copiaza .env, profiles/, out/ DOAR cu confirmare (meniu 8 / buton in Configurare; `KIT_IMPORT_CONFIRM=da`); install NU mai preia singur si programarea NU se muta. Programarea are nume per folder (`CarrefourSmartBillKit-<hash>` / `ro.carrefour-smartbill-kit.<hash>`); vechiul nume global e atins doar daca porneste acest folder. Demo: `node bin/kit.js ui --demo` (portal + SmartBill simulate, doar intr-un folder fara conturi).

## Mod "automat" - protectii (2026-10-20)
- Prima rulare automata intr-un folder = doar verificare (lista in log, nimic emis); se emite de la a doua rulare (`out/<profil>/automat-armat.json`).
- Maxim 3 facturi pe rulare (implicit; `auto.maxPerRun`, plafon 10).
- Fiecare factura: ciorna -> XML verificat (comanda, GLN, nume linii, U.M. XPP, fara erori e-Factura) -> raportul SmartBill recitit (dubluri) -> "Salveaza" -> numarul final citit (pagina sau raport). Orice indoiala = STOP, ciorna ramane in SmartBill > Ciorne.
- Rezultat necunoscut dupa o salvare = STOP pentru toata rularea (cod 11); comanda nu se mai salveaza automat niciodata (jurnal `issued.json`).
- Facturile emise: `FACTURI-EMISE-AUTOMAT.txt` (langa folderul kitului) + notificare pe ecran. Atentie: daca in SmartBill e pornita trimiterea automata in SPV, factura emisa pleaca singura la ANAF.
- Test fara emitere: `node scripts/test-automat.js` (SmartBill simulat); `KIT_STOP_BEFORE_FINAL=1` opreste chiar inainte de "Salveaza".

## Ciorne in bloc (meniu 9, `bulk-ciorne`) (2026-10-20)
- Toate comenzile din portal nefacturate (fara limita startFrom / 14 zile). Sarite cu motiv: facturate la Carrefour, in `issued.json`, emise/anulate in SmartBill, anulate/respinse in portal, marcate pentru verificare manuala.
- Cele cu ciorna existenta (`drafts.json` sau raportul SmartBill) NU se dubleaza: apar ca "are deja ciorna (id X)".
- Previzualizare (numar + total) si confirmare "da"; `--check` = doar previzualizare; loturi de 10 (`--lot=N`), toate intr-o rulare.
- MEREU doar ciorne (issue=false, draftOnly=true), si in profil "automat". Aceleasi protectii: lock comun cu `auto`, verificare furnizor (cod 12), CAPTCHA (cod 3, optiunea 5), reverificare dubluri + verificare XML in fillInvoice.
- Raport final: create / deja ciorna / sarite / erori (`out/<profil>/bulk-ciorne-*.json`). Teste: `node scripts/test-bulk.js` (portal simulat + hook-uri SmartBill).
