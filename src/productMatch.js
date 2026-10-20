'use strict';
// Deterministic matching of an order line (EAN / name / VAT) to an EXISTING SmartBill nomenclator product.
// Never creates or renames products: the invoice line uses the SmartBill product as it is.
const norm = s => String(s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();
const STOP = new Set(['G', 'GR', 'BUC', 'X']);
const tokens = s => norm(s).split(' ').filter(t => t && !STOP.has(t) && !/^\d+(G|GR|ML|KG|L)?$/.test(t));
const BUNDLE = /PACHET|DISCOUNT|LANSARE|GRATIS|CADOU|\+/i;

function score(line, p) {
  const name = p.Denumire || p.name || '';
  const cells = Object.values(p).map(String);
  let s = 0; const why = [];
  if (line.ean && cells.some(c => c.replace(/\D/g, '') === String(line.ean))) { s += 100; why.push('EAN'); }
  const lt = tokens(line.name); const pt = tokens(name);
  const hit = lt.filter(t => pt.some(q => q === t || q.startsWith(t) || t.startsWith(q)));
  if (lt.length && hit.length === lt.length) { s += 40; why.push('nume'); } else s += 10 * hit.length;
  const vat = parseFloat(String(p['Cota TVA'] || p.vat || '').replace(',', '.'));
  if (line.vat != null && vat === Number(line.vat)) { s += 15; why.push(`TVA ${vat}%`); }
  if (BUNDLE.test(name)) s -= 60;
  return { s, why };
}

function matchLine(line, products, pinned = {}) {
  if (pinned[line.ean]) return { id: String(pinned[line.ean]), how: 'profil' };
  const ranked = products.map(p => ({ p, ...score(line, p) })).filter(r => r.s >= 40).sort((a, b) => b.s - a.s);
  if (!ranked.length) return null;
  if (ranked[1] && ranked[1].s === ranked[0].s) return { ambiguous: ranked.slice(0, 4).map(r => `${r.p.id} ${r.p.Denumire} (${r.p.Cod})`) };
  const r = ranked[0];
  return { id: String(r.p.id), name: r.p.Denumire, code: r.p.Cod, how: r.why.join('+') };
}

module.exports = { matchLine, tokens };
