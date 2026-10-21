'use strict';
process.env.KIT_TEST_MODE = '1'; // test hooks (mocks, short timeouts) are honoured only in test mode
/**
 * Audit de scalare (offline, fara conturi reale, fara SmartBill real): sute de comenzi + paginare in portal (portal SIMULAT local),
 * schimbari de pagina, SmartBill 429/5xx/timeout (pagina simulata), crash intre ciorna si finalizare, lacat dupa somn / alt calculator,
 * registre foarte mari, sesiuni ale altui cont, EAN, ferestra de 14 zile + ora de vara/iarna, curatarea jurnalelor, raport suport mic.
 * Usage: node scripts/test-scalare.js   exit 0 = toate trecute.
 */
const fs = require('fs'); const path = require('path'); const os = require('os'); const { spawn, spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
Object.assign(process.env, { KIT_NO_NOTIFY: '1', KIT_RATE_MS: '1', KIT_RETRY_MS: '5' });
const results = []; const assert = (c, m) => { if (!c) throw new Error(m); };
async function T(id, name, fn) { let ok = false, ev = ''; const t0 = Date.now(); try { ev = String(await fn() || 'ok'); ok = true; } catch (e) { ev = 'FAIL: ' + String(e && e.stack || e).split('\n').slice(0, 2).join(' | '); } results.push({ id, name, ok, ev }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name} :: ${ev} (${Date.now() - t0} ms)`); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit scalare ă-')); let n = 0;
const prof = (extra = {}) => { const d = path.join(tmp, 'p' + (++n)); return { name: 'test', root: ROOT, secrets: { carrefourUser: 'u', carrefourPassword: 'p', email: 'a@b.ro', password: 'x' },
  cfg: { orderSource: { type: 'carrefour-portal' }, company: { name: 'FIRMA MEA TEST SRL' }, carrefour: { expectedSupplierCode: '10001' }, smartbill: { series: 'TST' }, auto: { mode: 'ciorne', startFrom: '2026-01-01', maxAgeDays: 3650 }, ...extra }, dirs: { state: path.join(d, 'state'), out: path.join(d, 'out', 'test') } }; };
const { wf, readLedger } = require('../src/fsx');

(async () => {
  const mock = await require('./mock-portal').start();
  Object.assign(process.env, { KIT_CARREFOUR_DOCS_URL: mock.url + '/docs', KIT_NAV_TIMEOUT: '8000', KIT_SUBMIT_WAIT: '800', KIT_TEST_HEADLESS: '1', KIT_UNATTENDED: '1' });
  const cp = require('../src/carrefourPortal');
  const many = (k, from = 0) => Array.from({ length: k }, (_, i) => ({ id: 1000 + from + i, nrComMeti: String(1800000 + from + i), magazin: 'CARREFOUR ' + (i % 37), codGLN: String(5940475000000 + (i % 37)), dataCom: '19.10.2026', totalFaraTvaML: 10 + i, stare: 'Noua' }));
  const reset = o => { for (const k of ['orders', 'pageSize', 'model', 'gridBroken', 'gridCalls']) delete mock.st[k]; Object.assign(mock.st, { mode: 'image', supplier: '10001', supplierName: 'FIRMA MEA TEST SRL', submits: 0, docsHits: 0, expireAfterDocs: Infinity, slowMs: 0, manual: null, password: 'p', rejectMsg: null, ...o }); };
  try {
    // ---------- portal: many orders, pagination, layout change ----------
    await T('C01', '437 comenzi, portalul arata doar 50 pe pagina -> toate citite (paginare, doar citire), fara dubluri', async () => {
      reset({ orders: many(437), pageSize: 50 }); const p = prof(); const d = await cp.discoverCarrefour(p, { maxDetails: 0, log: () => {} });
      const set = new Set(d.orders.map(o => o.orderNo)); assert(d.orders.length === 437 && set.size === 437, `citite ${d.orders.length}`); return `437/437 citite, ${mock.st.gridCalls} cereri de paginare`; });
    await T('C02', 'Pagina fara lista de comenzi (portal schimbat) -> LAYOUT (cod 6), nu "0 comenzi"', async () => {
      reset({ model: { altceva: true } }); const p = prof(); let e; try { await cp.discoverCarrefour(p, { maxDetails: 0, log: () => {} }); } catch (x) { e = x; }
      assert(e && e.code === 'LAYOUT', 'cod ' + (e && e.code)); return e.message.slice(0, 80); });
    await T('C03', 'Coloana "numar comanda" redenumita -> LAYOUT', async () => {
      reset({ model: { data: [{ id: 1, numarNou: '1', dataCom: '19.10.2026' }] } }); let e; try { await cp.discoverCarrefour(prof(), { maxDetails: 0, log: () => {} }); } catch (x) { e = x; }
      assert(e && e.code === 'LAYOUT', 'cod ' + (e && e.code)); return 'LAYOUT'; });
    await T('C04', 'Paginarea nu mai merge (portalul raspunde gol) -> LAYOUT, nu sare comenzi in tacere', async () => {
      reset({ orders: many(120), pageSize: 50, gridBroken: true }); let e; try { await cp.discoverCarrefour(prof(), { maxDetails: 0, log: () => {} }); } catch (x) { e = x; }
      assert(e && e.code === 'LAYOUT' && /120/.test(e.message), e && e.message); return e.message.slice(0, 90); });
    await T('C05', 'Sesiune salvata pentru ALT utilizator Carrefour -> aruncata, autentificare noua (nu se foloseste contul altcuiva)', async () => {
      reset({ orders: many(3) }); const p = prof(); await cp.discoverCarrefour(p, { maxDetails: 0, log: () => {} }); const f = path.join(p.dirs.state, 'carrefour-storage-state.json');
      assert(fs.existsSync(f + '.cont'), 'fara amprenta cont'); mock.st.submits = 0; await cp.discoverCarrefour(p, { maxDetails: 0, log: () => {} }); assert(mock.st.submits === 0, 'acelasi cont: a reautentificat');
      const q = { ...p, secrets: { ...p.secrets, carrefourUser: 'alt-producator' } }; await cp.discoverCarrefour(q, { maxDetails: 0, log: () => {} }); assert(mock.st.submits >= 1, 'a refolosit sesiunea altui cont');
      return `acelasi cont: 0 autentificari; alt cont: ${mock.st.submits} autentificare noua`; });
  } finally { await mock.close(); }

  // ---------- SmartBill: 429 / 5xx / timeout (pagina simulata, nimic trimis) ----------
  const fi = require('../src/fillInvoice');
  const fakeReportPage = seq => { let i = 0; const calls = []; return { calls, waitForResponse: async () => { const r = seq[Math.min(i++, seq.length - 1)]; calls.push(r); if (r === 'timeout') return null;
      return { ok: () => r < 400, status: () => r, headers: () => ({}), json: async () => ({ aaData: [['1', 'CARREFOUR ROMANIA SA | Comanda Carrefour: 1'], ['2', 'x']], iTotalDisplayRecords: 2 }), request: () => ({ postData: () => 'iDisplayStart=0&iDisplayLength=50' }) }; },
    goto: async () => {}, waitForTimeout: async () => {}, evaluate: async () => ({ rows: [] }) }; };
  const cf = { client: { cif: 'RO11588780' } };
  await T('C06', 'Raport SmartBill: 429, 503, apoi OK -> reincercat si citit (3 incercari)', async () => { const pg = fakeReportPage([429, 503, 200]); const rows = await fi.readInvoiceReport(pg, prof(), cf, '2026-10-01'); assert(rows.length === 1 && pg.calls.length === 3, JSON.stringify(pg.calls)); return '429 -> 503 -> 200: ' + rows.length + ' rand Carrefour'; });
  await T('C07', 'Raport SmartBill: 429 persistent -> cod RATE (cod 5), nimic salvat', async () => { let e; try { await fi.readInvoiceReport(fakeReportPage([429]), prof(), cf, '2026-10-01'); } catch (x) { e = x; } assert(e && e.code === 'RATE' && require('../src/errors').classify(e).exit === 5, e && e.code); return e.message.slice(0, 70); });
  await T('C08', 'Raport SmartBill: 502 persistent / fara raspuns (timeout) -> NETWORK (cod 5)', async () => { for (const s of [[502], ['timeout']]) { let e; try { await fi.readInvoiceReport(fakeReportPage(s), prof(), cf, '2026-10-01'); } catch (x) { e = x; } assert(e && e.code === 'NETWORK', String(s) + ' ' + (e && e.code)); } return '502 si timeout -> NETWORK'; });

  // ---------- auto/bulk: transient SmartBill errors are not counted against the order ----------
  const portal = require('../src/carrefourPortal'); let portalOrders = []; portal.discoverCarrefour = async () => ({ orders: portalOrders });
  const realRun = fi.run; let behave = () => null; let calls = [];
  fi.run = async (p, o) => { calls.push(o.orderNo); const b = behave(o); if (b instanceof Error) throw b; return { issued: { invoiceId: '9' + calls.length, number: o.issue ? 'TST ' + calls.length : null } }; };
  const auto = require('../src/auto'); const bulk = require('../src/bulk');
  const today = new Date(); const dd = x => { const d = new Date(today - x * 864e5); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; };
  const ord = (nr, daysAgo = 1) => ({ orderNo: String(nr), date: dd(daysAgo), store: 'S', total: 10, status: 'Noua' });
  const E = (code, msg) => Object.assign(new Error(msg), { code });
  await T('C09', 'Auto (ciorne): SmartBill 429 la a 2-a comanda -> oprit cu cod 5; comanda NU e marcata "esec" si e reluata data viitoare', async () => {
    const p = prof(); portalOrders = [ord(1), ord(2), ord(3)]; calls = []; behave = o => o.orderNo === '2' ? E('RATE', 'SmartBill cere sa incetinim (HTTP 429)') : null;
    const r = await auto.runOnce(p, { log: () => {} }); const st = JSON.parse(fs.readFileSync(path.join(p.dirs.out, 'auto-state.json'), 'utf8'));
    assert(r.exit === 5 && calls.join() === '1,2' && !st['2'], JSON.stringify({ exit: r.exit, calls, st }));
    behave = () => null; calls = []; const r2 = await auto.runOnce(p, { log: () => {} }); assert(calls.includes('2') && r2.exit == null, JSON.stringify({ calls, r2: r2.exit })); return 'oprit dupa 429, reluat ora urmatoare (' + calls.join(',') + ')'; });
  await T('C10', 'Automat (armat): NETWORK inainte de salvare -> oprit cod 5, FARA "necesita verificare" (nimic salvat)', async () => {
    const p = prof({ auto: { mode: 'automat', startFrom: '2026-01-01', maxAgeDays: 3650 } }); wf(path.join(p.dirs.out, 'automat-armat.json'), '{}'); portalOrders = [ord(11), ord(12)]; calls = []; behave = () => E('NETWORK', 'SmartBill nu raspunde');
    const r = await auto.runOnce(p, { log: () => {} }); const st = JSON.parse(fs.readFileSync(path.join(p.dirs.out, 'auto-state.json'), 'utf8'));
    assert(r.exit === 5 && !r.stopped && !(st['11'] && st['11'].needsHuman) && calls.length === 1, JSON.stringify({ r: r.exit, st, calls })); return 'cod 5, o singura incercare, nimic blocat'; });
  await T('C11', 'Ciorne in bloc: 503 -> oprit cod 5, comenzile ramase listate, nicio comanda marcata', async () => {
    const p = prof(); portalOrders = [ord(21), ord(22), ord(23)]; calls = []; behave = o => o.orderNo === '22' ? E('NETWORK', 'HTTP 503') : null;
    const r = await bulk.run(p, { confirm: async () => 'da', log: () => {} }); assert(r.exit === 5 && r.created.length === 1 && r.remaining.includes('22') && r.remaining.includes('23'), JSON.stringify({ exit: r.exit, c: r.created.length, rem: r.remaining })); return 'creat 1, ramase ' + r.remaining.join(','); });

  // ---------- crash / doubt between draft and final invoice ----------
  await T('C12', 'Automat: ciorna salvata, verificarea finala anti-dublura cade (SmartBill 503) -> NEEDS_HUMAN, NU finalizeaza; registrul nu spune "deja facturata"', async () => {
    const p = prof(); const D = fi._deps; const realD = { ...D }; let fin = 0;
    const order = { orderNo: '1780309', orderDate: '2026-10-19', store: { gln: '5940475006037', name: 'S' }, lines: [{ name: 'PRODUS TEST 50G', qty: 1, price: 1, vat: 11 }] };
    const xml = path.join(tmp, 'x.xml'); fs.writeFileSync(xml, `<Invoice>1780309 5940475006037<cac:InvoiceLine><cbc:InvoicedQuantity unitCode="XPP">1</cbc:InvoicedQuantity><cac:Item><cbc:Name>PRODUS TEST 50G</cbc:Name></cac:Item></cac:InvoiceLine></Invoice>`);
    D.downloadXml = async () => ({ xml, xmlErrors: null }); D.readReport = async () => { throw E('NETWORK', 'HTTP 503'); }; D.finalizeDraft = async () => { fin++; return { status: 'issued', number: '1' }; };
    const page = { url: () => 'u', waitForTimeout: async () => {}, waitForResponse: async () => ({ text: async () => '{"successfully":true,"is_draft":true,"id":555}', status: () => 200 }), click: async () => {},
      locator: () => { const o = { filter: () => o, first: () => o, count: async () => 0, isVisible: async () => false }; return o; }, evaluate: async () => ({ title: 'x', h: [], links: [] }) };
    const shot = async nm => { const g = path.join(p.dirs.out, nm + '.png'); wf(g, ''); return g; };
    let e; try { await fi.issueNow(page, { guard: { writes: [] } }, p, order, shot, () => {}, { draftOnly: false }); } catch (x) { e = x; } finally { Object.assign(D, realD); }
    const L = readLedger(path.join(p.dirs.out, 'issued.json')); assert(e && e.code === 'NEEDS_HUMAN' && fin === 0 && L['1780309'].status === 'draft-stopped', JSON.stringify({ c: e && e.code, fin, st: L['1780309'] && L['1780309'].status }));
    const dup = await fi._alreadyIssued(null, p, order, {}); assert(dup && dup.kind === 'unclear', JSON.stringify(dup)); return 'finalizari 0, stare draft-stopped -> "neclar, verifica" (nu "deja facturata")'; });
  await T('C13', 'Registru issued.json cu stare intermediara (draft-saved/finalizing/finalize-unknown) -> mereu "neclar", niciodata "deja facturata"', async () => {
    for (const s of ['draft-saved', 'finalizing', 'finalize-unknown', 'issued-unverified', 'issued-unchecked']) { const p = prof(); wf(path.join(p.dirs.out, 'issued.json'), JSON.stringify({ 77: { status: s, invoiceId: '1' } }));
      const d = await fi._alreadyIssued(null, p, { orderNo: '77', lines: [] }, {}); assert(d && d.kind === 'unclear', s + ' -> ' + (d && d.kind)); }
    const p = prof(); wf(path.join(p.dirs.out, 'issued.json'), JSON.stringify({ 78: { status: 'issued', number: 'TST 5' } })); assert((await fi._alreadyIssued(null, p, { orderNo: '78', lines: [] }, {})).kind === 'issued'); return '5 stari -> neclar; issued -> deja facturata'; });

  // ---------- lock: sleep/wake, other computer, read-only check ----------
  const lockF = d => path.join(d, 'auto.lock');
  await T('C14', 'Lacat preluat dupa somn lung (>2 h fara heartbeat): vechiul proprietar vede held()=false si se opreste', async () => {
    const d = path.join(tmp, 'L1'); const u = auto.lock(d); assert(u && u.held(), 'primul'); const old = new Date(Date.now() - 3 * 3600e3); fs.utimesSync(lockF(d), old, old);
    const txt = fs.readFileSync(lockF(d), 'utf8'); fs.writeFileSync(lockF(d), txt.replace(/^\d+/, '999999')); // the "other run" looks dead+old -> taken over
    const u2 = auto.lock(d); assert(u2 && u2.held() && !u.held(), 'preluare'); u(); assert(fs.existsSync(lockF(d)), 'unlock-ul vechi a sters lacatul nou'); u2(); return 'vechiul proprietar: held()=false; lacatul nou intact'; });
  await T('C15', 'Auto: lacatul pierdut in timpul rularii (somn) -> se opreste inainte de comanda urmatoare', async () => {
    const p = prof(); portalOrders = [ord(31), ord(32), ord(33)]; calls = [];
    behave = o => { if (o.orderNo === '31') { const f = lockF(p.dirs.out); fs.writeFileSync(f, `999999\n${os.hostname()}\naltcineva`); } return null; };
    const r = await auto.runOnce(p, { log: () => {} }); assert(calls.join() === '31' && /preluat/.test(r.stopped || ''), JSON.stringify({ calls, s: r.stopped })); return 'o comanda, apoi oprit'; });
  await T('C16', 'Lacat scris de ALT calculator (folder sincronizat), proaspat -> ocupat; vechi de 3 h -> preluat', async () => {
    const d = path.join(tmp, 'L2'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(lockF(d), `${process.pid}\nalt-calculator\nx`); assert(auto.lock(d) === null && auto.lockHeld(d), 'proaspat preluat');
    const old = new Date(Date.now() - 3 * 3600e3); fs.utimesSync(lockF(d), old, old); const u = auto.lock(d); assert(u, 'vechi nepreluat'); u(); return 'ok'; });
  await T('C17', 'lockHeld (interfata) doar citeste: nu creeaza si nu sterge lacatul', async () => {
    const d = path.join(tmp, 'L3'); fs.mkdirSync(d, { recursive: true }); assert(!auto.lockHeld(d) && !fs.existsSync(lockF(d)), 'a creat');
    const ch = spawn(process.execPath, ['-e', 'setTimeout(()=>{},20000)']); fs.writeFileSync(lockF(d), String(ch.pid)); try { assert(auto.lockHeld(d) && fs.readFileSync(lockF(d), 'utf8') === String(ch.pid), 'modificat'); } finally { ch.kill(); } return 'ok'; });
  await T('C18', 'Ciorna pentru O comanda (meniu 2 / interfata) cand ruleaza alta operatiune -> cod 13, mesaj clar, nimic deschis', async () => {
    const name = 'zz-test-lacat-' + process.pid; const pf = path.join(ROOT, 'profiles', name + '.json'); const out = path.join(ROOT, 'out', name);
    fs.writeFileSync(pf, JSON.stringify({ orderSource: { type: 'carrefour-portal' }, smartbill: { series: 'TST' } })); fs.mkdirSync(out, { recursive: true });
    const ch = spawn(process.execPath, ['-e', 'setTimeout(()=>{},30000)']); fs.writeFileSync(path.join(out, 'auto.lock'), String(ch.pid));
    try { const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'kit.js'), 'ciorna', '1780308', '--profile=' + name], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, timeout: 60000 });
      assert(r.status === 13 && /lucreaza deja/i.test(r.stderr), `cod ${r.status}: ${(r.stderr || '').slice(0, 200)}`); return 'cod 13: ' + r.stderr.split('\n').find(l => /EROARE/.test(l)).slice(0, 90); }
    finally { ch.kill(); fs.unlinkSync(pf); require('../src/fsx').rm(out); } });

  // ---------- big data ----------
  await T('C19', 'Registru cu 20.000 de comenzi (~40 MB): plan() pe 600 comenzi + citire/scriere registru sub 5 s', async () => {
    const p = prof(); const big = {}; for (let i = 0; i < 20000; i++) big[String(1700000 + i)] = { status: 'draft-only', invoiceId: String(i), at: new Date().toISOString(), responseSnippet: 'x'.repeat(1500), writes: ['POST /documente/emitere/factura/'] };
    const f = path.join(p.dirs.out, 'drafts.json'); const t0 = Date.now(); wf(f, JSON.stringify(big, null, 2)); const L = readLedger(f);
    const orders = Array.from({ length: 600 }, (_, i) => ({ orderNo: String(1719700 + i), date: dd(1), store: 'S', total: 1, status: 'Noua' }));
    const pl = auto.plan(orders, { cfg: { auto: { startFrom: '2026-01-01', maxAgeDays: 3650 } }, ledgers: { issued: {}, drafts: L }, state: {} }); const ms = Date.now() - t0;
    assert(pl.filter(x => x.skip === 'deja in registrul local').length === 300 && pl.filter(x => !x.skip).length === 300 && ms < 5000, ms + ' ms'); return `${(fs.statSync(f).size / 1e6).toFixed(0)} MB, ${ms} ms, 300 noi / 300 deja in registru`; });
  await T('C20', 'Jurnale/poze vechi curatate (log >180 zile, poze >60 zile); registre, PDF, XML pastrate', async () => {
    const root = path.join(tmp, 'R'); const out = path.join(root, 'out', 'p'); const old = Date.now() - 200 * 864e5; const files = { 'logs/auto-2026-01-01.log': 1, 'logs/auto-azi.log': 0, 'out/p/fill/1/50-ciorna.png': 1, 'out/p/fill/1/factura-1.pdf': 1, 'out/p/fill/1/efactura-1.xml': 1, 'out/p/issued.json': 1, 'out/p/login-diag/x.html': 1, 'out/p/fill/2/nou.png': 0 };
    for (const [r, o] of Object.entries(files)) { const f = path.join(root, r); wf(f, 'x'); if (o) fs.utimesSync(f, new Date(old), new Date(old)); }
    const k = auto.pruneOld(root, out); const ex = r => fs.existsSync(path.join(root, r));
    assert(k === 3 && !ex('logs/auto-2026-01-01.log') && !ex('out/p/fill/1/50-ciorna.png') && !ex('out/p/login-diag/x.html') && ex('out/p/fill/1/factura-1.pdf') && ex('out/p/fill/1/efactura-1.xml') && ex('out/p/issued.json') && ex('out/p/fill/2/nou.png') && ex('logs/auto-azi.log'), 'sterse ' + k);
    assert(auto.pruneOld(root, out) === 0, 'a doua oara in aceeasi zi'); return '3 sterse, restul pastrat; o data pe zi'; });
  await T('C21', 'Raport suport cu 400 de comenzi (poze + jurnale): limitat (max 15 poze, max 20 MB), registrele mereu incluse', async () => {
    const files = []; const root = path.join(tmp, 'S'); for (let i = 0; i < 400; i++) { const f = path.join(root, 'out', 'p', 'fill', String(i), 'a.png'); wf(f, Buffer.alloc(200e3)); files.push({ p: f, r: `out/p/fill/${i}/a.png` }); }
    const led = path.join(root, 'out', 'p', 'issued.json'); wf(led, '{}'); files.push({ p: led, r: 'out/p/issued.json' });
    const s = require('../src/support').pick(files); assert(s.files.some(f => /issued\.json/.test(f.r)) && s.files.filter(f => /png$/.test(f.r)).length === 15 && s.bytes < 20e6 && s.skipped === 385, JSON.stringify({ n: s.files.length, b: s.bytes, sk: s.skipped })); return `${s.files.length} fisiere, ${(s.bytes / 1e6).toFixed(1)} MB, ${s.skipped} omise`; });
  await T('C22', 'auto-state.json deteriorat -> pus deoparte + avertisment (nu pierdut in tacere)', async () => {
    const p = prof(); wf(path.join(p.dirs.out, 'auto-state.json'), '{rupt'); portalOrders = []; const lines = []; await auto.runOnce(p, { log: m => lines.push(m) });
    assert(fs.readdirSync(p.dirs.out).some(f => /auto-state\.json\.deteriorat-/.test(f)) && lines.some(l => /deteriorat/.test(l)), lines.join('|')); return 'copie pastrata + mesaj'; });

  // ---------- dates / DST / time zones ----------
  await T('C23', 'Fereastra de 14 zile: limita inclusa/exclusa corect, aceeasi in 4 fusuri orare si peste schimbarea orei (25.10.2026)', async () => {
    const code = `const a=require(${JSON.stringify(path.join(ROOT, 'src', 'auto'))});const o=[{orderNo:'1',date:'11.10.2026'},{orderNo:'2',date:'10.10.2026'},{orderNo:'3',date:'25.10.2026'},{orderNo:'4',date:'29.03.2026'}];
      const r=a.plan(o,{cfg:{auto:{startFrom:'2026-01-01',maxAgeDays:14}},ledgers:{},state:{},today:'2026-10-25'}).map(x=>x.orderNo+':'+(x.skip?'sarit':'da'));
      const r2=a.plan([{orderNo:'5',date:'15.03.2026'},{orderNo:'6',date:'14.03.2026'}],{cfg:{auto:{startFrom:'2026-01-01',maxAgeDays:14}},ledgers:{},state:{},today:'2026-03-29'}).map(x=>x.orderNo+':'+(x.skip?'sarit':'da'));
      console.log(JSON.stringify([r,r2,a.localDay(new Date('2026-10-24T21:30:00Z'))]))`;
    const outs = ['Europe/Bucharest', 'UTC', 'America/Los_Angeles', 'Pacific/Kiritimati'].map(tz => spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env: { ...process.env, TZ: tz } }).stdout.trim());
    const b = JSON.parse(outs[0]); assert(b[0].join() === '1:da,2:sarit,3:da,4:sarit' && b[1].join() === '5:da,6:sarit' && b[2] === '2026-10-25', outs[0]);
    assert(outs.every(o => JSON.stringify(JSON.parse(o).slice(0, 2)) === JSON.stringify(b.slice(0, 2))), outs.join(' / ')); return 'ziua 14 inclusa, ziua 15 exclusa; identic in 4 fusuri; 00:30 ora Romaniei = ziua noua'; });
  await T('C24', 'Fisierul jurnalului zilnic poarta data LOCALA (dupa miezul noptii in Romania = ziua noua)', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'auto.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'src', 'bulk.js'), 'utf8'); assert(!/toISOString\(\)\.slice\(0, 10\)\}\.log/.test(src) && /auto-\$\{localDay\(\)\}\.log/.test(src)); return 'auto-/bulk-ciorne-<data locala>.log'; });

  // ---------- products / EAN ----------
  await T('C25', 'EAN: zerouri in fata / GTIN-14 / numar -> acelasi produs; cod scurt sau gol nu potriveste nimic', async () => {
    const m = require('../src/productMatch'); const P = [{ id: 1, Denumire: 'MIERE POLIFLORA 500G', Cod: '05940000000017', 'Cota TVA': '11' }, { id: 2, Denumire: 'ALTCEVA', Cod: '123', 'Cota TVA': '21' }];
    const a = m.matchLine({ ean: '5940000000017', name: 'XYZ', vat: 11 }, P), b = m.matchLine({ ean: 5940000000017, name: 'XYZ' }, P), c = m.matchLine({ ean: '00005940000000017', name: 'XYZ' }, P), d = m.matchLine({ ean: '123', name: 'QQQ' }, P), e = m.matchLine({ ean: '', name: 'QQQ' }, P);
    assert(a.id === '1' && b.id === '1' && c.id === '1' && d === null && e === null, JSON.stringify([a, b, c, d, e])); return '3 forme EAN -> produsul 1; "123" si "" -> nimic'; });
  await T('C26', 'Programare Windows: XML cu pornire pe baterie, recuperare dupa somn/oprire, fara instante duble, fara administrator', async () => {
    const x = require('../src/schedule').winTaskXml('C:\\Users\\Ana Știr\\kit & co\\.runtime\\auto-task.cmd', 60, new Date(2026, 9, 25, 3, 30));
    for (const k of ['<DisallowStartIfOnBatteries>false', '<StopIfGoingOnBatteries>false', '<StartWhenAvailable>true', '<MultipleInstancesPolicy>IgnoreNew', '<RunLevel>LeastPrivilege', '<Interval>PT60M', 'kit &amp; co', '2026-10-25T03:30:00']) assert(x.includes(k), k);
    if (process.platform === 'win32') assert(require('../src/schedule').pointsHere(x, 'C:\\Users\\Ana Știr\\kit & co'), 'pointsHere'); return 'toate setarile prezente; calea cu spatii/diacritice/& escapata'; });
  await T('C27', 'Scurtatura de pe Desktop a ALTUI kit nu e suprascrisa: al doilea kit primeste "(nume folder)"', async () => {
    const sc = require('../src/shortcuts'); const desk = path.join(tmp, 'Desk'); fs.mkdirSync(desk, { recursive: true }); fs.writeFileSync(path.join(desk, 'Carrefour SmartBill.command'), '#!/bin/bash\nexec "/Users/alt/kit-vechi/run.command" ui\n');
    const mine = path.join(tmp, 'Kit Producator Ă'); const nm = sc.freeName(desk, 'Carrefour SmartBill', '.command', mine); assert(nm === 'Carrefour SmartBill (Kit Producator Ă)', nm);
    fs.writeFileSync(path.join(desk, nm + '.command'), `exec "${mine}/run.command" ui`); assert(sc.freeName(desk, 'Carrefour SmartBill', '.command', mine) === nm, 'reinstalare: alt nume');
    process.env.KIT_TEST_DESKTOPS = desk; const r = sc.removeMine(mine); delete process.env.KIT_TEST_DESKTOPS; assert(r.removed.includes(nm + '.command') && fs.existsSync(path.join(desk, 'Carrefour SmartBill.command')), JSON.stringify(r)); return nm + '; dezinstalarea o sterge doar pe a lui'; });
  await T('C28', 'Sesiune SmartBill salvata pentru alt email -> aruncata; sesiune veche fara amprenta (kit vechi) -> pastrata', async () => {
    const fx = require('../src/fsx'); const d = path.join(tmp, 'SS'); const f = path.join(d, 'storage-state.json'); wf(f, '{}'); assert(fx.sessionOwnerOk(f, 'a@b.ro') && fs.existsSync(f), 'veche');
    fx.stampSessionOwner(f, 'A@b.ro '); assert(fx.sessionOwnerOk(f, 'a@b.ro') && fs.existsSync(f), 'acelasi'); assert(!fx.sessionOwnerOk(f, 'alt@firma.ro') && !fs.existsSync(f), 'alt cont pastrat'); return 'ok'; });
  await T('C29', 'Configurarea porneste fara sesiunea temporara ramasa de la alt kit/producator (_setup)', async () => {
    const s = fs.readFileSync(path.join(ROOT, 'src', 'setup.js'), 'utf8'); assert(/bareProfile\('_setup'[\s\S]{0,400}unlinkSync\(path\.join\(profile\.dirs\.state, f\)\)/.test(s)); return 'sesiunile _setup sterse la inceput'; });
  await T('C30', 'Mac: aplicatia de pe Desktop arata un mesaj in romana cand Node.js lipseste (nu mai tace)', async () => {
    if (process.platform === 'win32') return 'sarit pe Windows';
    const kit = path.join(tmp, 'kit fara node'); fs.mkdirSync(path.join(kit, 'scripts'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'scripts', 'mac-ui-launch.sh'), path.join(kit, 'scripts', 'mac-ui-launch.sh')); fs.copyFileSync(path.join(ROOT, 'run.sh'), path.join(kit, 'run.sh')); fs.copyFileSync(path.join(ROOT, 'scripts', 'env-unix.sh'), path.join(kit, 'scripts', 'env-unix.sh'));
    const dlg = path.join(tmp, 'dialog.txt'); const r = spawnSync('/bin/bash', [path.join(kit, 'scripts', 'mac-ui-launch.sh')], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: tmp, KIT_TEST_DIALOG: dlg } });
    assert(r.status === 9 && /install\.command/.test(fs.readFileSync(dlg, 'utf8')), r.status + ' ' + r.stderr); return 'cod 9 + mesaj: ' + fs.readFileSync(dlg, 'utf8').slice(0, 70); });
  await T('C31', 'Mac launchd/Finder: PATH minim -> gaseste Node-ul folosit la instalare (.runtime/node-dir), nu cod 9', async () => {
    if (process.platform === 'win32') return 'sarit pe Windows';
    const kit = path.join(tmp, 'kit path minim'); fs.mkdirSync(path.join(kit, 'scripts'), { recursive: true }); fs.mkdirSync(path.join(kit, '.runtime'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'scripts', 'env-unix.sh'), path.join(kit, 'scripts', 'env-unix.sh'));
    const nd = path.join(tmp, 'node ascuns', 'bin'); fs.mkdirSync(nd, { recursive: true }); fs.writeFileSync(path.join(nd, 'node'), '#!/bin/sh\necho stub\n', { mode: 0o755 });
    fs.writeFileSync(path.join(kit, '.runtime', 'node-dir'), nd + '\n');
    const sb = path.join(tmp, 'bin minim'); fs.mkdirSync(sb, { recursive: true });   // like launchd: basic tools only, no node
    for (const t of ['dirname', 'sort', 'tail', 'ls', 'cat']) { const w = spawnSync('/bin/sh', ['-c', 'command -v ' + t], { encoding: 'utf8' }).stdout.trim(); if (w && !fs.existsSync(path.join(sb, t))) fs.symlinkSync(w, path.join(sb, t)); }
    const r = spawnSync('/bin/bash', ['-c', 'source "$1/scripts/env-unix.sh"; command -v node', '_', kit], { encoding: 'utf8', env: { PATH: sb, HOME: path.join(tmp, 'acasa-goala') } });
    assert(r.stdout.trim() === path.join(nd, 'node'), JSON.stringify(r.stdout + r.stderr)); return 'gasit: ' + r.stdout.trim().slice(-30); });
  await T('C32', 'Instalare Mac: disc plin / folder read-only -> mesaj clar, FARA sfatul gresit "verifica internetul"', () => {
    if (process.platform === 'win32') return 'sarit pe Windows (script Mac)';
    const s = fs.readFileSync(path.join(ROOT, 'scripts', 'install-unix.sh'), 'utf8'); const pf = path.join(ROOT, 'install.ps1'); const p = fs.existsSync(pf) ? fs.readFileSync(pf, 'utf8') : null;
    assert(/LOCAL_ERR=1 fail "Nu pot scrie/.test(s) && /LOCAL_ERR=1 fail "Pe disc/.test(s) && /NEED_KB=300000/.test(s), 'unix');
    const r = spawnSync('/bin/bash', ['-c', 'say(){ echo "$*"; }; ' + s.match(/fail\(\) \{[\s\S]*?\n\}/)[0] + '; LOCAL_ERR=1 fail "disc"'], { encoding: 'utf8' });
    assert(/EROARE: disc/.test(r.stdout) && !/internet/.test(r.stdout), r.stdout); if (p) assert(/-Local \}/.test(p) && /if \(-not \$Local\)/.test(p), 'ps1'); return 'fara sfat de internet'; });
  await T('C33', 'Instalare (Mac + Windows): scurtatura de pe Desktop se face INAINTE de orice descarcare / test (un pas care cade nu mai lasa producatorul fara scurtatura)', () => {
    for (const [f, a, b, c] of [['scripts/install-unix.sh', 'Desktop shortcuts are made FIRST', 'USE_SYSTEM=0', 'selftest'], ['install.ps1', 'Desktop shortcuts are made FIRST', '$useSystem = $false', 'selftest']]) {
      const p = path.join(ROOT, f); if (!fs.existsSync(p)) continue; const t = fs.readFileSync(p, 'utf8');
      assert(t.indexOf(a) > 0 && t.indexOf(a) < t.indexOf(b) && t.indexOf(b) < t.lastIndexOf(c), f + ' ordine'); assert((t.match(/CreateShortcut\(\(Join-Path|osacompile -o/g) || []).length <= 2, f + ' scurtatura dubla'); }
    return 'scurtatura -> Node -> biblioteci -> test'; });
  const unixInst = () => fs.readFileSync(path.join(ROOT, 'scripts', 'install-unix.sh'), 'utf8');
  await T('C34', 'Mac: kit dezarhivat in Descarcari, folder cu SPATIU ("carrefour-smartbill-kit 3") -> copiat automat in Acasa, fara node_modules, cu nota in folderul vechi; alt kit din Acasa nu e atins', () => {
    if (process.platform === 'win32') return 'sarit pe Windows';
    const s = unixInst(); const blk = s.slice(s.indexOf('mac_protected() {'), s.indexOf('# Desktop shortcuts are made FIRST')).replace('exec bash "$DEST/scripts/install-unix.sh" "$@"', 'echo "EXEC=$DEST"');
    const home = path.join(tmp, 'acasa C34'); const kit = path.join(home, 'Downloads', 'carrefour-smartbill-kit 3'); fs.mkdirSync(path.join(kit, 'node_modules', 'x'), { recursive: true }); fs.mkdirSync(path.join(kit, 'src'), { recursive: true });
    fs.writeFileSync(path.join(kit, 'src', 'a.js'), '1'); fs.mkdirSync(path.join(home, 'carrefour-smartbill-kit'), { recursive: true }); fs.writeFileSync(path.join(home, 'carrefour-smartbill-kit', '.env'), 'ALT=1');
    const sh = `set -euo pipefail; say(){ echo "$*"; }; fail(){ echo "FAIL $*"; exit 1; }; PLAT=darwin; HOME="$1"; KIT_DIR="$2"; ${blk}`;
    const r = spawnSync('/bin/bash', ['-c', sh, '_', home, kit], { encoding: 'utf8' }); const dest = path.join(home, 'carrefour-smartbill-kit 2');
    assert(r.stdout.includes('EXEC=' + dest), r.stdout + r.stderr); assert(fs.existsSync(path.join(dest, 'src', 'a.js')) && !fs.existsSync(path.join(dest, 'node_modules')), 'copie');
    assert(fs.readFileSync(path.join(home, 'carrefour-smartbill-kit', '.env'), 'utf8') === 'ALT=1', 'alt kit atins'); assert(/Acasa|Desktop/.test(fs.readFileSync(path.join(kit, 'PROGRAMUL-ESTE-IN-ACASA.txt'), 'utf8')), 'nota');
    const r2 = spawnSync('/bin/bash', ['-c', sh, '_', home, kit], { encoding: 'utf8' }); assert(r2.stdout.includes('EXEC=' + dest), 'a doua oara acelasi folder: ' + r2.stdout);
    const r3 = spawnSync('/bin/bash', ['-c', sh, '_', home, path.join(home, 'kit acasa')], { encoding: 'utf8' }); assert(!/EXEC=/.test(r3.stdout), 'din Acasa nu se muta');
    return 'copiat in "carrefour-smartbill-kit 2" (cel existent era al altui kit)'; });
  await T('C35', 'Mac: numele scurtaturii: a altui kit -> "Carrefour SmartBill (folder)"; a acestui kit -> refolosit; cale cu spatii', () => {
    if (process.platform === 'win32') return 'sarit pe Windows';
    const s = unixInst(); const fn = s.slice(s.indexOf('sc_points() {'), s.indexOf('if [ "$PLAT" = darwin ] && [ "${KIT_NO_SHORTCUT'));
    const desk = path.join(tmp, 'desk C35'); const kit = path.join(tmp, 'kit C35', 'carrefour-smartbill-kit 3'); fs.mkdirSync(path.join(desk, 'Carrefour SmartBill.app', 'Contents', 'Resources'), { recursive: true }); fs.mkdirSync(kit, { recursive: true });
    fs.writeFileSync(path.join(desk, 'Carrefour SmartBill.app', 'Contents', 'Resources', 'kit-dir.txt'), '/alt/kit\n');
    const run = () => spawnSync('/bin/bash', ['-c', `DESK="$1"; KIT_DIR="$2"
${fn}
sc_name "Carrefour SmartBill" .app`, '_', desk, kit], { encoding: 'utf8' }).stdout;
    assert(run() === 'Carrefour SmartBill (carrefour-smartbill-kit 3)', run());
    fs.writeFileSync(path.join(desk, 'Carrefour SmartBill.app', 'Contents', 'Resources', 'kit-dir.txt'), kit + '\n'); assert(run() === 'Carrefour SmartBill', 'propriu: ' + run());
    fs.rmSync(path.join(desk, 'Carrefour SmartBill.app'), { recursive: true }); assert(run() === 'Carrefour SmartBill', 'liber'); return 'ok'; });
  await T('C36', 'Windows: Smart App Control PORNIT (registru VerifiedAndReputablePolicyState=1) -> instructiune clara in romana, oprire INAINTE de descarcari; scurtatura deja facuta', () => {
    const p = path.join(ROOT, 'install.ps1'); if (!fs.existsSync(p)) return 'sarit (ZIP Mac)'; const t = fs.readFileSync(p, 'utf8');
    assert(/CI\\Policy' -Name VerifiedAndReputablePolicyState/.test(t) && /\$sac -eq 1/.test(t) && /KIT_TEST_SAC/.test(t), 'detectie');
    assert(/Securitate Windows/.test(t) && /Control aplicatii si browser > Setari Smart App Control/.test(t) && /Dezactivat/.test(t) && /resetare/.test(t), 'instructiune');
    assert(t.indexOf('Desktop shortcuts are made FIRST') < t.indexOf('VerifiedAndReputablePolicyState') && t.indexOf('VerifiedAndReputablePolicyState') < t.indexOf('$useSystem = $false'), 'ordine'); return 'detectat + instructiuni'; });
  await T('C37', 'Windows: scurtatura pe Desktopul REAL (si redirectat in OneDrive); run.bat arata fereastra cand instalarea nu e terminata (scurtatura porneste minimizat)', () => {
    const p = path.join(ROOT, 'install.ps1'); if (!fs.existsSync(p)) return 'sarit (ZIP Mac)'; const t = fs.readFileSync(p, 'utf8'); const b = fs.readFileSync(path.join(ROOT, 'run.bat'), 'utf8');
    assert(/GetFolderPath\('Desktop'\)/.test(t) && /\$env:OneDrive\) \{ Join-Path \$env:OneDrive 'Desktop'/.test(t) && /Scurtatura programului este pe Desktop/.test(t), 'desktop'); assert(!/\} catch \{\} \}/.test(t.slice(t.indexOf('Desktop shortcuts are made FIRST'), t.indexOf('Smart App Control'))), 'eroare inghitita');
    assert(/MessageBox\]::Show\('Programul nu este instalat complet/.test(b), 'run.bat'); return 'ok'; });
  await T('C38', 'Variabile de test RAMASE in Windows (KIT_SETUP_MOCK, KIT_CARREFOUR_DOCS_URL... mostenite de Explorer) fara KIT_TEST_MODE -> ignorate: configurarea reala NU intra in modul demo', () => {
    const env = { ...process.env, KIT_SETUP_MOCK: path.join(tmp, 'kit-tutorial-demo', 'demo-mock.json'), KIT_CARREFOUR_DOCS_URL: 'http://127.0.0.1:9/docs', KIT_STOP_BEFORE_FINAL: '1' }; delete env.KIT_TEST_MODE;
    const code = "const te=require('./src/testenv'); const before=te.TEST_VARS.filter(k=>k in process.env); te.strip(); const after=te.TEST_VARS.filter(k=>k in process.env); console.log(JSON.stringify({before,after,hook:te.hook('KIT_SETUP_MOCK')||null}))";
    const r = JSON.parse(spawnSync(process.execPath, ['-e', code], { cwd: ROOT, env, encoding: 'utf8' }).stdout);
    assert(['KIT_SETUP_MOCK','KIT_CARREFOUR_DOCS_URL','KIT_STOP_BEFORE_FINAL'].every(k => r.before.includes(k)) && r.after.length === 0 && r.hook === null, JSON.stringify(r));
    // the real CLI: setup with the stale mock var must not try to read demo-mock.json
    const k = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'kit.js'), 'setup'], { cwd: ROOT, env: { ...env, KIT_NO_OPEN: '1' }, input: '\n\n\n\n', encoding: 'utf8', timeout: 60000 });
    assert(!/demo-mock|ENOENT/.test(k.stdout + k.stderr), (k.stdout + k.stderr).slice(-300));
    const withTest = spawnSync(process.execPath, ['-e', "require('./src/testenv').strip(); console.log(process.env.KIT_SETUP_MOCK||'')"], { cwd: ROOT, env: { ...env, KIT_TEST_MODE: '1' }, encoding: 'utf8' }).stdout.trim();
    assert(withTest.endsWith('demo-mock.json'), 'in test mode ramane: ' + withTest); return 'ignorate fara KIT_TEST_MODE; folosite doar in teste'; });
  await T('C39', 'Kitul livrat: nicio referinta la demo/mock la rulare (src, bin, lansatoare): hook-urile de test trec DOAR prin testenv; fara .env, profile sau cai de la inregistrari', () => {
    const files = []; const walk = d => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(js|html|bat|ps1|sh|command)$/.test(n)) files.push(p); } };
    walk(path.join(ROOT, 'src')); walk(path.join(ROOT, 'bin')); for (const f of ['run.bat', 'run.sh', 'run.command', 'install.bat', 'install.ps1', 'install.command', 'scripts/install-unix.sh', 'scripts/env-unix.sh', 'scripts/mac-ui-launch.sh']) if (fs.existsSync(path.join(ROOT, f))) files.push(path.join(ROOT, f));
    const te = require(path.join(ROOT, 'src', 'testenv.js')); const bad = [];
    for (const f of files) { if (f.endsWith('testenv.js')) continue; const t = fs.readFileSync(f, 'utf8');
      if (/kit-tutorial-demo|demo-mock\.json/.test(t)) bad.push(path.relative(ROOT, f) + ': cale demo');
      for (const l of t.split('\n')) if (/scripts\/ui-demo|mock-portal/.test(l) && !/^\s*const d = demo \? await require\('\.\.\/\.\.\/scripts\/ui-demo'\)/.test(l) && !/shippedFiles\(\)\.filter/.test(l)) bad.push(path.relative(ROOT, f) + ': demo fara --demo: ' + l.trim().slice(0, 60));
      for (const v of te.TEST_VARS) if (t.split('\n').some(l => new RegExp('process\\.env\\.' + v + '\\b|process\\.env\\[.' + v).test(l) && !/KIT_TEST_MODE === '1'/.test(l))) bad.push(path.relative(ROOT, f) + ': ' + v + ' citit direct'); }
    assert(!bad.length, bad.join('; ')); assert(!fs.existsSync(path.join(ROOT, '.env')) || !process.env.KIT_RELEASE_CHECK, '.env in kit');
    return files.length + ' fisiere verificate'; });
  fi.run = realRun;

  const ok = results.filter(r => r.ok).length; console.log(`\n${ok}/${results.length} teste scalare trecute.`);
  try { require('../src/fsx').rm(tmp); } catch {}
  try { await require('../src/captchaOcr').terminate(); } catch {}
  process.exit(ok === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
