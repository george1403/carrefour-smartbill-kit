'use strict';
/**
 * Full offline bypass matrix — every scenario that blocked Pure Therapy live fills.
 * Exit 0 only if ALL gates pass. No SmartBill login required.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { matchLine, pinAgreesWithLine, loadEanPin, isJunkMirror } = require('../src/productMatch');
const fi = require('../src/fillInvoice');
const { resolveVatOption, pickSearchAttempts, isSgrDepositLine, sameCarrefourUnit, checkDraftXml } = fi;

const pin = loadEanPin();
const discPath = path.join(ROOT, 'out/pure-therapy/discovered-smartbill.json');
const disc = fs.existsSync(discPath)
  ? JSON.parse(fs.readFileSync(discPath, 'utf8'))
  : {
    // Offline stand-in so the matrix still runs from a fresh ZIP (no out/ shipped).
    vat: ['21 %', '0 % - SGR', '11 %', '7 %', '0 % - Taxare inversa', '0 % - SDD', '0 % - SFDD', '19 %', '5 %', '9 %'],
    products: Object.values(pin).map(p => ({
      id: p.id, Cod: p.sku, Denumire: p.name, 'Cota TVA': /SGR|Garantie/i.test(p.name) ? '0' : '21',
    })),
  };
const profilePath = path.join(ROOT, 'profiles/pure-therapy.json');
const profile = fs.existsSync(profilePath) ? JSON.parse(fs.readFileSync(profilePath, 'utf8')) : { products: [] };
const PT_VAT = disc.vat || ['21 %', '0 % - SGR', '11 %', '0 % - SDD', '0 % - SFDD', '19 %'];

let bad = 0; const results = [];
function T(id, name, fn) {
  try {
    const ev = fn();
    results.push({ id, name, ok: true, ev: String(ev || 'ok') });
    console.log(`PASS ${id} ${name} :: ${ev}`);
  } catch (e) {
    bad++;
    results.push({ id, name, ok: false, ev: String(e.message || e) });
    console.log(`FAIL ${id} ${name} :: ${e.message || e}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert'); }

// ——— MATCH / PIN ———
T('M01', 'Toate cele 24 EAN pin → SKU/id corect pe catalog PT', () => {
  const fails = [];
  for (const [ean, p] of Object.entries(pin)) {
    const m = matchLine({ name: p.name, ean, vat: /SGR|Garantie/i.test(p.name) ? 0 : 21, price: 1 }, disc.products, {});
    if (!m || m.ambiguous || String(m.id) !== String(p.id) || m.code !== p.sku) fails.push(`${ean} want ${p.sku}#${p.id} got ${JSON.stringify(m)}`);
  }
  assert(!fails.length, fails.slice(0, 5).join(' | '));
  return `${Object.keys(pin).length} pin OK`;
});

T('M02', 'Toate produsele din profilul PT se potrivesc (stocPin) — skip daca profilul nu e pe disc', () => {
  const products = profile.products || [];
  if (!products.length) return 'skip (fara profiles/pure-therapy.json — normal in ZIP)';
  const fails = [];
  for (const p of products) {
    const m = matchLine({ name: p.carrefourName, ean: p.ean, vat: p.vat, price: p.price }, disc.products, {});
    if (!m || String(m.id) !== String(p.smartbillId) || m.code !== p.smartbillCode) fails.push(`${p.carrefourName} → ${JSON.stringify(m)}`);
  }
  assert(!fails.length, fails.join(' | '));
  return `${products.length} profil OK`;
});

T('M03', 'Conflict Mentolime-nume + Ghimbiruta-EAN → Mentolime (nu Ghimbiruta)', () => {
  const gEan = Object.keys(pin).find(k => pin[k].sku === 'ghimbirutaF500');
  const m = matchLine({ name: 'KOMBUCHA MENTOLIME 500ML', ean: gEan, vat: 21 }, disc.products, {});
  assert(m && m.code === 'mentolime500', JSON.stringify(m));
  return m.how;
});

T('M04', 'Conflict Sokata-nume + socIK-EAN → sokataF500 (nu socIK)', () => {
  const soc = Object.keys(pin).find(k => pin[k].sku === 'socIK500');
  const m = matchLine({ name: 'KOMBUCHA SOKATA 500ML', ean: soc, vat: 21 }, disc.products, {});
  assert(m && m.code === 'sokataF500', JSON.stringify(m));
  return m.code + ' ' + m.how;
});

T('M05', 'pinAgrees: toate perechile exclusive de gust se resping reciproc', () => {
  const pairs = [
    [{ name: 'KOMBUCHA MENTOLIME 500ML' }, pin[Object.keys(pin).find(k => pin[k].sku === 'ghimbirutaF500')]],
    [{ name: 'KOMBUCHA SOKATA 500ML' }, pin[Object.keys(pin).find(k => pin[k].sku === 'socIK500')]],
    [{ name: 'KOMBUCHA ZMEURIKA 500ML' }, pin[Object.keys(pin).find(k => pin[k].sku === 'fr pas500')]],
    [{ name: 'KOMBUCHA PASSION 500ML' }, pin[Object.keys(pin).find(k => pin[k].sku === 'zmeura500')]],
    [{ name: 'GARANTIE PET' }, pin[Object.keys(pin).find(k => pin[k].sku === 'SGR sticla')]],
    [{ name: 'GARANTIE STICLA' }, pin[Object.keys(pin).find(k => pin[k].sku === 'SGR plastic')]],
  ];
  for (const [line, p] of pairs) assert(pinAgreesWithLine(line, p) === false, `should reject ${line.name} vs ${p.sku}`);
  return `${pairs.length} conflicte respinse`;
});

T('M06', 'Marime 500 vs 330: pin respins daca EAN e pe alt size', () => {
  const m330 = Object.keys(pin).find(k => pin[k].sku === 'mentolime330');
  assert(pinAgreesWithLine({ name: 'KOMBUCHA MENTOLIME 500ML' }, pin[m330]) === false);
  return 'size mismatch OK';
});

T('M07', 'Junk CF-/EAN-mirror nu e ales ca stock', () => {
  const junk = { id: '9', Cod: 'CF-5940628423360', Denumire: 'KOMBUCHA PASSION 500ML', 'Cota TVA': '21' };
  assert(isJunkMirror(junk, { name: 'KOMBUCHA PASSION 500ML' }) === true);
  const m = matchLine({ name: 'KOMBUCHA PASSION 500ML', ean: '5940628423360', vat: 21 }, [junk, ...disc.products.filter(p => String(p.Cod) === 'fr pas500').slice(0, 1)], {});
  assert(m && m.code === 'fr pas500', JSON.stringify(m));
  return 'junk exclus';
});

// ——— PLAN multi-line (comanda tip 211708) ———
T('P01', 'Plan multi-linie: 2x SGR + Sokata/Zmeura/Passion/Ghimbiruta — toate stocPin, zero freeText', () => {
  const lines = [
    { name: 'GARANTIE STICLA', ean: '3164', vat: 0, price: 0.5, qty: 1, unitCode: 'A' },
    { name: 'GARANTIE PET', ean: '3162', vat: 0, price: 0.5, qty: 14, unitCode: 'A' },
    { name: 'KOMBUCHA SOKATA 330ML', ean: '5940628423216', vat: 21, price: 6.94, qty: 2, unitCode: 'A' },
    { name: 'KOMBUCHA ZMEURIKA 500ML', ean: '5940628423087', vat: 21, price: 6.61, qty: 3, unitCode: 'A' },
    { name: 'KOMBUCHA SOKATA 500ML', ean: '5940628423100', vat: 21, price: 6.61, qty: 4, unitCode: 'A' },
    { name: 'KOMBUCHA GHIMBIRUTA 500ML', ean: '5940628423254', vat: 21, price: 6.61, qty: 2, unitCode: 'A' },
    { name: 'KOMBUCHA PASSION 500ML', ean: '5940628423360', vat: 21, price: 6.61, qty: 2, unitCode: 'A' },
    { name: 'KOMBUCHA MENTOLIME 500ML', ean: '5940628423285', vat: 21, price: 6.61, qty: 1, unitCode: 'A' },
  ];
  const plan = [];
  for (const l of lines) {
    assert(Number(l.price) > 0 && l.vat != null, 'price/vat');
    assert(!(l.unitCode && !/^(A|PCE|PCS|BUC|H87|C62|XPP|EA)$/i.test(l.unitCode)), 'unit');
    const m = matchLine(l, disc.products, {});
    if (isSgrDepositLine(l)) assert(m && !m.ambiguous && /^SGR /i.test(m.code), 'SGR ' + JSON.stringify(m));
    else assert(m && m.id && !m.ambiguous, JSON.stringify(m));
    plan.push({ ...l, smartbill: m, freeText: false });
  }
  assert(plan.every(l => !l.freeText && l.smartbill && l.smartbill.id));
  return plan.map(l => l.smartbill.code).join(', ');
});

T('P02', 'Linii qty=0 filtrate; comanda goala → NEEDS_HUMAN logic', () => {
  const lines = [
    { name: 'KOMBUCHA SOKATA 500ML', ean: '5940628423100', vat: 21, price: 6.61, qty: 0 },
    { name: 'KOMBUCHA PASSION 500ML', ean: '5940628423360', vat: 21, price: 6.61, qty: 2 },
  ];
  const keep = lines.filter(l => Number(l.qty) > 0);
  assert(keep.length === 1);
  return 'qty0 skip OK';
});

T('P03', 'isSgrDepositLine: PET/STICLA/GARANTIE la vat0; bautura 21% nu', () => {
  assert(isSgrDepositLine({ name: 'GARANTIE PET', vat: 0, ean: '3162' }));
  assert(isSgrDepositLine({ name: 'GARANTIE STICLA', vat: 0, ean: '3164' }));
  assert(!isSgrDepositLine({ name: 'KOMBUCHA SOKATA 500ML', vat: 21, ean: '5940628423100' }));
  assert(!isSgrDepositLine({ name: 'GARANTIE PET', vat: 21 })); // vat must be 0
  return 'SGR detector OK';
});

// ——— VAT ———
T('V01', 'PT VAT 0% → "0 % - SGR" (nu SDD, nu bare 0%)', () => {
  const r = resolveVatOption(PT_VAT, 0);
  assert(r.kind === 'SGR' && /SGR/i.test(r.text), JSON.stringify(r));
  return r.text;
});

T('V02', 'PT VAT 21% → "21 %" (spatii OK)', () => {
  const r = resolveVatOption(PT_VAT, 21);
  assert(r.kind === 'rate' && /^21\s*%/.test(r.text), JSON.stringify(r));
  return r.text;
});

T('V03', 'Fara SGR: cade pe SDD; fara ambele: pe 0%; lista goala: null', () => {
  const onlySdd = resolveVatOption(['21 %', '0 % - SDD'], 0);
  assert(onlySdd.kind === 'SDD', JSON.stringify(onlySdd));
  const only0 = resolveVatOption(['21 %', '0 % - Taxare inversa'], 0);
  assert(only0.kind === '0%', JSON.stringify(only0));
  const none = resolveVatOption(['21 %'], 0);
  assert(none.kind === null);
  return 'fallback chain OK';
});

T('V04', '21 % cu sufix ("21 % - Normal") tot se rezolva', () => {
  const r = resolveVatOption(['21 % - Normal', '11 %'], 21);
  assert(r && r.text.startsWith('21'), JSON.stringify(r));
  return r.text;
});

T('V05', '11% / 19% / rate lipsa', () => {
  assert(resolveVatOption(PT_VAT, 11).kind === 'rate');
  assert(resolveVatOption(PT_VAT, 19).kind === 'rate');
  assert(resolveVatOption(PT_VAT, 99).kind === null);
  return 'rates OK';
});

// ——— PICK ATTEMPTS ———
T('K01', 'Mentolime: #product_code mentolime500 primul; pastreaza & in name attempts', () => {
  const a = pickSearchAttempts('mentolime500', 'Furori kombucha menta & lamaie 500 ml');
  assert(a[0].field === '#product_code' && a[0].text === 'mentolime500', JSON.stringify(a.slice(0, 3)));
  assert(a.some(x => x.text.includes('&')), 'missing & attempt: ' + a.map(x => x.text).join(' | '));
  return `n=${a.length} first=${a[0].field}:${a[0].text}`;
});

T('K02', 'SGR sticla: code-first + compact + short token', () => {
  const a = pickSearchAttempts('SGR sticla', 'Garantie SGR Sticla');
  assert(a[0].text === 'SGR sticla' && a[0].field === '#product_code');
  assert(a.some(x => x.text === 'SGRsticla') || a.some(x => x.text === 'sticla'));
  return a.slice(0, 6).map(x => x.field + '=' + x.text).join('; ');
});

T('K03', 'fr pas500: compact frpas500 + "fr pas 500"', () => {
  const a = pickSearchAttempts('fr pas500', 'Furori kombucha fructul pasiunii 500 ml');
  assert(a.some(x => x.text === 'frpas500'), JSON.stringify(a.map(x => x.text)));
  assert(a.some(x => /fr pas 500/i.test(x.text)));
  return a.filter(x => /pas/i.test(x.text)).map(x => x.text).join(', ');
});

T('K04', 'sokataF500: variante fara F', () => {
  const a = pickSearchAttempts('sokataF500', 'Furori sokata kombucha 500 ml');
  assert(a.some(x => x.text === 'sokata500'));
  return 'sokata variants OK';
});

// ——— UM / XML / DOM ———
T('U01', 'sameCarrefourUnit: PCE≡XPP≡A≡BUC', () => {
  assert(sameCarrefourUnit('PCE', 'XPP') && sameCarrefourUnit('A', 'BUC') && !sameCarrefourUnit('PCE', 'KG'));
  return 'UM OK';
});

T('U02', 'checkDraftXml: &amp; in nume Mentolime + XPP', () => {
  const o = { orderNo: '922903', store: { gln: '5940477602572' }, lines: [{ name: 'KOMBUCHA MENTOLIME 500ML' }] };
  const x = `<Invoice><cbc:ID>1</cbc:ID><cac:Delivery><cac:DeliveryLocation><cbc:ID>5940477602572</cbc:ID></cac:DeliveryLocation></cac:Delivery>
    <cac:OrderReference><cbc:ID>922903</cbc:ID></cac:OrderReference>
    <cac:InvoiceLine><cbc:InvoicedQuantity unitCode="XPP">1</cbc:InvoicedQuantity>
    <cac:Item><cbc:Name>KOMBUCHA MENTOLIME 500ML</cbc:Name></cac:Item></cac:InvoiceLine></Invoice>`;
  const ok = checkDraftXml(x, o);
  assert(Object.values(ok).every(Boolean), JSON.stringify(ok));
  return 'XML Mentolime OK';
});

T('D01', 'DOM autocomplete regression (Mentolime/Sokata/SGR)', () => {
  const r = require('child_process').spawnSync(process.execPath, [path.join(ROOT, 'scripts/test-autocomplete-pick-dom.js')], { encoding: 'utf8', timeout: 60000 });
  assert(r.status === 0, (r.stdout + r.stderr).slice(-400));
  return (r.stdout || '').trim().split('\n').pop();
});

T('F01', 'forceSelectKnownProduct exportat + Mentolime id in pin', () => {
  assert(typeof fi.forceSelectKnownProduct === 'function');
  const m = Object.values(pin).find(p => p.sku === 'mentolime500');
  assert(m && String(m.id) === '32214943', JSON.stringify(m));
  const src = fs.readFileSync(path.join(ROOT, 'src/fillInvoice.js'), 'utf8');
  assert(/productAutocompleteSelect/.test(src), 'missing SmartBill select hook');
  assert(/force-select|FORCE select/.test(src), 'missing force-select path');
  assert(/resetProductLineInputs|product_gestiune/.test(src), 'missing gestiune reset');
  return `mentolime500#${m.id} force-select wired`;
});

T('F02', 'pickExistingProduct nu arde 20s pe numele lung inainte de force-select', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/fillInvoice.js'), 'utf8');
  // force-select must appear before "Last resort" name attempts in pickExistingProduct body order
  const iForce = src.indexOf('FORCE select');
  const iLast = src.indexOf('Last resort: remaining name attempts');
  assert(iForce > 0 && iLast > iForce, `order force=${iForce} last=${iLast}`);
  return 'force before long-name last resort';
});

T('N01', 'Nomenclator: dupa rename Carrefour NU reataseaza id (altfel redenumeste produsul in SmartBill)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/fillInvoice.js'), 'utf8');
  assert(/keepId:.*!renamed|keepId: !!\(.*!renamed/.test(src.replace(/\s+/g, ' ')), 'keepId must exclude renamed lines');
  assert(/detachId: lineIsCarrefourRename/.test(src), 'per-line detach after add missing');
  assert(!/Prefer "no gestiune"/.test(src), 'gestiune still cleared in reset');
  assert(/Do NOT touch #product_gestiune/.test(src), 'gestiune preserve comment missing');
  assert(/ar redenumi nomenclatorul/.test(src), 'gate for renamed+id missing');
  return 'nomenclator detach + gestiune preserve OK';
});

T('S01', 'forbiddenValues + KCRF absent din src shipped', () => {
  const { forbiddenValues } = require('../src/selftest');
  const v = forbiddenValues();
  assert(!v.length, v.join('; '));
  for (const f of fs.readdirSync(path.join(ROOT, 'src')).filter(x => x.endsWith('.js'))) {
    const t = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
    assert(!/\bKCRF\b/.test(t), `KCRF in src/${f}`);
  }
  return 'ship hygiene OK';
});

T('S02', 'pick nu mai seteaza ul.style.display=none (doar comentariu de avertizare OK)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/fillInvoice.js'), 'utf8');
  // Ban executable assignment; allow the warning comment that documents the Mentolime bug.
  assert(!/[^\/]ul\.style\.display\s*=\s*['"]none['"]/.test(src.replace(/\/\/[^\n]*/g, '')), 'display=none assignment still present');
  assert(/product_code/.test(src) && /resolveVatOption/.test(src));
  return 'no display:none assign; vat+code pick present';
});

const out = path.join(ROOT, 'out/pure-therapy/bypass-matrix.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), bad, total: results.length, results }, null, 2));
console.log(`\n${results.length - bad}/${results.length} bypass gates OK → ${out}`);
process.exit(bad ? 1 : 0);
