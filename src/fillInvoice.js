'use strict';
const { wf, af, mv } = require('./fsx');
/**
 * Completeaza factura Carrefour in SmartBill (web) cu campurile e-Factura, deterministic (Playwright, fara AI).
 * Implicit: DOAR completare + poza. Nicio cerere de scriere nu iese din browser (Guard).
 * --issue : emite factura (o singura data per comanda; verificare idempotenta in jurnalul local + raportul SmartBill).
 */
const fs = require('fs');
const path = require('path');
const { openSession, dismissCookies, firstVisible } = require('./smartbillWeb');
const { loadOrder } = require('./orderInput');
const { matchLine } = require('./productMatch');

const BASE = 'https://cloud.smartbill.ro';
const pad = n => String(n).padStart(2, '0');
const dmy = iso => { const [y, m, d] = String(iso).split('-'); return { d, m, y }; };
const todayIso = () => { const t = new Date(); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };
const addDays = (iso, n) => { const t = new Date(iso + 'T12:00:00'); t.setDate(t.getDate() + n); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };
const rnd15 = () => { let s = String(1 + Math.floor(Math.random() * 9)); while (s.length < 15) s += Math.floor(Math.random() * 10); return s; };

// Timeouts are generous for slower computers; KIT_SLOW=2 doubles them.
const SLOW = Math.max(1, Number(require('./testenv').hook('KIT_SLOW') || 1));
const T = ms => Math.round(ms * SLOW);
// "Brasov" matches "Brașov"/"Braşov"/"BRASOV" (Romanian diacritics, both comma and cedilla forms)
const roRe = (txt, { start = false } = {}) => new RegExp((start ? '^\\s*' : '') + String(txt).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  .replace(/a/gi, '[aăâAĂÂ]').replace(/i/gi, '[iîIÎ]').replace(/s/gi, '[sșşSȘŞ]').replace(/t/gi, '[tțţTȚŢ]').replace(/\s+/g, '[\\s-]*'), 'i');
/** Clear an input (works on macOS too: no Ctrl+A), type, pick the exact autocomplete item if one appears, blur, verify. */
async function setField(page, sel, text, { blurTo = '#quantity', pickExact = true, delay = 50 } = {}) {
  const el = page.locator(sel).first(); text = String(text);
  for (let attempt = 0; attempt < 2; attempt++) {
    await el.click(); await el.fill(''); await el.evaluate(e => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await el.pressSequentially(text, { delay }); await page.waitForTimeout(T(1200));
    if (pickExact) { const li = page.locator('ul.ui-autocomplete:visible li.ui-menu-item').filter({ hasText: new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) });
      if (await li.count()) { await li.first().click(); await page.waitForTimeout(T(600)); } }
    if (blurTo) { await page.locator(blurTo).click(); await page.waitForTimeout(T(600)); }
    const v = await el.inputValue(); if (v.trim() === text.trim()) return v;
  }
  return el.inputValue();
}

async function typeAndPick(page, input, text, liFilter, { timeout = 120000 } = {}) { timeout = T(timeout);
  const el = page.locator(input).first();
  await el.click(); await el.fill('');
  await el.pressSequentially(text, { delay: 40 });
  const li = page.locator('ul.ui-autocomplete:visible li.ui-menu-item').filter(liFilter).first();
  try {
    await li.waitFor({ state: 'visible', timeout });
  } catch (e) {
    throw new Error(`Timeout waiting for dropdown after typing "${text}" in ${input}. SmartBill slow or element not found (waited ${timeout}ms). Original: ${e.message}`);
  }
  await li.click();
  await page.waitForTimeout(1200);
}

/** Carrefour already sends SGR deposit as its own 0% line (GARANTIE PET/STICLA/SGR).
 *  Do NOT rely on SmartBill "Produs cu garantie SGR = Da" (that auto-adds a duplicate Garantie line). */
function isSgrDepositLine(l) {
  if (Number(l.vat) !== 0) return false;
  return /GARANTIE|SGR|\bPET\b|\bSTICLA\b|\bSTICL[AĂ]\b/i.test(String(l.name || '') + ' ' + String(l.carrefourCode || '') + ' ' + String(l.ean || ''));
}

/** Uncheck "Descarca gestiune" so free-text/SGR lines without stock can save as draft. */
async function disableStockDischarge(page, log) {
  const info = await page.evaluate(() => {
    const candidates = [
      ...document.querySelectorAll('input[type=checkbox][name*="descarca" i], input[type=checkbox][id*="descarca" i], input[type=checkbox][name*="gestiune" i], input[type=checkbox][id*="gestiune" i]'),
    ];
    // also match by nearby label text
    for (const inp of document.querySelectorAll('input[type=checkbox]')) {
      const lab = (inp.labels && inp.labels[0] && inp.labels[0].innerText) || '';
      const near = (inp.parentElement && inp.parentElement.innerText) || '';
      if (/descarc[aă].*gestiune|gestiune.*descarc/i.test(lab + ' ' + near)) candidates.push(inp);
    }
    const seen = new Set(); const out = [];
    for (const el of candidates) {
      if (!el || seen.has(el)) continue; seen.add(el);
      out.push({ id: el.id || null, name: el.name || null, checked: !!el.checked });
      if (el.checked) {
        el.checked = false;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof window.$ === 'function') try { window.$(el).prop('checked', false).trigger('change'); } catch {}
      }
    }
    return out;
  });
  if (info.length) log(`Descarcare gestiune: debifat pentru linii free-text/SGR (${info.map(x => (x.id || x.name || '?') + '=' + x.checked).join(', ')})`);
  else log('Descarcare gestiune: nu am gasit checkbox (salvez oricum; SmartBill poate cere stoc)');
  await page.waitForTimeout(T(400));
  return info;
}

/** Type Carrefour name as free-text invoice line (never saved to nomenclator; never enables auto-SGR). */
async function fillFreeTextProduct(page, l, i, result) {
  const pn = page.locator('#product_name');
  await pn.click(); await pn.fill('');
  await pn.pressSequentially(String(l.name), { delay: 30 });
  await page.waitForTimeout(T(1500));
  // Blur to dismiss autocomplete without picking a SmartBill product (avoids auto-SGR side effects)
  await page.locator('#quantity').click(); await page.waitForTimeout(T(500));
  if (!(await page.inputValue('#product_code')) && (l.ean || l.carrefourCode)) {
    await setField(page, '#product_code', String(l.ean || l.carrefourCode), { pickExact: false, blurTo: '#quantity' });
  }
  (result.freeTextLines = result.freeTextLines || []).push({ line: i + 1, name: l.name, code: await page.inputValue('#product_code'), sgrFallback: !!l._sgrFreeTextFallback });
}
async function setDate(page, prefix, iso) {
  const { d, m, y } = dmy(iso);
  for (const [k, val] of [['day', d], ['month', m], ['year', y]]) {
    const sel = prefix ? `#${prefix}_${k}` : `#${k}`;
    await page.locator(sel).fill(val); await page.locator(sel).dispatchEvent('change');
  }
  await page.keyboard.press('Escape').catch(() => {});
}
async function selectByText(page, sel, re) {
  const val = await page.$eval(sel, (s, src) => { const r = new RegExp(src, 'i'); const o = [...s.options].find(o => r.test(o.text.trim())); return o ? o.value : null; }, re.source);
  if (!val) { if (sel === '#vat_code') throw Object.assign(new Error(`Cota de TVA ceruta de comanda (${(re.source.match(/[\d.]+/) || ['?'])[0]}%) nu exista in SmartBill. Verifica cotele TVA in SmartBill (Configurare > Taxe) si comanda in portal.`), { code: 'NEEDS_HUMAN' });
    throw new Error(`optiunea ${re} nu exista in ${sel}`); }
  await page.selectOption(sel, val); await page.waitForTimeout(500);
  return val;
}
/** Select VAT rate with 0% SGR/SDD mapping: 0% lines -> "SGR" first, fallback "SDD", never bare "0%". */
async function selectVatCode(page, vatRate) {
  const rate = Number(vatRate);
  // For 0% (SGR deposit guarantee / packaging), map to SmartBill cota "SGR" first, fallback "SDD"
  if (rate === 0) {
    const opts = await page.$$eval('#vat_code option', opts => opts.map(o => ({ text: o.text, value: o.value })));
    const available = opts.map(o => o.text.trim());
    const availableValues = opts.map(o => String(o.value || '').trim());
    
    // DEBUG: Log all available options for 0% troubleshooting
    console.log('DEBUG selectVatCode: all #vat_code options:', JSON.stringify(opts.map(o => ({ t: o.text, v: o.value })), null, 2));
    
    // Try multiple SGR patterns: exact name, contains SGR, case-insensitive
    let sgr = available.find(t => /^SGR$/i.test(t.trim()));
    if (!sgr) sgr = available.find(t => /SGR/i.test(t));
    if (!sgr && availableValues.includes('SGR')) sgr = 'SGR'; // by value
    
    if (sgr) { 
      await selectByText(page, '#vat_code', new RegExp(sgr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')); 
      return `SGR (matched: ${sgr})`; 
    }
    
    // Fallback to SDD: try exact, contains, and common 0% exempt names
    let sdd = available.find(t => /^SDD$/i.test(t.trim()));
    if (!sdd) sdd = available.find(t => /SDD/i.test(t));
    if (!sdd) sdd = available.find(t => /scutit.*taxa|exempt/i.test(t) && /0\s*%/.test(t));
    if (!sdd && availableValues.includes('SDD')) sdd = 'SDD';
    
    if (sdd) { 
      await selectByText(page, '#vat_code', new RegExp(sdd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')); 
      return `SDD (matched: ${sdd})`; 
    }
    
    // Last resort: any 0% option
    const zero = available.find(t => /^0\s*%/i.test(t.trim()));
    if (zero) {
      console.log(`DEBUG: Using generic 0% option: "${zero}"`);
      await selectByText(page, '#vat_code', new RegExp(`^${zero.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
      return `0% (${zero})`;
    }
    
    // Neither SGR nor SDD exist: detailed error with actual options
    throw Object.assign(new Error(`Cota de TVA 0% (SGR/garanție returabilă) cerută de comandă nu există în SmartBill. Opțiuni disponibile: ${available.join(', ')}. Adaugă o cotă numită "SGR" la 0% / E - Scutit în SmartBill (Configurare > Cote TVA).`), { code: 'NEEDS_HUMAN', availableOptions: available });
  }
  // Non-zero rates: original logic (11%, 21%, etc. match by percentage text)
  await selectByText(page, '#vat_code', new RegExp(`^${vatRate}\\s*%$`));
  return `${vatRate}%`;
}

async function dismissNotices(page) {
  for (let i = 0; i < 3; i++) {
    const b = page.locator('.modal.in a, .modal.in button, .modal.show a, .modal.show button').filter({ hasText: /^\s*(Am inteles|Inchide|OK)\s*$/i }).first();
    if (!(await b.count()) || !(await b.isVisible().catch(() => false))) return;
    await b.click().catch(() => {}); await page.waitForTimeout(700);
  }
}

// Duplicate check, fail-closed. Local ledgers first, then the SmartBill invoice report from the order date to today
// (all pages). A Carrefour invoice whose mentions carry this order number blocks the run: issued -> duplicate,
// cancelled -> a human decides (never re-issued automatically), draft -> finish/delete the draft first.
/** Read the SmartBill invoice report (read-only, all pages) from fromIso to today -> Carrefour rows (text). */
const retryWait = (t, ra) => { const base = Number(require('./testenv').hook('KIT_RETRY_MS') || 20000); const sec = Number(ra); return Number.isFinite(sec) && sec > 0 ? Math.min(sec * 1000, 120000) : base * (t + 1) * 2; };
async function readInvoiceReport(page, profile, cf, fromIso) {
  const from = dmy(fromIso); const to = dmy(todayIso());
  // SmartBill busy (429 = too many requests, 5xx) or slow: wait and retry (max 3 tries); still failing -> RATE/NETWORK error
  // (nothing saved yet: auto/bulk stop the run WITHOUT counting it against the order, and retry at the next check)
  let resp = null;
  for (let t = 0; t < 3; t++) {
    const respP = page.waitForResponse(r => /\/raport\/facturi\/ajax\/?$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST', { timeout: 45000 }).catch(() => null);
    try { await page.goto(`${BASE}/raport/facturi/?startDate=${from.d}%2F${from.m}%2F${from.y}&endDate=${to.d}%2F${to.m}%2F${to.y}`, { waitUntil: 'domcontentloaded' }); }
    catch (e) { if (t === 2) throw Object.assign(new Error('SmartBill nu raspunde (raportul de facturi nu s-a deschis). Nu am salvat nimic.'), { code: 'NETWORK' }); await page.waitForTimeout(retryWait(t)); continue; }
    resp = await respP; if (resp && resp.ok()) break;
    if (resp && !(resp.status() === 429 || resp.status() >= 500)) break; // 4xx other than 429: not transient
    if (t < 2) await page.waitForTimeout(retryWait(t, resp && resp.headers()['retry-after']));
  }
  if (!resp) throw Object.assign(new Error('SmartBill nu a raspuns la timp (raportul de facturi, verificare anti-dublura). Nu am salvat nimic.'), { code: 'NETWORK' });
  if (resp.status() === 429) throw Object.assign(new Error('SmartBill cere sa incetinim (prea multe cereri, HTTP 429). Nu am salvat nimic.'), { code: 'RATE' });
  if (resp.status() >= 500) throw Object.assign(new Error(`SmartBill are o problema temporara (HTTP ${resp.status()}). Nu am salvat nimic.`), { code: 'NETWORK' });
  if (!resp.ok()) throw new Error('STOP: nu pot citi raportul de facturi din SmartBill (verificare anti-dublura).');
  let j; try { j = await resp.json(); } catch { throw new Error('STOP: raportul de facturi nu e JSON (verificare anti-dublura).'); }
  const body = resp.request().postData() || ''; let raw = j.aaData || [];
  const total = Number(j.iTotalDisplayRecords || j.iTotalRecords || raw.length);
  for (let startAt = raw.length; startAt < total && startAt < 20000; startAt += 500) {
    const b = body.replace(/iDisplayStart=\d+/, `iDisplayStart=${startAt}`).replace(/iDisplayLength=\d+/, 'iDisplayLength=500');
    let more = null, st = 0;
    for (let t = 0; t < 3 && !more; t++) {
      const r = await page.evaluate(bb => new Promise(res => window.$.ajax({ url: '/raport/facturi/ajax/', type: 'POST', data: bb, dataType: 'json', cache: false, timeout: 60000 }).done(d => res({ rows: d.aaData || [] })).fail(x => res({ status: x.status }))), b);
      if (r.rows) more = r.rows; else { st = r.status; if (!(st === 429 || st >= 500 || st === 0) || t === 2) break; await page.waitForTimeout(retryWait(t)); }
    }
    if (!more && (st === 429)) throw Object.assign(new Error('SmartBill cere sa incetinim (prea multe cereri, HTTP 429) la citirea raportului. Nu am salvat nimic.'), { code: 'RATE' });
    if (!more && (st >= 500 || st === 0)) throw Object.assign(new Error('SmartBill nu raspunde la citirea raportului de facturi. Nu am salvat nimic.'), { code: 'NETWORK' });
    if (!more) throw new Error('STOP: raportul de facturi nu s-a putut citi complet (verificare anti-dublura).');
    raw = raw.concat(more); if (!more.length) break;
  }
  const rows = raw.map(r => (Array.isArray(r) ? r : Object.values(r)).map(c => String(c && typeof c === 'object' ? JSON.stringify(c) : c ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()).join(' | '));
  wf(path.join(profile.dirs.out, `invoices-${from.y}${from.m}${from.d}-${to.y}${to.m}${to.d}.json`), JSON.stringify(rows, null, 2));
  const cif = String(cf.client.cif).replace(/\D/g, '');
  return rows.filter(r => r.includes(cif) || /CARREFOUR/i.test(r));
}
/** Which Carrefour orders already have an invoice / draft / cancelled invoice in SmartBill (by the "Comanda Carrefour: N" mention). */
function classify(rows, orderNo, series, netTotal = null, excludeDraftIds = []) {
  const n = String(orderNo).replace(/^0+/, '');
  const re = new RegExp(`Comanda Carrefour:\\s*0*${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9])`, 'i');
  const hits = rows.filter(r => re.test(r));
  // SmartBill drafts carry no mentions in the report: a Carrefour DRAFT with the same net total (+-0.05 lei) counts as this order's draft
  // (drafts already recorded for ANOTHER order with the same total are not counted: two orders can have the same total)
  if (!hits.length && netTotal != null) { const d = rows.find(r => /"is_draft": ?true/.test(r) && !excludeDraftIds.includes(String(r.split(' | ')[0]).trim()) && Math.abs(Number(r.split(' | ')[6]) - netTotal) <= 0.05);
    if (d) return { kind: 'draft', row: d, draftId: d.split(' | ')[0] }; }
  if (!hits.length) return null;
  const num = r => { const m = r.match(new RegExp(`\\b${String(series || '[A-Z]+').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:nr\\.?\\s*)?(\\d{1,10})\\b`)); return m ? `${series || ''} ${m[1]}`.trim() : null; };
  const ann = hits.filter(r => /"is_annulled": ?true/.test(r)); const dr = hits.filter(r => /"is_draft": ?true/.test(r)); const live = hits.filter(r => !ann.includes(r) && !dr.includes(r));
  if (live.length) return { kind: 'issued', number: num(live[0]), row: live[0] };
  if (dr.length) return { kind: 'draft', row: dr[0], draftId: String(dr[0].split(' | ')[0]).trim() || null };
  return { kind: 'cancelled', number: num(ann[0]), row: ann[0] };
}
async function alreadyIssued(page, profile, order, cf) {
  for (const f of ['issued.json', 'drafts.json']) {
    const file = path.join(profile.dirs.out, f); const L = require('./fsx').readLedger(file);
    const nzk = k => String(k).replace(/^0+/, ''); const k = Object.keys(L).find(x => nzk(x) === nzk(order.orderNo)); const e = k && L[k];
    // issued.json: ONLY "issued" means a final invoice. Any other state (draft-saved, draft-stopped, finalizing, finalize-unknown,
    // issued-unverified ...) = a run stopped half-way -> a person checks; never reported as "already invoiced".
    if (e && (e.status === 'pending' || e.status === 'unknown' || (f === 'issued.json' && e.status !== 'issued'))) return { kind: 'unclear', text: `Comanda ${order.orderNo}: o salvare anterioara in SmartBill s-a intrerupt sau e neclara (${f}, stare ${e.status}). Verifica in SmartBill (Facturi si Ciorne) daca exista deja factura/ciorna; nu continui automat.` };
    if (e && e.status !== 'pending' && e.status !== 'unknown') return f === 'issued.json'
      ? { kind: 'issued', text: `Comanda ${order.orderNo} este deja facturata: factura ${e.number || 'id ' + e.invoiceId}. Nu o mai completez.` }
      : { kind: 'draft', draftId: e.invoiceId ? String(e.invoiceId) : null, text: `Pentru comanda ${order.orderNo} exista deja o ciorna in SmartBill (id ${e.invoiceId}). Emite-o sau sterge-o din SmartBill > Rapoarte > Facturi > Filtrare > Ciorna.` };
  }
  const rows = await readInvoiceReport(page, profile, cf, order.orderDate && order.orderDate <= todayIso() ? addDays(order.orderDate, -1) : addDays(todayIso(), -30));
  const net = Math.round(order.lines.reduce((t, l) => t + Number(l.qty) * Number(l.price), 0) * 100) / 100;
  const others = []; for (const f of ['issued.json', 'drafts.json']) { const L = (() => { try { return JSON.parse(fs.readFileSync(path.join(profile.dirs.out, f), 'utf8')); } catch { return {}; } })();
    for (const [k, e] of Object.entries(L)) if (String(k).replace(/^0+/, '') !== String(order.orderNo).replace(/^0+/, '') && e && e.invoiceId) others.push(String(e.invoiceId)); }
  const c = classify(rows, order.orderNo, profile.cfg.smartbill?.series, net, others); if (!c) return null;
  if (c.kind === 'issued') return { kind: 'issued', text: `Comanda ${order.orderNo} este deja facturata in SmartBill: factura ${c.number || c.row.slice(0, 120)}. Nu o mai completez.` };
  if (c.kind === 'draft') return { kind: 'draft', draftId: c.draftId || null, text: `Pentru comanda ${order.orderNo} exista deja o ciorna in SmartBill${c.draftId ? ' (id ' + c.draftId + ', acelasi total)' : ''}. Emite-o sau sterge-o din SmartBill > Rapoarte > Facturi > Filtrare > Ciorna.` };
  return { kind: 'cancelled', text: `Factura ${c.number || ''} pentru comanda ${order.orderNo} a fost ANULATA in SmartBill; nu o refac automat (decide tu).` };
}

async function run(profile, opts = {}) {
  const { orderNo, orderFile, headed = false, log = console.log, draftOnly = false } = opts; const issue = !!opts.issue || draftOnly;
  const order = await loadOrder(profile, { orderNo, orderFile });
  const out = path.join(profile.dirs.out, 'fill', `${order.orderNo}-${Date.now()}`); fs.mkdirSync(out, { recursive: true });
  // rule: the invoice line name is ALWAYS the Carrefour portal description (BT-153), whatever older profiles say
  const cfg = { ...profile.cfg, smartbill: { ...(profile.cfg.smartbill || {}), carrefourLineName: true } }; const cf = JSON.parse(fs.readFileSync(path.join(profile.root, 'data/carrefour.json'), 'utf8'));
  const disc = path.join(profile.dirs.out, 'discovered-smartbill.json');
  let products = fs.existsSync(disc) ? JSON.parse(fs.readFileSync(disc, 'utf8')).products || [] : [];
  const pinned = Object.fromEntries((cfg.products || []).filter(p => p.smartbillId).map(p => [p.ean, p.smartbillId]));
  // already invoiced at Carrefour (portal shows an invoice number): refuse before opening SmartBill
  if (order.invoicedAtCarrefour && String(order.invoicedAtCarrefour).trim())
    throw Object.assign(new Error(`Comanda ${order.orderNo} este deja facturata (factura ${order.invoicedAtCarrefour} inregistrata in portalul Carrefour). Nu o mai completez.`), { code: 'DUPLICATE', kind: 'issued' });
  // a product added in SmartBill after setup: re-read the product list (read-only) when a line has no match
  if (order.lines.some(l => { const m = matchLine(l, products, pinned); return !m || m.ambiguous; })) {
    log('Recitesc lista de produse din SmartBill (doar citire)...');
    try { products = (await require('./discoverSmartbill').discoverSmartbill(profile, { log: () => {} })).products || products; } catch (e) { log('  nu am putut reciti produsele: ' + e.message.split('\n')[0]); }
  }
  // lines with quantity 0 (product refused/edited out by Carrefour) are not invoiced; units: pieces only, packages need a person
  const zero = order.lines.filter(l => !(Number(l.qty) > 0));
  if (zero.length) { log(`Atentie: ${zero.length} linii cu cantitate 0 nu se pun pe factura: ${zero.map(l => l.name).join(', ')}`); order.lines = order.lines.filter(l => Number(l.qty) > 0); }
  if (!order.lines.length) throw Object.assign(new Error(`Comanda ${order.orderNo} nu are nicio linie cu cantitate mai mare ca 0. Nu fac factura.`), { code: 'NEEDS_HUMAN' });
  const PIECE = /^(A|PCE|PCS|BUC|H87|C62|XPP|EA)$/i; // portal "A" = bucata (README: A->buc); kg/l/baxuri: a person checks
  const pack = order.lines.filter(l => l.unitCode && !PIECE.test(String(l.unitCode).trim()));
  if (pack.length) throw Object.assign(new Error(`Comanda ${order.orderNo} are cantitati in ${[...new Set(pack.map(l => l.unitCode))].join('/')} (baxuri/cutii?), nu in bucati: ${pack.map(l => l.name).join(', ')}. Verifica in portal cate bucati sunt; nu fac factura automat.`), { code: 'NEEDS_HUMAN' });
  if (order.lines.some(l => l.vat == null || !(Number(l.price) > 0))) throw Object.assign(new Error(`Comanda ${order.orderNo} are linii fara pret sau fara cota TVA in portal. Nu fac factura automat.`), { code: 'NEEDS_HUMAN' });
  if (!cfg.smartbill?.series) throw Object.assign(new Error('Nu e aleasa seria de factura. Alege optiunea 6 (Configurare).'), { code: 'CONFIG' });
  const plan = { order, issueDate: todayIso(), dueDate: addDays(todayIso(), cfg.smartbill?.dueDays || 7), series: cfg.smartbill?.series,
    despatchId: order.despatchId || rnd15(), clientCif: cf.client.cif, lines: [] };
  for (const l of order.lines) {
    const m = matchLine(l, products, pinned);
    // no (unique) product in the SmartBill list: with carrefourLineName the line is typed as free text (never saved to the list)
    if ((!m || m.ambiguous) && cfg.smartbill?.carrefourLineName && l.name && l.vat != null && l.price != null) { plan.lines.push({ ...l, smartbill: null, freeText: true }); continue; }
    if (!m || m.ambiguous) throw Object.assign(new Error(`Produsul "${l.name}" (EAN ${l.ean}) ${m ? 'se potriveste cu mai multe produse din SmartBill: ' + m.ambiguous.join('; ') : 'nu exista in lista de produse SmartBill'}. Adauga-l in SmartBill (Nomenclatoare > Produse) cu acelasi cod EAN, apoi incearca din nou.`), { code: 'NEEDS_HUMAN' });
    plan.lines.push({ ...l, smartbill: m });
  }
  // automat/--issue: a line without a SmartBill product is never ISSUED unattended (free text needs a person's eye); drafts are fine
  if (opts.issue && !draftOnly && plan.lines.some(l => l.freeText) && !cfg.auto?.allowFreeText)
    throw Object.assign(new Error(`Comanda ${order.orderNo} are produse care nu sunt in lista SmartBill: ${plan.lines.filter(l => l.freeText).map(l => `"${l.name}" (EAN ${l.ean || '-'})`).join(', ')}. Nu emit factura automat. Adauga produsul in SmartBill (Nomenclatoare > Produse) cu acelasi cod EAN, sau fa o ciorna (optiunea 2) si verific-o.`), { code: 'NEEDS_HUMAN' });
  wf(path.join(out, 'plan.json'), JSON.stringify(plan, null, 2));
  log(`Plan: comanda ${order.orderNo}, magazin ${order.store.name} GLN ${order.store.gln}, ${plan.lines.length} linii, serie ${plan.series}, aviz ${plan.despatchId}`);

  const s = await openSession({ profile, headless: !headed, log });
  const page = s.page; page.__guard = s.guard; const shot = async n => { const f = path.join(out, `${n}.png`); await page.screenshot({ path: f, fullPage: true }); return f; };
  const result = { out, plan: path.join(out, 'plan.json'), mode: issue ? 'issue' : 'fill-only' };
  try {
    { const dup = await alreadyIssued(page, profile, order, cf); result.duplicateCheck = dup || 'ok'; if (dup) throw Object.assign(new Error(dup.text), { code: dup.kind === 'unclear' ? 'NEEDS_HUMAN' : 'DUPLICATE', kind: dup.kind, draftId: dup.draftId || null }); }
    await page.goto(`${BASE}/documente/emitere/factura/`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await page.waitForTimeout(7000); await dismissCookies(page);

    // header
    // company CIF selector: optional (SmartBill UI may not show it for single-company accounts)
    if (cfg.company?.cif) {
      const hasCifSelector = await page.locator('#company_cifs').count().catch(() => 0);
      if (hasCifSelector) { await selectByText(page, '#company_cifs', new RegExp(`^${cfg.company.cif}$`)); result.companyCifSelected = true; }
      else result.companyCifSelector = 'not-found-skipped';
    }
    await typeAndPick(page, '#client_name', cf.client.cif.replace(/^RO/i, ''), { hasText: cf.client.cif.replace(/^RO/i, '') });
    await page.waitForTimeout(2500);
    await setDate(page, '', plan.issueDate);
    // due date typed directly (choosing "7 zile" in the list pops a "default term for this client" notice)
    await setDate(page, 'due', plan.dueDate);
    await dismissNotices(page);

    // delivery address = store, with "Identif. loc livrare" = GLN (BT-71)
    await dismissNotices(page);
    // BT-70 = store name only; the GLN goes ONLY in "Identif. loc livrare" (BT-71), like DocProcess
    const label = order.store.name;
    const known = await page.evaluate(async ([cid, gln]) => new Promise(res => window.$.ajax({ url: '/nomenclator/delivery-addresses/get-list/', dataType: 'json', type: 'POST', cache: false, data: { clientId: cid } })
      .done(r => res((r.addresses || []).filter(a => a.locationId === gln && !a.isDeleted))).fail(() => res([]))), [cfg.smartbill?.carrefourClientId || Number(((fs.existsSync(disc) ? JSON.parse(fs.readFileSync(disc, 'utf8')).carrefourClients : [])[0] || {}).raw?.col7) || 0, order.store.gln]).catch(() => []);
    result.knownAddresses = known.map(a => ({ id: a.id, description: a.description, locationId: a.locationId }));
    await page.click('#client_delivery_address_input'); await page.waitForTimeout(1500);
    if (known[0]) { await page.locator('#client_delivery_address_input').pressSequentially(known[0].description.slice(0, 18), { delay: 50 }); await page.waitForTimeout(2500); }
    result.addressItems = await page.evaluate(() => [...document.querySelectorAll('ul.ui-autocomplete li')].filter(e => e.offsetParent).map(e => e.innerText.replace(/\s+/g, ' ').trim()).slice(0, 10));
    const streetRe = new RegExp(String(order.store.street || order.store.gln).slice(0, 12).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    let existing = page.locator('ul.ui-autocomplete:visible li.ui-menu-item').filter({ hasText: order.store.gln });
    if (!(await existing.count()) && known[0]) existing = page.locator('ul.ui-autocomplete:visible li.ui-menu-item').filter({ hasText: known[0].description }).filter({ hasText: String(known[0].address || '').slice(0, 10) });
    if (!(await existing.count())) existing = page.locator('ul.ui-autocomplete:visible li.ui-menu-item').filter({ hasText: streetRe });
    if (await existing.count()) { await existing.first().click(); result.deliveryAddress = 'existenta'; }
    else if (known[0]) {
      // the address list does not appear in the dropdown: select the known address with SmartBill's own setter (same call it makes after "Adauga")
      await page.keyboard.press('Escape').catch(() => {});
      const ok = await page.evaluate(a => { try { window.SmartBill.require('js/src/issuing/delivery-address/utils').setDeliveryAddress(a); return true; } catch (e) { return String(e); } }, known[0]);
      await page.waitForTimeout(1200);
      const sel = await page.evaluate(() => { try { return window.SmartBill.require('js/src/issuing/delivery-address/utils').getSelectedDeliveryAddrId(); } catch (e) { return null; } });
      if (ok !== true || String(sel) !== String(known[0].id)) throw new Error(`Adresa de livrare existenta nu s-a putut selecta (${ok}, selectat=${sel})`);
      result.deliveryAddress = `existenta (id ${sel}: ${known[0].description})`;
    }
    else {
      await page.locator('ul.ui-autocomplete:visible li.client-add-new').first().click(); await page.waitForTimeout(2000);
      await page.fill('#mida-name', label);
      await page.fill('#mida-address', order.store.street || order.store.name);
      const rawCity = order.store.city || ''; const sector = (order.store.rawCity || '').match(/Sector\s*\d/i) || (JSON.stringify(order.store).match(/Sector\s*\d/i));
      const county = order.store.county || (/bucuresti/i.test(rawCity) ? 'Bucuresti' : null);
      if (county) await typeAndPick(page, '#mida-county-input', county, { hasText: roRe(county) }).catch(e => { log('judet: ' + e.message.split('\n')[0]); });
      const cityQ = /bucuresti/i.test(rawCity) && sector ? sector[0].replace(/\s+/, ' ') : rawCity;
      // city: type the first letters only (diacritics differ), pick the item matching the full name; retry with a shorter query
      let cityOk = false;
      for (const q of [cityQ, cityQ.slice(0, 4)]) { if (cityOk || !q) continue;
        cityOk = await typeAndPick(page, '#mida-city-input', q, { hasText: roRe(cityQ, { start: true }) }).then(() => true).catch(() => false); }
      if (!cityOk) { await page.fill('#mida-city-input', cityQ); result.cityWarning = `localitatea "${cityQ}" nu a aparut in lista SmartBill; scrisa direct`; }
      result.city = await page.inputValue('#mida-city-input').catch(() => null); result.county = await page.inputValue('#mida-county-input').catch(() => null);
      await page.fill('#mida-location-id', order.store.gln);
      await typeAndPick(page, '#mida-location-type-id-input', '0088', { hasText: '0088' }).catch(e => log('tip GLN: ' + e.message.split('\n')[0]));
      await shot('10-adresa-livrare');
      if (issue) {
        s.guard.writeRe = /^\/nomenclator\/delivery-addresses\/[a-z_-]+\/?$/i;
        await page.locator('.modal:visible a.btn-primary', { hasText: 'Adauga' }).first().click(); await page.waitForTimeout(3500);
        s.guard.writeRe = null;
        const cur = await page.inputValue('#client_delivery_address_input').catch(() => '');
        const streetKey = String(order.store.street || '').slice(0, 12);
        if (!(cur.includes(order.store.gln) || cur.includes(order.store.name) || (streetKey && cur.toUpperCase().includes(streetKey.toUpperCase())))) throw new Error(`Adresa de livrare nu s-a selectat dupa adaugare (acum: "${cur}")`);
        result.deliveryAddress = 'adaugata la clientul Carrefour';
      } else { await page.locator('.modal:visible a.btn-secondary', { hasText: 'Renunta' }).first().click(); result.deliveryAddress = 'NEADAUGATA (fill-only: ar fi adaugata la emitere)'; }
    }

    // series (set after client/address: picking the client can reset it), then verify
    const serRe = new RegExp(`^${plan.series.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`);
    { const all = await page.$$eval('#serie option', os => os.map(o => o.text.trim()));
      if (!all.some(x => serRe.test(x))) throw Object.assign(new Error(`Seria "${plan.series}" aleasa la configurare nu mai exista in SmartBill (acum exista: ${all.map(x => x.replace(/\s*\(.*$/, '')).join(', ') || 'niciuna'}). Alege optiunea 6 (Configurare) si alege seria din nou.`), { code: 'CONFIG' }); }
    for (let i = 0; i < 3; i++) {
      await selectByText(page, '#serie', serRe); await page.locator('#serie').dispatchEvent('change'); await page.waitForTimeout(1200); await dismissNotices(page);
      const cur = await page.$eval('#serie', e => e.selectedOptions[0]?.text.trim());
      if (serRe.test(cur)) { result.series = cur;
        // refresh the visible dropdown widget too, so the preview/screenshot shows the chosen series (the form posts #serie)
        result.seriesShown = await page.evaluate(() => { const s = document.querySelector('#serie'); [...s.options].forEach(o => { o.defaultSelected = o.selected; }); // screenshots show the 'selected' attribute
          return s.selectedOptions[0]?.text.trim() || null; }).catch(() => null);
        break; }
      if (i === 2) throw new Error(`Seria nu se poate selecta (acum: ${cur})`);
    }

    // BT-13, BT-16, delivery date
    await page.fill('#id-additional-field-acquisitionOrderNr', String(order.orderNo));
    await page.fill('#aviz', String(plan.despatchId));
    // BT-46 buyer identifier (Identificator cumparator) = Carrefour trade register number
    if (cf.client.regCom && await page.locator('#id-additional-field-buyerId').count()) await page.fill('#id-additional-field-buyerId', cf.client.regCom).catch(e => log('BT-46: ' + e.message.split('\n')[0]));
    // order no., store GLN and despatch advice also as visible text (BT-22 note) so they show in the ANAF render
    plan.mentions = `Comanda Carrefour: ${order.orderNo} | GLN livrare: ${order.store.gln} | Aviz: ${plan.despatchId}`;
    { const cur = (await page.inputValue('#mentions').catch(() => '')).trim(); await page.fill('#mentions', cur && !cur.includes(plan.mentions) ? `${plan.mentions}\n${cur}` : plan.mentions); result.mentions = await page.inputValue('#mentions'); }
    if (order.deliveryDate) { if (!(await page.isChecked('#deliveryDateCB'))) await page.check('#deliveryDateCB'); await setDate(page, 'delivery', order.deliveryDate); }

    // lines
    // SGR deposit lines (GARANTIE PET/STICLA at 0%): Carrefour already sent them. Prefer pick from nomenclator;
    // if autocomplete times out, fall back to free-text + cota "0 % - SGR". Never enable SmartBill auto-SGR.
    for (const [i, l] of plan.lines.entries()) {
      const sgrLine = isSgrDepositLine(l);
      if (l.freeText) {
        await fillFreeTextProduct(page, l, i, result);
      } else {
        const id = l.smartbill.id;
        const pickText = (l.smartbill.name || l.name).split(' ').slice(0, 4).join(' ');
        const pickTimeout = sgrLine ? 25000 : 120000; // fail fast on SGR so free-text can take over
        try {
          await typeAndPick(page, '#product_name', pickText, { has: page.locator(`xpath=self::li[@id="${id}"]`) }, { timeout: pickTimeout });
        } catch (pickErr) {
          if (!sgrLine) throw pickErr;
          log(`SGR linie ${i + 1} (${l.name}): autocomplete timeout/fail -> free-text + cota 0% SGR. (${String(pickErr.message || pickErr).split('\n')[0]})`);
          await page.keyboard.press('Escape').catch(() => {});
          l._sgrFreeTextFallback = true;
          l.freeText = true; // nomenclature gate: treat as free-text (add_product=false)
          await fillFreeTextProduct(page, l, i, result);
          (result.sgrFreeTextFallback = result.sgrFreeTextFallback || []).push({ line: i + 1, name: l.name, reason: String(pickErr.message || pickErr).split('\n')[0] });
        }
      }
      await page.fill('#quantity', String(l.qty));
      await page.fill('#price', String(l.price));
      const selectedVat = await selectVatCode(page, l.vat);
      await page.check('#is_vat_included_no');
      (result.vatMapping = result.vatMapping || []).push({ line: i + 1, requested: l.vat, selected: selectedVat, sgrDeposit: sgrLine, freeTextFallback: !!l._sgrFreeTextFallback });
      const bt156 = page.locator('#id-product-additional-field-buyersItemIdentification');
      if (!(await bt156.isVisible())) { await page.locator('xpath=//*[normalize-space(text())="DETALII PRODUS"]/ancestor::*[contains(@class,"row") or contains(@class,"flex")][1]//*[contains(@class,"edit") or contains(@class,"pencil") or contains(@class,"pen")]').first().click(); await page.waitForTimeout(800); }
      await bt156.fill(String(l.carrefourCode || ''));
      await page.fill('#id-product-additional-field-standardItemIdentifier', String(l.ean || ''));
      if (l.ean) await typeAndPick(page, '#id-product-additional-field-standardItemIdentifierTypeId', '0160', { hasText: '0160' }).catch(e => log('tip EAN: ' + e.message.split('\n')[0]));
      result.lineDescription = result.lineDescription || [];
      // BT-154 item description = Carrefour product name (line only; the product itself is not renamed)
      try {
        const before = await page.inputValue('#product_description');
        await page.evaluate(v => { const e = document.querySelector('#product_description'); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, cfg.smartbill?.carrefourLineName ? '' : String(l.name || ''));
        result.lineDescription.push({ line: i + 1, before, now: await page.inputValue('#product_description') });
      } catch (e) { result.lineDescription.push({ line: i + 1, error: e.message.split('\n')[0] }); }
      // Carrefour-only unit (mapped to UNECE XPP in SmartBill; "buc" stays H87 for everybody else)
      if (cfg.smartbill?.carrefourUnit) { const v = await setField(page, '#measuring_unit', cfg.smartbill.carrefourUnit, { blurTo: '#quantity' });
        if (v !== cfg.smartbill.carrefourUnit) throw new Error(`U.M. nu s-a putut seta: este "${v}", trebuia "${cfg.smartbill.carrefourUnit}"`); }
      // supplier item code (BT-155) only when explicitly enabled; never saved to the product list (see nomenclature gate)
      if (cfg.smartbill?.useOrderSellerCode && l.sellerCode) { const pc = page.locator('#product_code'); await pc.click(); await pc.fill(''); await pc.pressSequentially(String(l.sellerCode), { delay: 60 }); await page.waitForTimeout(1500); await page.locator('#price').click(); await page.waitForTimeout(800);
        result.afterCode = { code: await pc.inputValue(), name: await page.inputValue('#product_name'), um: await page.inputValue('#measuring_unit'), price: await page.inputValue('#price'), desc: await page.inputValue('#product_description').catch(() => null),
          dialogs: await page.evaluate(() => [...document.querySelectorAll('.modal, .ui-dialog')].filter(m => m.offsetParent || getComputedStyle(m).display === 'block').map(m => m.innerText.replace(/\s+/g, ' ').trim().slice(0, 200))) }; }
      // BT-153 line name = Carrefour description, typed over the picked product's name ON THIS LINE ONLY.
      // The product itself is never renamed: the line is sent with add_product=false / id=null (see below + gate).
      if (cfg.smartbill?.carrefourLineName && l.name) {
        const pn = page.locator('#product_name'); await pn.click(); await pn.fill(''); await pn.pressSequentially(String(l.name), { delay: 40 }); await page.waitForTimeout(1500);
        await page.locator('#price').click(); await page.waitForTimeout(1000);
        result.afterName = { name: await pn.inputValue(), code: await page.inputValue('#product_code'), um: await page.inputValue('#measuring_unit'), price: await page.inputValue('#price'), vat: await page.$eval('#vat_code', e => e.selectedOptions[0]?.text.trim()).catch(() => null), bt156: await bt156.inputValue() };
        if (result.afterName.name !== String(l.name)) throw new Error(`Numele liniei nu s-a putut seta (${result.afterName.name})`);
        if (cfg.smartbill?.carrefourUnit && result.afterName.um !== cfg.smartbill.carrefourUnit) throw new Error('U.M. s-a schimbat dupa numele liniei: ' + JSON.stringify(result.afterName));
        if (String(result.afterName.price) !== String(l.price) && Number(result.afterName.price) !== Number(l.price)) throw new Error('Pretul s-a schimbat dupa numele liniei: ' + JSON.stringify(result.afterName));
      }
      await shot(`20-linie-${i + 1}-inainte-adauga`);
      await page.click('#add_product_btn'); await page.waitForTimeout(2000);
      (result.afterAdd = result.afterAdd || []).push({ line: i + 1, series: await page.$eval('#serie', e => e.selectedOptions[0]?.text.trim()).catch(() => null),
        dialogs: await page.evaluate(() => [...document.querySelectorAll('.modal, .ui-dialog, .swal2-popup, [role=dialog]')].filter(m => m.offsetParent || getComputedStyle(m).display === 'block').map(m => m.innerText.replace(/\s+/g, ' ').trim().slice(0, 300)).filter(Boolean)),
        rows: await page.evaluate(() => (window.products || []).length) });
      { const err = page.locator('.swal2-popup:visible, .modal:visible, .ui-dialog:visible').filter({ hasText: /Au aparut erori/i });
        if (await err.count()) { const t = (await err.first().innerText()).replace(/\s+/g, ' ').trim(); throw new Error(`SmartBill nu a adaugat linia ${i + 1} (${l.name}): ${t}`); } }
      // "Doresti sa salvezi produsul in Nomenclator?" -> always "Nu": the invoice line must never create/rename a product
      const ask = page.locator('.ui-dialog:visible').filter({ hasText: /Introducere in nomenclator/i });
      if (await ask.count()) { await ask.locator('button', { hasText: /^\s*Nu\s*$/ }).first().click(); await page.waitForTimeout(1200); (result.nomenclatorDialog = result.nomenclatorDialog || []).push({ line: i + 1, answered: 'Nu' }); }
    }
    // Same effect as answering "Nu" to SmartBill's "Doresti sa salvezi produsul in Nomenclator?": the line is invoiced as typed
    // (Carrefour unit / description / code) and is NEVER written to the product list (add_product=false, no product id).
    result.lineNomenclator = await page.evaluate(() => (window.products || []).map(p => { const was = { id: p.id, add_product: p.add_product }; if (!p.is_discount) { p.add_product = false; p.id = null; } return was; }));
    if (cfg.smartbill?.carrefourLineName) { const names = await page.evaluate(() => (window.products || []).map(p => p.product_name));
      plan.lines.forEach((l, i) => { if (names[i] !== l.name) throw new Error(`STOP: linia ${i + 1} are numele "${names[i]}" in loc de "${l.name}"`); }); }
    // nomenclature gate: no line may be saved into the product list with changed data
    result.lineState = await page.evaluate(() => (window.products || []).map(p => ({ name: p.product_name, um: p.measuring_unit, code: p.product_code, id: p.id, add_product: p.add_product, description: p.product_description })));
    for (const [i, st] of result.lineState.entries()) {
      const nom = plan.lines[i]?.smartbill || {}; const nomUm = nom['U.M.'] || 'buc'; const nomCode = nom.Cod ?? nom.code;
      if (st.add_product && (!st.id || st.um !== nomUm || (nomCode != null && String(st.code) !== String(nomCode)))) throw new Error(`STOP: linia ${i + 1} ar salva/modifica produsul in nomenclator (${JSON.stringify(st)})`);
    }
    result.seriesAtEnd = await page.$eval('#serie', e => e.selectedOptions[0]?.text.trim()).catch(() => null);
    if (!new RegExp(`^${plan.series.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`).test(result.seriesAtEnd || '')) throw new Error(`Seria s-a schimbat in ${result.seriesAtEnd}`);
    if (!(await page.evaluate(() => (window.products || []).length))) throw new Error('Nicio linie adaugata pe factura: ' + JSON.stringify(result.afterAdd));
    result.seriesWidgets = await page.evaluate(() => [...document.querySelectorAll('select')].filter(e => /seri/i.test(e.id + e.name)).map(e => ({ id: e.id, name: e.name, visible: !!e.offsetParent, text: e.selectedOptions[0]?.text.trim(), value: e.value,
      sib: (e.parentElement?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80), styled: [...(e.parentElement?.querySelectorAll('.select2-selection__rendered, .filter-option, button') || [])].map(x => x.innerText.trim()).slice(0, 3) })));
    result.filledShot = await shot('30-formular-completat');
    result.form = await page.evaluate(() => ({ rows: [...document.querySelectorAll('table tbody tr')].map(r => r.innerText.replace(/\s+/g, ' ').trim()).filter(t => /\d/.test(t)).slice(0, 20),
      totals: (document.body.innerText.match(/Total[^\n]{0,80}/gi) || []).slice(0, 8) }));

    // Free-text / SGR deposit lines have no stock in gestiune. SmartBill rejects save with:
    // "Nu ai facut nicio achizitie pentru produsul X... emite fara descarcare de gestiune."
    // Uncheck stock discharge before Spre salvare when any such line is present.
    if (plan.lines.some(l => l.freeText || isSgrDepositLine(l))) {
      result.descarcaGestiune = await disableStockDischarge(page, log);
    }

    if (opts.probeSave && !issue) {
      await page.click('#saveInvoiceBtn'); await page.waitForTimeout(4000); result.probeShot = await shot('40-dupa-spre-salvare-BLOCAT');
      result.probe = await page.evaluate(() => [...document.querySelectorAll('button, a.btn, .modal:not([style*="none"]) *')].filter(e => e.offsetParent && /btn/.test(e.className) && e.innerText.trim()).map(e => `${e.tagName}#${e.id} ${e.innerText.trim().slice(0, 60)} .${String(e.className).slice(0, 50)}`).slice(0, 60));
    }
    if (issue) result.issued = await issueNow(page, s, profile, order, shot, log, { draftOnly });
  } catch (e) {
    result.error = e.message.split('\n')[0];
    await shot('99-eroare').catch(() => {});
    result.openModals = await page.evaluate(() => [...document.querySelectorAll('.modal.in, .modal.show')].map(m => m.innerText.replace(/\s+/g, ' ').trim().slice(0, 600))).catch(() => []);
    throw e;
  } finally {
    result.guardBlocked = s.guard.blocked.map(b => `${b.method} ${b.url}`);
    wf(path.join(out, "guard-blocked.json"), JSON.stringify(s.guard.blocked, null, 2));
    wf(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
    await s.browser.close();
  }
  log(`Rezultat: ${path.join(out, 'result.json')}`);
  return result;
}

// Issue exactly once. A 'pending' ledger entry is written BEFORE the click, so a crash can never lead to a 2nd invoice.
// draftOnly: "Spre salvare" creates a DRAFT (ciorna, no definitive number, not sent to SPV), its XML is previewed, and we STOP:
// nothing is finalized; the draft is recorded in drafts.json (separate from the issue ledger). Drafts are never deleted by the kit.
/** Draft e-Factura XML must carry: order no., delivery GLN, each line Name (BT-153) EXACTLY = Carrefour portal description, unitCode = data/carrefour.json unitCode (XPP). */
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function checkDraftXml(x, order, unitCode = 'XPP') {
  const items = [...x.matchAll(/<cac:InvoiceLine\b[^>]*>([\s\S]*?)<\/cac:InvoiceLine>/g)].map(m => m[1]);
  const names = items.map(b => ((b.match(/<cac:Item>[\s\S]*?<cbc:Name>([^<]*)<\/cbc:Name>/) || [])[1] || '').trim());
  const units = items.map(b => (b.match(/<cbc:InvoicedQuantity[^>]*unitCode="([^"]+)"/) || [])[1] || null);
  const want = order.lines.map(l => xmlEsc(String(l.name).trim()));
  return { [String(order.orderNo).replace(/^0+/, '')]: x.includes(String(order.orderNo).replace(/^0+/, '')), [order.store.gln]: x.includes(String(order.store.gln)),
    [`linii=${want.length}`]: items.length === want.length, 'nume linie = descriere Carrefour (BT-153)': want.length > 0 && want.every(w => names.includes(w)),
    [`U.M. ${unitCode}`]: units.length > 0 && units.every(u => u === unitCode) };
}

const kerr = (code, msg, extra = {}) => Object.assign(new Error(msg), { code, ...extra });
// Indirection so the offline tests can replace the SmartBill-touching steps (XML preview, final save, report lookups) with mocks.
const D = { downloadXml: (...a) => downloadXml(...a), finalizeDraft: (...a) => finalizeDraft(...a), readReport: (...a) => readInvoiceReport(...a) };

async function issueNow(page, s, profile, order, shot, log, { draftOnly = false } = {}) {
  const ledgerFile = path.join(profile.dirs.out, draftOnly ? 'drafts.json' : 'issued.json');
  const { readLedger } = require('./fsx'); const nzk = k => String(k).replace(/^0+/, '');
  const L = readLedger(ledgerFile); const prevKey = Object.keys(L).find(k => nzk(k) === nzk(order.orderNo));
  if (prevKey) throw kerr('NEEDS_HUMAN', `STOP: comanda ${order.orderNo} figureaza deja in jurnalul ${path.basename(ledgerFile)} (stare ${L[prevKey].status}): o salvare anterioara s-a intrerupt sau e neclara. Verifica in SmartBill (Facturi si Ciorne); nu reincerc automat.`);
  // merge-save: re-read the file and replace ONLY this order, so a parallel run never loses entries
  const save = () => { const cur = readLedger(ledgerFile); cur[order.orderNo] = L[order.orderNo]; wf(ledgerFile, JSON.stringify(cur, null, 2)); };
  L[order.orderNo] = { status: 'pending', at: new Date().toISOString() }; save();
  const before = page.url();
  s.guard.writeRe = /^\/documente\/(emitere\/factura|validare_data)\/?$/i;
  const respP = page.waitForResponse(r => r.request().method() === 'POST' && /\/documente\/emitere\/factura\/?$/.test(new URL(r.url()).pathname), { timeout: 60000 }).catch(() => null);
  await page.click('#saveInvoiceBtn');
  const resp = await respP;
  let body = null; try { body = resp ? await resp.text() : null; } catch {}
  await page.waitForTimeout(6000);
  s.guard.writeRe = null;
  await dismissNotices(page);
  const after = page.url();
  const info = await page.evaluate(() => ({ title: document.title, h: (document.body.innerText.match(/Factura[^\n]{0,80}\d{3,}/g) || []).slice(0, 6),
    links: [...document.querySelectorAll('a, button')].filter(e => e.offsetParent).map(e => ({ t: (e.innerText || e.title || '').trim().replace(/\s+/g, ' ').slice(0, 60), h: e.getAttribute('href'), id: e.id || null })).filter(x => x.t).slice(0, 120) }));
  let jb = null; try { jb = JSON.parse(body || ''); } catch {}
  const m = jb && jb.id ? [null, String(jb.id)] : (after.match(/\/(?:raport|compact-view)\/factura\/(\d+)/) || (body || '').match(/factura\/(\d+)/) || []);
  const num = (info.title.match(/nr\.?\s*0*(\d+)/i) || [])[1] || null;
  const sbErr = jb && (jb.errorText || jb.message) ? String(jb.errorText || jb.message).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null;
  const rec = { status: jb && jb.successfully ? (jb.is_draft ? 'draft-saved' : 'issued') : 'unknown', at: new Date().toISOString(), httpStatus: resp ? resp.status() : null, invoiceId: m[1] || null, number: num, urlBefore: before, urlAfter: after,
    responseSnippet: (body || '').slice(0, 1500), smartbillError: sbErr || null, writes: s.guard.writes.map(w => `${w.method} ${w.url}`) };
  L[order.orderNo] = rec; save();
  rec.shot = await shot(draftOnly ? '50-ciorna-salvata' : '50-factura-emisa');
  wf(path.join(path.dirname(rec.shot), 'after-issue-page.json'), JSON.stringify(info, null, 2));
  wf(path.join(path.dirname(rec.shot), 'issue-post.txt'), (s.guard.writes.find(w => /emitere\/factura/.test(w.url)) || {}).post || '');
  log(`SALVAT: ${JSON.stringify({ status: rec.status, invoiceId: rec.invoiceId, smartbillError: sbErr || undefined })}`);
  if (draftOnly && rec.status !== 'draft-saved') { L[order.orderNo] = rec; save(); throw kerr('SAVE_UNKNOWN', `STOP: am apasat "Spre salvare" pentru comanda ${order.orderNo}, dar SmartBill nu a confirmat ciorna (stare ${rec.status}${rec.httpStatus ? ', HTTP ' + rec.httpStatus : ''}, id ${rec.invoiceId || '?'}${sbErr ? ': ' + sbErr : ''}). Verifica in SmartBill > Rapoarte > Facturi > Filtrare > Ciorna (si Facturi); nu reincerc automat.`, { invoiceId: rec.invoiceId }); }
  // AUTOMAT / --issue: the ONLY accepted path is "draft saved with an id" -> XML checks -> final save. Anything else = doubt -> stop.
  // The ledger entry stays, so the order is never saved again automatically (no retry of a save whose result is unknown).
  if (!draftOnly && !(rec.status === 'draft-saved' && rec.invoiceId)) {
    rec.status = rec.status === 'issued' ? 'issued-unchecked' : 'unknown'; rec.needsHuman = true; L[order.orderNo] = rec; save();
    throw kerr('SAVE_UNKNOWN', `STOP: dupa "Spre salvare" SmartBill nu a raspuns cu o ciorna verificabila (stare ${rec.status}, id ${rec.invoiceId || '?'}). Verifica in SmartBill (Facturi si Ciorne) comanda ${order.orderNo}; nu reincerc automat.`, { invoiceId: rec.invoiceId });
  }
  if (rec.status === 'draft-saved' && rec.invoiceId) {
    // preview the e-Factura XML of the DRAFT (read-only) and stop before finalizing if order no. / GLN / names / unit are wrong
    let pv = null; try { pv = await D.downloadXml(page, rec.invoiceId, path.dirname(rec.shot)); } catch (e) { pv = { xmlError: e.message.split('\n')[0] }; }
    rec.draftXml = pv.xml || pv.xmlError || null;
    if (pv.xml) { const x = fs.readFileSync(pv.xml, 'utf8'); const cfj = JSON.parse(fs.readFileSync(path.join(profile.root, 'data', 'carrefour.json'), 'utf8'));
      rec.draftXmlCheck = checkDraftXml(x, order, cfj.unitCode || 'XPP');
      if (Object.values(rec.draftXmlCheck).some(v => !v)) { rec.status = draftOnly ? 'draft-only' : 'draft-stopped'; L[order.orderNo] = rec; save(); throw kerr('NEEDS_HUMAN', 'STOP: XML-ul ciornei nu contine ' + JSON.stringify(rec.draftXmlCheck) + ' (ciorna ramane nefinalizata)'); } }
    if (draftOnly) { rec.status = 'draft-only'; L[order.orderNo] = rec; save(); log(`CIORNA (nefinalizata): id ${rec.invoiceId}; XML: ${rec.draftXml}`); return rec; }
    // automat: no XML, or SmartBill reports e-Factura validation errors -> do not finalize (a final invoice cannot be edited)
    if (!pv.xml || (Array.isArray(pv.xmlErrors) ? pv.xmlErrors.length : pv.xmlErrors)) {
      rec.status = 'draft-stopped'; rec.needsHuman = true; L[order.orderNo] = rec; save();
      throw kerr('NEEDS_HUMAN', `STOP: nu am putut verifica XML-ul ciornei ${rec.invoiceId} (${pv.xml ? 'erori e-Factura: ' + JSON.stringify(pv.xmlErrors).slice(0, 200) : rec.draftXml}). Ciorna ramane nefinalizata in SmartBill > Rapoarte > Facturi > Filtrare > Ciorna.`);
    }
    // race: another run / a person may have issued this order meanwhile -> re-read the report just before the final save
    let againRows; try { againRows = await D.readReport(page, profile, JSON.parse(fs.readFileSync(path.join(profile.root, 'data', 'carrefour.json'), 'utf8')), order.orderDate && order.orderDate <= todayIso() ? addDays(order.orderDate, -1) : addDays(todayIso(), -30)); }
    catch (e) { rec.status = 'draft-stopped'; rec.needsHuman = true; rec.recheckError = e.message.split('\n')[0]; L[order.orderNo] = rec; save();
      throw kerr('NEEDS_HUMAN', `STOP: ciorna ${rec.invoiceId} pentru comanda ${order.orderNo} e salvata, dar verificarea finala anti-dublura nu s-a putut face (${rec.recheckError}). Ciorna NU a fost finalizata; verific-o si emite-o tu din SmartBill > Rapoarte > Facturi > Filtrare > Ciorna.`, { invoiceId: rec.invoiceId }); }
    const again = classify(againRows || await D.readReport(page, profile, JSON.parse(fs.readFileSync(path.join(profile.root, 'data', 'carrefour.json'), 'utf8')), order.orderDate && order.orderDate <= todayIso() ? addDays(order.orderDate, -1) : addDays(todayIso(), -30)), order.orderNo, profile.cfg.smartbill?.series, null);
    if (again && again.kind !== 'draft') { rec.status = 'draft-stopped'; rec.needsHuman = true; L[order.orderNo] = rec; save(); throw kerr('DUPLICATE', `STOP: intre timp a aparut in SmartBill o factura ${again.kind} pentru comanda ${order.orderNo} (${again.number || ''}); ciorna ${rec.invoiceId} NU a fost finalizata.`, { kind: again.kind }); }
    if (require('./testenv').hook('KIT_STOP_BEFORE_FINAL') === '1') { rec.status = 'draft-stopped'; rec.stoppedBeforeFinal = true; L[order.orderNo] = rec; save(); throw kerr('STOP_BEFORE_FINAL', `Test: oprit inainte de "Salveaza" (ciorna ${rec.invoiceId}, XML verificat).`); }
    rec.status = 'finalizing'; L[order.orderNo] = rec; save();
    try { Object.assign(rec, await D.finalizeDraft(page, s, rec.invoiceId, shot, log)); }
    catch (e) { rec.status = 'finalize-unknown'; rec.needsHuman = true; rec.finalizeError = e.message.split('\n')[0]; L[order.orderNo] = rec; save();
      throw kerr('SAVE_UNKNOWN', `STOP: "Salveaza" pentru ciorna ${rec.invoiceId} (comanda ${order.orderNo}) nu s-a terminat clar: ${rec.finalizeError}. Verifica in SmartBill daca factura e emisa; nu reincerc automat.`, { invoiceId: rec.invoiceId }); }
    L[order.orderNo] = rec; save();
    // capture the definitive number BEFORE continuing: page title, else the SmartBill report (now carries the mention)
    if (rec.status === 'issued' && !rec.number) {
      try { const c = classify(await D.readReport(page, profile, JSON.parse(fs.readFileSync(path.join(profile.root, 'data', 'carrefour.json'), 'utf8')), addDays(todayIso(), -1)), order.orderNo, profile.cfg.smartbill?.series, null);
        if (c && c.kind === 'issued' && c.number) { rec.number = c.number; rec.numberFrom = 'raport'; } } catch (e) { rec.numberLookupError = e.message.split('\n')[0]; }
    }
    if (rec.status !== 'issued' || !rec.number) {
      rec.status = rec.status === 'issued' ? 'issued-unverified' : 'finalize-unknown'; rec.needsHuman = true; L[order.orderNo] = rec; save();
      throw kerr('SAVE_UNKNOWN', `STOP: dupa "Salveaza" nu pot confirma numarul facturii (ciorna/factura id ${rec.invoiceId}, stare ${rec.status}). Verifica in SmartBill; nu reincerc automat.`, { invoiceId: rec.invoiceId });
    }
  }
  L[order.orderNo] = rec; save();
  if (rec.status === 'issued' && rec.invoiceId) rec.files = await downloadDocs(page, rec.invoiceId, path.dirname(rec.shot), log);
  L[order.orderNo] = rec; save();
  return rec;
}

// "Spre salvare Factura" stores a DRAFT (ciorna, temporary number). The draft viewer's "Salveaza" finalizes it
// (definitive number). "Trimite email" / "Trimite e-Factura" are never clicked and are hard-blocked by the Guard.
async function finalizeDraft(page, s, id, shot, log) {
  await page.goto(`${BASE}/documente/compact-view/factura/${id}/`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(7000); await dismissCookies(page);
  const isDraft = async () => /\bCIORNA\b/.test(await page.evaluate(() => document.body.innerText));
  if (!(await isDraft())) { const e = new Error(`STOP: documentul ${id} nu (mai) apare ca CIORNA inainte de "Salveaza"; nu fac nimic.`); e.code = 'SAVE_UNKNOWN'; throw e; }
  else {
    await shot('45-ciorna-inainte-de-salvare');
    s.guard.writeRe = /^\/documente\//i; // hard blocks (spv/trimite/email/delete/anulare) still apply
    const respP = page.waitForResponse(r => r.request().method() === 'POST' && /^\/documente\//.test(new URL(r.url()).pathname) && !/validare_data/.test(r.url()), { timeout: 60000 }).catch(() => null);
    await page.click('#viewer_save_id');
    const resp = await respP; await page.waitForTimeout(8000); s.guard.writeRe = null;
    await dismissNotices(page);
    var finalizeResp = resp ? { url: resp.url(), status: resp.status(), body: (await resp.text().catch(() => '')).slice(0, 1500) } : null;
  }
  await page.goto(`${BASE}/documente/compact-view/factura/${id}/`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(7000);
  const title = await page.title(); const draft = await isDraft();
  const number = (title.match(/nr\.?\s*(\d+)/i) || [])[1] || null;
  const shotFile = await shot('55-factura-finalizata');
  log(`FINALIZAT: ${title} ciorna=${draft}`);
  return { status: draft ? 'draft-saved' : 'issued', number, title, finalizeResp, finalShot: shotFile, writes: s.guard.writes.map(w => `${w.method} ${w.url}`) };
}

async function downloadDocs(page, id, dir, log) {
  const files = {};
  try {
    const r = await page.request.get(`${BASE}/documente/pdf/factura/${id}/?layout_id=4&print_id=3`);
    if (r.ok() && /pdf/i.test(r.headers()['content-type'] || '')) { files.pdf = path.join(dir, `factura-${id}.pdf`); wf(files.pdf, await r.body()); }
    else files.pdfError = `${r.status()} ${r.headers()['content-type']}`;
  } catch (e) { files.pdfError = e.message; }
  log(`PDF: ${files.pdf || files.pdfError}`);
  try { Object.assign(files, await downloadXml(page, id, dir)); } catch (e) { files.xmlError = e.message; }
  log(`XML: ${files.xml || files.xmlError}`);
  return files;
}

// "Genereaza XML pentru e-Factura": same calls SmartBill's own viewer makes (read-only; nothing is sent to SPV).
async function downloadXml(page, id, dir) {
  const guard = page.__guard; if (guard) guard.xmlDownload = true;
  try {
    if (!/compact-view\/factura\//.test(page.url())) { await page.goto(`${BASE}/documente/compact-view/factura/${id}/`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(6000); }
    const r = await page.evaluate(async docId => {
      const call = url => new Promise(res => window.$.ajax({ url, dataType: 'json', type: 'POST', cache: false, data: { documentId: docId } }).done(d => res({ ok: true, d })).fail(x => res({ ok: false, status: x.status, text: String(x.responseText || '').slice(0, 500) })));
      return { mappings: await call('/documente/get_mappings/'), xml: await call('/documente/send_xml/') };
    }, String(id));
    const files = { mappings: r.mappings.ok ? r.mappings.d : r.mappings };
    if (!r.xml.ok) return { ...files, xmlError: `send_xml ${r.xml.status} ${r.xml.text}` };
    const d = r.xml.d; const xml = d.message || d.xmlContent || d.xml;
    files.xmlErrors = d.eInvoiceXmlErrors || null; files.xmlWarnings = d.eInvoiceXmlWarnings || null;
    if (!xml || !/<Invoice|<\?xml/.test(xml)) return { ...files, xmlError: 'raspuns fara XML: ' + JSON.stringify(d).slice(0, 400) };
    files.xml = path.join(dir, `efactura-${id}.xml`); wf(files.xml, xml);
    return files;
  } finally { if (guard) guard.xmlDownload = false; }
}

async function finalizeFromLedger(profile, orderNo, opts = {}) {
  const log = opts.log || console.log;
  const ledgerFile = path.join(profile.dirs.out, 'issued.json');
  const L = JSON.parse(fs.readFileSync(ledgerFile, 'utf8')); const rec = L[orderNo];
  if (!rec || !rec.invoiceId) throw new Error(`Nicio ciorna in jurnal pentru ${orderNo}`);
  if (rec.status === 'issued' && rec.number && !opts.downloadOnly) throw new Error(`Comanda ${orderNo} e deja emisa: nr ${rec.number} (pentru PDF/XML: download ${orderNo})`);
  const out = path.join(profile.dirs.out, 'fill', `${orderNo}-finalize-${Date.now()}`); fs.mkdirSync(out, { recursive: true });
  const s = await openSession({ profile, log }); const page = s.page; page.__guard = s.guard; const shot = async n => { const f = path.join(out, `${n}.png`); await page.screenshot({ path: f, fullPage: true }); return f; };
  try {
    if (opts.downloadOnly) { rec.files = await downloadDocs(page, rec.invoiceId, out, log); L[orderNo] = rec; wf(ledgerFile, JSON.stringify(L, null, 2)); return rec; }
    const r = await finalizeDraft(page, s, rec.invoiceId, shot, log);
    Object.assign(rec, r, { finalizedAt: new Date().toISOString() });
    if (rec.status === 'issued') rec.files = await downloadDocs(page, rec.invoiceId, out, log);
    L[orderNo] = rec; wf(ledgerFile, JSON.stringify(L, null, 2));
    wf(path.join(out, 'guard-blocked.json'), JSON.stringify(s.guard.blocked, null, 2));
    return rec;
  } finally { await s.browser.close(); }
}

module.exports = { _deps: D, _alreadyIssued: (...a) => alreadyIssued(...a), issueNow, checkDraftXml, roRe, readInvoiceReport, classify, run, addDays, todayIso, finalizeFromLedger, downloadDocs, dismissNotices };
