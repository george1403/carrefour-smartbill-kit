'use strict';
process.env.KIT_TEST_MODE = '1'; // test hooks (mocks, short timeouts) are honoured only in test mode
// MOD DEMONSTRATIE (incarcat cu node -r doar de kit.js ui --demo / teste): SmartBill simulat, programare simulata.
// Nu se conecteaza la SmartBill, nu creeaza nimic real. Ciornele "create" se scriu doar in out/<profil>/drafts.json.
if (process.env.KIT_UI_DEMO === '1') {
  const fs = require('fs'); const path = require('path'); const ROOT = path.join(__dirname, '..');
  const fi = require('../src/fillInvoice');
  fi.run = async (p, o = {}) => {
    const log = o.log || (() => {}); const nr = String(o.orderNo || '').replace(/\D/g, '');
    if (!nr) throw Object.assign(new Error('Lipseste numarul comenzii.'), { code: 'CONFIG' });
    const drafts = path.join(p.dirs.out, 'drafts.json'); let L = {}; try { L = JSON.parse(fs.readFileSync(drafts, 'utf8')); } catch {}
    if (L[nr]) throw Object.assign(new Error(`Pentru comanda ${nr} exista deja o ciorna in SmartBill (id ${L[nr].invoiceId}). Nu o dublez.`), { code: 'DUPLICATE', kind: 'draft', draftId: L[nr].invoiceId });
    if (o.issue) throw new Error('demo: emiterea nu e simulata');
    log(`[demo] Completez factura pentru comanda ${nr} in SmartBill (simulat)...`); await new Promise(r => setTimeout(r, 1200));
    if (!o.draftOnly) return { mode: 'fill-only', deliveryAddress: 'CARREFOUR (demo)', lineState: [{ name: 'PRODUS TEST 50G', um: 'XPP', code: '5940000000017' }] };
    const id = String(7000 + Object.keys(L).length + 1); L[nr] = { status: 'draft-only', invoiceId: id, at: new Date().toISOString() };
    fs.mkdirSync(p.dirs.out, { recursive: true }); fs.writeFileSync(drafts, JSON.stringify(L, null, 2));
    return { mode: 'draft', issued: { status: 'draft-only', invoiceId: id, draftXmlCheck: { comanda: true, GLN: true, linii: true, 'U.M. XPP': true } }, lineState: [{ name: 'PRODUS TEST 50G', um: 'XPP', code: '5940000000017' }] };
  };
  const sw = require('../src/smartbillWeb'); sw.openSession = async () => { throw new Error('demo: SmartBill simulat (nu ma conectez la SmartBill real)'); };
  const ds = require('../src/discoverSmartbill'); ds.discoverSmartbill = async () => { const m = JSON.parse(fs.readFileSync(process.env.KIT_SETUP_MOCK, 'utf8')).smartbill; return { ...m, guard: { blocked: [] } }; };
  const sc = require('../src/schedule'); const mark = path.join(ROOT, '.demo-home', 'programare-demo.txt');
  sc.install = ({ every = 60 } = {}) => { fs.mkdirSync(path.dirname(mark), { recursive: true }); fs.writeFileSync(mark, String(every)); return `Programat (DEMO, nu s-a creat nimic in sistem): la fiecare ${every} minute.`; };
  sc.remove = () => { try { fs.unlinkSync(mark); } catch {} return 'Programarea a fost oprita (DEMO).'; };
  sc.current = () => { try { return fs.readFileSync(mark, 'utf8'); } catch { return ''; } };
}
