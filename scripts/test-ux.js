'use strict';
process.env.KIT_TEST_MODE = '1'; // test hooks (mocks, short timeouts) are honoured only in test mode
/** Teste de utilizare (producatori fara cunostinte tehnice): culori, caseta CE FACI, meniu, fara comenzi de scris, raport suport fara secrete.
 * Fara portaluri reale. Usage: node scripts/test-ux.js   exit 0 = toate trecute. */
const fs = require('fs'); const path = require('path'); const os = require('os'); const { spawnSync, execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..'); const KIT = path.join(ROOT, 'bin', 'kit.js');
const results = []; const assert = (c, m) => { if (!c) throw new Error(m); };
async function T(id, name, fn) { let ok = false, ev = ''; try { ev = String(await fn() || 'ok'); ok = true; } catch (e) { ev = 'FAIL: ' + String(e && e.message || e).split('\n')[0]; } results.push({ ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name} :: ${ev}`); }
const ESC = /\x1b\[/;
(async () => {
  const col = require('../src/color'); const E = require('../src/errors'); const menu = require('../src/menu');
  await T('X1', 'Culori: oprite fara TTY / cu NO_COLOR; pornite pe TTY; Windows vechi = fara culori; FORCE_COLOR', () => {
    const tty = { isTTY: true }, pipe = { isTTY: false };
    assert(!col.enabled(pipe, {}, 'linux'), 'pipe'); assert(col.enabled(tty, {}, 'darwin'), 'mac tty'); assert(!col.enabled(tty, { NO_COLOR: '1' }, 'darwin'), 'NO_COLOR');
    assert(col.enabled(tty, {}, 'win32', '10.0.19045'), 'win10'); assert(col.enabled(tty, {}, 'win32', '10.0.22631'), 'win11'); assert(!col.enabled(tty, {}, 'win32', '6.1.7601'), 'win7');
    assert(col.enabled(pipe, { FORCE_COLOR: '1' }, 'linux'), 'force'); assert(!col.enabled(tty, { TERM: 'dumb' }, 'linux'), 'dumb');
    const on = col.make(true), off = col.make(false); assert(on.err('x') === '\x1b[1m\x1b[31mx\x1b[39m\x1b[22m', 'rosu bold'); assert(/32m/.test(on.ok('x')) && /33m/.test(on.warn('x')) && off.err('x') === 'x', 'verde/galben/off');
    assert(col.strip(on.warn('da')) === 'da'); return 'ok'; });
  await T('X2', 'Caseta CE FACI: pasi numerotati, numar din meniu, linia "Raport suport" (13), rosie cand culorile sunt pornite', () => {
    for (const k of Object.keys(E.STEPS)) { const b = E.ceFaci(Number(k), col.make(false)); assert(/CE FACI/.test(b) && / 1\. /.test(b) && /optiunea 13 \(Raport suport\)/.test(b), 'cod ' + k); assert(!/node |--[a-z]|run\.(sh|bat) /.test(b), 'comanda in caseta ' + k); }
    assert(/Alege 5/.test(E.ceFaci(3, col.make(false))) && /Alege 14/.test(E.ceFaci(9, col.make(false))) && /31m/.test(E.ceFaci(3, col.make(true)))); return Object.keys(E.STEPS).length + ' coduri'; });
  await T('X3', 'Meniu: 1-9 neschimbate (tutorial), 10-15 noi', () => {
    const m = Object.fromEntries(menu.ITEMS.map(i => [i[0], i[2]('1')]));
    const exp = { 1: 'orders', 2: 'ciorna', 3: 'preview', 4: 'auto', 5: 'login-carrefour', 6: 'setup', 7: 'selftest', 8: 'import-config', 9: 'bulk-ciorne', 10: 'bulk-ciorne', 11: 'schedule', 12: 'discover', 13: 'support', 14: 'repair', 15: 'uninstall' };
    for (const [k, v] of Object.entries(exp)) assert(m[k] && m[k][0] === v, k); assert(m[10].includes('--check') && !m[9].includes('--check')); assert(menu.ITEMS.find(i => i[0] === '11')[2]('opreste').includes('--remove')); return '15 optiuni'; });
  await T('X4', 'Optiunea 9: lista fara tastatura, "da" cerut in meniu, apoi creare cu raspunsul dat (fara stdin in proces)', async () => {
    const run = async (todo, answer) => { const calls = []; const exec = (a, env, stdin) => { calls.push({ a, env, stdin }); if (env.KIT_BULK_SUMMARY) fs.writeFileSync(env.KIT_BULK_SUMMARY, JSON.stringify({ todo })); return 0; };
      const rc = await menu.bulk(exec, async () => answer); return { rc, calls }; };
    let r = await run(3, true); assert(r.rc === 0 && r.calls.length === 2 && r.calls[0].a.includes('--check') && r.calls[0].stdin === false && r.calls[1].env.KIT_BULK_CONFIRM === 'da' && r.calls[1].stdin === false, JSON.stringify(r.calls));
    r = await run(3, false); assert(r.calls.length === 1, 'nu -> creare'); r = await run(0, true); assert(r.calls.length === 1, '0 -> creare'); return 'da / nu / nimic de facut'; });
  await T('X5', 'Meniu cu raspunsuri trimise (fara fereastra): optiune gresita, 7, 0 -> mesaje clare, GATA, fara coduri de culoare', () => {
    const r = spawnSync(process.execPath, [KIT, 'menu'], { input: '99\n7\n0\n', encoding: 'utf8', timeout: 120000, env: { ...process.env, NO_COLOR: '', FORCE_COLOR: '' } });
    assert(r.status === 0, 'cod ' + r.status); assert(/Nu exista optiunea "99"/.test(r.stdout) && /LUCREZ/.test(r.stdout) && /GATA\./.test(r.stdout) && /La revedere/.test(r.stdout), r.stdout.slice(-400)); assert(!ESC.test(r.stdout), 'ANSI in pipe'); return 'ok'; });
  await T('X6', 'Eroare din linia de rulare directa: EROARE + caseta CE FACI cu numar din meniu + ultima-eroare.txt', () => {
    const r = spawnSync(process.execPath, [KIT, 'orders', '--profile=__ux_lipsa'], { encoding: 'utf8' });
    assert(r.status === 10 && /EROARE/.test(r.stderr) && /CE FACI/.test(r.stderr) && /Alege 6/.test(r.stderr) && /optiunea 13/.test(r.stderr), r.status + r.stderr); assert(!/node bin\/kit/.test(r.stderr), 'comanda CLI in mesaj');
    assert(fs.existsSync(path.join(ROOT, 'logs', 'ultima-eroare.txt'))); return 'cod 10'; });
  await T('X7', 'Ghid + mesaje: NICIO comanda de scris pentru producatori', () => {
    const g = fs.readFileSync(path.join(ROOT, 'docs', 'GHID_CONFIGURARE.md'), 'utf8');
    const bad = g.split('\n').filter(l => /node |bin\/kit|npm |npx |\s--[a-z]|terminal|linia de comanda|\.\/run|\.\/install|run\.(bat|sh|command) [a-z]|xattr|powershell/i.test(l)); assert(!bad.length, 'ghid: ' + bad[0]);
    const user = []; for (const f of fs.readdirSync(path.join(ROOT, 'src')).concat(fs.readdirSync(path.join(ROOT, 'src', 'ui')).map(x => 'ui/' + x)).filter(x => /\.(js|html)$/.test(x)).map(x => path.join(ROOT, 'src', x)).concat(['install.ps1', 'run.bat', 'run.sh', 'scripts/install-unix.sh'].map(x => path.join(ROOT, x)).filter(f => fs.existsSync(f))))
      fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (/^\s*(\/\/|\*|#|REM)/.test(l) || /CreateShortcut|#!\/bin\/bash/.test(l)) return; for (const s of l.match(/(['"`])(?:(?!\1).)*\1/g) || []) if (/node bin\/kit|ruleaza: |\.\/run\.sh |run\.bat [a-z]|run\.command [a-z]|schedule --remove|login-carrefour --relay/i.test(s)) user.push(path.basename(f) + ':' + (i + 1)); });
    assert(!user.length, 'mesaje cu comenzi: ' + user.join(', ')); return 'ok'; });
  await T('X8', 'Raport suport: UN fisier RAPORT-SUPORT-*.zip, REZUMAT.txt primul, poze login-diag, profil cenzurat, NICIUN secret', () => {
    const k = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-ux-')); const S = { pass: 'Parola#Secreta123', cpass: 'CarrefourPw!987', email: 'producator.real@firma-mea.ro', user: 'utilizatorCF77', token: 'tok_abcdef0123456789' };
    fs.writeFileSync(path.join(k, '.env'), `SMARTBILL_EMAIL=${S.email}\nSMARTBILL_PASSWORD="${S.pass}"\nCARREFOUR_USER=${S.user}\nCARREFOUR_PASSWORD=${S.cpass}\n`);
    fs.mkdirSync(path.join(k, 'profiles')); fs.writeFileSync(path.join(k, 'profiles', 'firma.json'), JSON.stringify({ smartbill: { series: 'TST', apiToken: S.token, email: S.email }, company: { name: 'FIRMA TEST' } }));
    fs.mkdirSync(path.join(k, 'logs')); fs.writeFileSync(path.join(k, 'logs', 'auto.log'), `login cu ${S.email} parola=${S.pass} token: ${S.token}\nok ${S.user}\n`);
    fs.writeFileSync(path.join(k, 'logs', 'ultima-eroare.txt'), `EROARE: parola ${S.cpass} respinsa\n` + E.ceFaci(4, col.make(false)));
    const ld = path.join(k, 'out', 'firma', 'login-diag'); fs.mkdirSync(ld, { recursive: true }); fs.writeFileSync(path.join(ld, 'poza.png'), Buffer.from([137, 80, 78, 71])); fs.writeFileSync(path.join(ld, 'diag.json'), JSON.stringify({ user: S.user, msg: 'x' }));
    fs.writeFileSync(path.join(k, 'out', 'firma', 'drafts.json'), JSON.stringify({ 1: { status: 'draft-only' }, 2: { status: 'pending' } }));
    fs.mkdirSync(path.join(k, 'out', 'firma', 'state'), { recursive: true }); fs.writeFileSync(path.join(k, 'out', 'firma', 'state', 'storage.json'), 'cookie ' + S.token);
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-ux-dest-')); process.env.KIT_SUPPORT_NO_SELFTEST = '1';
    const r = require('../src/support').run({ root: k, dest }); assert(/RAPORT-SUPORT-\d{4}-\d\d-\d\d-\d{4}\.zip$/.test(r.file), r.file); assert(/Trimite acest fisier lui George pe WhatsApp\/email/.test(r.text));
    const ls = JSON.parse(execFileSync('python3', ['-c', 'import sys,zipfile,json;z=zipfile.ZipFile(sys.argv[1]);print(json.dumps({"n":z.namelist(),"t":{i:z.read(i).decode("latin-1") for i in z.namelist()}}))', r.file], { encoding: 'utf8' }));
    assert(ls.n[0] === 'REZUMAT.txt', ls.n[0]); for (const want of ['out/firma/login-diag/poza.png', 'out/firma/login-diag/diag.json', 'logs/auto.log', 'profil/firma.json', 'logs/ultima-eroare.txt']) assert(ls.n.includes(want), 'lipseste ' + want);
    assert(!ls.n.some(n => /\.env|storage/.test(n)), 'fisier secret inclus');
    const all = Object.values(ls.t).join('\n'); for (const [n, v] of Object.entries(S)) assert(!all.includes(v), 'SECRET in zip: ' + n);
    const rez = ls.t['REZUMAT.txt']; assert(/Versiune kit/.test(rez) && /Node\.js/.test(rez) && /Sistem/.test(rez) && /CE FACI/.test(rez) && /drafts\.json: 2 comenzi/.test(rez) && /Ultimele optiuni/.test(rez) && /selftest/.test(rez), rez);
    fs.rmSync(k, { recursive: true, force: true }); fs.rmSync(dest, { recursive: true, force: true }); return ls.n.length + ' fisiere, 0 secrete'; });
  await T('X9', 'Fisierele Windows (.bat/.ps1) au sfarsit de linie Windows (CRLF)', () => { for (const f of fs.readdirSync(ROOT).filter(x => /\.(bat|ps1)$/.test(x))) { const t = fs.readFileSync(path.join(ROOT, f), 'utf8'); assert(!/[^\r]\n/.test(t), f + ' are LF'); } return 'ok'; });
  const bad = results.filter(r => !r.ok).length; console.log(`\n${results.length - bad}/${results.length} teste UX trecute.`); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
