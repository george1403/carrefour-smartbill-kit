'use strict';
process.env.KIT_TEST_MODE = '1'; // test hooks (mocks, short timeouts) are honoured only in test mode
const { rm: rmx } = require('../src/fsx'); // verified delete (Node 24 Windows: fs.rmSync is a no-op on non-ASCII paths)
/**
 * Offline tests of "ciorne in bloc" (bulk-ciorne). Carrefour = LOCAL mock portal (scripts/mock-portal.js, real browser login + OCR CAPTCHA);
 * SmartBill = test hooks (fillInvoice._deps mocks + a fake fillInvoice.run that applies the real duplicate classifier to a fake report).
 * No real portal, no real SmartBill, no real accounts. Usage: node scripts/test-bulk.js   exit 0 = all passed.
 */
const fs = require('fs'); const path = require('path'); const os = require('os'); const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
Object.assign(process.env, { KIT_NO_NOTIFY: '1', KIT_RATE_MS: '1', KIT_NAV_TIMEOUT: '8000', KIT_SUBMIT_WAIT: '800', KIT_TEST_HEADLESS: '1', KIT_UNATTENDED: '1', KIT_INTERACTIVE: '' });
const results = []; const assert = (c, m) => { if (!c) throw new Error(m); };
async function T(id, name, fn) { let ok = false, ev = ''; try { ev = String(await fn() || 'ok'); ok = true; } catch (e) { ev = 'FAIL: ' + String(e && e.message || e).split('\n')[0]; } results.push({ id, name, ok, ev }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name} :: ${ev}`); }

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-bulk-'));
  const mock = await require('./mock-portal').start();
  process.env.KIT_CARREFOUR_DOCS_URL = mock.url + '/docs';
  let n = 0;
  const prof = (auto = {}, extra = {}) => { const d = path.join(tmp, 'p' + (++n)); return { name: 'test', root: ROOT, secrets: { carrefourUser: 'u', carrefourPassword: 'p' },
    cfg: { orderSource: { type: 'carrefour-portal' }, company: { name: 'FIRMA MEA TEST SRL' }, carrefour: { expectedSupplierCode: '10001' }, smartbill: { series: 'TST' }, auto: { mode: 'ciorne', ...auto }, ...extra },
    dirs: { state: path.join(d, 'state'), out: path.join(d, 'out', 'test') } }; };
  const O = (nr, date, total, more = {}) => ({ id: Number(nr), nrComMeti: String(nr), magazin: 'CARREFOUR ' + nr, codGLN: '5940475006037', dataCom: date, totalFaraTvaML: total, stare: 'Noua', ...more });
  // portal: very old orders (2025, before any startFrom / 14-day window), invoiced at Carrefour, cancelled, rejected, ledger-invoiced, draft in ledger, draft only in SmartBill, issued only in SmartBill
  mock.st.orders = [O(1700001, '05.01.2025', 100), O(1700002, '11.03.2025', 200.5), O(1700003, '19.10.2026', 50), O(1700004, '01.02.2026', 70, { listaNrFact: 'DEL 12' }),
    O(1700005, '02.02.2026', 80, { stare: 'Anulata' }), O(1700006, '03.02.2026', 90, { stare: 'Respinsa' }), O(1700007, '04.02.2026', 10), O(1700008, '05.02.2026', 11), O(1700009, '06.02.2026', 12), O(1700010, '07.02.2026', 13)];
  // fake SmartBill report rows (format of readInvoiceReport): id | ... | net total col 6 | flags
  let report = ['901 | TST | x | Comanda Carrefour: 1700009 | a | b | 12.00 | "is_draft": true', '902 | TST 77 | x | Comanda Carrefour: 1700010 | a | b | 13.00 | "is_draft": false'];
  const fi = require('../src/fillInvoice'); const realRun = fi.run; let calls = []; let nextId = 5000;
  // fake fillInvoice.run: ledger check + REAL classify on the fake report (same rules as alreadyIssued), then records the draft like issueNow(draftOnly)
  fi.run = async (p, o) => {
    calls.push(o); if (o.issue || !o.draftOnly) throw new Error('bulk a cerut emitere!');
    const drafts = path.join(p.dirs.out, 'drafts.json'); const L = fs.existsSync(drafts) ? JSON.parse(fs.readFileSync(drafts, 'utf8')) : {};
    if (L[o.orderNo]) throw Object.assign(new Error(`exista deja o ciorna (id ${L[o.orderNo].invoiceId})`), { code: 'DUPLICATE', kind: 'draft', draftId: L[o.orderNo].invoiceId });
    const c = fi.classify(report, o.orderNo, 'TST', null);
    if (c) throw Object.assign(new Error(c.kind === 'draft' ? `Pentru comanda ${o.orderNo} exista deja o ciorna in SmartBill (id ${c.draftId})` : `Comanda ${o.orderNo} este deja facturata in SmartBill: factura ${c.number}`), { code: 'DUPLICATE', kind: c.kind, draftId: c.draftId });
    const id = String(nextId++); L[o.orderNo] = { status: 'draft-only', invoiceId: id }; fs.mkdirSync(p.dirs.out, { recursive: true }); fs.writeFileSync(drafts, JSON.stringify(L));
    report.push(`${id} | TST | x | y | a | b | 1.00 | "is_draft": true`); return { issued: { invoiceId: id, status: 'draft-only' } };
  };
  const bulk = require('../src/bulk');
  const seed = p => { fs.mkdirSync(p.dirs.out, { recursive: true }); fs.writeFileSync(path.join(p.dirs.out, 'issued.json'), JSON.stringify({ 1700007: { status: 'issued', number: 'TST 5', invoiceId: 1 } })); fs.writeFileSync(path.join(p.dirs.out, 'drafts.json'), JSON.stringify({ 1700008: { status: 'draft-only', invoiceId: '888' } })); };
  try {
    await T('K01', '--check: lista completa cu numar + total, comenzi vechi (2025) incluse, nimic creat', async () => { const p = prof({ startFrom: '2026-10-19', maxAgeDays: 14 }); seed(p); calls = []; const logs = [];
      const r = await bulk.run(p, { check: true, log: m => logs.push(m), confirm: async () => { throw new Error('a cerut confirmare la --check'); } });
      assert(calls.length === 0, 'creat la --check'); const nos = r.preview.map(x => x.orderNo); assert(nos.includes('1700001') && nos.includes('1700002'), 'vechi lipsa ' + nos);
      assert(/De facut ciorna: 5 comenzi, total 375\.50 lei/.test(logs.join('\n')), logs.join('\n').slice(0, 300)); return `${r.preview.length} de facut (total ${r.previewTotal}), ${r.alreadyDraft.length} deja ciorna, ${r.skipped.length} sarite`; });
    await T('K02', 'Fara "da" -> nimic creat', async () => { const p = prof(); seed(p); calls = []; const r = await bulk.run(p, { confirm: async () => 'nu', log: () => {} }); assert(calls.length === 0 && r.cancelled && r.created.length === 0); return 'anulat, 0 ciorne'; });
    await T('K03', 'Rulare cu "da": vechi incluse, ciorne existente NU dublate, facturate/anulate/respinse sarite, loturi automate', async () => { const p = prof({ startFrom: '2026-10-19', maxAgeDays: 14 }); seed(p); calls = []; const logs = [];
      const r = await bulk.run(p, { confirm: async () => 'da', batch: 2, log: m => logs.push(m) });
      const created = r.created.map(x => x.orderNo).sort(); assert(JSON.stringify(created) === JSON.stringify(['1700001', '1700002', '1700003']), 'create ' + created);
      const ad = Object.fromEntries(r.alreadyDraft.map(x => [x.orderNo, x.draftId])); assert(ad['1700008'] === '888' && ad['1700009'] === '901', JSON.stringify(ad));
      assert(!calls.some(c => c.orderNo === '1700008'), 'ciorna din registru reprocesata'); const sk = r.skipped.map(x => x.orderNo).sort(); assert(['1700004', '1700005', '1700006', '1700007', '1700010'].every(x => sk.includes(x)), 'sarite ' + sk);
      assert(calls.every(c => c.draftOnly === true && c.issue === false), 'emitere ceruta'); assert(logs.filter(l => /^Lot \d/.test(l)).length === 3, 'loturi'); assert(/are deja ciorna \(id 901\)/.test(r.text) && /3 create, 2 aveau deja ciorna/.test(r.text), r.text);
      assert(fs.existsSync(path.join(p.dirs.out, 'bulk-ciorne-ultimul-raport.json')));
      return r.text.split('\n')[0]; });
    await T('K04', 'A doua rulare: nimic nou, tot ce s-a facut apare "are deja ciorna" (fara dubluri)', async () => { const p = prof(); seed(p); await bulk.run(p, { confirm: async () => 'da', log: () => {} }); calls = []; const r = await bulk.run(p, { confirm: async () => 'da', log: () => {} }); assert(calls.every(c => ['1700009', '1700010'].includes(c.orderNo)) && r.created.length === 0 && r.alreadyDraft.length === 5, JSON.stringify(r.alreadyDraft)); return `${r.alreadyDraft.length} deja ciorna, 0 create (1700009/1700010 doar reverificate in SmartBill)`; });
    await T('K05', 'Profil AUTOMAT (armat): bulk face tot DOAR ciorne, 0 facturi', async () => { const p = prof({ mode: 'automat', maxPerRun: 10 }); seed(p); fs.writeFileSync(path.join(p.dirs.out, 'automat-armat.json'), '{}'); calls = []; report = report.slice(0, 2);
      const r = await bulk.run(p, { confirm: async () => 'da', log: () => {} }); assert(r.created.length === 3 && calls.length >= 3 && calls.every(c => c.issue === false && c.draftOnly === true), JSON.stringify(calls)); assert(!fs.existsSync(path.join(p.dirs.out, '..', '..', 'FACTURI-EMISE-AUTOMAT.txt')), 'fisier facturi emise'); assert(!JSON.parse(fs.readFileSync(path.join(p.dirs.out, 'issued.json'))).hasOwnProperty('1700001')); return `${r.created.length} ciorne, issue=false la toate`; });
    await T('K06', 'Hook SmartBill: issueNow(draftOnly) in profil automat -> ciorna salvata, XML verificat, "Salveaza" NU apasat', async () => { const D = fi._deps; const real = { ...D }; let fin = 0;
      try { const p = prof({ mode: 'automat' }); const order = { orderNo: '1700001', orderDate: '2025-01-05', store: { gln: '5940475006037', name: 'S' }, lines: [{ name: 'PRODUS TEST 50G', ean: '5940000000017' }] };
        const xml = '<Invoice>1700001 5940475006037<cac:InvoiceLine><cbc:InvoicedQuantity unitCode="XPP">6</cbc:InvoicedQuantity><cac:Item><cbc:Name>PRODUS TEST 50G</cbc:Name><cac:StandardItemIdentification><cbc:ID schemeID="0160">5940000000017</cbc:ID></cac:StandardItemIdentification></cac:Item></cac:InvoiceLine></Invoice>';
        D.downloadXml = async (pg, id, dir) => { const f = path.join(dir, 'x.xml'); fs.writeFileSync(f, xml); return { xml: f, xmlErrors: null }; }; D.finalizeDraft = async () => { fin++; return { status: 'issued', number: '1' }; }; D.readReport = async () => [];
        const page = { url: () => 'https://cloud.smartbill.ro/x', waitForTimeout: async () => {}, waitForResponse: async () => ({ text: async () => '{"successfully":true,"is_draft":true,"id":777}', status: () => 200 }), click: async () => {}, locator: () => { const o = { filter: () => o, first: () => o, count: async () => 0, isVisible: async () => false }; return o; }, evaluate: async () => ({ title: 'SmartBill', h: [], links: [] }), request: { get: async () => ({ ok: () => false, status: () => 0, headers: () => ({}) }) } };
        const shot = async nm => { const f = path.join(p.dirs.out, 'shots', nm + '.png'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ''); return f; };
        const r = await fi.issueNow(page, { guard: { writes: [], blocked: [] } }, p, order, shot, () => {}, { draftOnly: true });
        assert(r.status === 'draft-only' && fin === 0 && !fs.existsSync(path.join(p.dirs.out, 'issued.json')), JSON.stringify(r).slice(0, 200)); return `ciorna ${r.invoiceId}, 0 finalizari`; } finally { Object.assign(D, real); } });
    await T('K07', 'Cont Carrefour al altui furnizor -> oprit (cod 12), nimic creat', async () => { mock.st.supplier = '20002'; try { const p = prof(); calls = []; const r = await bulk.run(p, { confirm: async () => 'da', log: () => {} }); assert(r.exit === 12 && calls.length === 0, 'exit ' + r.exit); return 'exit 12'; } finally { mock.st.supplier = '10001'; } });
    await T('K08', 'CAPTCHA puternic (reCAPTCHA) nesupravegheat -> cod 3, nimic creat', async () => { mock.st.mode = 'recaptcha'; try { const p = prof(); calls = []; const r = await bulk.run(p, { confirm: async () => 'da', log: () => {} }); assert(r.exit === 3 && r.loginNeeded && calls.length === 0, 'exit ' + r.exit); return 'exit 3, ATENTIE + optiunea 5'; } finally { mock.st.mode = 'image'; } });
    await T('K09', 'Lock: alta rulare in curs -> bulk iese fara sa faca nimic', async () => { const p = prof(); fs.mkdirSync(p.dirs.out, { recursive: true }); const child = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(()=>{},20000)']); fs.writeFileSync(path.join(p.dirs.out, 'auto.lock'), String(child.pid));
      try { calls = []; const r = await bulk.run(p, { confirm: async () => 'da', log: () => {} }); assert(r.busy && calls.length === 0); return 'busy'; } finally { child.kill(); } });
    await T('K10', 'Eroare la o comanda (NEEDS_HUMAN, ex. XML) -> raportata, celelalte continua', async () => { const p = prof(); seed(p); report = report.slice(0, 2); calls = []; const prev = fi.run; fi.run = async (pp, o) => { if (o.orderNo === '1700002') { calls.push(o); throw Object.assign(new Error('STOP: XML-ul ciornei nu contine ...'), { code: 'NEEDS_HUMAN' }); } return prev(pp, o); };
      try { const r = await bulk.run(p, { confirm: async () => 'da', log: () => {} }); assert(r.errors.length === 1 && r.created.length === 2, JSON.stringify(r.errors)); const st = JSON.parse(fs.readFileSync(path.join(p.dirs.out, 'auto-state.json'))); assert(st['1700002'].needsHuman); return '1 eroare, 2 create, 1700002 marcata pentru verificare'; } finally { fi.run = prev; } });
    await T('K11', 'Meniu: optiunea 9 = bulk-ciorne; CLI help o descrie', () => { const m = require('../src/menu').ITEMS.find(i => i[0] === '9'); assert(m && m[2]()[0] === 'bulk-ciorne' && /Ciorne in bloc/.test(m[1]));
      const h = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'kit.js'), 'help'], { encoding: 'utf8' }); assert(/bulk-ciorne/.test(h.stdout) && /--check/.test(h.stdout)); return '9) ' + m[1].slice(0, 60); });
    await T('K12', 'Lista goala (toate facturate) -> "Nimic de facut", fara confirmare, 0 ciorne', async () => { const keep = mock.st.orders; mock.st.orders = [O(1700004, '01.02.2026', 70, { listaNrFact: 'DEL 12' })];
      try { const p = prof(); calls = []; const r = await bulk.run(p, { confirm: async () => { throw new Error('a cerut confirmare'); }, log: () => {} }); assert(calls.length === 0 && r.created.length === 0 && r.exit === 0); return '0 de facut, exit 0'; } finally { mock.st.orders = keep; } });
    await T('K13', 'Meniu 9 cu stdin deschis (terminal): raspuns "nu" -> raport si procesul SE TERMINA (fara readline/OCR agatat)', async () => {
      mock.st.orders = [O(1700101, '05.01.2025', 100)]; const d = path.join(tmp, 'k13'); fs.mkdirSync(d, { recursive: true }); const js = path.join(d, 'child.js');
      fs.writeFileSync(js, `const path=require('path');const ROOT=${JSON.stringify(ROOT)};const d=${JSON.stringify(d)};
const p={name:'test',root:ROOT,secrets:{carrefourUser:'u',carrefourPassword:'p'},cfg:{orderSource:{type:'carrefour-portal'},company:{name:'FIRMA MEA TEST SRL'},carrefour:{expectedSupplierCode:'10001'},smartbill:{series:'TST'},auto:{mode:'ciorne'}},dirs:{state:path.join(d,'state'),out:path.join(d,'out','test')}};
require(path.join(ROOT,'src','bulk')).run(p,{}).then(r=>{console.log('RETURNED '+!!r.cancelled);process.exitCode=r.exit||0;});`);
      const child = require('child_process').spawn(process.execPath, [js], { env: { ...process.env, KIT_INTERACTIVE: '1', KIT_UNATTENDED: '', KIT_BULK_CONFIRM: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
      let out = ''; child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { out += b; });
      child.stdin.write('nu\n'); // stdin stays OPEN, like a terminal
      const code = await new Promise(r => { const t = setTimeout(() => { child.kill(); r('HANG'); }, 45000); child.on('exit', c => { clearTimeout(t); r(c); }); });
      child.stdin.destroy();
      assert(/RETURNED true/.test(out), 'nu a ajuns la raport: ' + out.slice(-800)); assert(code === 0, 'procesul nu s-a terminat dupa raport (' + code + ')');
      return 'raport + iesire cod 0'; });
  } finally { fi.run = realRun; await mock.close(); }
  const bad = results.filter(r => !r.ok).length; console.log(`\n${results.length - bad}/${results.length} teste ciorne-in-bloc trecute.`); rmx(tmp); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
