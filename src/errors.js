'use strict';
// Coduri de iesire si mesaje simple, in romana, pentru producatori (fara termeni tehnici).
const EXIT = { OK: 0, ERROR: 1, DUPLICATE: 2, LOGIN_NEEDED: 3, AUTH: 4, NETWORK: 5, LAYOUT: 6, MANUAL_LOGIN: 7, DISK: 8, INSTALL: 9, CONFIG: 10, NEEDS_HUMAN: 11, WRONG_ACCOUNT: 12 };
const HELP = {
  1: 'A aparut o eroare. Citeste mesajul de mai sus; daca nu e clar, fa o poza ferestrei si trimite-o persoanei de contact tehnic.',
  2: 'Oprit ca sa nu faci o dubla: comanda are deja factura sau ciorna in SmartBill. Nu s-a salvat nimic.',
  3: 'Trebuie sa te autentifici din nou in portalul Carrefour. Alege optiunea 5 din meniu (Autentificare Carrefour), scrie codul din imagine, apoi incearca din nou.',
  4: 'Utilizatorul sau parola nu sunt acceptate. Verifica-le in browser, apoi alege optiunea 6 (Configurare) si scrie-le din nou. Nu am reincercat, ca sa nu se blocheze contul.',
  5: 'Nu se poate ajunge la portal (internet cazut sau portalul nu raspunde). Verifica legatura la internet si incearca peste cateva minute.',
  6: 'Pagina portalului Carrefour arata altfel decat stie programul (probabil s-a schimbat). Nu am facut nimic. Anunta persoana de contact tehnic.',
  7: 'Autentificarea nu s-a terminat (fereastra a fost inchisa sau a trecut timpul). Alege din nou optiunea 5 cand ai cateva minute.',
  8: 'Nu pot scrie pe disc (disc plin sau folder fara drept de scriere). Elibereaza spatiu sau muta folderul kitului in Documente, apoi incearca din nou.',
  9: 'Instalarea e incompleta. Porneste din nou install (install.command pe Mac, install.bat pe Windows).',
  10: 'Configurarea e deteriorata sau incompleta. Alege optiunea 6 (Configurare) si refa-o.',
  12: 'Contul Carrefour din configurare NU este al firmei tale. Programul s-a oprit si nu a citit nimic. Alege optiunea 6 (Configurare) si scrie utilizatorul si parola portalului pentru firma ta.',
  11: 'Comanda are nevoie de verificarea ta (vezi mesajul de mai sus). Nu am salvat nimic.',
};
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
module.exports = { EXIT, HELP, kitError, classify };
