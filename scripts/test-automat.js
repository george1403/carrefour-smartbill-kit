'use strict';
const { rm: rmx } = require('../src/fsx'); // verified delete (Node 24 Windows: fs.rmSync is a no-op on non-ASCII paths)
/**
 * Offline tests of mode "automat" (no SmartBill, no Carrefour, nothing issued): the SmartBill save, the XML preview,
 * the final "Salveaza" and the report lookups are MOCKS. Usage: node scripts/test-automat.js   exit 0 = all passed.
 */
const fs = require('fs'); const path = require('path'); const os = require('os');
const ROOT = path.join(__dirname, '..');
process.env.KIT_NO_NOTIFY = '1'; process.env.KIT_RATE_MS = '1';
const results = []; const assert = (c, m) => { if (!c) throw new Error(m); };
async function T(id, name, fn) { let ok = false, ev = ''; try { ev = String(await fn() || 'ok'); ok = true; } catch (e) { ev = 'FAIL: ' + String(e && e.message || e).split('\n')[0]; } results.push({ id, name, ok, ev }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name} :: ${ev}`); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-automat-'));
let n = 0; const prof = (auto = {}) => { const d = path.join(tmp, 'p' + (++n)); return { name: 't', root: ROOT, cfg: { smartbill: { series: 'TST' }, auto: { mode: 'automat', startFrom: '2026-10-01', maxAgeDays: 400, ...auto } }, dirs: { out: path.join(d, 'out', 't'), state: path.join(d, 'st') } }; };
const order = { orderNo: '1780308', orderDate: '2026-10-19', store: { gln: '5940475006037', name: 'S' }, lines: [{ name: 'CARPATHIAN JERKY PORK 50G', ean: '729927359502' }] };
const goodXml = `<Invoice>1780308 5940475006037<cac:InvoiceLine><cbc:InvoicedQuantity unitCode="XPP">9</cbc:InvoicedQuantity><cac:Item><cbc:Name>CARPATHIAN JERKY PORK 50G</cbc:Name><cac:StandardItemIdentification><cbc:ID schemeID="0160">729927359502</cbc:ID></cac:StandardItemIdentification></cac:Item></cac:InvoiceLine></Invoice>`;

const fi = require('../src/fillInvoice'); const D = fi._deps; const real = { ...D };
function fake({ body = '{"successfully":true,"is_draft":true,"id":555}', xml = goodXml, xmlErrors = null, xmlThrows = false, report = [], report2 = null, fin = { status: 'issued', number: '42' } } = {}) {
  const c = { saveClicks: 0, finalize: 0, reports: 0 };
  const page = { url: () => 'https://cloud.smartbill.ro/documente/emitere/factura/', waitForTimeout: async () => {},
    waitForResponse: async () => body == null ? null : { text: async () => body, status: () => 200 },
    click: async sel => { if (sel === '#saveInvoiceBtn') c.saveClicks++; },
    locator: () => { const o = { filter: () => o, first: () => o, count: async () => 0, isVisible: async () => false }; return o; },
    evaluate: async () => ({ title: 'SmartBill', h: [], links: [] }), request: { get: async () => ({ ok: () => false, status: () => 0, headers: () => ({}) }) } };
  const s = { guard: { writeRe: null, writes: [], blocked: [] } };
  D.downloadXml = async (pg, id, dir) => { if (xmlThrows) throw new Error('timeout send_xml'); if (!xml) return { xmlError: 'send_xml 500' }; const f = path.join(dir, 'x.xml'); fs.writeFileSync(f, xml); return { xml: f, xmlErrors }; };
  D.readReport = async () => { c.reports++; return c.reports === 1 ? report : (report2 || report); };
  D.finalizeDraft = async () => { c.finalize++; if (fin instanceof Error) throw fin; return { ...fin }; };
  return { page, s, c };
}
const shotFn = p => async nm => { const f = path.join(p.dirs.out, 'shots', nm + '.png'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ''); return f; };
const issue = (p, f) => fi.issueNow(f.page, f.s, p, order, shotFn(p), () => {}, { draftOnly: false });
const ledger = p => JSON.parse(fs.readFileSync(path.join(p.dirs.out, 'issued.json'), 'utf8'))[order.orderNo];
const code = async pr => { try { await pr; return 'ok'; } catch (e) { return e.code || e.message; } };

(async () => {
  await T('A01', 'Cale normala: ciorna -> XML verificat -> re-verificare dubluri -> Salveaza (mock) -> numar capturat', async () => { const p = prof(); const f = fake(); const r = await issue(p, f); assert(r.status === 'issued' && r.number === '42' && f.c.finalize === 1 && f.c.reports === 1, JSON.stringify(r).slice(0, 200)); return `nr ${r.number}, 1 salvare, 1 finalizare, raport recitit inainte`; });
  await T('A02', 'Numarul lipseste din pagina -> cautat in raport inainte de a continua', async () => { const p = prof(); const f = fake({ fin: { status: 'issued', number: null }, report2: ['555 | TST 43 | Comanda Carrefour: 1780308 | x'] }); const r = await issue(p, f); assert(r.number === 'TST 43' && r.numberFrom === 'raport', JSON.stringify(r)); return 'numar din raport: ' + r.number; });
  await T('A03', 'Salvat dar numarul nu se poate confirma -> STOP (SAVE_UNKNOWN), reincercarea NU mai salveaza', async () => { const p = prof(); const f = fake({ fin: { status: 'issued', number: null } }); assert(await code(issue(p, f)) === 'SAVE_UNKNOWN'); assert(ledger(p).status === 'issued-unverified'); const f2 = fake(); const e = await code(issue(p, f2)); assert(f2.c.saveClicks === 0 && /STOP|NEEDS_HUMAN/.test(e), 'a doua salvare!'); return 'stare issued-unverified; retry: 0 click-uri'; });
  await T('A04', '"Salveaza" se blocheaza/timeout (rezultat necunoscut) -> STOP, fara retry automat', async () => { const p = prof(); const f = fake({ fin: new Error('page.click: Timeout 30000ms') }); assert(await code(issue(p, f)) === 'SAVE_UNKNOWN'); assert(ledger(p).status === 'finalize-unknown'); const f2 = fake(); await code(issue(p, f2)); assert(f2.c.saveClicks === 0 && f2.c.finalize === 0); return 'finalize-unknown, retry refuzat'; });
  await T('A05', 'Raspuns ilizibil la "Spre salvare" -> STOP, nu se finalizeaza', async () => { const p = prof(); const f = fake({ body: null }); assert(await code(issue(p, f)) === 'SAVE_UNKNOWN' && f.c.finalize === 0 && ledger(p).status === 'unknown'); return 'unknown, 0 finalizari'; });
  await T('A06', 'SmartBill salveaza direct DEFINITIV (nu ciorna) -> STOP, fara verificare dupa', async () => { const p = prof(); const f = fake({ body: '{"successfully":true,"is_draft":false,"id":7}' }); assert(await code(issue(p, f)) === 'SAVE_UNKNOWN' && f.c.finalize === 0 && ledger(p).status === 'issued-unchecked'); return 'issued-unchecked, oprit'; });
  await T('A07', 'Previzualizarea XML esueaza -> ciorna ramane, NU se finalizeaza', async () => { const p = prof(); const f = fake({ xmlThrows: true }); assert(await code(issue(p, f)) === 'NEEDS_HUMAN' && f.c.finalize === 0); const f3 = fake({ xml: null }); const p3 = prof(); assert(await code(issue(p3, f3)) === 'NEEDS_HUMAN' && f3.c.finalize === 0); return 'exceptie si raspuns fara XML: oprit'; });
  await T('A08', 'XML gresit (U.M. H87 / nume / GLN / comanda) -> STOP inainte de Salveaza', async () => { const out = []; for (const [k, x] of [['UM', goodXml.replace('XPP', 'H87')], ['nume', goodXml.replace('PORK', 'BEEF')], ['GLN', goodXml.replace('5940475006037', '')], ['comanda', goodXml.replace('1780308', '')]]) { const p = prof(); const f = fake({ xml: x }); assert(await code(issue(p, f)) === 'NEEDS_HUMAN' && f.c.finalize === 0, k); out.push(k); } return 'oprit pentru: ' + out.join(', '); });
  await T('A09', 'SmartBill raporteaza erori e-Factura in XML -> STOP', async () => { const p = prof(); const f = fake({ xmlErrors: ['BR-RO-xx'] }); assert(await code(issue(p, f)) === 'NEEDS_HUMAN' && f.c.finalize === 0); return 'oprit'; });
  await T('A10', 'Cursa: intre timp apare factura emisa pentru comanda -> DUPLICATE, ciorna NU se finalizeaza', async () => { const p = prof(); const f = fake({ report: ['9 | TST 40 | Comanda Carrefour: 1780308 | "is_draft": false'] }); assert(await code(issue(p, f)) === 'DUPLICATE' && f.c.finalize === 0); return 'oprit'; });
  await T('A11', 'KIT_STOP_BEFORE_FINAL=1 -> se opreste exact inainte de "Salveaza"', async () => { process.env.KIT_STOP_BEFORE_FINAL = '1'; try { const p = prof(); const f = fake(); assert(await code(issue(p, f)) === 'STOP_BEFORE_FINAL' && f.c.finalize === 0 && f.c.saveClicks === 1); } finally { delete process.env.KIT_STOP_BEFORE_FINAL; } return 'ciorna salvata (mock), XML OK, oprit inainte de finalizare'; });
  await T('A12', 'Ciorna existenta pentru comanda (acelasi total) -> clasificata ca ciorna (dublura evitata)', () => { const c = fi.classify(['77 | a | b | c | d | e | 121.50 | "is_draft": true'], '1780308', 'TST', 121.5); assert(c && c.kind === 'draft'); const c2 = fi.classify(['77 | a | b | c | d | e | 121.50 | "is_draft": true'], '1780308', 'TST', 121.5, ['77']); assert(!c2); return 'ciorna gasita; ciorna altei comenzi exclusa'; });
  Object.assign(D, real);

  // ---------- auto.runOnce with mocked portal + mocked fillInvoice.run ----------
  const cpPath = require.resolve('../src/carrefourPortal'); const fiPath = require.resolve('../src/fillInvoice');
  let orders = []; let calls = []; let behave = () => ({ issued: { number: 'TST ' + (100 + calls.length), invoiceId: calls.length } });
  require.cache[cpPath] = { id: cpPath, filename: cpPath, loaded: true, exports: { discoverCarrefour: async () => ({ orders }) } };
  const realRun = fi.run; fi.run = async (p, o) => { calls.push(o); return behave(o); };
  const auto = require('../src/auto');
  const mk = k => Array.from({ length: k }, (_, i) => ({ orderNo: String(1780400 + i), date: '19.10.2026', store: 'S' + i, total: 10 }));
  await T('B01', 'Prima rulare automat = doar verificare (nimic emis), apoi armat', async () => { const p = prof(); orders = mk(2); calls = []; const r = await auto.runOnce(p, { log: () => {} }); assert(calls.length === 0 && r.mode === 'verificare' && r.done.length === 2, JSON.stringify(r)); assert(fs.existsSync(path.join(p.dirs.out, 'automat-armat.json'))); return '2 ar fi facturate, 0 emise'; });
  await T('B02', 'Maxim pe rulare: implicit 3; 50 in profil -> plafonat la 10; notificare + fisier cu facturile emise', async () => { const p = prof(); fs.mkdirSync(p.dirs.out, { recursive: true }); fs.writeFileSync(path.join(p.dirs.out, 'automat-armat.json'), '{}'); orders = mk(15); calls = []; const r = await auto.runOnce(p, { log: () => {} }); assert(calls.length === 3 && r.issued.length === 3, 'implicit ' + calls.length);
    const txt = fs.readFileSync(path.join(p.dirs.out, '..', '..', 'FACTURI-EMISE-AUTOMAT.txt'), 'utf8'); assert(/3 facturi emise/.test(txt) && /TST 101/.test(txt), txt);
    const p2 = prof({ maxPerRun: 50 }); fs.mkdirSync(p2.dirs.out, { recursive: true }); fs.writeFileSync(path.join(p2.dirs.out, 'automat-armat.json'), '{}'); calls = []; await auto.runOnce(p2, { log: () => {} }); assert(calls.length === 10, 'plafon ' + calls.length); return 'implicit 3, plafon 10, fisier: ' + txt.split('\n')[1].trim(); });
  await T('B03', 'Rezultat necunoscut la o comanda -> toata rularea se opreste (exit 11), comanda nu se mai reincearca', async () => { const p = prof(); fs.mkdirSync(p.dirs.out, { recursive: true }); fs.writeFileSync(path.join(p.dirs.out, 'automat-armat.json'), '{}'); orders = mk(3); calls = [];
    behave = () => { throw Object.assign(new Error('STOP: nu pot confirma numarul'), { code: 'SAVE_UNKNOWN', invoiceId: 9 }); };
    const r = await auto.runOnce(p, { log: () => {} }); assert(calls.length === 1 && r.exit === 11 && r.stopped && r.saveUnknown, JSON.stringify(r));
    behave = () => ({ issued: { number: 'TST 1' } }); calls = []; const r2 = await auto.runOnce(p, { log: () => {} }); assert(!calls.some(c => c.orderNo === '1780400'), 'reincercat!'); return `oprit dupa 1; a doua rulare sare ${r2.skipped.find(s => s.orderNo === '1780400') ? '1780400 (necesita verificare)' : '?'}`; });
  await T('B04', 'Filtru data (startFrom), comanda anulata, deja facturata la Carrefour -> sarite', async () => { const p = prof({ startFrom: '2026-10-15' }); fs.mkdirSync(p.dirs.out, { recursive: true }); fs.writeFileSync(path.join(p.dirs.out, 'automat-armat.json'), '{}');
    orders = [{ orderNo: '1', date: '10.10.2026' }, { orderNo: '2', date: '19.10.2026', status: 'Anulata' }, { orderNo: '3', date: '19.10.2026', invoiceNumbers: 'F1' }, { orderNo: '4', date: '19.10.2026' }]; calls = []; const r = await auto.runOnce(p, { log: () => {} }); assert(calls.length === 1 && calls[0].orderNo === '4', JSON.stringify(calls)); return r.skipped.map(s => s.orderNo + ': ' + s.why).join(' | '); });
  await T('B05', 'Ciorna deja prezenta (DUPLICATE draft) -> sarita, rularea continua', async () => { const p = prof(); fs.mkdirSync(p.dirs.out, { recursive: true }); fs.writeFileSync(path.join(p.dirs.out, 'automat-armat.json'), '{}'); orders = mk(2); calls = [];
    behave = o => { if (o.orderNo === '1780400') throw Object.assign(new Error('exista deja o ciorna'), { code: 'DUPLICATE', kind: 'draft' }); return { issued: { number: 'TST 9' } }; };
    const r = await auto.runOnce(p, { log: () => {} }); assert(calls.length === 2 && !r.stopped && r.issued.length === 1); return '1 sarita (ciorna), 1 emisa'; });
  await T('B06', 'Mod ciorne neschimbat: cere doar ciorne (draftOnly), fara rulare de proba', async () => { const p = prof({ mode: 'ciorne' }); orders = mk(1); calls = []; behave = () => ({ issued: { invoiceId: 5 } }); await auto.runOnce(p, { log: () => {} }); assert(calls.length === 1 && calls[0].draftOnly === true && calls[0].issue === false); return 'draftOnly=true'; });
  fi.run = realRun;
  const bad = results.filter(r => !r.ok).length; console.log(`\n${results.length - bad}/${results.length} teste automat trecute.`); rmx(tmp); process.exit(bad ? 1 : 0);
})();
