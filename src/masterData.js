'use strict';
const { wf, af, mv } = require('./fsx');
/**
 * Carrefour-specific SmartBill master data, so the e-Factura looks like the DocProcess one in SPV.
 * Dry-run by default (reads + backup + plan). With apply=true each write is unlocked in the Guard ONLY for its exact
 * endpoint; deletes / SPV / e-mail stay hard-blocked. Every run writes a JSON backup of the "before" state.
 *  1. delivery addresses of the Carrefour client: name = store name only (GLN only in "Identif. loc livrare", BT-71)
 *  2. store delivery address for the order (added if missing)
 *  3. Carrefour-only unit name (default "PCE") mapped to UNECE XPP; "buc" stays H87
 *  4. company phone / e-mail (BT-42/BT-43) when given
 *  5. bank accounts shown on documents (BT-84) when given
 */
const fs = require('fs'); const path = require('path');
const { openSession, dismissCookies } = require('./smartbillWeb');
const BASE = 'https://cloud.smartbill.ro';
const stripGln = d => String(d || '').replace(/\s*GLN\s*\d{8,14}\s*$/i, '').trim();

async function ajax(page, url, data) {
  return page.evaluate(async ([u, d]) => new Promise(res => window.$.ajax({ url: u, dataType: 'json', type: 'POST', cache: false, data: d })
    .done(r => res(r)).fail(x => res({ fail: x.status, text: String(x.responseText || '').slice(0, 400) }))), [url, data]);
}

async function readState(page, clientId) {
  const st = {};
  st.deliveryAddresses = (await ajax(page, '/nomenclator/delivery-addresses/get-list/', { clientId })).addresses || [];
  st.mappedUnits = (await ajax(page, '/nomenclator/measuring-units/get-mapped-units/', {})).result || [];
  await page.goto(`${BASE}/core/configurare/date-firma/`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3000);
  st.company = await page.evaluate(() => Object.fromEntries(['name', 'cif', 'reg_com', 'phone', 'email', 'capital', 'additional_data'].map(k => [k, document.querySelector('#id_' + k)?.value ?? null])));
  await page.goto(`${BASE}/core/configurare/conturi-bancare/`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3000);
  st.bankAccounts = await page.evaluate(() => [...document.querySelectorAll('table tbody tr')].map(r => ({ text: r.innerText.replace(/\s+/g, ' ').trim(),
    iban: (r.innerText.match(/RO\d{2}[A-Z]{4}[0-9A-Z]{16}/) || [])[0] || null, cb: r.querySelector('input[type=checkbox]')?.id || null, shown: !!r.querySelector('input[type=checkbox]')?.checked })).filter(x => x.iban));
  return st;
}

async function run(profile, opts = {}) {
  const { apply = false, store = null, unit = 'PCE', phone = null, email = null, banks = [], log = console.log } = opts;
  const cf = JSON.parse(fs.readFileSync(path.join(profile.root, 'data/carrefour.json'), 'utf8'));
  const out = path.join(profile.dirs.out, 'masterdata', String(Date.now())); fs.mkdirSync(out, { recursive: true });
  const s = await openSession({ profile, log }); const page = s.page; const g = s.guard; const res = { out, apply, changes: [] };
  const goIssue = async () => { await page.goto(`${BASE}/documente/emitere/factura/`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(4000); await page.waitForFunction(() => window.$ && window.$.ajax, null, { timeout: 30000 }); await dismissCookies(page); };
  const unlock = async (re, fn) => { g.writeRe = re; try { return await fn(); } finally { g.writeRe = null; } };
  try {
    await goIssue();
    const cl = await ajax(page, '/core/get_clients/', { search_term: cf.client.cif.replace(/^RO/i, '') }).catch(() => null);
    const discF = path.join(profile.dirs.out, 'discovered-smartbill.json'); const discId = fs.existsSync(discF) ? Number(((JSON.parse(fs.readFileSync(discF, 'utf8')).carrefourClients || [])[0] || {}).raw?.col7) : null;
    const clientId = opts.clientId || profile.cfg.smartbill?.carrefourClientId || discId || ((cl && (cl.clients || cl.result || [])).find?.(c => JSON.stringify(c).includes(String(cf.client.cif).replace(/\D/g, ''))) || {}).id;
    if (!clientId) throw new Error('Nu gasesc clientul Carrefour in SmartBill (seteaza smartbill.carrefourClientId in profil).');
    await goIssue(); const before = await readState(page, clientId); before.clientId = clientId;
    wf(path.join(out, 'backup-before.json'), JSON.stringify(before, null, 2)); res.backup = path.join(out, 'backup-before.json');

    const plan = [];
    for (const a of before.deliveryAddresses) if (stripGln(a.description) !== a.description) plan.push({ kind: 'rename-address', id: a.id, from: a.description, to: stripGln(a.description) });
    if (store && !before.deliveryAddresses.some(a => a.locationId === store.gln)) plan.push({ kind: 'add-address', store });
    const CODE = cf.unitCode || 'XPP';
    if (unit && !before.mappedUnits.some(m => m.mu === unit && m.mapping === CODE)) plan.push({ kind: 'map-unit', mu: unit, mapping: CODE, from: (before.mappedUnits.find(m => m.mu === unit) || {}).mapping || null });
    if (phone && before.company.phone !== phone) plan.push({ kind: 'company-phone', from: before.company.phone, to: phone });
    if (email && before.company.email !== email) plan.push({ kind: 'company-email', from: before.company.email, to: email });
    for (const b of banks) { const ex = before.bankAccounts.find(x => x.iban === b.iban); if (!ex) plan.push({ kind: 'add-bank', ...b }); else if (!ex.shown) plan.push({ kind: 'show-bank', iban: b.iban, cb: ex.cb }); }
    res.plan = plan; log(`Plan (${apply ? 'APLIC' : 'doar citire'}):\n` + plan.map(p => ' - ' + JSON.stringify(p)).join('\n'));
    if (!apply) return res;

    await goIssue();
    for (const p of plan.filter(p => p.kind === 'rename-address')) {
      const a = { ...before.deliveryAddresses.find(x => x.id === p.id), description: p.to }; if (!a.contactPersonList?.length) delete a.contactPersonList;
      let r = await unlock(/^\/nomenclator\/delivery-addresses\/edit\/?$/, () => ajax(page, '/nomenclator/delivery-addresses/edit/', { deliveryAddress: JSON.stringify(a), clientId, warnBeforeExecution: true, updateDeliveryAddressOnRecurrency: false }));
      if (r && r.successfully && r.message === 'Recurrency exists.') r = await unlock(/^\/nomenclator\/delivery-addresses\/edit\/?$/, () => ajax(page, '/nomenclator/delivery-addresses/edit/', { deliveryAddress: JSON.stringify(a), clientId, warnBeforeExecution: false, updateDeliveryAddressOnRecurrency: false }));
      res.changes.push({ ...p, ok: !!(r && r.successfully), resp: r && (r.errorText || r.message || '') });
    }
    for (const p of plan.filter(p => p.kind === 'add-address')) {
      const st = p.store; const sector = (JSON.stringify(st).match(/Sector\s*\d/i) || [])[0];
      const a = { description: st.name, address: st.street || '', addressAdditionalInfo: '', addressLine3: '', country: 'Romania', county: st.county || 'Bucuresti',
        city: /bucuresti/i.test(st.city || '') && sector ? sector.replace(/\s+/, ' ') : (st.city || ''), zipCode: st.zip || '', locationId: st.gln, locationType: '0088', locationTypeId: 1, defaultAddress: false };
      const r = await unlock(/^\/nomenclator\/delivery-addresses\/add\/?$/, () => ajax(page, '/nomenclator/delivery-addresses/add/', { deliveryAddress: JSON.stringify(a), clientId, warnBeforeExecution: true, updateDeliveryAddressOnRecurrency: false }));
      res.changes.push({ kind: p.kind, sent: a, ok: !!(r && r.successfully), resp: r && (r.errorText || r.message || ''), created: r && r.clientDeliveryAddress });
    }
    for (const p of plan.filter(p => p.kind === 'map-unit')) {
      const r = await unlock(/^\/nomenclator\/measuring-units\/save-mu-mapping\/?$/, () => ajax(page, '/nomenclator/measuring-units/save-mu-mapping/', { mu: p.mu, mapping: p.mapping }));
      res.changes.push({ ...p, ok: !!(r && r.successfully), resp: r && (r.errorText || '') });
    }
    const cp = plan.filter(p => /^company-/.test(p.kind));
    if (cp.length) {
      await page.goto(`${BASE}/core/configurare/date-firma/`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3000); await dismissCookies(page);
      for (const p of cp) await page.fill(p.kind === 'company-phone' ? '#id_phone' : '#id_email', p.to);
      // SmartBill first asks /core/otp-code-is-expired/ (read); if it wants an SMS code we STOP (never bypassed)
      await unlock(/^\/core\/(configurare\/date-firma|otp-code-is-expired)\/?$/, async () => { await page.click('#company-config-save'); await page.waitForTimeout(6000); });
      await page.screenshot({ path: path.join(out, 'date-firma-dupa-salvare.png'), fullPage: true });
      res.otp = await page.evaluate(() => [...document.querySelectorAll('.modal, .ui-dialog')].filter(m => m.offsetParent).map(m => m.innerText.replace(/\s+/g, ' ').trim().slice(0, 300)));
      await page.goto(`${BASE}/core/configurare/date-firma/`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3000);
      const now = await page.evaluate(() => ({ phone: document.querySelector('#id_phone')?.value, email: document.querySelector('#id_email')?.value }));
      for (const p of cp) res.changes.push({ ...p, ok: (p.kind === 'company-phone' ? now.phone : now.email) === p.to });
    }
    const bp = plan.filter(p => /-bank$/.test(p.kind));
    if (bp.length) {
      await page.goto(`${BASE}/core/configurare/conturi-bancare/`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3000); await dismissCookies(page);
      for (const p of bp.filter(p => p.kind === 'add-bank')) {
        await unlock(/^\/core\/(configurare\/conturi-bancare\/.*|get_banks?\/|otp-code-is-expired\/)$/, async () => {
          await page.fill('#id_iban', p.iban); await page.locator('#id_iban').blur(); await page.waitForTimeout(2000);
          await page.fill('#id_name', p.bank); await page.selectOption('#id_currency', { label: p.currency === 'EUR' ? 'EUR - Euro' : 'RON - Leu' });
          await page.click('#add_account_btn_id'); await page.waitForTimeout(6000); await page.screenshot({ path: path.join(out, 'cont-' + p.iban.slice(-6) + '.png'), fullPage: true });
          res.otpBank = await page.evaluate(() => [...document.querySelectorAll('.modal, .ui-dialog')].filter(m => m.offsetParent).map(m => m.innerText.replace(/\s+/g, ' ').trim().slice(0, 300)));
        });
        await page.goto(`${BASE}/core/configurare/conturi-bancare/`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3000);
        const row = await page.evaluate(iban => { const r = [...document.querySelectorAll('table tbody tr')].find(x => x.innerText.includes(iban)); return r ? { cb: r.querySelector('input[type=checkbox]')?.id, shown: !!r.querySelector('input[type=checkbox]')?.checked } : null; }, p.iban);
        res.changes.push({ ...p, ok: !!row, row });
        if (row && !row.shown && row.cb) bp.push({ kind: 'show-bank', iban: p.iban, cb: row.cb });
      }
      for (const p of bp.filter(p => p.kind === 'show-bank')) {
        await unlock(/^\/core\/(configurare\/conturi-bancare\/.*|otp-code-is-expired\/)$/, async () => { await page.locator('#' + p.cb).check({ force: true }); await page.waitForTimeout(4000); });
        await page.screenshot({ path: path.join(out, 'afisare-' + p.iban.slice(-6) + '.png'), fullPage: true });
        await dismissCookies(page);
        await page.goto(`${BASE}/core/configurare/conturi-bancare/`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3000);
        res.changes.push({ ...p, ok: await page.evaluate(id => !!document.getElementById(id)?.checked, p.cb) });
      }
    }
    await goIssue(); const after = await readState(page, clientId); wf(path.join(out, 'after.json'), JSON.stringify(after, null, 2)); res.after = path.join(out, 'after.json');
    return res;
  } finally {
    res.writes = g.writes.map(w => ({ m: w.method, u: w.url, post: (w.post || '').slice(0, 600) })); res.blocked = g.blocked.map(b => `${b.method} ${b.url}`);
    wf(path.join(out, 'result.json'), JSON.stringify(res, null, 2)); await s.browser.close();
  }
}
module.exports = { run, stripGln };

/** Read the e-Factura settings page (read-only) and return plain-Romanian warnings. */
async function readEfactura(page) {
  await page.goto(`${BASE}/core/configurare/e-factura/`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3500);
  const t = await page.evaluate(() => document.body.innerText);
  const r = { connected: /Conectat la SPV/i.test(t) && !/Neconectat/i.test(t), expires: (t.match(/expira in:\s*(\d{2}\/\d{2}\/\d{4})/i) || [])[1] || null,
    autoSend: /Trimiterea automata este activa/i.test(t) ? true : (/Activeaza trimiterea automata/i.test(t) ? false : null),
    when: (t.match(/Este configurata trimiterea automata[^\n]*/i) || [])[0] || null, warnings: [] };
  if (!r.connected) r.warnings.push('SmartBill NU este conectat la SPV (ANAF). Facturile pentru Carrefour trebuie sa ajunga in SPV: in SmartBill > Configurare > e-Factura > Conectare SPV.');
  if (r.expires) { const [d, m, y] = r.expires.split('/').map(Number); const days = Math.round((new Date(y, m - 1, d) - new Date()) / 864e5); if (days < 14) r.warnings.push(`Conectarea SmartBill la SPV expira in ${days} zile (${r.expires}). Prelungeste-o din SmartBill > Configurare > e-Factura.`); }
  if (r.autoSend === true) r.warnings.push(`Trimiterea automata in SPV este PORNITA in SmartBill: facturile emise pleaca singure la ANAF${r.when ? ' (' + r.when.replace(/^Este configurata /i, '') + ')' : ''}. Verifica fiecare factura inainte.`);
  if (r.autoSend === false) r.warnings.push('Trimiterea automata in SPV este OPRITA: dupa emitere, trimite tu factura in SPV din SmartBill (termen legal: 5 zile lucratoare).');
  return r;
}

/**
 * First-run setup for a new producer (called by `setup`, safe to re-run):
 *  - Carrefour-only unit name mapped to UNECE XPP (created if missing; a name the producer does not use elsewhere)
 *  - e-Factura settings check (read-only) with plain-Romanian warnings
 * Delivery addresses are created per store GLN on the first invoice for that store (fillInvoice).
 */
async function ensureForProducer(profile, { log = console.log, products = [] } = {}) {
  const s = await openSession({ profile, log: () => {} }); const page = s.page; const g = s.guard; const res = { warnings: [] };
  try {
    await page.goto(`${BASE}/documente/emitere/factura/`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(4000);
    await page.waitForFunction(() => window.$ && window.$.ajax, null, { timeout: 30000 });
    const mapped = (await ajax(page, '/nomenclator/measuring-units/get-mapped-units/', {})).result || [];
    const usedUms = new Set(products.map(p => String(p['U.M.'] || p.um || '').toUpperCase()).filter(Boolean));
    let unit = profile.cfg.smartbill?.carrefourUnit || null;
    const cfj = JSON.parse(fs.readFileSync(path.join(profile.root, 'data', 'carrefour.json'), 'utf8')); const CODE = cfj.unitCode || 'XPP';
    const KIT_UNITS = ['PCE', 'PCE CRF', 'CRF PCE']; // Carrefour-only unit names created by the kit (never the producer's own "buc")
    if (!unit) for (const cand of KIT_UNITS) { const m = mapped.find(x => x.mu.toUpperCase() === cand); if ((m && (m.mapping === CODE || m.mapping === 'XPP')) || (!m && !usedUms.has(cand))) { unit = cand; break; } }
    if (!unit) throw new Error('Nu gasesc un nume liber pentru unitatea de masura Carrefour (PCE).');
    const cur = mapped.find(x => x.mu === unit);
    if (!cur || cur.mapping !== CODE) {
      // only the kit's own Carrefour-only unit names are (re)mapped to the configured code (data/carrefour.json unitCode)
      if (cur && !(KIT_UNITS.includes(unit.toUpperCase()) && cur.mapping === 'XPP')) throw new Error(`Unitatea "${unit}" este deja mapata la ${cur.mapping} in SmartBill; alege alta (smartbill.carrefourUnit in profil).`);
      g.writeRe = /^\/nomenclator\/measuring-units\/save-mu-mapping\/?$/;
      const r = await ajax(page, '/nomenclator/measuring-units/save-mu-mapping/', { mu: unit, mapping: CODE }).finally(() => { g.writeRe = null; });
      if (!(r && r.successfully)) throw new Error('Nu am putut salva maparea unitatii ' + unit + ' -> ' + CODE + ': ' + JSON.stringify(r).slice(0, 200));
      res.unitCreated = !cur; res.unitRemapped = cur ? { from: cur.mapping, to: CODE } : null; log(`  Unitate Carrefour "${unit}" -> ${CODE} (cod e-Factura ${cur ? 'schimbat din ' + cur.mapping : 'creat'}) in SmartBill.`);
    } else log(`  Unitate Carrefour "${unit}" -> ${CODE}: exista deja.`);
    res.unit = unit;
    res.efactura = await readEfactura(page); res.warnings.push(...res.efactura.warnings);
  } finally { res.blocked = g.blocked.map(b => `${b.method} ${b.url}`); await s.browser.close(); }
  return res;
}
module.exports.readEfactura = readEfactura; module.exports.ensureForProducer = ensureForProducer;
