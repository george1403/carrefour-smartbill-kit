'use strict';
process.env.KIT_TEST_MODE = '1';
/**
 * Test: company_cifs selector optional (single-company vs multi-company SmartBill accounts).
 * Usage: node scripts/test-company-cif-selector.js   exit 0 = all passed.
 */
const results = [];
const assert = (c, m) => { if (!c) throw new Error(m); };
async function T(id, name, fn) {
  let ok = false, ev = '';
  const t0 = Date.now();
  try { ev = String(await fn() || 'ok'); ok = true; }
  catch (e) { ev = 'FAIL: ' + String(e && e.message || e).split('\n')[0]; }
  results.push({ id, name, ok, ev, ms: Date.now() - t0 });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name} :: ${ev}`);
}

(async () => {
  const fi = require('../src/fillInvoice');

  // Test selectByText with optional flag
  await T('CIF01', 'selectByText: element exists -> selects correctly', async () => {
    const mockPage = {
      $: async (sel) => sel === '#test' ? { found: true } : null,
      $eval: async (sel, fn, src) => {
        if (sel !== '#test') throw new Error('wrong selector');
        // Simulate finding a matching option
        const mockSelect = {
          options: [
            { value: '1', text: ' RO40893400 ' },
            { value: '2', text: ' RO12345678 ' }
          ]
        };
        return fn(mockSelect, src);
      },
      selectOption: async (sel, val) => { assert(sel === '#test' && val === '1', `selected ${val}`); },
      waitForTimeout: async () => {}
    };
    const result = await fi._selectByText(mockPage, '#test', /^RO40893400$/);
    assert(result === '1', `value: ${result}`);
    return 'selected value 1';
  });

  await T('CIF02', 'selectByText: element missing, optional=false -> throws error', async () => {
    const mockPage = {
      $: async () => null
    };
    let threw = false;
    try {
      await fi._selectByText(mockPage, '#missing', /test/, { optional: false });
    } catch (e) {
      threw = true;
      assert(/nu exista/.test(e.message), `wrong error: ${e.message}`);
    }
    assert(threw, 'did not throw');
    return 'threw error as expected';
  });

  await T('CIF03', 'selectByText: element missing, optional=true -> returns null', async () => {
    const mockPage = {
      $: async () => null
    };
    const result = await fi._selectByText(mockPage, '#missing', /test/, { optional: true });
    assert(result === null, `result: ${result}`);
    return 'returned null';
  });

  // Test the discovery code (integration test with simple mocks)
  await T('CIF04', 'discover: page.evaluate code with company_cifs present', async () => {
    // This is the actual code that runs inside page.evaluate
    const evalCode = () => {
      const opts = sel => [...(document.querySelector(sel)?.options || [])].map(o => ({ value: o.value, text: o.text.trim(), selected: o.selected }));
      const series = opts('#serie').map(o => {
        const m = o.text.match(/^(.*?)\s*\(\s*nr\.\s*(\d+)\s*\)\s*$/i);
        return { name: m ? m[1].trim() : o.text, next: m ? Number(m[2]) : null, value: o.value, selected: o.selected };
      });
      const cifEl = document.querySelector('#company_cifs');
      return {
        cifs: cifEl ? opts('#company_cifs').map(o => o.text) : [],
        series,
        vat: opts('#vat_code').map(o => o.text),
        currencies: opts('#currency').map(o => o.text.split(' ')[0]),
        issuer: document.querySelector('#issuer')?.value || null,
        eFacturaFields: [...document.querySelectorAll('[id^="id-additional-field-"]')].map(e => e.id.replace('id-additional-field-', ''))
      };
    };
    
    // Simulate multi-company SmartBill account
    const mockDocument = {
      querySelector: (sel) => {
        if (sel === '#company_cifs') {
          return { options: [
            { value: '1', text: 'RO40893400', selected: true },
            { value: '2', text: 'RO12345678', selected: false }
          ] };
        }
        if (sel === '#serie') return { options: [{ value: 's1', text: 'TST (nr. 100)', selected: true }] };
        if (sel === '#vat_code') return { options: [{ value: 'v1', text: '19 %', selected: true }] };
        if (sel === '#currency') return { options: [{ value: 'c1', text: 'RON', selected: true }] };
        if (sel === '#issuer') return { value: 'John Doe' };
        return null;
      },
      querySelectorAll: () => []
    };
    
    // Execute the code with our mock document
    global.document = mockDocument;
    const result = evalCode();
    delete global.document;
    
    assert(Array.isArray(result.cifs) && result.cifs.length === 2, `cifs: ${JSON.stringify(result.cifs)}`);
    assert(result.cifs[0] === 'RO40893400', `first CIF: ${result.cifs[0]}`);
    return `found ${result.cifs.length} CIFs (multi-company account)`;
  });

  await T('CIF05', 'discover: page.evaluate code with company_cifs missing', async () => {
    // Same eval code
    const evalCode = () => {
      const opts = sel => [...(document.querySelector(sel)?.options || [])].map(o => ({ value: o.value, text: o.text.trim(), selected: o.selected }));
      const series = opts('#serie').map(o => {
        const m = o.text.match(/^(.*?)\s*\(\s*nr\.\s*(\d+)\s*\)\s*$/i);
        return { name: m ? m[1].trim() : o.text, next: m ? Number(m[2]) : null, value: o.value, selected: o.selected };
      });
      const cifEl = document.querySelector('#company_cifs');
      return {
        cifs: cifEl ? opts('#company_cifs').map(o => o.text) : [],
        series,
        vat: opts('#vat_code').map(o => o.text),
        currencies: opts('#currency').map(o => o.text.split(' ')[0]),
        issuer: document.querySelector('#issuer')?.value || null,
        eFacturaFields: [...document.querySelectorAll('[id^="id-additional-field-"]')].map(e => e.id.replace('id-additional-field-', ''))
      };
    };
    
    // Simulate single-company SmartBill account (no #company_cifs)
    const mockDocument = {
      querySelector: (sel) => {
        if (sel === '#company_cifs') return null; // Single-company: selector doesn't exist
        if (sel === '#serie') return { options: [{ value: 's1', text: 'TST (nr. 100)', selected: true }] };
        if (sel === '#vat_code') return { options: [{ value: 'v1', text: '19 %', selected: true }] };
        if (sel === '#currency') return { options: [{ value: 'c1', text: 'RON', selected: true }] };
        if (sel === '#issuer') return { value: 'John Doe' };
        return null;
      },
      querySelectorAll: () => []
    };
    
    global.document = mockDocument;
    const result = evalCode();
    delete global.document;
    
    assert(Array.isArray(result.cifs) && result.cifs.length === 0, `cifs: ${JSON.stringify(result.cifs)}`);
    assert(result.series.length === 1, `series: ${JSON.stringify(result.series)}`);
    return 'empty CIF array (single-company account)';
  });

  const fails = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - fails}/${results.length} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
