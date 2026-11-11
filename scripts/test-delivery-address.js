'use strict';
/**
 * Offline gates for delivery-address selection after hand-added Carrefour stores.
 * Exit 0 only if all pass.
 */
const assert = (c, m) => { if (!c) throw new Error(m); };
const { storeFromTableRow, lookupStoreTable, sameGln } = require('../src/orderInput');
const { addressLooksSelected } = require('../src/fillInvoice');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

let bad = 0;
const T = (id, name, fn) => {
  try { const ev = fn(); console.log(`PASS ${id} ${name} :: ${ev}`); }
  catch (e) { bad++; console.log(`FAIL ${id} ${name} :: ${e.message || e}`); }
};

T('A01', 'street/city aliases normalize like streetName/cityName', () => {
  const a = storeFromTableRow({ name: '99 TEST', streetName: 'STR. X', buildingNumber: '1', cityName: 'CLUJ', county: 'Cluj' }, '5940000000001');
  const b = storeFromTableRow({ name: '99 TEST', street: 'STR. X, 1', city: 'CLUJ', county: 'Cluj' }, '5940000000001');
  assert(a.street.includes('STR. X') && a.city === 'CLUJ', a.street + '/' + a.city);
  assert(b.street.includes('STR. X') && b.city === 'CLUJ', b.street + '/' + b.city);
  assert(a.county === 'Cluj' && b.county === 'Cluj', 'county');
  return `${a.street} | ${b.street}`;
});

T('A02', 'sameGln tolerates number vs string', () => {
  assert(sameGln('5940475219833', 5940475219833), 'num');
  assert(sameGln('5940475219833', '5940475219833'), 'str');
  assert(!sameGln('5940475219833', '5940475219834'), 'diff');
  return 'ok';
});

T('A03', 'addressLooksSelected rejects Fara adresa; accepts name/GLN/street', () => {
  const store = { gln: '5940475219833', name: '35 CARREFOUR MEGA MALL', street: 'BDUL. PIERRE DE COUBERTIN, NR. 3-5' };
  assert(!addressLooksSelected('Fara adresa de livrare', store), 'fara');
  assert(!addressLooksSelected('', store), 'empty');
  assert(addressLooksSelected('35 CARREFOUR MEGA MALL', store), 'name');
  assert(addressLooksSelected('GLN 5940475219833', store), 'gln');
  assert(addressLooksSelected('BDUL. PIERRE DE COUBERTIN, NR. 3-5', store), 'street');
  return 'ok';
});

T('A04', 'lookupStoreTable finds shipped store by GLN', () => {
  const row = lookupStoreTable(ROOT, '5940475219833');
  assert(row && /MEGA MALL/i.test(row.name), JSON.stringify(row));
  const rowNum = lookupStoreTable(ROOT, Number('5940475219833'));
  assert(rowNum && rowNum.name === row.name, 'numeric key');
  return row.name;
});

T('A05', 'missing street+city yields empty street (config gate input)', () => {
  const s = storeFromTableRow({ name: 'X' }, '1', 'X');
  assert(!s.street && !s.city, JSON.stringify(s));
  return 'empty';
});

if (bad) { console.log(`\n${bad} FAIL`); process.exit(1); }
console.log('\nALL PASS delivery-address');
