'use strict';
// Final audit tests (F-series): UI texts without menu numbers, Desktop shortcuts of THIS folder only, installer texts without commands.
const fs = require('fs'); const path = require('path'); const os = require('os'); const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..'); let ok = 0, n = 0;
const T = (id, name, fn) => { n++; try { const r = fn(); if (r !== true) throw new Error(String(r)); ok++; console.log(`PASS ${id} ${name}`); } catch (e) { console.log(`FAIL ${id} ${name} :: ${e.message}`); } };
const E = require('../src/errors');
T('F01', 'Toate mesajele CE FACI / HELP, in interfata, fara numere de meniu', () => {
  const all = [...Object.values(E.HELP), ...Object.values(E.STEPS).flat(), 'Daca nu reusesti: alege optiunea 13 (Raport suport) si trimite fisierul lui George.'];
  const bad = all.map(E.uiText).filter(t => /\b(optiunea|alege(?: din nou)?)\s+\d|din meniu/i.test(t)); return bad.length ? bad.join(' | ') : true; });
T('F02', 'Mesajele motorului (auto/bulk/portal/config/schedule) -> butoane in interfata', () => {
  const src = ['auto.js', 'bulk.js', 'carrefourPortal.js', 'config.js', 'fillInvoice.js', 'importConfig.js', 'schedule.js', 'setup.js', 'support.js', 'smartbillWeb.js'].map(f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n');
  const strs = (src.match(/'[^'\n]*'|`[^`\n]*`/g) || []).filter(s => /optiunea \d|alege( din nou)? \d/i.test(s)).map(s => E.uiText(s));
  const bad = strs.filter(t => /\b(optiunea|alege(?: din nou)?)\s+\d{1,2}\b/i.test(t)); return bad.length ? bad.slice(0, 5).join(' | ') : strs.length > 10 || 'prea putine mesaje gasite ' + strs.length; });
T('F03', 'Interfata: textele trec prin uiText (rulari + probleme deschise)', () => { const s = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'server.js'), 'utf8');
  return /uiText\(clean\(s\)\)/.test(s) && /text: uiText\(clean\(p\.text\)\)/.test(s) || 'lipseste uiText'; });
T('F04', 'Interfata: "Incearca din nou" dupa o configurare esuata NU retrimite fara parole (duce la ecranul Configurare)', () => {
  const s = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'app.js'), 'utf8'); return /S\.last\.action === 'setup'\) \{[^}]*go\('setup'\)/.test(s) || 'lipseste'; });
// shortcuts
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-sc-')); const d1 = path.join(tmp, 'Desktop'), d2 = path.join(tmp, 'OneDrive', 'Desktop'); fs.mkdirSync(d1, { recursive: true }); fs.mkdirSync(d2, { recursive: true });
const other = path.join(tmp, 'alt-kit');
const mk = (d, n, root, enc = 'utf8') => { const f = path.join(d, n); if (n.endsWith('.app')) { fs.mkdirSync(path.join(f, 'Contents', 'Resources', 'Scripts'), { recursive: true }); fs.writeFileSync(path.join(f, 'Contents', 'Resources', 'Scripts', 'main.scpt'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('cd ' + root, enc)])); } else fs.writeFileSync(f, Buffer.concat([Buffer.from('L\0\0\0'), Buffer.from(root + '\\run.bat', enc)])); return f; };
const sc = require('../src/shortcuts');
T('F05', 'Dezinstalare: sterge scurtaturile ACESTUI folder (Desktop + Desktop OneDrive, .app, .lnk UTF-16) si le lasa pe ale altui kit', () => {
  process.env.KIT_TEST_DESKTOPS = [d1, d2].join(path.delimiter);
  const a = mk(d1, 'Carrefour SmartBill.app', ROOT); const b = mk(d2, 'Carrefour SmartBill.lnk', ROOT, 'utf16le'); const c = mk(d1, 'Carrefour SmartBill - Meniu text.command', other); const x = mk(d2, 'Carrefour SmartBill - Meniu text.lnk', other, 'utf16le');
  const r = sc.removeMine(ROOT); delete process.env.KIT_TEST_DESKTOPS;
  if (fs.existsSync(a) || fs.existsSync(b)) return 'nu a sters: ' + JSON.stringify(r);
  if (!fs.existsSync(c) || !fs.existsSync(x)) return 'a sters scurtatura altui kit';
  return r.removed.length === 2 && r.kept.length === 2 || JSON.stringify(r); });
T('F06', 'kit.js uninstall (HOME separat): mesaj clar, scurtatura altui kit ramasa', () => {
  const h = path.join(tmp, 'home'); fs.mkdirSync(path.join(h, 'Desktop'), { recursive: true }); const keep = mk(path.join(h, 'Desktop'), 'Carrefour SmartBill.command', other); const mine = mk(path.join(h, 'Desktop'), 'Carrefour SmartBill - Meniu text.command', ROOT);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'kit.js'), 'uninstall'], { encoding: 'utf8', env: { ...process.env, HOME: h, USERPROFILE: h, KIT_TEST_DESKTOPS: path.join(h, 'Desktop'), KIT_SCHEDULE_DRY: '1' }, timeout: 60000 });
  const o = r.stdout + r.stderr; if (fs.existsSync(mine)) return 'nu a sters scurtatura proprie'; if (!fs.existsSync(keep)) return 'a sters scurtatura altui kit';
  return /Am lasat pe Desktop/.test(o) && /trage-l in Cos/.test(o) || o; });
T('F07', 'Instalatoarele nu afiseaza comenzi (npm ci) in mesajele pentru producator', () => {
  const t = ['install.ps1', 'scripts/install-unix.sh'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const shown = t.split('\n').filter(l => /Write-Host|say |fail |Fail /.test(l) && !/install-deps|Linux/.test(l) && /npm ci|npx |playwright install/.test(l.replace(/^[^"]*"|"[^"]*$/g, '')));
  return shown.length ? shown.join(' | ') : true; });
T('F08', 'SmartBill fara email/parola -> cod 10 (Configurare), fara nume tehnice', () => {
  const s = fs.readFileSync(path.join(ROOT, 'src', 'smartbillWeb.js'), 'utf8'); if (/SMARTBILL_PASSWORD \(/.test(s)) return 'nume tehnic';
  return E.classify(Object.assign(new Error('x'), { code: 'CONFIG' })).exit === 10 || 'cod'; });
T('F09', 'Kit vechi: cautat si in Desktop/Documente/Descarcari OneDrive', () => /OneDriveCommercial/.test(fs.readFileSync(path.join(ROOT, 'src', 'importConfig.js'), 'utf8')) || 'lipseste');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${ok}/${n} teste audit final trecute.`); process.exit(ok === n ? 0 : 1);
