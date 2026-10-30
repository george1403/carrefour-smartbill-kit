'use strict';
/**
 * Match a Carrefour order line to an EXISTING SmartBill (Shopify) nomenclator product.
 * Names often differ (Carrefour "KOMBUCHA PASSION 500ML" vs SmartBill "Furori kombucha fructul pasiunii 500 ml");
 * Cod is often the Shopify SKU, not the EAN. We still pick the SmartBill product; fillInvoice then sets
 * the invoice LINE name to the Carrefour description (carrefourLineName) without renaming the product.
 * Never creates or renames nomenclator products.
 */
const norm = s => String(s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();
const STOP = new Set(['G', 'GR', 'BUC', 'X', 'SET', 'CU', 'DE', 'SI', 'THE', 'AND']);
// Keep size tokens (500ML, 330ML) — they disambiguate Shopify variants
const tokens = s => norm(s).split(' ').filter(t => t && !STOP.has(t) && !/^\d+$/.test(t));
// EAN/GTIN: digits only, leading zeros ignored (portal may send 5940000000017 as a number, GTIN-14 "0..." or UPC-A 12 digits)
const gtin = s => { const d = String(s ?? '').replace(/\D/g, '').replace(/^0+/, ''); return d.length >= 7 ? d : null; };
const digits = s => String(s ?? '').replace(/\D/g, '').replace(/^0+/, '');
const BUNDLE = /PACHET|DISCOUNT|LANSARE|GRATIS|CADOU|\+|SET\s*\d/i;

/** Carrefour flavor/name → tokens that appear on Shopify/SmartBill denumiri */
const ALIAS = {
  PASSION: ['PASIUNII', 'PASIUNE', 'PASSION', 'MANGO'],
  PASIUNII: ['PASSION', 'PASIUNE'],
  SOKATA: ['SOC', 'SOKATA', 'SOCATĂ'],
  SOC: ['SOKATA', 'SOC'],
  ZMEURIKA: ['ZMEURA', 'ZMEURIKA'],
  ZMEURA: ['ZMEURIKA', 'ZMEURA'],
  GHIMBIRUTA: ['GHIMBIR', 'GHIMBIRUTA'],
  GHIMBIR: ['GHIMBIRUTA', 'GHIMBIR'],
  GARANTIE: ['GARANTIE', 'SGR'],
  PET: ['PET', 'PLASTIC'],
  STICLA: ['STICLA', 'STICLA'],
};

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

function score(line, p) {
  const name = p.Denumire || p.name || '';
  const code = String(p.Cod ?? p.code ?? '').trim();
  const cells = Object.values(p).map(String);
  let s = 0; const why = [];

  // Full GTIN in any product field
  const le = gtin(line.ean);
  if (le && cells.some(c => gtin(c) === le)) { s += 100; why.push('EAN'); }
  // Short codes / SGR (3162, 3164) or Cod already set to EAN digits
  const ld = digits(line.ean);
  if (ld && ld.length >= 3 && (digits(code) === ld || cells.some(c => digits(c) === ld && digits(c).length === ld.length))) {
    if (!why.includes('EAN')) { s += 90; why.push('codEAN'); }
  }
  // Exact Shopify SKU if order carries sellerCode
  if (line.sellerCode && norm(line.sellerCode) === norm(code)) { s += 95; why.push('SKU'); }

  const lt = expand(tokens(line.name));
  const pt = expand(tokens(name));
  const hit = lt.filter(t => pt.some(q => q === t || q.startsWith(t) || t.startsWith(q)));
  const uniqHit = hit.filter(t => !['KOMBUCHA', 'IKOMBUCHA', 'FURORI', 'GARANTIE', 'SGR'].includes(t));
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
  // Prefer SGR cota label for 0% deposit lines
  if (Number(line.vat) === 0 && /SGR/i.test(vatRaw)) { s += 10; why.push('cotaSGR'); }

  if (BUNDLE.test(name)) s -= 60;
  // Prefer Shopify SKU codes (sokataF500, PET) over Cod that is only the GTIN/EAN mirror
  const codeDig = digits(code);
  if (code && !gtin(code) && !/^\d{8,14}$/.test(codeDig)) { s += 8; why.push('sku'); }
  else if (gtin(code) || (codeDig.length >= 8 && codeDig.length <= 14)) { s -= 5; why.push('codEanMirror'); }
  return { s, why };
}

function matchLine(line, products, pinned = {}) {
  const pk = line.ean != null && (pinned[line.ean] != null ? line.ean : Object.keys(pinned).find(k => gtin(k) && gtin(k) === gtin(line.ean)));
  if (pk != null && pk !== false && pinned[pk] != null) {
    const id = String(pinned[pk]);
    const p = products.find(x => String(x.id) === id);
    return { id, name: p && (p.Denumire || p.name), code: p && (p.Cod || p.code), how: 'profil' };
  }
  const ranked = products.map(p => ({ p, ...score(line, p) })).filter(r => r.s >= 40).sort((a, b) => b.s - a.s);
  if (!ranked.length) return null;
  // If top is an EAN-as-Cod mirror and next is a Shopify SKU with solid name score, prefer SKU
  if (ranked[1]) {
    const topCode = String(ranked[0].p.Cod || ranked[0].p.code || '');
    const nextCode = String(ranked[1].p.Cod || ranked[1].p.code || '');
    const topIsEanCod = !!(gtin(topCode) || (digits(topCode).length >= 8 && digits(line.ean || '') === digits(topCode)));
    const nextIsSku = nextCode && !gtin(nextCode) && !/^\d{8,14}$/.test(digits(nextCode));
    if (topIsEanCod && nextIsSku && ranked[1].s >= 40 && ranked[0].s - ranked[1].s <= 50) {
      ranked.unshift(ranked.splice(1, 1)[0]);
    }
  }
  if (ranked[1] && ranked[1].s === ranked[0].s) return { ambiguous: ranked.slice(0, 4).map(r => `${r.p.id} ${r.p.Denumire} (${r.p.Cod})`) };
  const r = ranked[0];
  return { id: String(r.p.id), name: r.p.Denumire, code: r.p.Cod, how: r.why.join('+') };
}

module.exports = { matchLine, tokens, gtin, score, expand };
