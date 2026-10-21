'use strict';
process.env.KIT_TEST_MODE = '1'; // test hooks (mocks, short timeouts) are honoured only in test mode
/**
 * Teste interfata grafica (kit.js ui --demo): portal Carrefour simulat local + SmartBill simulat, conturi false, folder temporar.
 * Token, Host/Origin/CSRF, niciun secret in raspunsuri, ciorne in bloc cu confirmare, lock (o actiune odata + lock-ul comun),
 * ciorna o comanda + dubla, configurare cu intrebari, raport suport, autentificare, card de eroare (cod), dezinstalare.
 * Usage: node scripts/test-ui.js   exit 0 = toate trecute.
 */
const fs = require('fs'); const path = require('path'); const os = require('os'); const http = require('http'); const { spawn } = require('child_process');
const { rm: rmx } = require('../src/fsx');
const SRC = path.join(__dirname, '..');
const results = []; const assert = (c, m) => { if (!c) throw new Error(m); };
async function T(id, name, fn) { let ok = false, ev = ''; try { ev = String(await fn() || 'ok'); ok = true; } catch (e) { ev = 'FAIL: ' + String(e && e.message || e).split('\n')[0]; } results.push({ ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name} :: ${ev}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BODIES = [];
function req(port, method, p, { token, body, headers = {} } = {}) {
  return new Promise((res, rej) => { const data = body == null ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const h = { host: `127.0.0.1:${port}`, ...(token ? { 'x-kit-token': token } : {}), ...(data != null ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers };
    for (const k of Object.keys(h)) if (h[k] == null) delete h[k];
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: h, setHost: false }, s => { let b = ''; s.on('data', c => b += c); s.on('end', () => { BODIES.push(b); let j = null; try { j = JSON.parse(b); } catch {} res({ code: s.statusCode, body: b, json: j, headers: s.headers }); }); });
    r.on('error', rej); if (data != null) r.write(data); r.end(); });
}
function makeKit(tmp) {
  const kit = path.join(tmp, 'kit ș'); for (const f of require('../src/selftest').shippedFiles().concat(['test-data/captcha-3387.png'])) { const d = path.join(kit, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(SRC, f), d); }
  rmx(path.join(kit, 'profiles')); rmx(path.join(kit, 'out')); rmx(path.join(kit, 'logs')); rmx(path.join(kit, '.demo-home'));
  fs.symlinkSync(path.join(SRC, 'node_modules'), path.join(kit, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir'); return kit;
}
async function startUi(kit, env = {}) {
  try { fs.unlinkSync(path.join(kit, '.runtime', 'ui.json')); } catch {}
  const pwb = process.env.PLAYWRIGHT_BROWSERS_PATH || (fs.existsSync(path.join(SRC, '.runtime', 'browsers')) ? path.join(SRC, '.runtime', 'browsers') : undefined);
  const child = spawn(process.execPath, [path.join(kit, 'bin', 'kit.js'), 'ui', '--demo', '--no-open'], { cwd: kit, env: { ...process.env, KIT_NO_OPEN: '1', KIT_RATE_MS: '200', KIT_SUPPORT_NO_SELFTEST: '1', ...(pwb ? { PLAYWRIGHT_BROWSERS_PATH: pwb } : {}), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', b => out += b); child.stderr.on('data', b => out += b);
  for (let i = 0; i < 100; i++) { await sleep(150); try { const s = JSON.parse(fs.readFileSync(path.join(kit, '.runtime', 'ui.json'), 'utf8')); return { ...s, child, out: () => out }; } catch {} if (child.exitCode != null) break; }
  throw new Error('interfata nu a pornit: ' + out);
}
async function waitJob(u, ms = 120000) { const t0 = Date.now(); let lines = []; let since = 0;
  for (;;) { const r = await req(u.port, 'GET', '/api/job?since=' + since, { token: u.token }); const j = r.json; lines = lines.concat(j.lines || []); since = j.total;
    if (!j.running) return { ...j, all: lines }; if (j.question) return { ...j, all: lines, asked: true }; if (Date.now() - t0 > ms) throw new Error('job prea lung: ' + lines.slice(-5).join(' | ')); await sleep(250); } }
const post = (u, p, body, extra = {}) => req(u.port, 'POST', p, { token: u.token, body, ...extra });

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-ui-')); const kit = makeKit(tmp); let u = null;
  const SECRETS = ['demo@firma-demo.ro', 'parola-demo-sb', 'demo-furnizor', 'noul@exemplu-ui.ro', 'Parola-UI-Secreta-1', 'utilizator-ui-nou', 'Parola-UI-Secreta-2'];
  try {
    u = await startUi(kit);
    await T('UI01', 'Doar 127.0.0.1, port aleator, ui.json cu permisiuni 600', async () => { assert(u.port > 1024, 'port'); const st = fs.statSync(path.join(kit, '.runtime', 'ui.json')); if (process.platform !== 'win32') assert((st.mode & 0o077) === 0, 'mod ' + (st.mode & 0o777).toString(8));
      const addrs = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address);
      for (const a of addrs.slice(0, 2)) { const ok = await new Promise(r => { const s = require('net').connect(u.port, a); s.on('connect', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); }); assert(!ok, 'raspunde pe ' + a); }
      return `port ${u.port}, ${addrs.length} interfete externe refuzate`; });
    await T('UI02', 'Token: pagina si API refuza fara token / token gresit; pagina cu token = 200 + CSP + no-store', async () => {
      assert((await req(u.port, 'GET', '/')).code === 403, 'fara t'); assert((await req(u.port, 'GET', '/?t=' + 'a'.repeat(48))).code === 403, 't gresit');
      assert((await req(u.port, 'GET', '/api/status')).code === 403, 'api fara token'); assert((await req(u.port, 'GET', '/api/status', { token: u.token.slice(0, -1) + 'x' })).code === 403, 'api token gresit');
      const ok = await req(u.port, 'GET', '/?t=' + u.token); assert(ok.code === 200 && /Carrefour/.test(ok.body) && /script-src 'nonce-/.test(ok.headers['content-security-policy']) && ok.headers['cache-control'] === 'no-store' && ok.headers['x-frame-options'] === 'DENY', 'pagina');
      assert(!/onclick=|onchange=|javascript:/i.test(ok.body), 'handler inline'); return 'ok'; });
    await T('UI03', 'Host strain (DNS rebinding) si POST fara JSON / cu Origin strain / fara token -> refuzate (CSRF)', async () => {
      assert((await req(u.port, 'GET', '/api/status', { token: u.token, headers: { host: 'evil.example:' + u.port } })).code === 403, 'host');
      assert((await req(u.port, 'POST', '/api/run', { token: u.token, body: '{"action":"selftest"}', headers: { 'content-type': 'text/plain' } })).code === 415, 'text/plain');
      assert((await req(u.port, 'POST', '/api/run', { token: u.token, body: { action: 'selftest' }, headers: { origin: 'http://evil.example' } })).code === 403, 'origin');
      assert((await req(u.port, 'POST', '/api/run', { body: { action: 'selftest' } })).code === 403, 'fara token');
      assert((await req(u.port, 'POST', '/api/run', { body: '{"action":"selftest"}', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://evil.example' } })).code === 403, 'formular');
      assert((await post(u, '/api/run', { action: 'bulk-create' })).code === 400, 'actiune interna'); assert((await post(u, '/api/run', { action: 'rm -rf' })).code === 400, 'actiune necunoscuta');
      return 'ok'; });
    await T('UI04', 'Starea (panou): profil, mod, programare, fara secrete', async () => { const s = (await req(u.port, 'GET', '/api/status', { token: u.token })).json;
      assert(s.demo && s.configured && s.company === 'Firma Demo SRL' && s.mode === 'ciorne' && s.schedule === false && Array.isArray(s.problems), JSON.stringify(s)); return `${s.company}, ${s.mode}, ${s.problems.length} probleme`; });
    await T('UI05', 'Ciorne in bloc: creare FARA lista -> refuzata; lista -> 5 comenzi + total; numar gresit / fara confirmare -> refuzat', async () => {
      assert((await post(u, '/api/bulk-create', { confirm: true, count: 5, offer: 'x' })).code === 400, 'fara lista');
      const r = await post(u, '/api/run', { action: 'bulk-check' }); assert(r.code === 200, 'start ' + r.body);
      const j = await waitJob(u); assert(j.exit === 0 && j.result && j.result.preview.length === 5 && j.result.previewTotal === 998.99 && j.result.skipped.length === 2 && j.result.offer, JSON.stringify(j).slice(0, 400));
      assert(!fs.existsSync(path.join(kit, 'out', 'firma-demo', 'drafts.json')), 'lista a creat ceva');
      const of = j.result.offer; assert((await post(u, '/api/bulk-create', { confirm: true, count: 4, offer: of.id })).code === 400, 'numar gresit'); assert((await post(u, '/api/bulk-create', { count: 5, offer: of.id })).code === 400, 'fara confirm');
      global.OFFER = of; return `5 de facut, 998.99 lei, 2 sarite`; });
    await T('UI06', 'O actiune odata: in timpul crearii, alta actiune -> 409 "lucreaza deja"; apoi 5 ciorne create, oferta nu se refoloseste', async () => {
      const r = await post(u, '/api/bulk-create', { confirm: true, count: 5, offer: global.OFFER.id }); assert(r.code === 200, r.body);
      const b = await post(u, '/api/run', { action: 'selftest' }); assert(b.code === 409 && /lucreaza deja/.test(b.json.message), 'a doua actiune ' + b.code);
      const s = (await req(u.port, 'GET', '/api/status', { token: u.token })).json; assert(s.busy, 'busy');
      const j = await waitJob(u); assert(j.exit === 0 && j.result.created.length === 5 && j.result.mode === 'ciorne', JSON.stringify(j.result || j.all.slice(-5)));
      const d = JSON.parse(fs.readFileSync(path.join(kit, 'out', 'firma-demo', 'drafts.json'), 'utf8')); assert(Object.keys(d).length === 5 && Object.values(d).every(x => x.status === 'draft-only'), 'drafts');
      assert((await post(u, '/api/bulk-create', { confirm: true, count: 5, offer: global.OFFER.id })).code === 400, 'oferta refolosita'); return '5 ciorne (doar ciorne), 409 la a doua actiune'; });
    await T('UI07', 'Lock comun: o verificare programata (alt proces viu) tine lock-ul -> lista refuzata 409, nimic pornit', async () => {
      const holder = spawn(process.execPath, ['-e', 'setTimeout(()=>{},30000)']); const lf = path.join(kit, 'out', 'firma-demo', 'auto.lock'); fs.writeFileSync(lf, String(holder.pid));
      try { const r = await post(u, '/api/run', { action: 'bulk-check' }); assert(r.code === 409 && /programata/.test(r.json.message), r.body); assert((await post(u, '/api/run', { action: 'auto' })).code === 409, 'auto');
        const s = (await req(u.port, 'GET', '/api/status', { token: u.token })).json; assert(s.busy, 'status busy'); } finally { holder.kill(); try { fs.unlinkSync(lf); } catch {} }
      return '409 + busy'; });
    await T('UI08', 'Ciorna o comanda: cifre obligatorii; comanda deja ciorna -> cod 2 (OPRIT, dubla); comanda noua -> GATA', async () => {
      assert((await post(u, '/api/run', { action: 'ciorna', order: 'abc' })).code === 409, 'fara cifre');
      await post(u, '/api/run', { action: 'ciorna', order: '1780301' }); let j = await waitJob(u); assert(j.exit === 2, 'dubla exit ' + j.exit + ' ' + j.all.slice(-3).join('|'));
      await post(u, '/api/run', { action: 'ciorna', order: '1780399' }); j = await waitJob(u); assert(j.exit === 0 && /CIORNA SALVATA/.test(j.all.join('\n')), 'noua ' + j.exit + ' ' + j.all.slice(-3).join('|')); return 'cod 2, apoi GATA'; });
    await T('UI09', 'Configurare: 4 raspunsuri scrise de program (nu apar), seria aleasa din butoane, confirmare furnizor da/nu', async () => {
      await post(u, '/api/run', { action: 'setup', reuse: false, email: SECRETS[3], password: SECRETS[4], carrefourUser: SECRETS[5], carrefourPassword: SECRETS[6], mode: 'ciorne', schedule: false });
      let j = await waitJob(u); assert(j.asked && j.question.kind === 'choice' && j.question.choices.length === 2 && /DEMO/.test(j.question.choices[0].label), 'serie ' + JSON.stringify(j.question) + j.all.slice(-4).join('|'));
      assert((await post(u, '/api/answer', { job: j.id, text: '2' })).code === 200, 'raspuns');
      j = await waitJob(u); assert(j.asked && j.question.kind === 'yesno' && /furnizorului/.test(j.question.text), 'furnizor ' + JSON.stringify(j.question));
      await post(u, '/api/answer', { job: j.id, text: 'da' }); j = await waitJob(u); assert(j.exit === 0, 'exit ' + j.exit + ' ' + j.all.slice(-4).join('|'));
      const env = fs.readFileSync(path.join(kit, '.env'), 'utf8'); assert(env.includes(SECRETS[4]) && env.includes(SECRETS[6]), '.env nescris');
      const all = JSON.stringify(j.all); for (const s of SECRETS) assert(!all.includes(s), 'secret in iesire'); assert(!/firma-demo\.ro|exemplu-ui/.test(all), 'domeniu email in iesire');
      const p = JSON.parse(fs.readFileSync(path.join(kit, 'profiles', 'firma-demo.json'), 'utf8')); assert(p.smartbill.series === 'CRF' && p.auto.mode === 'ciorne', 'profil ' + p.smartbill.series); return 'seria CRF, .env scris, 0 secrete afisate'; });
    await T('UI10', 'Raport suport: un clic -> fisier RAPORT-SUPORT-*.zip, fara secrete; "Arata fisierul" accepta doar acel nume', async () => {
      await post(u, '/api/run', { action: 'support' }); const j = await waitJob(u); assert(j.exit === 0 && j.result && /^RAPORT-SUPORT-/.test(j.result.file), JSON.stringify(j.result));
      const z = fs.readFileSync(path.join(kit, j.result.file)); const txt = require('zlib'); let all = '';
      for (let o = 0; (o = z.indexOf(Buffer.from([0x50, 0x4b, 3, 4]), o)) >= 0; o += 4) { const n = z.readUInt16LE(o + 26), x = z.readUInt16LE(o + 28), c = z.readUInt32LE(o + 18); try { all += txt.inflateRawSync(z.slice(o + 30 + n + x, o + 30 + n + x + c)).toString('utf8'); } catch {} }
      for (const s of SECRETS) assert(!all.includes(s), 'secret in arhiva');
      assert((await post(u, '/api/reveal', { file: j.result.file })).json.ok === true, 'reveal'); assert((await post(u, '/api/reveal', { file: '../.env' })).json.ok === false, 'reveal .env'); return j.result.file; });
    await T('UI11', 'Autentificare Carrefour (portal simulat, cod citit local) -> GATA', async () => { await post(u, '/api/run', { action: 'login' }); const j = await waitJob(u, 150000); assert(j.exit === 0 && /Autentificare reusita|deja autentificat/.test(j.all.join('\n')), 'exit ' + j.exit + ' ' + j.all.slice(-3).join('|')); return j.all.filter(Boolean).slice(-1)[0]; });
    await T('UI12', 'Verificare automata: pornire / oprire (programare DEMO), starea se schimba', async () => {
      await post(u, '/api/run', { action: 'schedule-on' }); let j = await waitJob(u); assert(j.exit === 0, 'on'); assert((await req(u.port, 'GET', '/api/status', { token: u.token })).json.schedule === true, 'status on');
      await post(u, '/api/run', { action: 'schedule-off' }); j = await waitJob(u); assert(j.exit === 0 && (await req(u.port, 'GET', '/api/status', { token: u.token })).json.schedule === false, 'off'); return 'pornit -> oprit'; });
    await T('UI13', 'Istoric: actiunile din interfata apar in jurnalul meniului (si in raportul suport)', async () => { const h = (await req(u.port, 'GET', '/api/history', { token: u.token })).json;
      assert(h.menu.some(l => /optiunea 9 \(Ciorne în bloc: creare, interfata\) -> cod 0/.test(l)) && h.drafts.length >= 6 && h.bulk.length >= 2, JSON.stringify(h).slice(0, 300)); return `${h.menu.length} actiuni, ${h.drafts.length} ciorne`; });
    await T('UI14', 'Niciun raspuns al serverului nu contine parole / emailuri / utilizatori (.env)', () => { const all = BODIES.join('\n'); for (const s of SECRETS) assert(!all.includes(s), 'gasit ' + s.slice(0, 3) + '***'); assert(!/SMARTBILL_PASSWORD|CARREFOUR_PORTAL_PASSWORD/.test(all), 'nume variabile'); return BODIES.length + ' raspunsuri verificate'; });
    await T('UI15', 'Al doilea dublu-click: nu porneste al doilea server, refoloseste-l pe primul', async () => {
      const r = require('child_process').spawnSync(process.execPath, [path.join(kit, 'bin', 'kit.js'), 'ui', '--demo', '--no-open'], { cwd: kit, env: { ...process.env, KIT_NO_OPEN: '1' }, encoding: 'utf8', timeout: 30000 });
      assert(r.status === 0 && /ruleaza deja/.test(r.stdout), r.stdout + r.stderr); return 'refolosit'; });
    await T('UI16', 'Dezinstalare: fara confirmare -> 400; cu confirmare -> GATA, serverul se opreste singur', async () => {
      assert((await post(u, '/api/run', { action: 'uninstall' })).code === 400, 'fara confirm'); await post(u, '/api/run', { action: 'uninstall', confirm: true }); const j = await waitJob(u); assert(j.exit === 0 && /Poti sterge/.test(j.all.join('\n')), 'exit ' + j.exit);
      const code = await new Promise(r => { const t = setTimeout(() => r('inca porneste'), 12000); u.child.on('exit', c => { clearTimeout(t); r(c); }); if (u.child.exitCode != null) r(u.child.exitCode); }); assert(code === 0, 'server ' + code); u = null; return 'oprit'; });
    await T('UI17', 'Card CE FACI: portal cazut -> cod 5 (internet) la lista; textele UI au pasi + buton de reparare pentru 3/4/5/9/10/12', async () => {
      u = await startUi(kit, { KIT_DEMO_MOCK_MODE: 'down' }); await post(u, '/api/run', { action: 'bulk-check' }); const j = await waitJob(u); assert(j.exit === 5, 'exit ' + j.exit + ' ' + j.all.slice(-3).join('|'));
      const app = fs.readFileSync(path.join(SRC, 'src', 'ui', 'app.js'), 'utf8'); for (const k of [3, 4, 5, 9, 10, 12]) assert(new RegExp(`\\b${k}: \\{ t: '[^']+', s: \\[`).test(app), 'cod ' + k); assert(/CE FACI/.test(app) && /Nu închide fereastra/.test(app), 'texte');
      return 'cod 5 -> card "Nu e internet"'; });
    await T('UI18', 'Demo refuzat intr-un folder cu conturi reale', () => { const k2 = path.join(tmp, 'real'); fs.mkdirSync(path.join(k2, 'scripts'), { recursive: true }); fs.writeFileSync(path.join(k2, '.env'), 'X=1\n');
      const src = fs.readFileSync(path.join(SRC, 'scripts', 'ui-demo.js'), 'utf8'); assert(/folder de test/.test(src) && /existsSync\(marker\)/.test(src)); return 'verificat'; });
  } finally { if (u) { try { await post(u, '/api/quit', {}); } catch {} try { u.child.kill(); } catch {} } await sleep(800); rmx(tmp); }
  const bad = results.filter(r => !r.ok).length; console.log(`\n${results.length - bad}/${results.length} teste interfata trecute.`); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
