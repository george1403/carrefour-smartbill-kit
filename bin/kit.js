#!/usr/bin/env node
'use strict';
// Bundled Chromium lives in <kit>/.runtime/browsers (install.* puts it there). Run straight from a shell
// (node bin/kit.js ...) the env var is missing and Playwright looks in ~/Library/Caches -> exit 9. Set it here.
{ const _p = require('path'), _fs = require('fs'); const _b = _p.join(__dirname, '..', '.runtime', 'browsers');
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && _fs.existsSync(_b)) process.env.PLAYWRIGHT_BROWSERS_PATH = _b; }
const { loadProfile } = require('../src/config');
const args = process.argv.slice(2);
const cmd = args[0];
const opt = n => { const a = args.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const flag = n => args.includes(`--${n}`);
const HELP = `Comenzi:
  setup                 configurare (4 intrebari: email+parola SmartBill, utilizator+parola Carrefour)
  login-carrefour       (meniu 5) prima autentificare in portalul Carrefour: se deschide o fereastra vizibila,
                        scrii tu codul CAPTCHA o singura data; sesiunea se pastreaza
                        intai incearca singur (sesiune salvata, apoi citire locala a codului, fara AI)
                        [--manual] direct fereastra vizibila  [--ocr-only] doar citire automata  [--relay=DIR] (server fara ecran): poza CAPTCHA in DIR/captcha.png, raspunsul in DIR/answer.txt
  discover              reciteste automat SmartBill + Carrefour (firma, serii, produse, magazine)
  orders                lista comenzilor Carrefour
  ciorna <nr-comanda>   face o CIORNA in SmartBill (nu emite factura)
  preview <nr-comanda>  doar completeaza formularul + poza (nu salveaza nimic)
  fill <nr-comanda>     (tehnic) completeaza factura in SmartBill si face o poza; NU salveaza, NU emite
                        [--order-file=comanda.json] [--issue = emite, o singura data per comanda] [--draft-only = doar ciorna + XML, nu emite]
  masterdata            (Carrefour) adrese de livrare fara GLN in nume, UM PCE->XPP, telefon/email, conturi; [--apply] altfel doar citire
  selftest              verificare instalare (fara conturi)
  import-config [DIR]   copiaza .env + profilul + jurnalele dintr-un kit vechi (actualizare fara pierderi)
  auto                  comenzile noi din portal -> ciorne (sau facturi, daca in setup ai ales 'automat')
                        --check = doar arata ce ar face; --draft-only = forteaza ciorne; --watch --every=60 = repeta
  bulk-ciorne           (meniu 9) CIORNE IN BLOC: TOATE comenzile nefacturate din portal (fara limita de data) -> ciorne,
                        in loturi; arata lista + total si cere "da"; NU emite niciodata (nici in mod automat)
                        --check = doar lista, nu creeaza nimic; --lot=10 = marimea lotului
  schedule              porneste 'auto' singur la fiecare ora (--every=MIN, --remove = opreste)
  recon                 (tehnic) poze + inventar campuri din SmartBill
Optiuni: --profile=NUME
Coduri de iesire: 0 ok, 1 eroare, 2 oprit (ar fi dubla), 3 autentificare Carrefour necesara (optiunea 5), 4 parola gresita,
  5 fara internet/portal cazut, 6 portalul s-a schimbat, 7 autentificare neterminata, 8 disc plin/fara drept de scriere,
  9 instalare incompleta, 10 configurare deteriorata, 11 necesita verificarea ta, 12 cont Carrefour al altui furnizor`;

(async () => {
  if (!cmd || cmd === 'help') return console.log(HELP);
  if (cmd === 'setup') return require('../src/setup').run({ dryRun: flag('dry-run') });
  if (cmd === 'selftest') return require('../src/selftest').run();
  if (cmd === 'menu') return require('../src/menu').run();
  if (cmd === 'import-config') return console.log(require('../src/importConfig').run({ from: args[1] && !args[1].startsWith('--') ? args[1] : null, auto: flag('auto') }));
  const profile = loadProfile(opt('profile'));
  if (cmd === 'login-carrefour' && (flag('relay') || opt('relay'))) { const dir = opt('relay') || require('path').join(profile.dirs.out, 'captcha-relay'); return console.log(await require('../src/carrefourPortal').captchaRelay(profile, { dir })); }
  if (cmd === 'login-carrefour' && flag('ocr-only')) { const cp = require('../src/carrefourPortal'); const s = await cp._open(profile);
    try { return console.log(await cp.ensureLogin(s, profile, { log: console.log })); } finally { await s.browser.close(); } }
  if (cmd === 'login-carrefour') return console.log(await require('../src/carrefourPortal').interactiveLogin(profile, { ...(flag('headless') ? { headed: false } : {}), manual: flag('manual') }));
  if (cmd === 'discover') {
    const out = {};
    if (!flag('carrefour-only')) { const d = await require('../src/discoverSmartbill').discoverSmartbill(profile);
      out.smartbill = { company: d.company, series: d.series, products: d.products?.length, carrefourClients: d.carrefourClients?.length, blocked: d.guard.blocked }; }
    if (!flag('smartbill-only') && profile.cfg.orderSource?.type === 'carrefour-portal') { const c = await require('../src/carrefourPortal').discoverCarrefour(profile);
      out.carrefour = { supplierCodes: c.supplierCodes, stores: c.stores.length, products: c.products.length, orders: c.orders.length }; }
    console.log(JSON.stringify(out, null, 2)); return;
  }
  if (cmd === 'recon') {
    const { recon } = require('../src/recon');
    const targets = (profile.cfg.smartbill?.reconUrls || []).map((url, i) => ({ name: `page${i + 1}`, url }));
    const { outDir, res } = await recon(profile, { targets });
    console.log(`Recon salvat in ${outDir}. Cereri de scriere blocate: ${res.guard.blocked.length}`);
    return;
  }
  if (cmd === 'auto') { const a = require('../src/auto'); const o = { check: flag('check'), mode: flag('draft-only') ? 'ciorne' : undefined };
    if (flag('watch')) { const r = await a.watch(profile, { ...o, every: Number(opt('every') || 60) }); process.exitCode = r.exit || 0; return; }
    const r = await a.runOnce(profile, o); process.exitCode = r.exit != null ? r.exit : (r.errors?.length ? 1 : 0); return; }
  if (cmd === 'bulk-ciorne') { const r = await require('../src/bulk').run(profile, { check: flag('check'), batch: Number(opt('lot') || 10) }); process.exitCode = r.exit || 0; return; }
  if (cmd === 'schedule') return console.log(flag('remove') ? require('../src/schedule').remove() : require('../src/schedule').install({ every: Number(opt('every') || 60), profile: opt('profile') }));
  if (cmd === 'orders') return void await require('../src/orders').list(profile);
  if (cmd === 'fill' || cmd === 'ciorna' || cmd === 'preview') {
    const nr = args[1] && !args[1].startsWith('--') ? args[1] : null; const draftOnly = cmd === 'ciorna' || flag('draft-only');
    const r = await require('../src/fillInvoice').run(profile, { orderNo: nr, orderFile: opt('order-file'),
      issue: flag('issue'), draftOnly, probeSave: flag('probe-save'), headed: flag('headed'), log: m => console.log(m) });
    console.log('\n' + require('../src/report').fillSummary(r));
    if (flag('json')) console.log(JSON.stringify({ mode: r.mode, deliveryAddress: r.deliveryAddress, issued: r.issued, filledShot: r.filledShot }, null, 2));
    return;
  }
  if (cmd === 'masterdata') { const st = opt('store-file') ? JSON.parse(require('fs').readFileSync(opt('store-file'), 'utf8')) : null;
    const r = await require('../src/masterData').run(profile, { apply: flag('apply'), store: st && (st.store || st), unit: opt('unit') || 'PCE', phone: opt('phone'), email: opt('email'),
      banks: (opt('banks') || '').split(';').filter(Boolean).map(x => { const [iban, bank, currency] = x.split(','); return { iban, bank, currency: currency || 'RON' }; }) });
    console.log(JSON.stringify({ plan: r.plan, changes: r.changes, otp: r.otp, otpBank: r.otpBank, backup: r.backup, out: r.out, blocked: r.blocked }, null, 2)); return; }
  if (cmd === 'download') { const r = await require('../src/fillInvoice').finalizeFromLedger(profile, args[1], { downloadOnly: true }); console.log(JSON.stringify({ number: r.number, files: r.files }, null, 2)); return; }
  if (cmd === 'finalize') { const r = await require('../src/fillInvoice').finalizeFromLedger(profile, args[1]); console.log(JSON.stringify({ status: r.status, number: r.number, title: r.title, files: r.files }, null, 2)); return; }
  console.error('Comanda necunoscuta: ' + cmd + '\n\n' + HELP); process.exit(1);
})().catch(e => {
  const { classify, HELP } = require('../src/errors'); const c = classify(e);
  if (c.exit === 2) { console.error('\nOPRIT: ' + c.message); process.exit(2); }
  console.error('\nEROARE: ' + (process.env.KIT_DEBUG ? (e.stack || e.message) : c.message));
  if (HELP[c.exit] && c.exit !== 1) console.error('CE FACI: ' + HELP[c.exit]);
  process.exit(c.exit || 1);
});
