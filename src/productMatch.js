'use strict';
/**
 * Match a Carrefour order line to an EXISTING SmartBill stock product (Shopify SKUs).
 * Pin map comes from real issued KCRF invoices (EAN → Furori/ikombucha/SGR SKU).
 * Never prefer CF-* / EAN-mirror junk. Never invent products.
 */
const fs = require('fs');
const path = require('path');

const norm = s => String(s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();
const STOP = new Set(['G', 'GR', 'BUC', 'X', 'SET', 'CU', 'DE', 'SI', 'THE', 'AND']);
const tokens = s => norm(s).split(' ').filter(t => t && !STOP.has(t) && !/^\d+$/.test(t));
const gtin = s => { const d = String(s ?? '').replace(/\D/g, '').replace(/^0+/, ''); return d.length >= 7 ? d : null; };
const digits = s => String(s ?? '').replace(/\D/g, '').replace(/^0+/, '');
const BUNDLE = /PACHET|DISCOUNT|LANSARE|GRATIS|CADOU|\+|SET\s*\d/i;

const ALIAS = {
  PASSION: ['PASIUNII', 'PASIUNE', 'PASSION', 'MANGO', 'FRUCTUL'],
  PASIUNII: ['PASSION', 'PASIUNE'],
  SOKATA: ['SOC', 'SOKATA', 'SOCATA'],
  SOC: ['SOKATA', 'SOC'],
  ZMEURIKA: ['ZMEURA', 'ZMEURIKA'],
  ZMEURA: ['ZMEURIKA', 'ZMEURA'],
  GHIMBIRUTA: ['GHIMBIR', 'GHIMBIRUTA'],
  GHIMBIR: ['GHIMBIRUTA', 'GHIMBIR'],
  MENTOLIME: ['MENTA', 'LAMAIE', 'MENTOLIME'],
  GARANTIE: ['GARANTIE', 'SGR'],
  PET: ['PET', 'PLASTIC'],
  STICLA: ['STICLA', 'STICLA'],
};

/** EAN → { sku, name, id } from issued KCRF invoices (stock products they already use). */
let EAN_PIN = null;
function loadEanPin() {
  if (EAN_PIN) return EAN_PIN;
  try {
    EAN_PIN = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'carrefour-ean-to-shopify.json'), 'utf8'));
  } catch {
    EAN_PIN = {};
  }
  return EAN_PIN;
}

function expand(toks) {
  const out = new Set(toks);
  for (const t of toks) {
    for (const a of (ALIAS[t] || [])) out.add(norm(a).split(' ')[0]);
  }
  return [...out];
}

function sizeToken(name) {
  const m = norm(name).match(/\b(\d+)\s*(ML|G|GR|KG|L)\b/);
  return m ? m[1] + m[2] : null;
}

/** Accidental free-text / CF- / EAN-mirror junk — never use for stock. */
function isJunkMirror(p, line) {
  const name = String(p.Denumire || p.name || '');
  const code = String(p.Cod ?? p.code ?? '').trim();
  if (/^CF-/i.test(code)) return true;
  const codeDig = digits(code);
  if (gtin(code) || (codeDig.length >= 8 && codeDig.length <= 14)) return true;
  if (/^KOMBUCHA\b/i.test(name) && /^(PET|3162|3164)$/i.test(code)) return true;
  if (/^KOMBUCHA\s+[A-Z]+\s+\d+ML$/i.test(name.trim()) && line && norm(name) === norm(line.name)) return true;
  return false;
}

/**
 * Stock brand preference from their real invoices:
 * Furori (sokata/zmeura/passion/ghimbiruta/mentolime) and ikombucha classics.
 * EVA is a different catalog line — do NOT prefer it for Carrefour.
 */
function brandRank(p) {
  const code = String(p.Cod ?? p.code ?? '').trim();
  const name = String(p.Denumire || p.name || '');
  if (/^CF-/i.test(code) || gtin(code)) return -100;
  if (/^SGR\b/i.test(code)) return 60;
  if (/Furori|sokataF|zmeura\d|fr pas|ghimbirutaF|mentolime|coacaze|tonika/i.test(code + ' ' + name)) return 50;
  if (/IK\d|ikombucha|^[a-z]+IK|^(socIK|ghimbirIK|rooib|menta|trand|CV)/i.test(code) || /^ikombucha/i.test(name)) return 45;
  if (/^EVA\b/i.test(code)) return -20; // not their Carrefour stock line
  if (/^RAYAM\b/i.test(code)) return 5;
  return 0;
}

function findBySkuOrId(products, pin) {
  if (!pin) return null;
  const byId = pin.id && products.find(p => String(p.id) === String(pin.id));
  if (byId && !isJunkMirror(byId)) return byId;
  const sku = String(pin.sku || '').trim();
  if (!sku) return null;
  const hits = products.filter(p => String(p.Cod ?? p.code ?? '').trim() === sku && !isJunkMirror(p));
  if (!hits.length) return null;
  // Prefer exact denumire from pin when duplicates share Cod
  if (pin.name) {
    const n = norm(pin.name);
    const exact = hits.find(p => norm(p.Denumire || p.name) === n);
    if (exact) return exact;
  }
  return hits.sort((a, b) => brandRank(b) - brandRank(a))[0];
}

function score(line, p) {
  const name = p.Denumire || p.name || '';
  const code = String(p.Cod ?? p.code ?? '').trim();
  let s = 0; const why = [];

  if (isJunkMirror(p, line)) { s -= 120; why.push('junkMirror'); }

  const lt = expand(tokens(line.name));
  const pt = expand(tokens(name));
  const hit = lt.filter(t => pt.some(q => q === t || q.startsWith(t) || t.startsWith(q)));
  const uniqHit = hit.filter(t => !['KOMBUCHA', 'IKOMBUCHA', 'FURORI', 'GARANTIE', 'SGR', 'EVA'].includes(t));
  if (lt.length && hit.length === lt.length) { s += 40; why.push('nume'); }
  else {
    s += 10 * hit.length;
    if (uniqHit.length) { s += 15 * uniqHit.length; why.push('alias'); }
  }

  const szL = sizeToken(line.name); const szP = sizeToken(name);
  if (szL && szP && szL === szP) { s += 20; why.push('marime'); }
  else if (szL && szP && szL !== szP) { s -= 25; why.push('marimeDif'); }

  const vatRaw = String(p['Cota TVA'] || p.vat || '');
  const vat = parseFloat(vatRaw.replace(',', '.'));
  if (line.vat != null && Number.isFinite(vat) && vat === Number(line.vat)) { s += 15; why.push(`TVA ${vat}%`); }
  if (Number(line.vat) === 0 && /SGR/i.test(vatRaw)) { s += 10; why.push('cotaSGR'); }
  if (Number(line.vat) === 0 && /^SGR\b/i.test(code)) { s += 40; why.push('sgrSku'); }
  if (Number(line.vat) === 0 && /PET/i.test(line.name || '') && /plastic/i.test(code + ' ' + name)) { s += 30; why.push('petPlastic'); }
  if (Number(line.vat) === 0 && /STICL/i.test(line.name || '') && /sticla/i.test(code + ' ' + name)) { s += 30; why.push('sticlaSku'); }

  if (BUNDLE.test(name)) s -= 60;

  const codeDig = digits(code);
  if (code && !gtin(code) && !/^CF-/i.test(code) && !/^\d{8,14}$/.test(codeDig)) {
    s += 12; why.push('sku');
  } else if (/^CF-/i.test(code) || gtin(code) || (codeDig.length >= 8 && codeDig.length <= 14)) {
    s -= 40; why.push('codEanMirror');
  }

  const br = brandRank(p);
  if (br) { s += Math.min(Math.max(br, -40), 50); why.push(br >= 45 ? 'stockBrand' : br < 0 ? 'notStock' : 'brand'); }

  return { s, why, brand: br };
}

function matchLine(line, products, pinned = {}) {
  // 1) Explicit profile pin
  const pk = line.ean != null && (pinned[line.ean] != null ? line.ean : Object.keys(pinned).find(k => gtin(k) && gtin(k) === gtin(line.ean)));
  if (pk != null && pk !== false && pinned[pk] != null) {
    const id = String(pinned[pk]);
    const p = products.find(x => String(x.id) === id);
    return { id, name: p && (p.Denumire || p.name), code: p && (p.Cod || p.code), how: 'profil' };
  }

  // 2) Hard pin from issued KCRF invoices = their real SmartBill stock products
  const eanKey = String(line.ean || '').replace(/\D/g, '').replace(/^0+/, '') || String(line.ean || '').trim();
  const pinTable = loadEanPin();
  const pin = pinTable[eanKey] || pinTable[String(line.ean || '').trim()];
  if (pin) {
    const p = findBySkuOrId(products, pin);
    if (p) {
      return {
        id: String(p.id),
        name: p.Denumire || p.name,
        code: p.Cod || p.code,
        how: 'stocKCRF',
      };
    }
  }

  // 3) Fuzzy fallback — still never junk / EVA-first
  const ranked = products
    .map(p => ({ p, ...score(line, p) }))
    .filter(r => r.s >= 40 && !isJunkMirror(r.p, line))
    .sort((a, b) => b.s - a.s || (b.brand || 0) - (a.brand || 0));
  if (!ranked.length) return null;

  if (ranked[1] && ranked[1].s === ranked[0].s) {
    const same = ranked.filter(r => r.s === ranked[0].s);
    same.sort((a, b) => (b.brand || 0) - (a.brand || 0));
    if ((same[0].brand || 0) > (same[1].brand || 0)) {
      const r = same[0];
      return { id: String(r.p.id), name: r.p.Denumire, code: r.p.Cod, how: r.why.join('+') + '+tieBrand' };
    }
    return { ambiguous: same.slice(0, 4).map(r => `${r.p.id} ${r.p.Denumire} (${r.p.Cod})`) };
  }
  const r = ranked[0];
  return { id: String(r.p.id), name: r.p.Denumire, code: r.p.Cod, how: r.why.join('+') };
}

module.exports = { matchLine, tokens, gtin, score, expand, isJunkMirror, brandRank, loadEanPin };
