'use strict';
const { rm: rmx } = require('../src/fsx'); // verified delete (Node 24 Windows: fs.rmSync is a no-op on non-ASCII paths)
/**
 * Scenario matrix (offline): a local MOCK of the Carrefour portal + unit checks. No real portal, no real accounts, no SmartBill writes.
 * Usage: node scripts/test-scenarios.js [--only=S01,S02] [--json=FILE]   exit 0 = all passed.
 */
const fs = require('fs'); const path = require('path'); const os = require('os'); const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2); const only = (args.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const jsonOut = (args.find(a => a.startsWith('--json=')) || '').slice(7);
const results = [];
async function T(id, name, fn) {
  if (only.length && !only.includes(id)) return;
  const t0 = Date.now(); let ok = false, evidence = '';
  try { evidence = String(await fn() || 'ok'); ok = true; } catch (e) { evidence = 'FAIL: ' + String(e && e.message || e).split('\n')[0]; }
  results.push({ id, name, ok, evidence, ms: Date.now() - t0 }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name} :: ${evidence}`);
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const expectErr = async (p, code) => { try { await p; } catch (e) { assert(e.code === code, `cod ${e.code} in loc de ${code}: ${e.message}`); return e; } throw new Error('nu a dat eroare (asteptam ' + code + ')'); };

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit scen ă-'));
  const mock = await require('./mock-portal').start();
  Object.assign(process.env, { KIT_CARREFOUR_DOCS_URL: mock.url + '/docs', KIT_NAV_TIMEOUT: '8000', KIT_SUBMIT_WAIT: '800', KIT_TEST_HEADLESS: '1', KIT_NO_NOTIFY: '1', DISPLAY: process.env.DISPLAY || ':99' });
  const cp = require('../src/carrefourPortal'); const { classify, EXIT } = require('../src/errors');
  let n = 0;
  const prof = (extra = {}) => { const d = path.join(tmp, 'p' + (++n)); return { name: 'test', root: ROOT, secrets: { carrefourUser: 'u', carrefourPassword: 'p' },
    cfg: { orderSource: { type: 'carrefour-portal' }, company: { name: 'FIRMA MEA TEST SRL' }, carrefour: { expectedSupplierCode: '10001' }, smartbill: { series: 'TST' }, auto: { mode: 'ciorne', startFrom: '2026-10-01', maxAgeDays: 400 }, ...extra }, dirs: { state: path.join(d, 'state'), out: path.join(d, 'out', 'test') } }; };
  const reset = o => Object.assign(mock.st, { mode: 'image', supplier: '10001', supplierName: 'FIRMA MEA TEST SRL', submits: 0, docsHits: 0, expireAfterDocs: Infinity, slowMs: 0, manual: null, wrongDone: false, password: 'p', rejectMsg: null, ...o });
  const setTTY = v => { process.env.KIT_INTERACTIVE = v ? '1' : ''; process.env.KIT_UNATTENDED = v ? '' : '1'; };
  setTTY(false);
  try {
    // ---------- CAPTCHA / login ----------
    await T('S01', 'CAPTCHA simplu (imagine) citit local, fara AI', async () => { reset(); const p = prof(); const r = await cp.fetchOrder(p, '1780308'); assert(r.lines.length === 1, 'linii'); assert(fs.existsSync(path.join(p.dirs.state, 'carrefour-storage-state.json')), 'sesiune nesalvata'); return `login OCR, ${mock.st.submits} trimitere, sesiune salvata`; });
    await T('S02', 'Sesiune salvata valida (fara login)', async () => { reset(); const p = prof(); await cp.fetchOrder(p, '1780308'); mock.st.submits = 0; await cp.fetchOrder(p, '1780308'); assert(mock.st.submits === 0, 'a trimis login'); return '0 trimiteri la a doua rulare'; });
    await T('S03', 'reCAPTCHA/hCaptcha widget, rulare automata -> cod 3 + mesaj optiunea 5', async () => { reset({ mode: 'recaptcha' }); const e = await expectErr(cp.fetchOrder(prof(), '1780308'), 'CAPTCHA'); assert(classify(e).exit === 3 && /optiunea 5/.test(e.message), e.message); assert(mock.st.submits === 0, 'a trimis'); return 'exit 3, 0 trimiteri: ' + e.message.slice(0, 70); });
    await T('S04', 'CAPTCHA necunoscut/mai puternic (fara imagine) -> cod 3, nimic trimis', async () => { reset({ mode: 'unknown-captcha' }); const e = await expectErr(cp.fetchOrder(prof(), '1780308'), 'CAPTCHA'); assert(mock.st.submits === 0); return 'exit ' + classify(e).exit; });
    await T('S05', 'Bot-check/challenge fara formular -> cod 3', async () => { reset({ mode: 'challenge' }); const e = await expectErr(cp.fetchOrder(prof(), '1780308'), 'CAPTCHA'); return 'exit ' + classify(e).exit; });
    setTTY(true);
    await T('S06', 'reCAPTCHA, producator la calculator -> fereastra vizibila, rezolva, rularea CONTINUA', async () => { reset({ mode: 'recaptcha', manual: 'ok' }); const p = prof(); const r = await cp.fetchOrder(p, '1780308'); assert(r.lines[0].name === 'PRODUS TEST 50G'); return `comanda citita dupa login manual (${mock.st.submits} trimitere de la "om")`; });
    await T('S07', 'Cod gresit scris in fereastra -> mesaj, mai incearca, apoi reuseste', async () => { reset({ mode: 'image', manual: 'wrong-then-ok', answer: 'XXXX' }); const p = prof();
      // OCR reads 3387 but the portal wants another code -> OCR rejected -> headed window -> human types wrong, then right
      mock.st.answer = '3387'; mock.st.manual = 'wrong-then-ok'; process.env.KIT_MANUAL_TIMEOUT_MS = '30000'; const r = await cp.interactiveLogin(p, { manual: true }); assert(/reusita/i.test(r), r); assert(mock.st.wrongDone, 'nu a fost cod gresit'); delete process.env.KIT_MANUAL_TIMEOUT_MS; return `${mock.st.submits} trimiteri (1 gresita): ${r.slice(0, 40)}`; });
    await T('S08', 'Fereastra inchisa inainte de login -> cod 7, nimic salvat', async () => { reset({ mode: 'recaptcha' }); process.env.KIT_TEST_CLOSE_MS = '1500'; try { const p = prof(); const e = await expectErr(cp.interactiveLogin(p, { manual: true }), 'MANUAL_LOGIN'); assert(!fs.existsSync(path.join(p.dirs.state, 'carrefour-storage-state.json'))); return 'exit ' + classify(e).exit + ': ' + e.message.slice(0, 60); } finally { delete process.env.KIT_TEST_CLOSE_MS; } });
    await T('S09', 'Timp expirat in fereastra (nimeni nu scrie codul) -> cod 7, fara bucla', async () => { reset({ mode: 'recaptcha' }); process.env.KIT_MANUAL_TIMEOUT_MS = '4000'; try { const t0 = Date.now(); const e = await expectErr(cp.interactiveLogin(prof(), { manual: true }), 'MANUAL_LOGIN'); assert(Date.now() - t0 < 20000, 'prea lung'); return `oprit dupa ${Math.round((Date.now() - t0) / 1000)} s, exit ${classify(e).exit}`; } finally { delete process.env.KIT_MANUAL_TIMEOUT_MS; } });
    setTTY(false);
    await T('S10', 'Sesiune expirata in timpul rularii -> relogin automat O DATA, continua', async () => { reset({ expireAfterDocs: 1 }); const p = prof(); const r = await cp.fetchOrder(p, '1780308'); assert(r.lines.length === 1); assert(mock.st.expired === 1, 'nu a expirat'); return `sesiunea a expirat 1x, relogin automat, continuat (${mock.st.submits} logari)`; });
    await T('S11', 'Sesiune expirata la mijloc + CAPTCHA puternic, automat -> cod 3 "a expirat in timpul rularii"', async () => { reset(); const p = prof(); await cp.fetchOrder(p, '1780308'); reset({ mode: 'recaptcha', expireAfterDocs: 0 }); mock.st.sessions.clear();
      const e = await expectErr(cp.fetchOrder(p, '1780308'), 'CAPTCHA'); return 'exit ' + classify(e).exit; });
    await T('S12', 'Parola Carrefour gresita -> cod 4, O SINGURA incercare (anti-blocare)', async () => { reset({ password: 'alta' }); const e = await expectErr(cp.fetchOrder(prof(), '1780308'), 'AUTH'); assert(mock.st.submits === 1, 'trimiteri ' + mock.st.submits); return `exit ${classify(e).exit}, 1 trimitere`; });
    await T('S12b', 'Mesaj necunoscut de la portal -> NU "parola gresita" (cod 3, nu 4), 1 trimitere, poza+HTML fara parola in login-diag', async () => { reset({ mode: 'none', rejectMsg: 'Your request failed to complete.' }); const pr = prof(); const e = await expectErr(cp.fetchOrder(pr, '1780308'), 'CAPTCHA'); assert(mock.st.submits === 1, 'trimiteri ' + mock.st.submits); assert(/failed to complete/.test(e.message), 'mesajul portalului lipseste'); const d = path.join(pr.dirs.out, 'login-diag'); const fl = fs.readdirSync(d); assert(fl.some(f => f.endsWith('.png')) && fl.some(f => f.endsWith('.html')), 'dovezi ' + fl); for (const f of fl.filter(f => f.endsWith('.html'))) assert(!/type="password"[^>]*value="[^"]+"/i.test(fs.readFileSync(path.join(d, f), 'utf8')), 'parola in HTML'); return `exit ${classify(e).exit}, dovezi ${fl.length} fisiere`; });
    await T('S12c', 'Mesaje Liferay in engleza: "Authentication failed" -> 4; "Text verification failed" -> CAPTCHA, nu parola', async () => { const c = cp.classifyLoginError; const r = [c('Authentication failed. Please try again.'), c('Text verification failed.'), c('Your account has been locked.'), c('Autentificare esuata. Va rugam sa incercati din nou.'), c('Textul introdus nu corespunde cu codul de verificare.'), c('Your request failed to complete.'), c('')]; assert(r.join() === 'auth,captcha,locked,auth,captcha,unknown,unknown', r.join()); return r.join(' '); });
    await T('S13', 'Cont Carrefour al ALTUI furnizor (20002) -> cod 12, sesiune arhivata, nimic citit', async () => { reset({ supplier: '20002', supplierName: 'ALT FURNIZOR TEST SRL' }); const p = prof(); const e = await expectErr(cp.fetchOrder(p, '1780308'), 'WRONG_ACCOUNT');
      const st = fs.readdirSync(p.dirs.state); assert(!st.includes('carrefour-storage-state.json') && st.some(f => /cont-gresit/.test(f)), st.join()); return `exit ${classify(e).exit}; ${st.join(',')}`; });
    await T('S14', 'Profil vechi fara cod furnizor: numele furnizorului difera de firma -> cod 12', async () => { reset({ supplier: '20002', supplierName: 'ALT FURNIZOR TEST SRL' }); const p = prof({ carrefour: {} }); await expectErr(cp.discoverCarrefour(p, { maxDetails: 0, log: () => {} }), 'WRONG_ACCOUNT'); return 'refuzat dupa nume'; });
    await T('S15', 'Portal cazut (HTTP 503) -> cod 5', async () => { reset({ mode: 'down' }); const e = await expectErr(cp.fetchOrder(prof(), '1780308'), 'NETWORK'); return 'exit ' + classify(e).exit; });
    await T('S16', 'Fara internet (conexiune refuzata) -> cod 5', async () => { const { spawnSync: sp } = require('child_process');
      const r = sp(process.execPath, ['-e', `process.env.KIT_CARREFOUR_DOCS_URL='http://127.0.0.1:59999/docs';const cp=require(${JSON.stringify(path.join(ROOT, 'src', 'carrefourPortal'))});cp.fetchOrder(${JSON.stringify(prof())},'1').catch(e=>{console.log(e.code, require(${JSON.stringify(path.join(ROOT, 'src', 'errors'))}).classify(e).exit);process.exit(0)})`], { encoding: 'utf8', env: process.env, timeout: 60000 });
      assert(/NETWORK 5/.test(r.stdout), r.stdout + r.stderr); return r.stdout.trim(); });
    await T('S17', 'Portal lent (3 s / pagina) -> merge', async () => { reset({ slowMs: 3000 }); const r = await cp.fetchOrder(prof(), '1780308'); return 'ok, linii ' + r.lines.length; });
    await T('S18', 'Pagina portalului schimbata -> cod 6, nimic trimis', async () => { reset({ mode: 'layout' }); const e = await expectErr(cp.fetchOrder(prof(), '1780308'), 'LAYOUT'); assert(mock.st.submits === 0); return 'exit ' + classify(e).exit; });
    await T('S19', 'Comanda inexistenta in portal -> cod 11 cu mesaj clar', async () => { reset(); const e = await expectErr(cp.fetchOrder(prof(), '999999'), 'NEEDS_HUMAN').catch(async x => { throw x; }); return e.message.slice(0, 60); });
    // ---------- automatic checks ----------
    await T('S20', 'Verificare automata cu sesiune expirata -> cod 3, fisier ATENTIE + notificare, fara bucla (watch se opreste)', async () => { reset({ mode: 'recaptcha' }); const p = prof(); const a = require('../src/auto'); const logs = [];
      const r = await a.watch(p, { every: 0.001, maxRuns: 5, log: m => logs.push(m) }); assert(r.exit === 3, 'exit ' + r.exit);
      const runs = logs.filter(l => /Verific comenzile/.test(l)).length; assert(runs === 1, 'rulari ' + runs);
      const f = path.join(p.dirs.out, '..', '..', 'ATENTIE-autentificare-Carrefour.txt'); assert(fs.existsSync(f) && /optiunea 5/.test(fs.readFileSync(f, 'utf8')), 'fisier'); return `1 rulare din 5 posibile, exit 3, ${path.basename(f)}`; });
    await T('S21', 'Notificarea nu se repeta la fiecare ora (max 1 / 6 h)', async () => { const a = require('../src/auto'); const d = path.join(tmp, 'notif', 'out', 'x'); fs.mkdirSync(d, { recursive: true }); delete process.env.KIT_NO_NOTIFY;
      const spawned = []; const cpm = require('child_process'); const orig = cpm.spawn; cpm.spawn = (...x) => { spawned.push(x[0]); return { unref() {}, on() { return this; } }; };
      try { a.notifyLogin(d, () => {}); a.notifyLogin(d, () => {}); a.notifyLogin(d, () => {}); } finally { cpm.spawn = orig; process.env.KIT_NO_NOTIFY = '1'; }
      assert(spawned.length === 1, 'notificari ' + spawned.length); return `3 apeluri -> 1 notificare (${spawned[0]})`; });
    await T('S22', 'Doua rulari deodata (lock) + lock ramas de la Mac adormit/oprit', async () => { const a = require('../src/auto'); const d = path.join(tmp, 'lock'); fs.mkdirSync(d, { recursive: true });
      const u1 = a.lock(d); assert(u1, 'primul'); const child = spawnSync(process.execPath, ['-e', `console.log(!!require(${JSON.stringify(path.join(ROOT, 'src', 'auto'))}).lock(${JSON.stringify(d)}))`], { encoding: 'utf8' }); assert(child.stdout.trim() === 'false', 'al doilea a intrat'); u1();
      fs.writeFileSync(path.join(d, 'auto.lock'), '999999'); const u2 = a.lock(d); assert(u2, 'lock vechi (proces mort) nu a fost ignorat'); u2(); return 'al doilea refuzat; lock orfan ignorat'; });
    await T('S23', 'Comanda noua in automat dupa relogin: ATENTIE se arhiveaza (nu se sterge)', async () => { reset(); const p = prof(); const f = path.join(p.dirs.out, '..', '..', 'ATENTIE-autentificare-Carrefour.txt'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x');
      const r = await require('../src/auto').runOnce(p, { check: true, log: () => {} }); assert(!fs.existsSync(f) && fs.readdirSync(path.join(p.dirs.out, 'notificari')).length === 1, 'nearhivat'); return `exit ${r.exit ?? 0}, ${r.done.length} de procesat, notificare arhivata`; });
  } finally { await mock.close(); }

  // ---------- unit checks (no browser) ----------
  const fi = require('../src/fillInvoice'); const { classify: ec } = require('../src/errors');
  const row = (id, ment, draft, ann, total) => `${id} | x | x | x | x | x | ${total} | ${ment} | "is_draft": ${draft} "is_annulled": ${ann}`;
  await T('U01', 'Deja facturata in SmartBill -> refuz (dubla)', () => { const c = fi.classify([row(1, 'Comanda Carrefour: 1780308 TST 12', false, false, 10)], '1780308', 'TST', 10); assert(c.kind === 'issued'); return c.kind + ' ' + c.number; });
  await T('U02', 'Ciorna existenta (fara mentiuni, acelasi total) -> refuz', () => { const c = fi.classify([row(55, '', true, false, 120.36)], '1780308', 'TST', 120.36); assert(c.kind === 'draft'); return 'draft id ' + c.draftId; });
  await T('U03', 'Factura ANULATA -> nu se reface automat (decide producatorul)', () => { const c = fi.classify([row(2, 'Comanda Carrefour: 1780308', false, true, 10)], '1780308', 'TST', 10); assert(c.kind === 'cancelled'); return c.kind; });
  await T('U04', 'Doua comenzi cu acelasi total: ciorna celeilalte comenzi NU blocheaza', () => { const rows = [row(55, '', true, false, 120.36)]; assert(fi.classify(rows, '1780309', 'TST', 120.36, ['55']) === null, 'blocat'); return 'ciorna 55 (inregistrata pt. alta comanda) ignorata'; });
  await T('U05', 'Numar comanda cu zerouri (00208711 = 208711), fara potrivire partiala (1780308 != 17803080)', () => { assert(fi.classify([row(1, 'Comanda Carrefour: 00208711', false, false, 1)], '208711', 'S', null)); assert(!fi.classify([row(1, 'Comanda Carrefour: 17803080', false, false, 1)], '1780308', 'S', null)); return 'ok'; });
  const xml = fs.existsSync(process.env.KIT_DRAFT_XML || '') ? fs.readFileSync(process.env.KIT_DRAFT_XML, 'utf8') : null;
  await T('U06', 'XML ciorna: nume linie = descriere Carrefour (BT-153) si U.M. XPP; altfel STOP inainte de emitere', () => {
    const order = { orderNo: '1780308', store: { gln: '5940475006037' }, lines: [{ name: 'PRODUS TEST 50G' }] };
    const good = `<Invoice>1780308 5940475006037<cac:InvoiceLine><cbc:InvoicedQuantity unitCode="XPP">6</cbc:InvoicedQuantity><cac:Item><cbc:Name>PRODUS TEST 50G</cbc:Name></cac:Item></cac:InvoiceLine></Invoice>`;
    const bad = good.replace('unitCode="XPP"', 'unitCode="H87"').replace('<cbc:Name>PRODUS TEST 50G', '<cbc:Name>(99) Produs Test Stil Vechi');
    const g = fi.checkDraftXml(good, order), b = fi.checkDraftXml(bad, order);
    assert(Object.values(g).every(Boolean), JSON.stringify(g)); assert(!b['nume linie = descriere Carrefour (BT-153)'] && !b['U.M. XPP'], JSON.stringify(b));
    let real = ''; if (xml) { const names = [...xml.matchAll(/<cac:Item>[\s\S]*?<cbc:Name>([^<]*)/g)].map(m => m[1]); const r = fi.checkDraftXml(xml, { orderNo: '1780308', store: { gln: '5940475006037' }, lines: names.map(name => ({ name })) }); real = ` | ciorna reala 55046683: ${JSON.stringify(r)}`; }
    return 'corect=OK, gresit=STOP' + real; });
  const lines = (o) => ({ orderNo: '1', store: { gln: '1', name: 'x' }, lines: o });
  const pre = async (order, cfg = { smartbill: { series: 'TST' } }) => { const f = path.join(tmp, 'o' + Math.random() + '.json'); fs.writeFileSync(f, JSON.stringify(order));
    const p = { name: 't', root: ROOT, cfg, secrets: {}, dirs: { out: path.join(tmp, 'pre'), state: path.join(tmp, 'pres') } };
    try { await fi.run(p, { orderFile: f, log: () => {} }); return null; } catch (e) { return e; } };
  await T('U07', 'Linie cu cantitate 0 nu se factureaza; toate 0 -> cod 11', async () => { const e = await pre(lines([{ name: 'A', qty: 0, price: 1, vat: 11, unitCode: 'PCE' }])); assert(e && e.code === 'NEEDS_HUMAN', e && e.message); return e.message.slice(0, 70); });
  await T('U08', 'Cantitati in baxuri/cutii (nu bucati) -> cod 11, verifica producatorul', async () => { const e = await pre(lines([{ name: 'A', qty: 2, price: 1, vat: 11, unitCode: 'CT' }])); const okA = await pre(lines([{ name: 'A', qty: 2, price: 1, vat: 11, unitCode: 'A' }]), { smartbill: {} }); assert(okA && okA.code === 'CONFIG', 'unitatea A (bucata) a fost refuzata'); assert(e && e.code === 'NEEDS_HUMAN' && /CT/.test(e.message), e && e.message); return e.message.slice(0, 70); });
  await T('U09', 'Linie fara cota TVA / pret -> cod 11', async () => { const e = await pre(lines([{ name: 'A', qty: 2, price: 1, vat: null, unitCode: 'PCE' }])); assert(e && e.code === 'NEEDS_HUMAN', e && e.message); return 'ok'; });
  await T('U10', 'Profil fara serie -> cod 10 (Configurare)', async () => { const e = await pre(lines([{ name: 'A', qty: 2, price: 1, vat: 11, unitCode: 'PCE' }]), { smartbill: {} }); assert(e && e.code === 'CONFIG', e && e.message); return e.message.slice(0, 60); });
  await T('U11', 'Produs negasit / EAN necunoscut -> potrivire nula (mesaj: adauga-l in SmartBill)', () => { const m = require('../src/productMatch').matchLine({ name: 'PRODUS NOU 1KG', ean: '123', vat: 11 }, [{ id: 1, Denumire: 'Altceva', Cod: 'X' }]); assert(m === null); assert(/Adauga-l in SmartBill/.test(fs.readFileSync(path.join(ROOT, 'src', 'fillInvoice.js'), 'utf8'))); return 'null -> NEEDS_HUMAN'; });
  await T('U12b', 'Profil JSON stricat -> mesaj clar + cod 10', () => { const pf = path.join(ROOT, 'profiles', '__test_stricat.json'); fs.writeFileSync(pf, '{ "smartbill": { "series": "A", '); try { const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'kit.js'), 'orders', '--profile=__test_stricat'], { encoding: 'utf8' }); assert(r.status === 10 && /deteriorat/.test(r.stderr), r.status + r.stderr); return `exit ${r.status}`; } finally { const a = path.join(tmp, 'archived-profile.json'); fs.renameSync(pf, a); } });
  await T('U13', '.env relativ se gaseste si cand programarea porneste din alt folder (Task Scheduler/launchd)', () => { const pf = path.join(ROOT, 'profiles', '__test_env.json'); fs.writeFileSync(pf, JSON.stringify({ envFile: '.env', smartbill: { series: 'A' } }));
    try { const r = spawnSync(process.execPath, ['-e', `console.log(require(${JSON.stringify(path.join(ROOT, 'src', 'config'))}).loadProfile('__test_env').envFile)`], { encoding: 'utf8', cwd: os.tmpdir() }); assert(r.stdout.trim() === path.join(ROOT, '.env'), r.stdout + r.stderr); return r.stdout.trim().replace(ROOT, '<kit>'); } finally { fs.renameSync(pf, path.join(tmp, 'archived-env-profile.json')); } });
  await T('U14', 'Disc plin / fara drept de scriere -> cod 8', () => { const d = path.join(tmp, 'ro'); fs.mkdirSync(d); fs.chmodSync(d, 0o500); let e; try { require('../src/fsx').wf(path.join(d, 'x', 'y.json'), '{}'); } catch (x) { e = x; } fs.chmodSync(d, 0o700);
    const full = ec(Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }));
    if (process.getuid && process.getuid() === 0) return 'root: EACCES nu se poate simula; ENOSPC -> ' + full.exit;
    assert(e && ec(e).exit === 8 && full.exit === 8, e && e.code); return `${e.code} -> 8, ENOSPC -> 8`; });
  await T('U15', 'Browser Playwright lipsa / biblioteci lipsa -> cod 9', () => { assert(ec(new Error("browserType.launch: Executable doesn't exist at /x/chrome")).exit === 9); assert(ec(new Error("Cannot find module 'playwright'")).exit === 9); return 'ok'; });
  await T('U16', 'Node lipsa / instalare incompleta: run.sh -> mesaj + cod 9', () => { const k = path.join(tmp, 'k ă'); fs.mkdirSync(path.join(k, 'scripts'), { recursive: true }); fs.copyFileSync(path.join(ROOT, 'run.sh'), path.join(k, 'run.sh')); fs.copyFileSync(path.join(ROOT, 'scripts', 'env-unix.sh'), path.join(k, 'scripts', 'env-unix.sh'));
    const r = spawnSync('/bin/bash', [path.join(k, 'run.sh'), 'orders'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: tmp } }); assert(r.status === 9 && /install/.test(r.stdout), r.status + r.stdout + r.stderr); return 'exit 9: ' + r.stdout.split('\n')[0]; });
  await T('U17', 'Fara internet / timeout navigare -> cod 5 (mesaj)', () => { assert(ec(new Error('page.goto: net::ERR_INTERNET_DISCONNECTED at https://x')).exit === 5 && ec(new Error('page.goto: Timeout 60000ms exceeded')).exit === 5); return 'ok'; });
  await T('U18', 'Actualizare ZIP: kit nou intr-un folder nou ("... 2", cu spatii si diacritice) preia .env + profil + jurnale; kitul vechi neatins', () => {
    const base = path.join(tmp, 'Descărcări mele'); const old = path.join(base, 'carrefour-smartbill-kit'); const neu = path.join(base, 'carrefour-smartbill-kit 2');
    for (const d of [old, neu]) { fs.mkdirSync(path.join(d, 'bin'), { recursive: true }); fs.mkdirSync(path.join(d, 'src'), { recursive: true }); fs.writeFileSync(path.join(d, 'bin', 'kit.js'), ''); }
    fs.writeFileSync(path.join(old, '.env'), 'SMARTBILL_EMAIL="x"\n'); fs.mkdirSync(path.join(old, 'profiles')); fs.writeFileSync(path.join(old, 'profiles', 'firma.json'), '{}'); fs.writeFileSync(path.join(old, 'profiles', '.default'), 'firma');
    fs.mkdirSync(path.join(old, 'out', 'firma'), { recursive: true }); fs.writeFileSync(path.join(old, 'out', 'firma', 'drafts.json'), '{"1":{}}');
    fs.copyFileSync(path.join(ROOT, 'src', 'importConfig.js'), path.join(neu, 'src', 'importConfig.js'));
    // installs no longer import by themselves (2026-10-20): auto = nothing; only the confirmed request (menu 8 / UI) copies
    const r0 = spawnSync(process.execPath, ['-e', `console.log(require(${JSON.stringify(path.join(neu, 'src', 'importConfig.js'))}).run({auto:true}))`], { encoding: 'utf8', env: { ...process.env, HOME: tmp } });
    assert(!fs.existsSync(path.join(neu, '.env')), 'instalarea a preluat singura' + r0.stdout);
    const r = spawnSync(process.execPath, ['-e', `console.log(require(${JSON.stringify(path.join(neu, 'src', 'importConfig.js'))}).run({}))`], { encoding: 'utf8', env: { ...process.env, HOME: tmp, KIT_IMPORT_CONFIRM: 'da' } });
    for (const f of ['.env', 'profiles/firma.json', 'profiles/.default', 'out/firma/drafts.json']) assert(fs.existsSync(path.join(neu, f)), 'lipseste ' + f + r.stdout + r.stderr);
    assert(fs.existsSync(path.join(old, '.env')), 'vechiul atins'); const again = spawnSync(process.execPath, ['-e', `console.log(require(${JSON.stringify(path.join(neu, 'src', 'importConfig.js'))}).run({}))`], { encoding: 'utf8' });
    assert(/deja/.test(again.stdout), 'a doua oara'); return r.stdout.split('\n')[1].trim(); });
  await T('U19', 'Programarea automata ruleaza "nesupravegheat" (fara fereastra) pe Mac/Windows/Linux', () => { const s = fs.readFileSync(path.join(ROOT, 'src', 'schedule.js'), 'utf8'); assert((s.match(/KIT_UNATTENDED/g) || []).length === 3); const plist = require('../src/schedule').install({ dryRun: true }); return 'launchd/schtasks/cron cu KIT_UNATTENDED=1'; });

  const bad = results.filter(r => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} scenarii trecute.`);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 2));
  rmx(tmp);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
