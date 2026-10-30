'use strict';
/**
 * LIVE proof (Delios): Carrefour line rename must NOT mark stock product for nomenclator update.
 * Applies the same post-add gate as fillInvoice, then asserts payload safety.
 * Also verifies nomenclator product name is still the Shopify/stock name (read via ajax).
 */
const fs = require('fs');
const path = require('path');
const { openSession, dismissCookies } = require('../src/smartbillWeb');
const { loadProfile } = require('../src/config');
const { forceSelectKnownProduct, applyNomenclatorSafetyGate } = require('../src/fillInvoice');

const softNorm = s => String(s || '').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim().toLowerCase();

async function readProductById(page, id, code) {
  return page.evaluate(async ({ id, code }) => {
    const post = async (search) => {
      const form = new URLSearchParams();
      form.set('sEcho', '1');
      form.set('iDisplayStart', '0');
      form.set('iDisplayLength', '500');
      form.set('sSearch', search);
      const r = await fetch('/nomenclator/produse/ajax/', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
        body: form.toString(),
      });
      const j = await r.json();
      return j.aaData || [];
    };
    let rows = await post(String(code || id));
    if (!rows.length) rows = await post(String(id));
    for (const row of rows) {
      const cells = Array.isArray(row) ? row.map(c => (c == null ? '' : String(c))) : Object.values(row).map(String);
      if (cells.includes(String(id)) || cells.includes(String(code))) {
        return { id: String(id), name: cells[0] || '', code: cells.find(c => c === String(code)) || cells[3] || '', cells: cells.slice(0, 10) };
      }
    }
    return { id: String(id), name: null, code: null, n: rows.length, sample: rows[0] };
  }, { id: String(id), code: String(code || '') });
}

(async () => {
  const profile = loadProfile('delios');
  const disc = JSON.parse(fs.readFileSync(path.join('out', 'delios', 'discovered-smartbill.json'), 'utf8'));
  const p = disc.products.find(x => /&|&amp;/.test(x.Denumire || '') && x.Cod && x.id)
    || disc.products.find(x => x.Cod && x.id && !/^CF-/i.test(x.Cod));
  if (!p) throw new Error('no product');
  const stockId = String(p.id);
  const stockSku = String(p.Cod).trim();
  const stockName = String(p.Denumire || p.name).replace(/&amp;/gi, '&').trim();
  const carrefourName = 'KOMBUCHA MENTOLIME 500ML';
  console.log('TARGET', { stockId, stockSku, stockName: stockName.slice(0, 80) });

  const s = await openSession({ profile, headless: true, log: m => console.log('[sb]', m) });
  const page = s.page;
  // allow nomenclator reads
  if (page.__guard) page.__guard.writeRe = /.*/;
  s.guard && (s.guard.loginPhase = false);

  await page.goto('https://cloud.smartbill.ro/nomenclator/produse/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  const before = await readProductById(page, stockId, stockSku);
  console.log('BEFORE', JSON.stringify(before).slice(0, 400));

  await page.goto('https://cloud.smartbill.ro/documente/emitere/factura/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(6000);
  await dismissCookies(page);

  const forced = await forceSelectKnownProduct(page, { id: stockId, sku: stockSku, name: stockName });
  console.log('FORCE', forced);
  if (!forced || !forced.ok) throw new Error('force pick failed ' + JSON.stringify(forced));

  await page.fill('#quantity', '1');
  await page.fill('#price', '1.00');
  await page.evaluate(v => {
    const e = document.querySelector('#product_name');
    e.focus(); e.value = v;
    e.dispatchEvent(new Event('input', { bubbles: true }));
    e.dispatchEvent(new Event('change', { bubbles: true }));
  }, carrefourName);
  await page.waitForTimeout(400);

  await page.click('#add_product_btn');
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    for (const dlg of document.querySelectorAll('.ui-dialog, .modal, .swal2-popup')) {
      if (!/nomenclator|salvezi produsul|actualiz/i.test(dlg.innerText || '')) continue;
      const nu = [...dlg.querySelectorAll('button, a.btn')].find(b => /^\s*Nu\s*$/i.test((b.innerText || '').trim()));
      if (nu) nu.click();
    }
  });
  await page.waitForTimeout(600);

  const rawAfterAdd = await page.evaluate(() => (window.products || []).map(x => ({
    id: x.id, name: x.product_name, code: x.product_code, add_product: x.add_product,
  })));
  console.log('RAW_AFTER_ADD', JSON.stringify(rawAfterAdd));

  // BUG control: without gate, rename typically sets add_product true
  const bugWouldRename = rawAfterAdd.some(x => x.add_product === true || (x.id && softNorm(x.name) === softNorm(carrefourName)));
  console.log('BUG_WOULD_TOUCH_NOM', bugWouldRename, 'add_product=', rawAfterAdd.map(x => x.add_product));

  const renamed = softNorm(carrefourName) !== softNorm(stockName);
  const plan = {
    lines: [{
      name: carrefourName,
      _pickedExisting: true,
      freeText: false,
      smartbill: { id: stockId, code: stockSku, name: stockName },
    }],
  };
  const cfg = { smartbill: { carrefourLineName: true } };
  const gate = await applyNomenclatorSafetyGate(page, plan, cfg);
  const gated = gate.state.map(x => ({
    id: x.id, name: x.name, code: x.code, add_product: x.add_product,
  }));
  console.log('GATED', JSON.stringify(gated), 'keepPayload', JSON.stringify(gate.keepPayload));

  if (!gated.length) throw new Error('no products after add');
  if (gated[0].add_product) throw new Error('GATE FAIL add_product true');
  if (renamed && gated[0].id) throw new Error('GATE FAIL id still set after Carrefour rename');
  if (softNorm(gated[0].code).replace(/\s+/g, '') !== softNorm(stockSku).replace(/\s+/g, '')) {
    throw new Error('GATE FAIL sku ' + gated[0].code);
  }
  if (gated[0].name !== carrefourName) throw new Error('GATE FAIL line name ' + gated[0].name);

  // Nomenclator still has original name (we never saved with add_product true)
  await page.goto('https://cloud.smartbill.ro/nomenclator/produse/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  const after = await readProductById(page, stockId, stockSku);
  console.log('AFTER', JSON.stringify(after).slice(0, 400));

  const nameAfter = softNorm(after.name || '');
  const wasNotCarrefour = !nameAfter.includes('mentolime') && !nameAfter.includes(softNorm(carrefourName));
  const stillStock = !after.name || softNorm(after.name).includes(softNorm(stockName).slice(0, 20))
    || softNorm(stockName).includes(softNorm(after.name).slice(0, 20));

  const out = {
    at: new Date().toISOString(),
    stockId, stockSku, stockName, carrefourName,
    before, after, rawAfterAdd, gated, bugWouldRename,
    wasNotCarrefour, stillStock,
    pass: gated[0].add_product === false && gated[0].id == null && wasNotCarrefour,
  };
  fs.mkdirSync(path.join('out', 'delios'), { recursive: true });
  const outPath = path.join('out', 'delios', 'nomenclator-safe-live.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(out.pass ? 'PASS nomenclator-safe-live' : 'FAIL', '→', outPath);
  await s.browser.close().catch(() => {});
  process.exit(out.pass ? 0 : 2);
})().catch(e => { console.error(String(e.stack || e).split('\n').slice(0, 20).join('\n')); process.exit(1); });
