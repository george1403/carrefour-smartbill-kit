'use strict';
/**
 * Comanda de facturat, intr-un format unic (normalizat), din:
 *  - fisier JSON DocProcess ("JSON Supplier (Original)" / UBL JSON) -> --order-file=cale
 *  - fisier JSON simplu al kitului (acelasi format ca rezultatul de mai jos)
 *  - portalul Carrefour (profil orderSource=carrefour-portal) -> dupa numarul comenzii
 * Format: { orderNo, orderDate, despatchId, despatchDate, deliveryDate, store:{gln,name,street,city,county,country},
 *           lines:[{ name, ean, carrefourCode, sellerCode, qty, unitCode, price, vat }], totals:{net,vat,gross}, source }
 */
const fs = require('fs');
const path = require('path');
const d10 = s => (s ? String(s).slice(0, 10) : null);
const v = x => (x && typeof x === 'object' && 'value' in x ? x.value : x);
const dig = s => String(s == null ? '' : s).replace(/\D/g, '');

/** Accept both kit shape (streetName/cityName) and hand-edited aliases (street/city). */
function storeFromTableRow(t, gln, fallbackName) {
  if (!t || typeof t !== 'object') return { gln: String(gln || ''), name: fallbackName || null };
  const streetName = t.streetName || t.street || '';
  const building = t.buildingNumber || t.number || t.building || '';
  const cityRaw = String(t.cityName || t.city || t.rawCity || '');
  const streetJoined = t.street && !t.streetName
    ? String(t.street)
    : [streetName, building].filter(Boolean).join(', ');
  const countyFromStreet = ((String(streetName || t.street || '').match(/JUD\.?\s*([A-ZĂÂÎȘȚ\- ]+)/i) || [])[1] || '').trim() || null;
  return {
    gln: String(gln || t.gln || ''),
    name: t.name || fallbackName || null,
    street: streetJoined,
    city: cityRaw.split(',')[0].trim(),
    rawCity: cityRaw,
    county: t.county || (/bucuresti/i.test(cityRaw) ? 'Bucuresti' : null) || countyFromStreet,
    country: t.country || 'RO',
  };
}

/** Lookup GLN in carrefour-stores.json (string/number key). */
function lookupStoreTable(root, gln) {
  const cf = JSON.parse(fs.readFileSync(path.join(root, 'data/carrefour.json'), 'utf8'));
  const table = JSON.parse(fs.readFileSync(path.join(root, cf.storesFile), 'utf8')) || {};
  const key = String(gln || '');
  if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
  const want = dig(key);
  if (!want) return null;
  for (const [k, row] of Object.entries(table)) if (dig(k) === want) return row;
  return null;
}

function fromDocProcess(j, { root } = {}) {
  const P = j.properties || {}; const U = j.ublContent?.ublProperties || {};
  const del = (U.delivery || [])[0] || {}; const loc = del.deliveryLocation || {}; const a = loc.address || {};
  const lines = (j.ublContent?.lines || []).map(l => ({
    name: v(l.item?.description?.[0]) || v(l.item?.name), ean: v(l.item?.standardItemIdentification?.id) || null,
    carrefourCode: v(l.item?.buyersItemIdentification?.id) || null, sellerCode: v(l.item?.sellersItemIdentification?.id) || null,
    qty: Number(v(l.invoicedQuantity)), unitCode: l.invoicedQuantity?.unitCode || null, price: Number(v(l.price?.priceAmount)),
    vat: Number(v(l.taxTotal?.[0]?.taxSubtotal?.[0]?.percent)), net: Number(v(l.lineExtensionAmount)), packSize: v(l.item?.packSizeNumeric) ?? null,
  }));
  const city = String(v(a.cityName) || '');
  const gln = v(loc.id) || P['edm:gln'];
  let store = { gln, glnScheme: loc.id?.schemeID || null, name: v(loc.description?.[0]) || P['edm:name'],
    street: [v(a.streetName), v(a.buildingNumber)].filter(Boolean).join(', '), city: city.split(',')[0].trim(), rawCity: city,
    county: /bucuresti/i.test(city) ? 'Bucuresti' : ((city.match(/JUD\.?\s*([A-Z\- ]+)/i) || [])[1] || '').trim() || null, country: v(a.country?.identificationCode) || 'RO' };
  // Fill gaps from hand-extended carrefour-stores.json (street/city aliases OK)
  if (root && gln && !(store.street && store.city)) {
    try {
      const t = lookupStoreTable(root, gln);
      if (t) {
        const filled = storeFromTableRow(t, gln, store.name);
        store = { ...store, name: store.name || filled.name, street: store.street || filled.street, city: store.city || filled.city,
          rawCity: store.rawCity || filled.rawCity, county: store.county || filled.county, country: store.country || filled.country };
      }
    } catch (_) {}
  }
  return {
    source: 'docprocess-json', orderNo: P['edm:orderId'], orderDate: d10(P['edm:orderDate']), despatchId: P['edm:despatchAdviceId'] || null,
    despatchDate: d10(P['edm:despatchAdviceDate']), deliveryDate: d10(v(del.actualDeliveryDate) || P['edm:deliveryDate']), docprocessNumber: P['edm:documentId'],
    store, lines, totals: { net: P['edm:totalWithoutVat'], vat: P['edm:totalVat'], gross: P['edm:totalWithVat'] },
  };
}

function fromFile(file, { root } = {}) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (j.ublContent) return fromDocProcess(j, { root });
  if (j.orderNo && Array.isArray(j.lines)) return { source: 'kit-json', ...j };
  throw new Error(`Format de comanda necunoscut: ${file}`);
}

async function fromPortal(profile, orderNo) {
  const { fetchOrder } = require('./carrefourPortal');
  const o = await fetchOrder(profile, orderNo);
  const iso = s => { const m = String(s || '').match(/(\d{2})[./-](\d{2})[./-](\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : d10(s); };
  // store address from the Carrefour store table (shipped or hand-extended). Accept street/city aliases.
  const t = lookupStoreTable(profile.root, o.gln);
  const store = t ? storeFromTableRow(t, o.gln, o.store) : { gln: String(o.gln || ''), name: o.store };
  return { source: 'carrefour-portal', orderNo: o.orderNo, orderDate: iso(o.date), deliveryDate: iso(o.delivery), despatchId: null, invoicedAtCarrefour: o.invoiceNumbers || null,
    store, lines: o.lines.map(l => ({ name: l.name, ean: l.ean, carrefourCode: l.carrefourCode, qty: l.qty, unitCode: l.unit, price: l.price, vat: l.vat })) };
}

async function loadOrder(profile, { orderNo, orderFile }) {
  if (orderFile) return fromFile(orderFile, { root: profile.root });
  if (profile.cfg.orderSource?.type === 'carrefour-portal') return fromPortal(profile, orderNo);
  throw new Error('Da comanda cu --order-file=<fisier.json> (profilul nu citeste din portal).');
}

module.exports = { loadOrder, fromDocProcess, fromFile, storeFromTableRow, lookupStoreTable, sameGln: (a, b) => dig(a) === dig(b) && dig(a) !== '' };
