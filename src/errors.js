'use strict';
// Coduri de iesire si mesaje simple, in romana, pentru producatori (fara termeni tehnici).
const EXIT = { OK: 0, ERROR: 1, DUPLICATE: 2, LOGIN_NEEDED: 3, AUTH: 4, NETWORK: 5, LAYOUT: 6, MANUAL_LOGIN: 7, DISK: 8, INSTALL: 9, CONFIG: 10, NEEDS_HUMAN: 11, WRONG_ACCOUNT: 12 };
const HELP = {
  1: 'A aparut o eroare. Citeste mesajul de mai sus; daca nu e clar, alege 13 (Raport suport) si trimite fisierul lui George.',
  2: 'Oprit ca sa nu faci o dubla: comanda are deja factura sau ciorna in SmartBill. Nu s-a salvat nimic.',
  3: 'Trebuie sa te autentifici din nou in portalul Carrefour. Alege optiunea 5 din meniu (Autentificare Carrefour), scrie codul din imagine, apoi incearca din nou.',
  4: 'Utilizatorul sau parola nu sunt acceptate. Verifica-le in browser, apoi alege optiunea 6 (Configurare) si scrie-le din nou. Nu am reincercat, ca sa nu se blocheze contul.',
  5: 'Nu se poate ajunge la portal (internet cazut sau portalul nu raspunde). Verifica legatura la internet si incearca peste cateva minute.',
  6: 'Pagina portalului Carrefour arata altfel decat stie programul (probabil s-a schimbat). Nu am facut nimic. Alege 13 (Raport suport) si trimite fisierul lui George.',
  7: 'Autentificarea nu s-a terminat (fereastra a fost inchisa sau a trecut timpul). Alege din nou optiunea 5 cand ai cateva minute.',
  8: 'Nu pot scrie pe disc (disc plin sau folder fara drept de scriere). Elibereaza spatiu sau muta folderul kitului in Documente, apoi incearca din nou.',
  9: 'Instalarea e incompleta. Alege optiunea 14 din meniu (Reparare instalare). Daca meniul nu porneste, da dublu-click pe install (install.command pe Mac, install.bat pe Windows).',
  10: 'Configurarea e deteriorata sau incompleta. Alege optiunea 6 (Configurare) si refa-o.',
  12: 'Contul Carrefour din configurare NU este al firmei tale. Programul s-a oprit si nu a citit nimic. Alege optiunea 6 (Configurare) si scrie utilizatorul si parola portalului pentru firma ta.',
  11: 'Comanda are nevoie de verificarea ta (vezi mesajul de mai sus). Nu am salvat nimic.',
};
// Pasi numerotati pentru caseta CE FACI (fiecare spune ce optiune din MENIU alegi; niciodata comenzi de scris).
const STEPS = {
  1: ['Citeste mesajul EROARE de mai sus.', 'Incearca din nou aceeasi optiune din meniu.'],
  2: ['Nu ai nimic de facut: comanda are deja factura sau ciorna in SmartBill.', 'Verifica in SmartBill > Facturi / Ciorne, daca vrei.'],
  3: ['Alege 5 (Autentificare Carrefour).', 'In fereastra care se deschide scrie codul din imagine si apasa Autentificare.', 'Dupa ce fereastra se inchide, alege din nou optiunea pe care o voiai.'],
  4: ['Verifica utilizatorul si parola intrand o data in portal / SmartBill din browser.', 'Alege 6 (Configurare) si scrie-le din nou.', 'Nu am reincercat, ca sa nu se blocheze contul.'],
  5: ['Verifica internetul (deschide o pagina in browser).', 'Asteapta cateva minute si alege din nou aceeasi optiune.', 'Ce era deja facut nu se dubleaza.'],
  6: ['Nu am facut nimic. Pagina portalului s-a schimbat; programul trebuie actualizat de George.'],
  7: ['Alege din nou 5 (Autentificare Carrefour) cand ai cateva minute libere.', 'Nu inchide fereastra portalului pana nu se inchide singura.'],
  8: ['Elibereaza spatiu pe disc (sterge fisiere mari de care nu ai nevoie).', 'Sau muta tot folderul programului in Documente.', 'Apoi alege din nou aceeasi optiune.'],
  9: ['Alege 14 (Reparare instalare) si asteapta sa scrie GATA.', 'Daca meniul nu porneste deloc: dublu-click pe install (install.command pe Mac, install.bat pe Windows).'],
  10: ['Alege 6 (Configurare) si raspunde din nou la intrebari.'],
  11: ['Citeste mesajul de mai sus: comanda are nevoie de ochiul tau.', 'Verifica in SmartBill > Facturi si Ciorne comanda respectiva.', 'Nu am salvat nimic nou.'],
  12: ['Alege 6 (Configurare).', 'Scrie utilizatorul si parola portalului Carrefour pentru FIRMA TA.'],
};
/** Caseta "CE FACI" cu pasi numerotati, in romana, cu numarul din meniu. */
function ceFaci(exit, c = require('./color').stderr) {
  const st = STEPS[exit] || STEPS[1]; const w = 72; const line = '+' + '-'.repeat(w) + '+';
  const wrap = (t, ind) => { const out = []; let cur = ''; for (const word of t.split(' ')) { if ((cur + ' ' + word).trim().length > w - 2 - ind) { out.push(cur); cur = word; } else cur = (cur + ' ' + word).trim(); } if (cur) out.push(cur); return out; };
  const L = [line, '| ' + 'CE FACI:'.padEnd(w - 1) + '|'];
  st.forEach((t, i) => wrap(t, 4).forEach((x, j) => L.push('| ' + ((j ? '    ' : ` ${i + 1}. `) + x).padEnd(w - 1) + '|')));
  L.push('| ' + ''.padEnd(w - 1) + '|'); wrap('Daca nu reusesti: alege optiunea 13 (Raport suport) si trimite fisierul lui George.', 1).forEach(x => L.push('| ' + x.padEnd(w - 1) + '|'));
  L.push(line); return c.err(L.join('\n'));
}
function kitError(code, message, extra = {}) { return Object.assign(new Error(message), { code, ...extra }); }
/** Map any error to { exit, message } (plain Romanian). Never includes secrets. */
function classify(e) {
  const m = String((e && e.message) || e || ''); const c = e && e.code;
  if (c === 'DUPLICATE') return { exit: EXIT.DUPLICATE, message: m };
  if (c === 'CAPTCHA' || c === 'LOGIN_NEEDED' || c === 'SESSION') return { exit: EXIT.LOGIN_NEEDED, message: m };
  if (c === 'AUTH') return { exit: EXIT.AUTH, message: m };
  if (c === 'NETWORK') return { exit: EXIT.NETWORK, message: m };
  if (c === 'LAYOUT') return { exit: EXIT.LAYOUT, message: m };
  if (c === 'MANUAL_LOGIN') return { exit: EXIT.MANUAL_LOGIN, message: m };
  if (c === 'CONFIG') return { exit: EXIT.CONFIG, message: m };
  if (c === 'WRONG_ACCOUNT') return { exit: EXIT.WRONG_ACCOUNT, message: m };
  if (c === 'SAVE_UNKNOWN' || c === 'STOP_BEFORE_FINAL') return { exit: EXIT.NEEDS_HUMAN, message: m };
  if (c === 'NEEDS_HUMAN') return { exit: EXIT.NEEDS_HUMAN, message: m };
  if (['ENOSPC', 'EACCES', 'EPERM', 'EROFS', 'EDQUOT'].includes(c)) return { exit: EXIT.DISK, message: `Nu pot scrie fisierul (${c === 'ENOSPC' || c === 'EDQUOT' ? 'disc plin' : 'fara drept de scriere'}).` };
  if (/Executable doesn't exist|Please run the following command to download new browsers|Cannot find module '(playwright|dotenv|tesseract\.js|pngjs)'/i.test(m)) return { exit: EXIT.INSTALL, message: 'Lipseste browserul sau o biblioteca a programului.' };
  if (/net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|CONNECTION|ADDRESS_UNREACHABLE|TIMED_OUT|NETWORK|PROXY)|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(m)) return { exit: EXIT.NETWORK, message: 'Fara legatura la internet sau serverul nu raspunde.' };
  if (/page\.goto: Timeout|Navigation timeout/i.test(m)) return { exit: EXIT.NETWORK, message: 'Pagina se incarca prea greu (internet lent sau server ocupat).' };
  if (/login esuat \(verifica emailul\/parola/i.test(m)) return { exit: EXIT.AUTH, message: 'SmartBill nu a acceptat emailul/parola din configurare.' };
  return { exit: EXIT.ERROR, message: m };
}
const BLOCKED_MSG = 'Windows a marcat fisierele programului ca "descarcate de pe internet" si le poate bloca. Inchide programul, click dreapta pe ZIP-ul descarcat > Proprietati > bifeaza "Deblocheaza" > OK, dezarhiveaza din nou si da dublu-click pe install.bat.';
module.exports = { BLOCKED_MSG, EXIT, HELP, STEPS, ceFaci, kitError, classify };
