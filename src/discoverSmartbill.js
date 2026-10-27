'use strict';
const { wf, af, mv } = require('./fsx');
/**
 * Auto-discovery din contul SmartBill (READ-ONLY, prin Guard): firma + CIF, serii (cu numarul urmator),
 * cote TVA, date firma (IBAN, banca, reg. com.), nomenclator produse, client Carrefour existent.
 * Nu salveaza nimic in SmartBill: toate cererile non-GET sunt blocate in afara listelor/citirilor.
 */
const fs = require('fs');
const path = require('path');
const { openSession, dismissCookies } = require('./smartbillWeb');

const BASE = 'https://cloud.smartbill.ro';
const strip = h => (h && typeof h === 'object' ? JSON.stringify(h) : String(h ?? '')).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

async function go(page, url, wait = 5000) {
  await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(wait);
  await dismissCookies(page);
}

async function readInvoiceForm(page) {
  await go(page, '/documente/emitere/factura/', 7000);
  return page.evaluate(() => {
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
      eFacturaFields: [...document.querySelectorAll('[id^="id-additional-field-"]')].map(e => e.id.replace('id-additional-field-', '')),
    };
  });
}

async function readCompany(page) {
  await go(page, '/core/configurare/date-firma/', 5000);
  return page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('input, select, textarea')) {
      if (el.type === 'password' || el.type === 'hidden') continue;
      const r = el.getBoundingClientRect(); if (!r.width) continue;
      let label = '';
      if (el.id) label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText || '';
      if (!label) label = el.closest('.form-group, .row, div')?.querySelector('label')?.innerText || el.placeholder || el.name || el.id || '';
      const value = el.tagName === 'SELECT' ? (el.selectedOptions[0]?.text || '') : el.value;
      if (value) out.push({ label: label.trim().slice(0, 60), id: el.id || null, name: el.name || null, value: value.trim().slice(0, 120) });
    }
    return out.map(o => ({ ...o, bank: o.bank ? o.bank.replace(/\s+(RON|EUR|USD|GBP)\b.*$/, '').trim() : null }));
  });
}

function pick(fields, re) { const f = fields.find(x => re.test(`${x.label} ${x.id} ${x.name}`)); return f ? f.value : null; }

/** Reissue the page's own DataTables list request with a bigger page (and optional search). */
async function readList(page, url, ajaxPath, { search = '', length = 1000 } = {}) {
  const reqP = page.waitForRequest(r => r.method() === 'POST' && r.url().includes(ajaxPath), { timeout: 30000 }).catch(() => null);
  await go(page, url, 6000);
  const req = await reqP;
  if (!req) return { headers: [], rows: [], error: 'lista nu a fost incarcata' };
  const params = new URLSearchParams(req.postData() || '');
  params.set('iDisplayStart', '0'); params.set('iDisplayLength', String(length)); params.set('sSearch', search);
  const hdrs = req.headers();
  const res = await page.evaluate(async ({ u, body, h }) => {
    const r = await fetch(u, { method: 'POST', credentials: 'same-origin', body, headers: {
      'content-type': h['content-type'] || 'application/x-www-form-urlencoded; charset=UTF-8',
      'x-requested-with': 'XMLHttpRequest', ...(h['x-csrftoken'] ? { 'x-csrftoken': h['x-csrftoken'] } : {}) } });
    return { status: r.status, text: await r.text() };
  }, { u: req.url(), body: params.toString(), h: hdrs });
  const headers = await page.evaluate(() => [...document.querySelectorAll('table.dataTable thead th, table thead th')].map(t => t.innerText.trim()).filter(Boolean));
  let json; try { json = JSON.parse(res.text); } catch { return { headers, rows: [], error: `raspuns ne-JSON (${res.status})` }; }
  const raw = json.aaData || json.data || [];
  const rows = raw.map(r => Array.isArray(r) ? r.map(strip) : Object.fromEntries(Object.entries(r).map(([k, v]) => [k, strip(v)])));
  return { headers, rows, total: json.iTotalRecords ?? json.recordsTotal ?? rows.length };
}

function rowsToObjects(list) {
  // SmartBill lists have a hidden first column (row id) with no header: shift headers by one when rows are longer.
  const first = list.rows.find(Array.isArray);
  const h = first && first.length > list.headers.length && /^\d+$/.test(first[0]) ? ['id', ...list.headers] : list.headers;
  return list.rows.map(r => Array.isArray(r) ? Object.fromEntries(r.map((v, i) => [h[i] || `col${i}`, v])) : r);
}

async function readBankAccounts(page) {
  await go(page, '/core/configurare/conturi-bancare/', 5000);
  return page.evaluate(() => {
    const out = [];
    for (const tr of document.querySelectorAll('tr')) {
      const t = tr.innerText.replace(/\s+/g, ' ');
      const m = t.match(/\bRO\d{2}[A-Z]{4}[A-Z0-9]{16}\b/);
      const cur = (t.match(/\b(RON|EUR|USD|GBP)\b/) || [])[1] || null;
      if (m && !out.some(o => o.iban === m[0])) out.push({ iban: m[0], currency: cur, bank: (t.replace(m[0], '').match(/[A-Z][A-Z .&-]{3,}(BANK|BANCA|BCR|BRD|ING|CEC|TRANSILVANIA|RAIFFEISEN|UNICREDIT|GARANTI|LIBRA|ALPHA|OTP|EXIM)[A-Z .&-]*/) || [''])[0].trim() || null });
    }
    return out;
  });
}

async function discoverSmartbill(profile, { log = console.log } = {}) {
  const s = await openSession({ profile, log });
  const out = { at: new Date().toISOString() };
  try {
    out.companyName = (await s.page.evaluate(() => [...document.querySelectorAll('a')].map(a => a.innerText.trim()).find(t => /\b(SRL|SA|PFA|II|IF|SCS|SNC)\b\.?$/i.test(t)) || null)) || null;
    Object.assign(out, await readInvoiceForm(s.page));
    const fields = await readCompany(s.page);
    out.company = {
      name: pick(fields, /nume|denumire|firma/i) || out.companyName,
      cif: out.cifs.find(c => !/_OSS$/i.test(c)) || pick(fields, /cif|cui|fiscal/i),
      regCom: pick(fields, /reg.*com|nr.*reg/i),
      address: pick(fields, /adres|sediu/i),
      city: pick(fields, /oras|localit/i),
      county: pick(fields, /jude/i),
      iban: null, // from Conturi bancare (below)
      bank: null,
    };
    out.companyFieldsSeen = fields.map(f => f.label);
    out.bankAccounts = await readBankAccounts(s.page);
    const ron = out.bankAccounts.filter(b => !b.currency || b.currency === 'RON');
    if (ron.length === 1) Object.assign(out.company, { iban: ron[0].iban, bank: ron[0].bank });
    const prod = await readList(s.page, '/nomenclator/produse/', '/nomenclator/produse/ajax/');
    out.products = rowsToObjects(prod); out.productsTotal = prod.total; if (prod.error) out.productsError = prod.error;
    const cl = await readList(s.page, '/nomenclator/clienti/', '/nomenclator/clienti/ajax/', { length: 2000 });
    out.clientsTotal = cl.total;
    const cfCif = String(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'carrefour.json'), 'utf8')).client.cif).replace(/\D/g, '');
    out.carrefourClients = rowsToObjects(cl).filter(r => JSON.stringify(r).includes(cfCif)).map(r => {
      const v = Object.values(r).map(String);
      return { name: v.find(x => /CARREFOUR/i.test(x) && !x.startsWith('{')) || null, cif: v.find(x => /^(RO)?\d{6,10}$/i.test(x) && x.includes(cfCif)) || v.find(x => /^RO\d{6,10}$/i.test(x)) || null, raw: r };
    });
    if (cl.error) out.clientsError = cl.error;
  } finally {
    out.guard = { blocked: s.guard.blocked.map(b => `${b.method} ${b.url}`), allowedCount: s.guard.allowed.length };
    await s.browser.close();
  }
  fs.mkdirSync(profile.dirs.out, { recursive: true });
  wf(path.join(profile.dirs.out, 'discovered-smartbill.json'), JSON.stringify(out, null, 2));
  return out;
}

module.exports = { discoverSmartbill, _readInvoiceForm: readInvoiceForm };
