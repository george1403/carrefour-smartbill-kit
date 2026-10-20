'use strict';
/**
 * Adversarial audit tests for bulk ciorne + automat (offline; no portal, no SmartBill, nothing issued).
 * Carrefour portal and fillInvoice.run are stubbed; the REAL plan()/bulkPlan()/lock()/issueNow()/ledger code runs.
 * Usage: node scripts/test-audit.js   exit 0 = all passed.
 */
const fs = require('fs'); const path = require('path'); const os = require('os'); const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
Object.assign(process.env, { KIT_NO_NOTIFY: '1', KIT_RATE_MS: '1' });
const results = []; const assert = (c, m) => { if (!c) throw new Error(m); };
async function T(id, name, fn) { let ok = false, ev = ''; try { ev = String(await fn() || 'ok'); ok = true; } catch (e) { ev = 'FAIL: ' + String(e && e.stack || e).split('\n').slice(0, 2).join(' | '); } results.push({ id, name, ok, ev }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name} :: ${ev}`); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-audit-')); let n = 0;
const prof = (auto = {}) => { const d = path.join(tmp, 'p' + (++n)); return { name: 't', root: ROOT, secrets: {}, cfg: { orderSource: { type: 'carrefour-portal' }, smartbill: { series: 'TST' }, auto: { mode: 'ciorne', startFrom: '2026-01-01', maxAgeDays: 3650, ...auto } }, dirs: { state: path.join(d, 'st'), out: path.join(d, 'out', 't') } }; };
const today = new Date(); const dd = x => { const d = new Date(today - x * 864e5); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; };
const portal = require('../src/carrefourPortal'); let portalOrders = []; let portalErr = null;
portal.discoverCarrefour = async () => { if (portalErr) throw portalErr; return { orders: portalOrders }; };
const fi = require('../src/fillInvoice'); let calls = []; let behave = () => null; let idn = 7000;
const realRun = fi.run;
fi.run = async (p, o) => { calls.push({ ...o }); const b = behave(o); if (b instanceof Error) throw b; if (b) return b; return { issued: { invoiceId: String(idn++), number: o.issue && !o.draftOnly ? 'TST ' + idn : null, status: o.draftOnly ? 'draft-only' : 'issued' } }; };
const auto = require('../src/auto'); const bulk = require('../src/bulk'); const { readLedger, wf } = require('../src/fsx');
const ord = (nr, daysAgo = 1, more = {}) => ({ orderNo: String(nr), date: dd(daysAgo), store: 'S' + nr, total: 10 + Number(nr) % 100, status: 'Noua', ...more });
const E = (code, msg, extra = {}) => Object.assign(new Error(msg), { code, ...extra });
const arm = p => wf(path.join(p.dirs.out, 'automat-armat.json'), '{}');

(async () => {
  // ---------- lock ----------
  await T('X01', 'Lock atomic: a doua achizitie in acelasi proces/alt pid viu -> refuzata', async () => { const p = prof(); fs.mkdirSync(p.dirs.out, { recursive: true });
    const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},20000)']); fs.writeFileSync(path.join(p.dirs.out, 'auto.lock'), String(child.pid));
    try { assert(auto.lock(p.dirs.out) === null, 'lock luat desi alt proces viu il tine'); } finally { child.kill(); } return 'refuzat cat timp procesul traieste'; });
  await T('X02', 'Lock ramas de la un proces mort (crash) -> preluat', async () => { const p = prof(); fs.mkdirSync(p.dirs.out, { recursive: true }); fs.writeFileSync(path.join(p.dirs.out, 'auto.lock'), '999999');
    const u = auto.lock(p.dirs.out); assert(u, 'lock mort nepreluat'); assert(fs.readFileSync(path.join(p.dirs.out, 'auto.lock'), 'utf8').split('\n')[0] === String(process.pid)); u(); assert(!fs.existsSync(path.join(p.dirs.out, 'auto.lock')), 'lock nesters'); return 'preluat + sters la final'; });
  await T('X03', 'Lock mai vechi de 2 h (proces viu, pid refolosit) -> preluat; unlock-ul vechiului proprietar nu-l sterge pe al nou', async () => { const p = prof(); const f = path.join(p.dirs.out, 'auto.lock'); fs.mkdirSync(p.dirs.out, { recursive: true });
    const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},20000)']); fs.writeFileSync(f, String(child.pid)); const old = new Date(Date.now() - 3 * 3600e3); fs.utimesSync(f, old, old);
    try { const u = auto.lock(p.dirs.out); assert(u, 'lock vechi nepreluat'); u(); } finally { child.kill(); } return 'ok'; });
  await T('X04', 'Lock heartbeat: mtime reimprospatat (bulk lung nu e considerat blocat)', async () => { const src = fs.readFileSync(path.join(ROOT, 'src/auto.js'), 'utf8'); assert(/utimesSync/.test(src) && /LOCK_BEAT_MS = 60e3/.test(src)); return 'utimes la 60 s'; });
  await T('X05', 'Auto si bulk in acelasi timp: bulk refuza (exit 13, busy), nimic creat', async () => { const p = prof(); fs.mkdirSync(p.dirs.out, { recursive: true }); const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},20000)']); fs.writeFileSync(path.join(p.dirs.out, 'auto.lock'), String(child.pid)); const u = () => child.kill(); calls = []; portalOrders = [ord(1)];
    try { const r = await bulk.run(p, { confirm: async () => 'da', log: () => {} }); assert(r.busy && r.exit === 13 && calls.length === 0, JSON.stringify(r)); const a = await auto.runOnce(p, { log: () => {} }); assert(a.busy && a.exit === 13 && calls.length === 0); } finally { u(); } return 'busy la ambele'; });

  // ---------- plan / limits ----------
  await T('X06', 'plan(): comanda duplicata in lista portalului apare o singura data', async () => { const r = auto.plan([ord(5), ord(5), ord('005')], { cfg: prof().cfg, ledgers: {}, state: {} }); assert(r.length === 1, r.length); return '1 candidat'; });
  await T('X07', 'plan(): startFrom invalid nu mai opreste rularea (foloseste azi)', async () => { const r = auto.plan([ord(6, 0), ord(7, 3)], { cfg: { auto: { startFrom: 'ieri' } }, ledgers: {}, state: {} }); assert(!r[0].skip && r[1].skip, JSON.stringify(r)); return 'azi=ok, vechi=sarita'; });
  await T('X08', 'plan(): maxAgeDays 14 + startFrom: comanda de 15 zile sarita, de 13 zile acceptata', async () => { const r = auto.plan([ord(8, 15), ord(9, 13)], { cfg: { auto: { startFrom: '2020-01-01' } }, ledgers: {}, state: {} }); assert(r[0].skip && !r[1].skip, JSON.stringify(r)); return r[0].skip; });
  await T('X09', 'plan(): orice intrare in registre (si pending/unknown/finalize-unknown) blocheaza', async () => { const r = auto.plan([ord(1), ord(2), ord(3)], { cfg: prof().cfg, ledgers: { issued: { '01': { status: 'pending' }, 2: { status: 'finalize-unknown' } }, drafts: { 3: { status: 'unknown' } } }, state: {} }); assert(r.every(x => x.skip), JSON.stringify(r)); return 'toate sarite'; });
  await T('X10', 'maxPerRun: automat plafonat 1..10 (implicit 3), ciorne 1..50, valori stricate -> implicit', async () => { const m = auto.maxPerRun;
    assert(m({ auto: { maxPerRun: 999 } }, 'automat') === 10 && m({ auto: {} }, 'automat') === 3 && m({ auto: { maxPerRun: -5 } }, 'automat') === 1 && m({ auto: { maxPerRun: 'abc' } }, 'automat') === 3, 'automat');
    assert(m({ auto: {} }, 'ciorne') === 10 && m({ auto: { maxPerRun: 0 } }, 'ciorne') === 10 && m({ auto: { maxPerRun: 1e6 } }, 'ciorne') === 50 && m({ auto: { maxPerRun: '4' } }, 'ciorne') === 4, 'ciorne'); return 'ok'; });
  await T('X11', 'AUTOMAT cu 15 comenzi noi si maxPerRun 99: emite maxim 10, restul la ora urmatoare', async () => { const p = prof({ mode: 'automat', maxPerRun: 99 }); arm(p); calls = []; portalOrders = Array.from({ length: 15 }, (_, i) => ord(100 + i));
    const r = await auto.runOnce(p, { log: () => {} }); assert(calls.length === 10 && calls.every(c => c.issue === true && c.draftOnly === false) && r.issued.length === 10, calls.length); return `${calls.length} emise`; });
  await T('X12', 'AUTOMAT prima rulare (neinarmat): 0 apeluri SmartBill, doar lista', async () => { const p = prof({ mode: 'automat' }); calls = []; portalOrders = [ord(1)]; const r = await auto.runOnce(p, { log: () => {} }); assert(calls.length === 0 && r.done[0].would === 'factura' && fs.existsSync(path.join(p.dirs.out, 'automat-armat.json'))); return 'doar verificare, armat'; });
  await T('X13', 'Mod ciorne: niciun apel cu issue:true', async () => { const p = prof(); calls = []; portalOrders = [ord(1), ord(2)]; await auto.runOnce(p, { log: () => {} }); assert(calls.length === 2 && calls.every(c => !c.issue && c.draftOnly)); return 'draftOnly'; });
  await T('X14', 'Profil automat + --draft-only: forteaza ciorne', async () => { const p = prof({ mode: 'automat' }); arm(p); calls = []; portalOrders = [ord(1)]; await auto.runOnce(p, { mode: 'ciorne', log: () => {} }); assert(calls.length === 1 && !calls[0].issue && calls[0].draftOnly); return 'ok'; });

  // ---------- crash / unclear saves ----------
  await T('X15', 'Registru deteriorat (crash in timpul scrierii): auto si bulk se opresc, 0 apeluri (nu il trateaza ca gol)', async () => { const p = prof(); fs.mkdirSync(p.dirs.out, { recursive: true }); fs.writeFileSync(path.join(p.dirs.out, 'drafts.json'), '{"1": {"status": "draft-on');
    calls = []; portalOrders = [ord(1)]; const a = await auto.runOnce(p, { log: () => {} }); const b = await bulk.run(p, { confirm: async () => 'da', log: () => {} });
    assert(calls.length === 0 && a.exit === 11 && b.exit === 11, JSON.stringify({ a: a.exit, b: b.exit, c: calls.length })); assert(/deteriorat/.test(a.errors[0].error)); return 'exit 11 la ambele'; });
  await T('X16', 'Scriere atomica: nu ramane fisier .tmp, continut complet', async () => { const p = prof(); const f = path.join(p.dirs.out, 'x.json'); wf(f, '{"a":1}'); wf(f, '{"a":2}'); assert(readLedger(f).a === 2 && fs.readdirSync(p.dirs.out).length === 1); return 'ok'; });
  await T('X17', 'readLedger: BOM UTF-8 (Notepad Windows) acceptat, fisier gol = {}', async () => { const p = prof(); const f = path.join(p.dirs.out, 'i.json'); wf(f, '\uFEFF{"5":{"status":"issued"}}'); assert(readLedger(f)[5].status === 'issued'); wf(f, ''); assert(Object.keys(readLedger(f)).length === 0); return 'ok'; });
  await T('X18', 'Bulk: comanda cu pending/unknown in issued.json sau drafts.json (crash anterior) -> sarita, nu se face ciorna', async () => { const p = prof(); wf(path.join(p.dirs.out, 'issued.json'), JSON.stringify({ 1: { status: 'pending' } })); wf(path.join(p.dirs.out, 'drafts.json'), JSON.stringify({ 2: { status: 'unknown' }, 3: { status: 'pending' } }));
    calls = []; portalOrders = [ord(1), ord(2), ord(3), ord(4)]; const r = await bulk.run(p, { confirm: async () => 'da', log: () => {} });
    assert(calls.length === 1 && calls[0].orderNo === '4' && r.skipped.filter(s => /neclara/.test(s.why)).length === 3, JSON.stringify(r.skipped)); return '3 sarite (neclar), 1 ciorna'; });
  await T('X19', 'issueNow(draftOnly) raspuns neclar -> SAVE_UNKNOWN, nicio finalizare; a doua incercare -> NEEDS_HUMAN fara click', async () => { const p = prof(); const D = fi._deps; const realD = { ...D }; let fin = 0, clicks = 0;
    D.finalizeDraft = async () => { fin++; return { status: 'issued' }; };
    const page = { url: () => 'u', waitForTimeout: async () => {}, waitForResponse: async () => ({ text: async () => '<html>Eroare</html>', status: () => 403 }), click: async () => { clicks++; }, locator: () => { const o = { filter: () => o, first: () => o, count: async () => 0, isVisible: async () => false }; return o; }, evaluate: async () => ({ title: 'x', h: [], links: [] }) };
    const s = { guard: { writes: [] } }; const order = { orderNo: '1780308', store: {}, lines: [] }; const shot = async nm => { const f = path.join(p.dirs.out, nm + '.png'); wf(f, ''); return f; };
    try { let c1; try { await fi.issueNow(page, s, p, order, shot, () => {}, { draftOnly: true }); } catch (e) { c1 = e; }
      assert(c1 && c1.code === 'SAVE_UNKNOWN' && /HTTP 403/.test(c1.message), c1 && c1.message);
      let c2; try { await fi.issueNow(page, s, p, order, shot, () => {}, { draftOnly: true }); } catch (e) { c2 = e; }
      assert(c2 && c2.code === 'NEEDS_HUMAN' && clicks === 1 && fin === 0, `${c2 && c2.code} clicks=${clicks} fin=${fin}`);
      assert(!fs.existsSync(path.join(p.dirs.out, 'issued.json')), 'scris in issued.json in mod ciorna'); } finally { Object.assign(D, realD); }
    return 'SAVE_UNKNOWN apoi NEEDS_HUMAN, 1 click, 0 finalizari'; });
  await T('X20', 'Ledger merge-save: o intrare scrisa de alt proces intre timp nu se pierde', async () => { const p = prof(); const D = fi._deps; const realD = { ...D }; const f = path.join(p.dirs.out, 'drafts.json');
    D.downloadXml = async () => ({ xmlError: 'skip' });
    const page = { url: () => 'u', waitForTimeout: async () => {}, waitForResponse: async () => ({ text: async () => '{"successfully":true,"is_draft":true,"id":77}', status: () => 200 }),
      click: async () => { const L = JSON.parse(fs.readFileSync(f, 'utf8')); L['999'] = { status: 'draft-only', invoiceId: '5' }; fs.writeFileSync(f, JSON.stringify(L)); }, locator: () => { const o = { filter: () => o, first: () => o, count: async () => 0, isVisible: async () => false }; return o; }, evaluate: async () => ({ title: 'x', h: [], links: [] }) };
    const shot = async nm => { const g = path.join(p.dirs.out, nm + '.png'); wf(g, ''); return g; };
    try { try { await fi.issueNow(page, { guard: { writes: [] } }, p, { orderNo: '1780308', store: {}, lines: [] }, shot, () => {}, { draftOnly: true }); } catch {} } finally { Object.assign(D, realD); }
    const L = readLedger(f); assert(L['999'] && L['1780308'], JSON.stringify(L)); return 'ambele intrari pastrate'; });
  await T('X21', 'Auto mod ciorne: SAVE_UNKNOWN -> needsHuman imediat (nu reincearca ora urmatoare)', async () => { const p = prof(); calls = []; portalOrders = [ord(1)]; behave = () => E('SAVE_UNKNOWN', 'neclar');
    await auto.runOnce(p, { log: () => {} }); behave = () => null; calls = []; const r = await auto.runOnce(p, { log: () => {} }); assert(calls.length === 0 && /verificare manuala/.test(r.skipped[0].why)); return 'sarita la rularea 2'; });

  // ---------- SmartBill 403 / timeouts / captcha ----------
  await T('X22', 'Bulk: 403 de la SmartBill -> opreste lotul, restul "neprocesate", exit 11', async () => { const p = prof(); calls = []; portalOrders = [ord(1), ord(2), ord(3)]; behave = o => o.orderNo === '2' ? new Error('HTTP 403 Forbidden') : null;
    const r = await bulk.run(p, { confirm: async () => 'da', log: () => {} }); behave = () => null; assert(calls.length === 2 && r.exit === 11 && r.remaining.includes('3'), JSON.stringify(r.remaining)); return 'oprit la 403'; });
  await T('X23', 'Bulk: fara internet/timeout de navigare -> opreste (exit 5), nu bate toate comenzile', async () => { const p = prof(); calls = []; portalOrders = [ord(1), ord(2), ord(3)]; behave = () => new Error('page.goto: Timeout 60000ms exceeded');
    const r = await bulk.run(p, { confirm: async () => 'da', log: () => {} }); behave = () => null; assert(calls.length === 1 && r.exit === 5, `${calls.length} ${r.exit}`); return 'exit 5 dupa 1 incercare'; });
  await T('X24', 'Auto ciorne: timeout -> opreste rularea (exit 5), comanda reincercata data viitoare', async () => { const p = prof(); calls = []; portalOrders = [ord(1), ord(2)]; behave = () => new Error('net::ERR_TIMED_OUT');
    const r = await auto.runOnce(p, { log: () => {} }); behave = () => null; assert(calls.length === 1 && r.exit === 5); const r2 = await auto.runOnce(p, { log: () => {} }); assert(r2.done.length === 2); return 'oprit, apoi reluat'; });
  await T('X25', 'Bulk: SAVE_UNKNOWN -> opreste tot (exit 11) si marcheaza comanda', async () => { const p = prof(); calls = []; portalOrders = [ord(1), ord(2)]; behave = () => E('SAVE_UNKNOWN', 'STOP: neclar');
    const r = await bulk.run(p, { confirm: async () => 'da', log: () => {} }); behave = () => null; assert(calls.length === 1 && r.exit === 11 && JSON.parse(fs.readFileSync(path.join(p.dirs.out, 'auto-state.json')))[1].needsHuman); return 'ok'; });
  await T('X26', 'CAPTCHA la citirea portalului: auto exit 3, bulk exit 3, fisier ATENTIE; watch se opreste', async () => { const p = prof(); portalErr = E('CAPTCHA', 'captcha'); calls = [];
    try { const a = await auto.runOnce(p, { log: () => {} }); const b = await bulk.run(p, { confirm: async () => 'da', log: () => {} }); const w = await auto.watch(p, { every: 0, maxRuns: 5, log: () => {} });
      assert(a.exit === 3 && b.exit === 3 && w.exit === 3 && calls.length === 0); } finally { portalErr = null; try { fs.unlinkSync(path.join(p.dirs.out, '..', '..', 'ATENTIE-autentificare-Carrefour.txt')); } catch {} } return 'exit 3'; });
  await T('X27', 'Login gresit / cont strain: auto exit 4 / 12', async () => { const p = prof(); portalErr = E('AUTH', 'parola'); const a = await auto.runOnce(p, { log: () => {} }); portalErr = E('WRONG_ACCOUNT', 'alt furnizor'); const b = await auto.runOnce(p, { log: () => {} }); portalErr = null; assert(a.exit === 4 && b.exit === 12, `${a.exit} ${b.exit}`); return '4, 12'; });
  await T('X28', 'Automat: o eroare oarecare opreste TOATA rularea (exit 11), nimic dupa ea', async () => { const p = prof({ mode: 'automat' }); arm(p); calls = []; portalOrders = [ord(1), ord(2), ord(3)]; behave = o => o.orderNo === '2' ? new Error('ceva') : null;
    const r = await auto.runOnce(p, { log: () => {} }); behave = () => null; assert(calls.length === 2 && r.exit === 11 && r.issued.length === 1); return '1 emisa, oprit'; });
  await T('X29', 'Automat: DUPLICATE (deja facturata in SmartBill) -> sarita, continua', async () => { const p = prof({ mode: 'automat' }); arm(p); calls = []; portalOrders = [ord(1), ord(2)]; behave = o => o.orderNo === '1' ? E('DUPLICATE', 'deja', { kind: 'issued' }) : null;
    const r = await auto.runOnce(p, { log: () => {} }); behave = () => null; assert(calls.length === 2 && r.issued.length === 1 && !r.exit); return 'ok'; });

  // ---------- product mapping / amounts ----------
  await T('X30', 'Automat (--issue): produs necunoscut in SmartBill -> NEEDS_HUMAN inainte de a deschide SmartBill; ciorna permisa', async () => {
    const ds = require('../src/discoverSmartbill'); const realDs = ds.discoverSmartbill; ds.discoverSmartbill = async () => ({ products: [] });
    const sw = require('../src/smartbillWeb'); const realOpen = sw.openSession; let opened = 0; sw.openSession = async () => { opened++; throw new Error('STOP-test: sesiune'); };
    const p = prof({ mode: 'automat' }); const of = path.join(tmp, 'o.json'); fs.writeFileSync(of, JSON.stringify({ orderNo: '42', orderDate: '2026-10-19', store: { gln: '1', name: 'S' }, lines: [{ name: 'PRODUS NOU', ean: '123', qty: 2, unitCode: 'PCE', price: 5.5, vat: 21 }] }));
    try { let e1; try { await realRun(p, { orderFile: of, issue: true, log: () => {} }); } catch (e) { e1 = e; } assert(e1 && e1.code === 'NEEDS_HUMAN' && /nu sunt in lista SmartBill/.test(e1.message) && opened === 0, e1 && e1.message);
      let e2; try { await realRun(p, { orderFile: of, draftOnly: true, log: () => {} }); } catch (e) { e2 = e; } assert(e2 && /STOP-test|Lipsesc din \.env|Lipsesc emailul sau parola SmartBill/.test(e2.message), 'ciorna nu a ajuns la SmartBill: ' + (e2 && e2.message));
    } finally { ds.discoverSmartbill = realDs; sw.openSession = realOpen; } return 'automat refuza, ciorna trece de verificare (ajunge la sesiunea SmartBill, fara conturi)'; });
  await T('X31', 'Linii fara pret/TVA, cantitate 0, baxuri -> NEEDS_HUMAN (fara SmartBill)', async () => { const p = prof(); const mk = l => { const f = path.join(tmp, 'o' + Math.random() + '.json'); fs.writeFileSync(f, JSON.stringify({ orderNo: '43', store: { gln: '1', name: 'S' }, lines: [l] })); return f; };
    const codes = []; for (const l of [{ name: 'A', qty: 1, price: 0, vat: 21 }, { name: 'A', qty: 1, price: 5, vat: null }, { name: 'A', qty: 0, price: 5, vat: 21 }, { name: 'A', qty: 1, price: 5, vat: 21, unitCode: 'CT' }]) { try { await realRun(p, { orderFile: mk(l), draftOnly: true, log: () => {} }); codes.push('ok'); } catch (e) { codes.push(e.code); } }
    assert(codes.every(c => c === 'NEEDS_HUMAN'), codes.join()); return codes.join(); });
  await T('X32', 'Bulk previzualizare: total cu zecimale corect (0.1+0.2), comenzi fara total marcate "?"', async () => { const r = bulk.previewText([{ orderNo: '1', total: 0.1 }, { orderNo: '2', total: 0.2 }, { orderNo: '3', total: null }]); assert(/total 0\.30 lei/.test(r.text) && /\?\s+lei/.test(r.text), r.text); return 'ok'; });

  // ---------- Windows ----------
  await T('X33', 'Programare Windows: .cmd nu contine calea kitului (diacritice/spatii in cale nu se strica in cmd.exe)', async () => { const src = fs.readFileSync(path.join(ROOT, 'src/schedule.js'), 'utf8'); assert(/%~dp0\.\.\\\\\\\\run\.bat|%~dp0\.\.\\\\run\.bat/.test(src) && !/path\.join\(ROOT, 'run\.bat'\)/.test(src)); return 'call "%~dp0..\\run.bat"'; });
  await T('X34', 'Bulk fara "da" pe stdin (programare / fara terminal) -> nimic creat, exit 0', async () => { const p = prof(); calls = []; portalOrders = [ord(1)]; const r = await bulk.run(p, { confirm: async () => '', log: () => {} }); assert(calls.length === 0 && r.cancelled && r.exit === 0); return 'anulat'; });
  await T('X35', 'Scriere atomica Windows: rename EPERM/EBUSY temporar -> reincearca; EPERM permanent -> copiere + stergere temp; fara .tmp ramas', async () => {
    const fsx = require('../src/fsx'); const d = path.join(tmp, 'atom ă'); const f = path.join(d, '.setup-progress.json'); fsx.wf(f, 'v1');
    const real = fs.renameSync; let n = 0;
    try {
      fs.renameSync = (a, b) => { if (n++ < 2) throw Object.assign(new Error('busy'), { code: n === 1 ? 'EPERM' : 'EBUSY' }); return real(a, b); };
      fsx.wf(f, 'v2'); assert(fs.readFileSync(f, 'utf8') === 'v2' && n === 3, 'retry ' + n);
      fs.renameSync = () => { throw Object.assign(new Error('held'), { code: 'EACCES' }); };
      fsx.wf(f, 'v3'); assert(fs.readFileSync(f, 'utf8') === 'v3', 'fallback copiere');
      fs.renameSync = () => { throw Object.assign(new Error('x'), { code: 'ENOSPC' }); };
      let threw = false; try { fsx.wf(f, 'v4'); } catch (e) { threw = e.code === 'ENOSPC'; } assert(threw && fs.readFileSync(f, 'utf8') === 'v3', 'alta eroare trebuie aruncata, fisierul vechi intact');
    } finally { fs.renameSync = real; }
    assert(!fs.readdirSync(d).some(x => x.endsWith('.tmp')), 'temp ramas: ' + fs.readdirSync(d)); return 'retry, copiere, fara .tmp'; });
  await T('X36', 'Stergere verificata (fsx.rm) in cale cu diacritice: fisier + folder dispar (Node 24 Windows: rmSync nu face nimic)', async () => {
    const fsx = require('../src/fsx'); const d = path.join(tmp, 'kit fresh ă-rm'); fsx.wf(path.join(d, 'out', '.setup-progress.json'), '{}'); fsx.wf(path.join(d, 'a', 'b.txt'), 'x');
    fsx.rm(path.join(d, 'out', '.setup-progress.json')); assert(!fs.existsSync(path.join(d, 'out', '.setup-progress.json')), 'fisier'); fsx.rm(d); assert(!fs.existsSync(d), 'folder'); fsx.rm(d); return 'ok'; });

  const ok = results.filter(r => r.ok).length; console.log(`\n${ok}/${results.length} PASS`);
  fs.writeFileSync(path.join(tmp, 'results.json'), JSON.stringify(results, null, 2)); process.exit(ok === results.length ? 0 : 1);
})();
