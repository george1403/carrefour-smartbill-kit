'use strict';
// Lista comenzilor Carrefour (doar citire) din portalul de furnizori, cu starea fiecareia: NOUA / ciorna / facturata.
const fs = require('fs'); const path = require('path');
const nz = s => String(s || '').replace(/^0+/, '');
async function list(profile) {
  const { discoverCarrefour } = require('./carrefourPortal');
  const d = await discoverCarrefour(profile, { maxDetails: 0, log: () => {} });
  const led = f => { try { return JSON.parse(fs.readFileSync(path.join(profile.dirs.out, f), 'utf8')); } catch { return {}; } };
  const iss = led('issued.json'), dr = led('drafts.json'); const find = (L, n) => L[Object.keys(L).find(k => nz(k) === nz(n))];
  // SmartBill invoice report (read-only): which orders already have an invoice/draft/cancelled invoice
  let rows = null; const fi = require('./fillInvoice');
  try {
    const iso = x => { const m = String(x || '').match(/^(\d{2})\.(\d{2})\.(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
    const dates = d.orders.map(o => iso(o.date)).filter(Boolean).sort(); const cf = JSON.parse(fs.readFileSync(path.join(profile.root, 'data', 'carrefour.json'), 'utf8'));
    const { openSession } = require('./smartbillWeb'); const s = await openSession({ profile, log: () => {} });
    try { await s.page.goto('https://cloud.smartbill.ro/documente/emitere/factura/', { waitUntil: 'domcontentloaded' }); await s.page.waitForFunction(() => window.$ && window.$.ajax, null, { timeout: 60000 });
      rows = await fi.readInvoiceReport(s.page, profile, cf, fi.addDays(dates[0] || fi.todayIso(), -1)); } finally { await s.browser.close(); }
  } catch (e) { console.log('  (nu am putut verifica in SmartBill care sunt deja facturate: ' + e.message.split('\n')[0] + ')'); }
  console.log(`\nComenzi in portalul Carrefour: ${d.orders.length}`);
  for (const o of d.orders.slice(0, 40)) {
    const i = find(iss, o.orderNo), c = find(dr, o.orderNo); const sb = rows ? fi.classify(rows, o.orderNo, profile.cfg.smartbill?.series, o.total != null ? Number(o.total) : null) : null;
    const st = sb && sb.kind === 'issued' ? `deja facturata (${sb.number || 'SmartBill'})` : sb && sb.kind === 'draft' ? 'ciorna in SmartBill' : sb && sb.kind === 'cancelled' ? `factura ANULATA (${sb.number || ''}) - decide tu` : o.invoiceNumbers ? `deja facturata (${o.invoiceNumbers})` : i && i.status === 'issued' ? `deja facturata (${i.number || i.invoiceId})` : c && c.status === 'draft-only' ? `ciorna facuta (id ${c.invoiceId})` : 'NOUA';
    console.log(`  ${o.orderNo.padEnd(9)} ${String(o.date || '').padEnd(10)} ${String(o.store || '').padEnd(24)} ${String(o.total ?? '').padStart(9)} lei  ${st}`);
  }
  return d.orders;
}
module.exports = { list };
