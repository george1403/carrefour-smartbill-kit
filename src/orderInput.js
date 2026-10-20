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
const d10 = s => (s ? String(s).slice(0, 10) : null);
const v = x => (x && typeof x === 'object' && 'value' in x ? x.value : x);

function fromDocProcess(j) {
  const P = j.properties || {}; const U = j.ublContent?.ublProperties || {};
  const del = (U.delivery || [])[0] || {}; const loc = del.deliveryLocation || {}; const a = loc.address || {};
  const lines = (j.ublContent?.lines || []).map(l => ({
    name: v(l.item?.description?.[0]) || v(l.item?.name), ean: v(l.item?.standardItemIdentification?.id) || null,
    carrefourCode: v(l.item?.buyersItemIdentification?.id) || null, sellerCode: v(l.item?.sellersItemIdentification?.id) || null,
    qty: Number(v(l.invoicedQuantity)), unitCode: l.invoicedQuantity?.unitCode || null, price: Number(v(l.price?.priceAmount)),
    vat: Number(v(l.taxTotal?.[0]?.taxSubtotal?.[0]?.percent)), net: Number(v(l.lineExtensionAmount)), packSize: v(l.item?.packSizeNumeric) ?? null,
  }));
  const city = String(v(a.cityName) || '');
  return {
    source: 'docprocess-json', orderNo: P['edm:orderId'], orderDate: d10(P['edm:orderDate']), despatchId: P['edm:despatchAdviceId'] || null,
    despatchDate: d10(P['edm:despatchAdviceDate']), deliveryDate: d10(v(del.actualDeliveryDate) || P['edm:deliveryDate']), docprocessNumber: P['edm:documentId'],
    store: { gln: v(loc.id) || P['edm:gln'], glnScheme: loc.id?.schemeID || null, name: v(loc.description?.[0]) || P['edm:name'],
      street: [v(a.streetName), v(a.buildingNumber)].filter(Boolean).join(', '), city: city.split(',')[0].trim(), rawCity: city,
      county: /bucuresti/i.test(city) ? 'Bucuresti' : ((city.match(/JUD\.?\s*([A-Z\- ]+)/i) || [])[1] || '').trim() || null, country: v(a.country?.identificationCode) || 'RO' },
    lines, totals: { net: P['edm:totalWithoutVat'], vat: P['edm:totalVat'], gross: P['edm:totalWithVat'] },
  };
}

function fromFile(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (j.ublContent) return fromDocProcess(j);
  if (j.orderNo && Array.isArray(j.lines)) return { source: 'kit-json', ...j };
  throw new Error(`Format de comanda necunoscut: ${file}`);
}

async function fromPortal(profile, orderNo) {
  const { fetchOrder } = require('./carrefourPortal');
  const o = await fetchOrder(profile, orderNo);
  const iso = s => { const m = String(s || '').match(/(\d{2})[./-](\d{2})[./-](\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : d10(s); };
  // store address from the Carrefour store table shipped with the kit (Carrefour data, same for every supplier)
  const path = require('path'); const cf = JSON.parse(fs.readFileSync(path.join(profile.root, 'data/carrefour.json'), 'utf8'));
  const t = (JSON.parse(fs.readFileSync(path.join(profile.root, cf.storesFile), 'utf8')) || {})[o.gln] || null;
  const city = t ? String(t.cityName || '') : '';
  const store = t ? { gln: o.gln, name: t.name || o.store, street: [t.streetName, t.buildingNumber].filter(Boolean).join(', '), city: city.split(',')[0].trim(), rawCity: city,
    county: t.county || (/bucuresti/i.test(city) ? 'Bucuresti' : null) || ((String(t.streetName || '').match(/JUD\.?\s*([A-Z\- ]+)/i) || [])[1] || '').trim() || null, country: t.country || 'RO' } : { gln: o.gln, name: o.store };
  return { source: 'carrefour-portal', orderNo: o.orderNo, orderDate: iso(o.date), deliveryDate: iso(o.delivery), despatchId: null, invoicedAtCarrefour: o.invoiceNumbers || null,
    store, lines: o.lines.map(l => ({ name: l.name, ean: l.ean, carrefourCode: l.carrefourCode, qty: l.qty, unitCode: l.unit, price: l.price, vat: l.vat })) };
}

async function loadOrder(profile, { orderNo, orderFile }) {
  if (orderFile) return fromFile(orderFile);
  if (profile.cfg.orderSource?.type === 'carrefour-portal') return fromPortal(profile, orderNo);
  throw new Error('Da comanda cu --order-file=<fisier.json> (profilul nu citeste din portal).');
}

module.exports = { loadOrder, fromDocProcess, fromFile };
