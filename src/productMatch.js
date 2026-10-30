'use strict';
/**
 * Match a Carrefour order line to an EXISTING SmartBill stock product (Shopify SKUs).
 * Pin map comes from real issued Carrefour stock invoices (EAN → Furori/ikombucha/SGR SKU).
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

/** EAN → { sku, name, id } from issued Carrefour stock invoices (products they already use). */
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
  // Polluted PT nomenclator rows from earlier kit runs (not real SGR services)
  if (/^(PET|3162|3164|sticla|plastic)$/i.test(code)) return true;
  if (/^GARANTIE\b/i.test(name) && !/^SGR\b/i.test(code)) return true;
  if (/^KOMBUCHA\b/i.test(name) && /^(PET|3162|3164)$/i.test(code)) return true;
  // Carrefour portal-shaped Denumire on a non-pin SKU = free-text junk left in nomenclator
  if (/^KOMBUCHA\s+[A-Z]+\s+\d+ML$/i.test(name.trim()) && line && norm(name) === norm(line.name)) return true;
  if (/^KOMBUCHA\s+[A-Z]+\s+\d+ML$/i.test(name.trim()) && !/F\d{3,4}$|mentolime|zmeura|fr\s*pas|sokata/i.test(code)) return true;
  return false;
}

/**
 * Carrefour Furori SKUs (*F / mentolime / zmeura / fr pas) vs ikombucha (*IK).
 * Bidirectional: GHIMBIRUTA≠ghimbirIK AND IKOMBUCHA GHIMBIR≠ghimbirutaF; never EVA for Furori portal names.
 * Family is decided by SKU code first (polluted Denumire like "Furori…"+ghimbirIK must not count as Furori).
 */
function brandFamilyAgree(line, p) {
  const L = norm(line && line.name);
  const code = String(p.Cod ?? p.code ?? '').trim();
  const name = String(p.Denumire || p.name || '');
  if (!L) return true;
  const isIk = /IK\d|[a-z]+IK\b|IK\s*vrac|ikombucha/i.test(code) || (/^ikombucha/i.test(name) && !/F\d{3,4}$|ghimbirutaF|sokataF|mentolime|zmeura\d|fr\s*pas/i.test(code));
  const isFurori = /sokataF|zmeura\d|fr\s*pas|ghimbirutaF|mentolime/i.test(code) || /F\d{3,4}$/i.test(code)
    || (/Furori/i.test(name) && !isIk);
  const looksFuroriPortal = /GHIMBIRUTA|SOKATA|ZMEURIKA|MENTOLIME|PASSION|PASIUN|\bFURORI\b/.test(L);
  // Classic IK naming — exclude Furori Shopify stock names ("Furori kombucha ghimbir …")
  const looksIkPortal = /IKOMBUCHA/.test(L)
    || (/\bSOC\b/.test(L) && !/SOKATA|FURORI/.test(L))
    || (/\bGHIMBIR\b/.test(L) && !/GHIMBIRUTA|FURORI/.test(L))
    || (/\bMENTA\b/.test(L) && !/MENTOLIME|LAMAI|FURORI/.test(L));
  if (looksFuroriPortal && isIk && !isFurori) return false;
  if (looksIkPortal && isFurori && !isIk) return false;
  // EVA is a separate catalog — never stock-match Carrefour Furori/IK drink lines
  if ((looksFuroriPortal || looksIkPortal || /KOMBUCHA|IKOMBUCHA/.test(L)) && /^EVA\b/i.test(code)) return false;
  return true;
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
  // Other brands first — "RAYAM zmeura330" must not match the zmeura\\d Furori SKU pattern
  if (/^EVA\b/i.test(code)) return -20;
  if (/^RAYAM\b/i.test(code)) return 5;
  if (/Furori/i.test(name) || /^(sokataF|zmeura\d|fr\s*pas|ghimbirutaF|mentolime|coacaze|tonika)/i.test(code)
    || /\b(sokataF|zmeura\d|ghimbirutaF|mentolime)\b/i.test(code)) return 50;
  if (/IK\d|ikombucha|^[a-z]+IK|^(socIK|ghimbirIK|rooib|menta|trand|CV)/i.test(code) || /^ikombucha/i.test(name)) return 45;
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

/** Exclusive flavor family — used both directions so wrong EANs cannot stocPin across flavors. */
function flavorKey(s) {
  const N = norm(s);
  if (!N) return null;
  if (/GARANTIE|SGR/.test(N) && /PET|PLASTIC/.test(N)) return 'SGR_PET';
  if (/GARANTIE|SGR/.test(N) && /STICL/.test(N)) return 'SGR_STICLA';
  if (/MENTOLIME|MENTA.*LAMAI|LAMAI.*MENTA/.test(N)) return 'MENTOLIME';
  if (/GHIMBIRUTA|GHIMBIRUTAF/.test(N)) return 'GHIMBIRUTA';
  if (/\bGHIMBIR\b/.test(N)) return 'GHIMBIR_IK';
  if (/SOKATA|SOKATAF/.test(N)) return 'SOKATA';
  if (/\bSOC\b/.test(N)) return 'SOC_IK';
  if (/ZMEUR/.test(N)) return 'ZMEURA';
  if (/PASSION|PASIUN|FR\s*PAS|FRPAS/.test(N)) return 'PASSION';
  if (/ROOIB/.test(N)) return 'ROOIB';
  if (/TRANDAFIR|HIBISCUS|\bTRAND/.test(N)) return 'TRAND';
  if (/\bMENTA\b/.test(N)) return 'MENTA_IK';
  if (/CEAI\s*VERDE|\bCV\d/.test(N)) return 'CV';
  if (/COACAZE/.test(N)) return 'COACAZE';
  if (/TONIKA/.test(N)) return 'TONIKA';
  return null;
}

/**
 * Refuse an EAN pin when the Carrefour line name is clearly a different flavor/SKU family.
 * Protects against wrong EANs in portal XML (e.g. Mentolime name + Ghimbiruta EAN → ghimbirutaF500).
 * Bidirectional: SOC line + trandafir EAN also rejected.
 */
function pinAgreesWithLine(line, pin) {
  const L = norm(line && line.name);
  const P = norm(`${(pin && pin.name) || ''} ${(pin && pin.sku) || ''}`);
  if (!L || !P) return true;
  const fL = flavorKey(L);
  const fP = flavorKey(P);
  // Compatible pairs: Carrefour GHIMBIRUTA ↔ Furori stock name that still keys as GHIMBIR_IK via "ghimbir"
  const compatible = (a, b) => {
    if (!a || !b) return true;
    if (a === b) return true;
    if ((a === 'GHIMBIRUTA' && b === 'GHIMBIR_IK') || (a === 'GHIMBIR_IK' && b === 'GHIMBIRUTA')) {
      // Only when the Furori side is actually ghimbirutaF / Furori ghimbir stock — not classic IKOMBUCHA
      const furoriSide = a === 'GHIMBIRUTA' ? L : P;
      const ikSide = a === 'GHIMBIR_IK' ? L : P;
      if (/FURORI|GHIMBIRUTA/.test(furoriSide) && /IKOMBUCHA/.test(ikSide)) return false;
      if (/GHIMBIRUTA|GHIMBIRUTAF|FURORI/.test(P) && /GHIMBIRUTA/.test(L)) return true;
      if (/GHIMBIRUTA|GHIMBIRUTAF|FURORI/.test(L) && /GHIMBIRUTA|GHIMBIR/.test(P) && !/IKOMBUCHA/.test(L)) return true;
      return false;
    }
    return false;
  };
  if (fL && fP && !compatible(fL, fP)) return false;
  // Size mismatch (500 vs 330) when both sides declare a bottle size
  const szL = sizeToken(L); const szP = sizeToken(P) || (String(pin.sku || '').match(/(\d{3,4})$/) || [])[1];
  if (szL && szP) {
    const a = szL.replace(/\D/g, ''); const b = String(szP).replace(/\D/g, '');
    if (a && b && a !== b) return false;
  }
  return true;
}

function score(line, p) {
  const name = p.Denumire || p.name || '';
  const code = String(p.Cod ?? p.code ?? '').trim();
  let s = 0; const why = [];

  if (isJunkMirror(p, line)) { s -= 120; why.push('junkMirror'); }
  if (!brandFamilyAgree(line, p)) { s -= 100; why.push('brandFamily'); }

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
  // Prefer real SGR services; junk PET/sticla codes already junkMirrored
  if (Number(line.vat) === 0 && /PET/i.test(line.name || '') && /^SGR\s*plastic$/i.test(code)) { s += 30; why.push('petPlastic'); }
  if (Number(line.vat) === 0 && /STICL/i.test(line.name || '') && /^SGR\s*sticla$/i.test(code)) { s += 30; why.push('sticlaSku'); }

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
  // 1) Explicit profile pin — must agree on flavor/size and resolve to a real Cod
  const pk = line.ean != null && (pinned[line.ean] != null ? line.ean : Object.keys(pinned).find(k => gtin(k) && gtin(k) === gtin(line.ean)));
  if (pk != null && pk !== false && pinned[pk] != null) {
    const id = String(pinned[pk]);
    const p = products.find(x => String(x.id) === id);
    if (p && !isJunkMirror(p, line)) {
      const code = String(p.Cod || p.code || '').trim();
      const name = String(p.Denumire || p.name || '').trim();
      const pinLike = { id, sku: code, name };
      if (code && name && pinAgreesWithLine(line, pinLike) && brandFamilyAgree(line, p)) {
        return { id, name, code, how: 'profil' };
      }
    }
    // Stale/wrong profile pin → fall through to stocPin / fuzzy (never return empty SKU)
  }

  // 2) Hard pin from issued stock invoices = their real SmartBill products
  const eanKey = String(line.ean || '').replace(/\D/g, '').replace(/^0+/, '') || String(line.ean || '').trim();
  const pinTable = loadEanPin();
  const pin = pinTable[eanKey] || pinTable[String(line.ean || '').trim()];
  if (pin && pinAgreesWithLine(line, pin)) {
    const p = findBySkuOrId(products, pin);
    if (p && brandFamilyAgree(line, p)) {
      // Pin SKU from issued stock invoices is source of truth (never trust a drifted Shopify Cod).
      return {
        id: String(p.id),
        name: pin.name || p.Denumire || p.name,
        code: pin.sku || p.Cod || p.code,
        how: 'stocPin',
      };
    }
    // Pin known but product list stale — still return pin only if brand family agrees with the pin SKU itself.
    if (pin.id && pin.sku && brandFamilyAgree(line, { Cod: pin.sku, Denumire: pin.name || '' })) {
      return { id: String(pin.id), name: pin.name || null, code: pin.sku, how: 'stocPin-only' };
    }
  }

  // 3) Fuzzy fallback — still never junk / EVA-first / wrong brand family
  const ranked = products
    .map(p => ({ p, ...score(line, p) }))
    .filter(r => r.s >= 40 && !isJunkMirror(r.p, line) && brandFamilyAgree(line, r.p))
    .sort((a, b) => b.s - a.s || (b.brand || 0) - (a.brand || 0));
  if (!ranked.length) return null;

  // SGR deposit lines: only accept real SGR* service codes
  if (Number(line.vat) === 0 && /GARANTIE|SGR|PET|STICL/i.test(String(line.name || ''))) {
    const sgrOnly = ranked.filter(r => /^SGR\b/i.test(String(r.p.Cod ?? r.p.code ?? '').trim()));
    if (!sgrOnly.length) return null;
    ranked.length = 0;
    ranked.push(...sgrOnly);
  }

  if (ranked[1] && ranked[1].s === ranked[0].s) {
    const same = ranked.filter(r => r.s === ranked[0].s);
    same.sort((a, b) => (b.brand || 0) - (a.brand || 0));
    if ((same[0].brand || 0) > (same[1].brand || 0)) {
      const r = same[0];
      return { id: String(r.p.id), name: r.p.Denumire, code: r.p.Cod, how: r.why.join('+') + '+tieBrand' };
    }
    // Prefer exact flavorKey match on Cod/Denumire when scores+brand tie
    const want = flavorKey(line.name);
    if (want) {
      const flav = same.filter(r => flavorKey(`${r.p.Denumire} ${r.p.Cod}`) === want);
      if (flav.length === 1) {
        const r = flav[0];
        return { id: String(r.p.id), name: r.p.Denumire, code: r.p.Cod, how: r.why.join('+') + '+tieFlavor' };
      }
    }
    return { ambiguous: same.slice(0, 4).map(r => `${r.p.id} ${r.p.Denumire} (${r.p.Cod})`) };
  }
  const r = ranked[0];
  return { id: String(r.p.id), name: r.p.Denumire, code: r.p.Cod, how: r.why.join('+') };
}

module.exports = { matchLine, tokens, gtin, score, expand, isJunkMirror, brandRank, brandFamilyAgree, loadEanPin, pinAgreesWithLine, flavorKey };
