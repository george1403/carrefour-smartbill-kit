'use strict';
// Offline self-test (no credentials, no network to SmartBill/Carrefour): runtime, modules, data files,
// headless Chromium launch, and a check that the kit has no AI/LLM dependencies.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const AI = /^(openai|@anthropic-ai\/.*|anthropic|@google\/generative-ai|@google\/genai|langchain|@langchain\/.*|ollama|@mistralai\/.*|cohere-ai|groq-sdk|@xai\/.*|replicate|ai|@ai-sdk\/.*|llamaindex|together-ai)$/i;

async function run() {
  const ok = (m) => console.log('OK   ' + m); let bad = 0; const no = (m) => { bad++; console.log('FAIL ' + m); };
  const maj = Number(process.versions.node.split('.')[0]);
  (maj >= 20 ? ok : no)(`Node.js ${process.versions.node} (${process.platform}-${process.arch})`);
  for (const m of ['dotenv', 'playwright', 'tesseract.js', 'pngjs']) { try { require(m); ok(`modul ${m}`); } catch (e) { no(`modul ${m}: ${e.message}`); } }
  for (const f of ['data/carrefour.json', 'data/carrefour-stores.json']) { try { JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); ok(f); } catch (e) { no(`${f}: ${e.message}`); } }
  for (const m of ['config', 'smartbillWeb', 'discoverSmartbill', 'carrefourPortal', 'setup', 'orders', 'fillInvoice', 'orderInput', 'captchaOcr', 'errors', 'importConfig', 'auto', 'schedule', 'menu', 'masterData', 'color', 'support']) { try { require(`./${m}`); ok(`src/${m}.js`); } catch (e) { no(`src/${m}.js: ${e.message}`); } }
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const ai = Object.keys(lock.packages || {}).map(k => k.replace(/^.*node_modules\//, '')).filter(n => AI.test(n));
  (ai.length ? no : ok)(`fara dependinte AI/LLM${ai.length ? ': ' + ai.join(', ') : ''}`);
  const src = fs.readdirSync(path.join(ROOT, 'src')).map(f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n');
  const hosts = src.match(/api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.x\.ai|api\.mistral\.ai|api\.groq\.com/g);
  (hosts ? no : ok)(`fara apeluri catre API-uri AI${hosts ? ': ' + [...new Set(hosts)].join(', ') : ''}`);
  // AI/LLM SDKs anywhere in the installed tree (not only direct deps); tesseract.js (classic OCR engine) is allowed.
  const nm = path.join(ROOT, 'node_modules'); const installed = [];
  if (fs.existsSync(nm)) for (const d of fs.readdirSync(nm)) { if (d.startsWith('@')) { for (const e of fs.readdirSync(path.join(nm, d))) installed.push(`${d}/${e}`); } else installed.push(d); }
  const aiInst = installed.filter(n => AI.test(n)); (aiInst.length ? no : ok)(`node_modules fara pachete AI/LLM (${installed.length} pachete verificate)${aiInst.length ? ': ' + aiInst.join(', ') : ''}`);
  try { const pl = require('./auto').plan([{ orderNo: '1', date: '19.10.2026' }, { orderNo: '2', date: '19.10.2026', invoiceNumbers: '7' }, { orderNo: '03', date: '19.10.2026' }], { cfg: { auto: { startFrom: '2026-10-19' } }, ledgers: { drafts: { '3': {} } }, state: {}, today: '2026-10-19' });
    (pl.map(x => !!x.skip).join() === 'false,true,true' ? ok : no)('regula auto: doar comenzile noi, nefacturate'); require('./schedule').install({ dryRun: true }); ok('programare automata (' + process.platform + ')'); } catch (e) { no('auto/schedule: ' + e.message); }
  try { const fi = require('./fillInvoice'); const o = { orderNo: '1', store: { gln: '2' }, lines: [{ name: 'A & B 50G' }] };
    const x = '<i>1 2<cac:InvoiceLine xmlns=""><cbc:InvoicedQuantity unitCode="XPP">1</cbc:InvoicedQuantity><cac:Item><cbc:Name>A &amp; B 50G</cbc:Name></cac:Item></cac:InvoiceLine></i>';
    (Object.values(fi.checkDraftXml(x, o)).every(Boolean) && !Object.values(fi.checkDraftXml(x.replace('A &amp; B 50G', 'Alt nume'), o)).every(Boolean) ? ok : no)('verificare XML: nume linie = descriere Carrefour, U.M. XPP');
    const ec = require('./errors').classify; (ec({ code: 'CAPTCHA', message: 'x' }).exit === 3 && ec(new Error('page.goto: net::ERR_INTERNET_DISCONNECTED')).exit === 5 ? ok : no)('coduri de iesire (3 = autentificare Carrefour, 5 = fara internet)');
  } catch (e) { no('verificari rapide: ' + e.message); }
  try { const r = require('child_process').spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'test-automat.js')], { encoding: 'utf8', timeout: 120000 }); const last = (r.stdout || '').trim().split('\n').pop();
    (r.status === 0 ? ok : no)(`mod automat (teste offline, SmartBill simulat, nimic emis): ${last}${r.status === 0 ? '' : ' ' + (r.stdout || '').split('\n').filter(l => /^FAIL/.test(l)).join(' | ').slice(0, 800)}`); } catch (e) { no('mod automat: ' + e.message); }
  try { ok(require('../scripts/test-fresh-setup').run()); } catch (e) { no('setup din ZIP proaspat: ' + e.message.slice(0, 1500)); }
  // No producer-specific values in the files we ship (the kit is the same ZIP for every producer).
  try { const v = forbiddenValues(); (v.length ? no : ok)(`fara date de producator in fisierele kitului${v.length ? ': ' + v.slice(0, 8).join('; ') : ''}`); } catch (e) { no('verificare date producator: ' + e.message); }
  // Local OCR for the Carrefour CAPTCHA: works offline from the bundled traineddata; must read the two sample images.
  try {
    const ocr = require('./captchaOcr'); if (!fs.existsSync(path.join(ocr.LANG_DIR, 'eng.traineddata.gz'))) throw new Error('lipseste eng.traineddata.gz');
    const res = []; for (const f of fs.readdirSync(path.join(ROOT, 'test-data')).filter(x => /^captcha-\d{4}\.png$/.test(x))) {
      const r = await ocr.solve(fs.readFileSync(path.join(ROOT, 'test-data', f))); res.push(`${f.slice(8, 12)}=>${r.ok ? r.text : 'nesigur'}`);
      if (!(r.ok && r.text === f.slice(8, 12))) throw new Error(res.join(' ')); }
    await ocr.terminate(); ok(`OCR local CAPTCHA (tesseract.js, fara AI/LLM, offline): ${res.join(' ')}`);
  } catch (e) { no('OCR CAPTCHA: ' + e.message); }
  try { const b = await require('playwright').chromium.launch(); const p = await b.newPage(); await p.setContent('<p>ok</p>'); await b.close(); ok('Chromium porneste'); }
  catch (e) { no('Chromium: ' + e.message.split('\n')[0]); }
  console.log(bad ? `\n${bad} probleme.` : '\nTotul e in regula.');
  if (bad) process.exitCode = 1;
}

// Files shipped in the ZIP (same rules as .gitattributes export-ignore): everything except local/runtime data and dev tools.
function shippedFiles() {
  const skip = /^(node_modules|\.runtime|out|profiles|\.git|tools|\.github|stores)(\/|$)|^\.env$|\.(png|pdf|gz|zip)$/i;
  const outl = []; const walk = d => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { const r = d ? `${d}/${e.name}` : e.name; if (skip.test(r)) continue; e.isDirectory() ? walk(r) : outl.push(r); } };
  walk(''); return outl;
}
function forbiddenValues() {
  const cf = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'carrefour.json'), 'utf8'));
  const okCif = String(cf.client.cif).replace(/\D/g, ''); const okReg = String(cf.client.regCom || '');
  // values of every local producer profile on this computer (never shipped): name, CIF, Reg. com., IBAN, series, ids
  const local = [];
  const pd = path.join(ROOT, 'profiles');
  if (fs.existsSync(pd)) for (const f of fs.readdirSync(pd).filter(x => x.endsWith('.json'))) { try { const c = JSON.parse(fs.readFileSync(path.join(pd, f), 'utf8'));
    local.push(c.company?.name, c.company?.cif, c.company?.regCom, c.company?.iban, c.smartbill?.series, c.smartbill?.carrefourClientId, c.carrefour?.supplierAccountId, c.carrefour?.supplierGln, c.carrefour?.supplierCifMustBe);
  } catch {} }
  const vals = [...new Set(local.filter(x => x != null && String(x).length >= 4).map(String))].filter(x => !x.includes(okCif));
  const hits = [];
  for (const f of shippedFiles()) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of t.match(/\bRO\d{2}[A-Z]{4}[0-9A-Z]{16}\b/g) || []) hits.push(`${f}: IBAN ${m.slice(0, 6)}...`);
    for (const m of t.match(/\bRO\d{6,10}\b/g) || []) if (m.replace(/\D/g, '') !== okCif) hits.push(`${f}: CIF ${m}`);
    for (const m of t.match(/\bJ\d{2}\/\d{1,6}\/\d{4}\b/g) || []) if (m !== okReg) hits.push(`${f}: Reg.com ${m}`);
    for (const v of vals) if (new RegExp(`(^|[^A-Za-z0-9])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9])`).test(t)) hits.push(`${f}: valoare din profilul local`);
  }
  return [...new Set(hits)];
}
module.exports = { run, forbiddenValues, shippedFiles };
