'use strict';
/**
 * Offline DOM regression for productAutocompleteItemsScript:
 * - Mentolime: menu with opacity/zero rects still clickable by stock id
 * - Sokata: ignore client autocomplete chrome
 * - Never require :visible / getClientRects
 */
const { chromium } = require('playwright');
const { productAutocompleteItemsScript } = (() => {
  // Replicate the shipped script body by requiring fillInvoice internals via evaluate source.
  // We inject the same function text the kit uses at runtime.
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'fillInvoice.js'), 'utf8');
  const m = src.match(/function productAutocompleteItemsScript\(\) \{[\s\S]*?\n\}/);
  if (!m) throw new Error('productAutocompleteItemsScript not found');
  // eslint-disable-next-line no-new-func
  return { productAutocompleteItemsScript: new Function(`${m[0]}; return productAutocompleteItemsScript;`)() };
})();

async function runCase(page, { html, inputSel, id, sku, name, expectOk, expectId }) {
  await page.setContent(html);
  // Stub SmartBill select + no real jQuery autocomplete — exercise DOM id / built-item path.
  await page.addScriptTag({ content: `
    window.$ = undefined;
    window.__selected = null;
    window.productAutocompleteSelect = function(t){ window.__selected = t && t.item; };
  ` });
  const fn = productAutocompleteItemsScript();
  const r = await page.evaluate(fn, { inputSel, id, sku, name });
  if (!!r.ok !== !!expectOk) throw new Error(`ok=${r.ok} expected ${expectOk}: ${JSON.stringify(r)}`);
  if (expectId && String(r.id) !== String(expectId)) throw new Error(`id=${r.id} expected ${expectId}`);
  if (expectOk && expectId) {
    const sel = await page.evaluate(() => window.__selected && String(window.__selected.id));
    if (String(sel) !== String(expectId)) throw new Error(`productAutocompleteSelect not called with id ${expectId}, got ${sel}`);
  }
  return r;
}

(async () => {
  const b = await chromium.launch({ headless: true });
  const page = await b.newPage();
  let n = 0; const ok = (m) => { n++; console.log('OK', m); };

  // Mentolime: target id present, menu display none (stuck) — still pick by id
  await runCase(page, {
    html: `<input id="product_name"/><ul class="ui-autocomplete" style="display:none">
      <li class="ui-menu-item" id="32214943">Furori kombucha menta &amp; lamaie 500 ml (mentolime500)</li>
    </ul>`,
    inputSel: '#product_name', id: '32214943', sku: 'mentolime500', name: 'Furori kombucha menta & lamaie 500 ml',
    expectOk: true, expectId: '32214943',
  });
  ok('Mentolime pick by DOM id with display:none menu');

  // Sokata: client chrome + product — pick product id, not client
  await runCase(page, {
    html: `<input id="product_name"/>
      <ul class="ui-autocomplete" style="display:block">
        <li class="ui-menu-item client-add-new">Adauga client nou</li>
        <li class="ui-menu-item">CARREFOUR ROMANIA SA</li>
      </ul>
      <ul class="ui-autocomplete" style="display:block;opacity:0.01">
        <li class="ui-menu-item" id="23381871">Furori sokata kombucha 500 ml (sokataF500)</li>
        <li class="ui-menu-item" id="999">altceva</li>
      </ul>`,
    inputSel: '#product_name', id: '23381871', sku: 'sokataF500', name: 'Furori sokata kombucha 500 ml',
    expectOk: true, expectId: '23381871',
  });
  ok('Sokata pick by id ignores client chrome');

  // SGR sticla
  await runCase(page, {
    html: `<input id="product_code"/><ul class="ui-autocomplete" style="display:block">
      <li class="ui-menu-item" id="53098725">Garantie SGR Sticla (SGR sticla)</li>
    </ul>`,
    inputSel: '#product_code', id: '53098725', sku: 'SGR sticla', name: 'Garantie SGR Sticla',
    expectOk: true, expectId: '53098725',
  });
  ok('SGR sticla pick by id');

  // Missing id → fail with texts (not empty if nodes exist)
  const miss = await runCase(page, {
    html: `<input id="product_name"/><ul class="ui-autocomplete" style="display:block">
      <li class="ui-menu-item" id="1">alt produs (x)</li>
    </ul>`,
    inputSel: '#product_name', id: '32214943', sku: 'mentolime500', name: 'Furori kombucha menta & lamaie 500 ml',
    expectOk: false,
  });
  if (!(miss.texts && miss.texts.length)) throw new Error('expected diagnostic texts, got ' + JSON.stringify(miss));
  ok('miss reports Vazute texts');

  await b.close();
  console.log(`\n${n} DOM pick checks OK`);
})().catch(e => { console.error('FAIL', e.message || e); process.exit(1); });
