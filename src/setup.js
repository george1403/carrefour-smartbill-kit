'use strict';
const { wf, af, mv } = require('./fsx');
/**
 * Asistent de configurare. Producatorul raspunde la 4 intrebari (2 conturi) + alege seria din lista citita din SmartBill.
 * Tot restul se descopera automat (READ-ONLY): firma, CIF, IBAN, serii, produse din SmartBill;
 * cod furnizor, magazine/GLN, produse (EAN, cod Carrefour, pret) si comenzi din portalul Carrefour.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { bareProfile, ROOT } = require('./config');
const { discoverSmartbill } = require('./discoverSmartbill');
const cf = require('./carrefourPortal');

// One shared readline: works on a terminal and with piped answers (CI / scripted first run).
let RL = null; const queue = []; const waiters = []; let CLOSED = false;
function rl() {
  if (RL) return RL;
  RL = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
  RL.on('line', l => { const w = waiters.shift(); if (w) w(l); else queue.push(l); });
  RL.on('close', () => { CLOSED = true; while (waiters.length) waiters.shift()(null); });
  return RL;
}
function prompt(q, { hidden = false, def = '' } = {}) {
  const r = rl();
  process.stdout.write(q + (def ? ` [${def}] ` : ' '));
  if (hidden && process.stdin.isTTY) { r._writeToOutput = () => {}; }
  return new Promise(resolve => {
    const done = a => { if (hidden) { delete r._writeToOutput; process.stdout.write(hidden && process.stdin.isTTY ? '\n' : (a != null ? '***\n' : '\n')); } else if (!process.stdin.isTTY) process.stdout.write((a ?? '') + '\n');
      resolve(a == null && !def ? null : (((a ?? '').trim()) || def)); };
    if (queue.length) done(queue.shift()); else if (CLOSED) done(null); else waiters.push(done);
  });
}

function writeEnv(file, vals) {
  const keep = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(l => l && !Object.keys(vals).some(k => l.startsWith(k + '='))) : [];
  const q = v => JSON.stringify(String(v));
  wf(file, keep.concat(Object.entries(vals).map(([k, v]) => `${k}=${q(v)}`)).join('\n') + '\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

const slug = s => String(s || 'firma').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\b(srl|sa|pfa|ii|if)\b/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'firma';
const digits = s => String(s || '').replace(/\D/g, '');

function matchProducts(sbProducts, cfProducts) {
  // SmartBill nomenclator rows are objects keyed by table header (Denumire, Cod, ...). Match by EAN in any cell, else by name.
  const norm = s => String(s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();
  return cfProducts.map(p => {
    const byEan = p.ean && sbProducts.find(r => Object.values(r).some(v => digits(v) === p.ean));
    const byName = !byEan && sbProducts.find(r => { const n = norm(r.Denumire || r.Nume || Object.values(r)[1]); return n && (n === norm(p.name) || norm(p.name).includes(n) || n.includes(norm(p.name))); });
    const sb = byEan || byName || null;
    return { ean: p.ean, carrefourCode: p.carrefourCode, carrefourName: p.name, unit: p.unit, vat: p.vat, price: p.lastPrice,
      smartbillName: sb ? (sb.Denumire || sb.Nume || Object.values(sb)[0]) : null, smartbillCode: sb ? (sb.Cod || null) : null,
      match: byEan ? 'EAN' : byName ? 'nume' : 'NEGASIT' };
  });
}

async function run({ dryRun = false } = {}) {
  console.log('\n=== Configurare Carrefour -> SmartBill ===');
  if (dryRun) {
    for (const f of ['data/carrefour.json', 'data/carrefour-stores.json']) JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    console.log('[dry-run] Intrebari: 1/4 Email SmartBill, 2/4 Parola SmartBill, 3/4 Utilizator Carrefour, 4/4 Parola Carrefour; apoi alegerea seriei,');
    console.log('[dry-run] modul de lucru (1 = doar ciorne, implicit / 2 = automat) si daca porneste singur la fiecare ora (implicit: nu).');
    require('./schedule'); require('./auto'); require('./masterData');
    console.log('[dry-run] Nu se scrie .env si nu se contacteaza SmartBill/Carrefour. OK.');
    return;
  }
  console.log('Ai nevoie doar de 2 conturi: SmartBill si portalul de furnizori Carrefour. Restul il citim automat.\n');
  const envFile = path.join(ROOT, '.env');
  // resumable: answers from an earlier (interrupted) setup are reused; nothing secret is kept outside .env
  const progFile = path.join(ROOT, 'out', '.setup-progress.json');
  let prog = {}; try { prog = JSON.parse(fs.readFileSync(progFile, 'utf8')); } catch {}
  const saveProg = o => { Object.assign(prog, o, { at: new Date().toISOString() }); wf(progFile, JSON.stringify(prog, null, 2)); };
  const saved = require('./config').readSecrets(envFile);
  let reuse = false;
  if (fs.existsSync(envFile) && !saved.missing.length) {
    const u = String(saved.secrets.email || ''); const hint = u.replace(/^(.{2}).*(@.*)$/, '$1***$2');
    reuse = !/^n/i.test(await prompt(`Am gasit conturile salvate la configurarea anterioara (SmartBill ${hint}). Le folosesc? (da/nu)`, { def: 'da' }));
  }
  if (!reuse) {
    const vals = {
      SMARTBILL_EMAIL: await prompt('1/4  Email cont SmartBill:'),
      SMARTBILL_PASSWORD: await prompt('2/4  Parola SmartBill:', { hidden: true }),
      CARREFOUR_PORTAL_USERNAME: await prompt('3/4  Utilizator portal furnizori Carrefour:'),
      CARREFOUR_PORTAL_PASSWORD: await prompt('4/4  Parola portal Carrefour:', { hidden: true }),
    };
    const empty = Object.entries(vals).filter(([, v]) => !v).map(([k]) => k);
    if (empty.length) throw Object.assign(new Error('Nu ai completat toate cele 4 raspunsuri (email si parola SmartBill, utilizator si parola Carrefour). Nu am salvat nimic; porneste din nou Configurarea.'), { code: 'CONFIG' });
    writeEnv(envFile, vals);
    console.log('Salvat in .env (doar pe acest calculator, permisiuni 600).\n');
  } else console.log('Folosesc conturile salvate.\n');
  const MOCK = process.env.KIT_SETUP_MOCK ? JSON.parse(fs.readFileSync(process.env.KIT_SETUP_MOCK, 'utf8')) : null; // tests only: no network

  let profile = bareProfile('_setup', envFile);
  console.log('Citesc contul SmartBill (doar citire)...');
  const sb = MOCK ? MOCK.smartbill : await discoverSmartbill(profile, { log: () => {} });
  const name = slug(sb.company?.name || sb.companyName);
  console.log(`  Firma: ${sb.company?.name || sb.companyName}  CIF: ${sb.company?.cif}  IBAN: ${sb.company?.iban || '(negasit)'}`);
  console.log(`  Produse in nomenclator: ${sb.products?.length ?? 0}`);
  if (!sb.series?.length) throw new Error('Nu am gasit nicio serie de factura in SmartBill.');
  sb.series.forEach((s, i) => console.log(`  ${i + 1}) seria ${s.name}  (urmatorul numar: ${s.next ?? '?'})`));
  // each producer picks their own series; no silent default (only the answer from an interrupted setup is offered again)
  const prevSeries = sb.series.findIndex(s => s.name === prog.series);
  const def = prevSeries >= 0 ? String(prevSeries + 1) : '';
  let series = sb.series.length === 1 ? sb.series[0] : null;
  for (let tries = 0; !series && tries < 5; tries++) {
    const a = await prompt(`Ce serie folosim pentru facturile Carrefour? Scrie numarul (1-${sb.series.length}):`, { def });
    if (a == null) break;
    if (a === '') { console.log('  Scrie numarul seriei din lista de mai sus.'); continue; }
    const k = Number(String(a).replace(/\D/g, '')); if (k >= 1 && k <= sb.series.length) series = sb.series[k - 1]; else console.log(`  "${a}" nu e in lista. Scrie un numar intre 1 si ${sb.series.length}.`);
  }
  if (!series) throw Object.assign(new Error('Nu ai ales seria de factura. Porneste din nou Configurarea (optiunea 6).'), { code: 'CONFIG' });
  console.log(`  Seria aleasa: ${series.name}`);
  saveProg({ series: series.name });

  // IBAN: automatic when the account has one; a choice only when SmartBill lists several
  const ron = (sb.bankAccounts || []).filter(b => !b.currency || b.currency === 'RON');
  if (!sb.company.iban && ron.length > 1) {
    ron.forEach((b, i) => console.log(`  ${i + 1}) ${b.iban}  ${b.bank || ''}`));
    const k = Number(await prompt('Ai mai multe conturi in lei. Pe care il punem pe facturile Carrefour? Scrie numarul:', { def: '1' }));
    const b = ron[Math.max(0, Math.min(ron.length - 1, k - 1))]; Object.assign(sb.company, { iban: b.iban, bank: b.bank });
  }

  // move the session/out dirs under the real profile name
  const real = bareProfile(name, envFile);
  for (const k of ['state', 'out']) if (fs.existsSync(profile.dirs[k]) && !fs.existsSync(real.dirs[k])) mv(profile.dirs[k], real.dirs[k]);
  profile = real;

  console.log('\nCitesc portalul Carrefour (doar citire)...');
  let cfData = null;
  try { cfData = MOCK ? MOCK.carrefour : await cf.discoverCarrefour(profile, { log: () => {} }); }
  catch (e) {
    if (e.code === 'CAPTCHA' && process.stdin.isTTY) {
      console.log('Portalul cere un cod CAPTCHA la prima autentificare. Il scrii tu, o singura data.');
      await cf.interactiveLogin(profile);
      cfData = await cf.discoverCarrefour(profile, { log: () => {} });
    } else {
      console.log(`  ATENTIE: portalul Carrefour nu a putut fi citit: ${e.message}`);
      console.log('  Profilul se salveaza fara datele din portal. Dupa ce rezolvi, alege din meniu 5 (Autentificare Carrefour), apoi 12 (Reciteste datele din SmartBill si Carrefour).');
      cfData = { error: e.message, code: e.code || null, stores: [], products: [], supplierCodes: [] };
    }
  }
  // which Carrefour supplier account is this? The producer confirms it is their own company (never another supplier's login)
  let expectedSupplierCode = null;
  if (!cfData.error && (cfData.supplierCodes || []).length) {
    const codes = cfData.supplierCodes; const names = (cfData.supplierNames || []).join(', ');
    if (codes.length > 1) throw Object.assign(new Error(`Contul Carrefour vede comenzi pentru mai multi furnizori (${codes.join(', ')}). Foloseste contul firmei tale.`), { code: 'WRONG_ACCOUNT' });
    const ans = await prompt(`  Contul Carrefour este al furnizorului "${names}" (cod ${codes[0]}). Este firma ta, ${sb.company?.name || ''}? (da/nu)`, { def: '' });
    if (!/^d/i.test(ans || '')) throw Object.assign(new Error('Contul Carrefour scris nu este al firmei tale. Nu am salvat nimic din portal. Porneste din nou Configurarea cu utilizatorul si parola firmei tale.'), { code: 'WRONG_ACCOUNT' });
    expectedSupplierCode = codes[0];
  }
  const carrefour = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/carrefour.json'), 'utf8'));
  const storeTable = JSON.parse(fs.readFileSync(path.join(ROOT, carrefour.storesFile), 'utf8'));
  const stores = (cfData.stores || []).map(s => ({ ...s, ...(storeTable[s.gln] ? { address: storeTable[s.gln] } : { addressMissing: true }) }));
  const products = matchProducts(sb.products || [], cfData.products || []);

  const cfg = {
    _generated: `setup ${new Date().toISOString()} — nu e nevoie sa editezi acest fisier; ruleaza din nou setup sau discover.`,
    envFile: '.env',
    orderSource: { type: 'carrefour-portal' },
    company: { name: sb.company?.name || sb.companyName, cif: sb.company?.cif, regCom: sb.company?.regCom, iban: sb.company?.iban, bank: sb.company?.bank },
    smartbill: { series: series.name, nextNumberAtSetup: series.next, vatOptions: sb.vat, eFacturaFields: sb.eFacturaFields, dueDays: 7, currency: 'RON',
      carrefourClientExists: (sb.carrefourClients || []).length > 0,
      carrefourClientId: Number(((sb.carrefourClients || [])[0] || {}).raw?.col7) || null,
      carrefourUnit: null, useOrderSellerCode: false, carrefourLineName: true },
    carrefour: { ...carrefour, supplierAccountId: expectedSupplierCode || null, expectedSupplierCode, supplierGln: sb.company?.cif ? '22' + digits(sb.company.cif).padStart(11, '0') : null,
      _supplierGlnNote: 'derivat din CUI (22 + CUI pe 11 cifre); verifica in portalul Carrefour' },
    stores, products, carrefourPortal: cfData.error ? { status: 'NECITIT', error: cfData.error } : { status: 'ok', orders: (cfData.orders || []).length, at: cfData.at },
  };
  // how unattended runs work: drafts only (safe default) or automatic invoices
  console.log('\nCum vrei sa lucreze cand verifica singur comenzile noi?');
  console.log('  1) doar ciorne  - pregateste facturile ca CIORNE in SmartBill; tu le verifici si le emiti (recomandat la inceput)');
  console.log('  2) automat      - emite singur factura pentru fiecare comanda noua');
  const mode = (await prompt('Scrie 1 sau 2:', { def: prog.mode === 'automat' ? '2' : '1' })) === '2' ? 'automat' : 'ciorne';
  saveProg({ mode });
  cfg.auto = { mode, startFrom: new Date().toISOString().slice(0, 10), maxAgeDays: 14, maxPerRun: 10, _note: 'comenzile mai vechi decat startFrom nu se factureaza automat' };
  wf(path.join(ROOT, 'profiles', `${name}.json`), JSON.stringify(cfg, null, 2));
  wf(path.join(ROOT, 'profiles', '.default'), name);

  // SmartBill preparation for Carrefour (unit -> XPP) + e-Factura check (plain Romanian warnings)
  console.log('\nPregatesc SmartBill pentru Carrefour...');
  try {
    const real2 = require('./config').loadProfile(name);
    const r = MOCK ? MOCK.ensure : await require('./masterData').ensureForProducer(real2, { log: m => console.log(m), products: sb.products || [] });
    cfg.smartbill.carrefourUnit = r.unit; cfg.smartbill.efactura = r.efactura && { connected: r.efactura.connected, autoSend: r.efactura.autoSend, expires: r.efactura.expires, at: new Date().toISOString() };
    wf(path.join(ROOT, 'profiles', `${name}.json`), JSON.stringify(cfg, null, 2));
    r.warnings.forEach(w => console.log('  ATENTIE: ' + w));
  } catch (e) { console.log('  ATENTIE: nu am putut pregati SmartBill: ' + e.message.split('\n')[0] + '  (ruleaza din nou: setup)'); }

  // optional: start by itself every hour
  const sch = await prompt('\nVrei ca programul sa verifice singur comenzile noi, la fiecare ora, cat timp calculatorul e pornit? (da/nu)', { def: 'nu' });
  if (/^d/i.test(sch) && MOCK) console.log('  [test] programarea nu se creeaza in test.');
  else if (/^d/i.test(sch)) { try { console.log('  ' + require('./schedule').install({ every: 60 })); } catch (e) { console.log('  ATENTIE: programarea nu a reusit: ' + e.message); } }

  console.log(`\nGata. Profil: profiles/${name}.json`);
  console.log(`  Cod furnizor Carrefour: ${cfg.carrefour.supplierAccountId || '(negasit)'}   Magazine: ${stores.length}   Produse Carrefour: ${products.length}`);
  const miss = products.filter(p => p.match === 'NEGASIT');
  if (miss.length) { console.log('  ATENTIE: produse Carrefour fara pereche in nomenclatorul SmartBill:'); miss.forEach(p => console.log(`   - ${p.carrefourName} (EAN ${p.ean})`)); }
  const noAddr = stores.filter(s => s.addressMissing);
  if (noAddr.length) console.log(`  ATENTIE: ${noAddr.length} magazine fara adresa in tabelul inclus (se completeaza la urmatoarea actualizare a kitului).`);
  if (RL) RL.close();
  try { fs.unlinkSync(progFile); } catch {}
  console.log(`\nMod ales: ${mode === 'automat' ? 'AUTOMAT (emite facturi)' : 'DOAR CIORNE (tu emiti facturile din SmartBill)'}. Il schimbi oricand: run setup.`);
  console.log('Urmatorul pas: run orders (vezi comenzile)  |  run auto (comenzile noi -> ciorne/facturi)  |  run fill <nr> (doar completeaza, nu salveaza).');
}

module.exports = { run, matchProducts, slug };
