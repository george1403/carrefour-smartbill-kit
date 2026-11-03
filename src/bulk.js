'use strict';
/**
 * "Ciorne in bloc": EVERY Carrefour portal order that is not invoiced yet -> SmartBill DRAFT (ciorna), in batches.
 * - ignores auto.startFrom / auto.maxAgeDays (old orders included)
 * - skips: invoiced at Carrefour, in out/issued.json, issued/cancelled in SmartBill (fillInvoice re-checks the report),
 *   cancelled/rejected in the portal, orders flagged "needs manual review"
 * - orders that already have a draft (out/drafts.json or SmartBill report) are NOT drafted again: "are deja ciorna (id X)"
 * - ALWAYS draft-only, whatever the profile mode (also "automat"): fillInvoice.run({ issue:false, draftOnly:true }). Never issues.
 * - keeps every safeguard: same lock as "auto", supplier guard (discoverCarrefour/checkSupplier), CAPTCHA handling,
 *   duplicate re-check + XML check inside fillInvoice.
 * - preview + confirmation ("da") before anything is created; --check = preview only.
 */
const fs = require('fs'); const path = require('path');
const { wf, af } = require('./fsx');
const { lock, notifyLogin } = require('./auto');
const nz = s => String(s || '').replace(/^0+/, '');
const iso = d => { const m = String(d || '').match(/^(\d{2})\.(\d{2})\.(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : (String(d || '').match(/^\d{4}-\d{2}-\d{2}/) || [null])[0]; };
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const money = n => (Math.round(Number(n || 0) * 100) / 100).toFixed(2);

/** Classify portal orders without touching SmartBill. No date limits. */
function bulkPlan(orders, { ledgers = {}, state = {} } = {}) {
  const find = (L, n) => { const k = Object.keys(L || {}).find(x => nz(x) === nz(n)); return k ? L[k] : null; };
  const seen = new Set();
  return orders.filter(o => o && o.orderNo && !seen.has(nz(o.orderNo)) && seen.add(nz(o.orderNo))).map(o => {
    const base = { orderNo: o.orderNo, date: iso(o.date), store: o.store || null, total: o.total != null ? Number(o.total) : null };
    const iss = find(ledgers.issued, o.orderNo); const dr = find(ledgers.drafts, o.orderNo); const st = state[nz(o.orderNo)];
    if (o.invoiceNumbers && String(o.invoiceNumbers).trim()) return { ...base, skip: `deja facturata la Carrefour (${o.invoiceNumbers})` };
    if (iss && iss.status !== 'pending' && iss.status !== 'unknown') return { ...base, skip: `deja in registrul facturilor emise (${iss.number || 'id ' + (iss.invoiceId || '?')})` };
    // an interrupted / unclear earlier save (crash, timeout): an invoice or draft MAY exist -> a person checks, never redone in bulk
    if (iss || (dr && (dr.status === 'pending' || dr.status === 'unknown'))) return { ...base, skip: `salvare neclara intr-o rulare anterioara (${(iss || dr).status}); verifica in SmartBill (Facturi si Ciorne) comanda ${o.orderNo}` };
    if (/anulat|respins|refuzat|cancel|reject/i.test(o.status || '')) return { ...base, skip: `stare portal: ${o.status}` };
    if (st && st.needsHuman) return { ...base, skip: 'necesita verificare manuala: ' + (st.reason || '') };
    if (dr && dr.invoiceId && dr.status !== 'pending' && dr.status !== 'unknown') return { ...base, draft: String(dr.invoiceId) };
    return base;
  });
}

function previewText(p) {
  const todo = p.filter(x => !x.skip && !x.draft); const sum = todo.reduce((t, x) => t + (Number(x.total) || 0), 0);
  const L = [`CIORNE IN BLOC - previzualizare (nu s-a creat nimic inca)`, `De facut ciorna: ${todo.length} comenzi, total ${money(sum)} lei fara TVA`];
  todo.forEach((x, i) => L.push(`  ${String(i + 1).padStart(3)}. ${String(x.orderNo).padEnd(9)} ${String(x.date || '').padEnd(10)} ${String(x.store || '').padEnd(26)} ${x.total != null ? money(x.total).padStart(10) : '         ?'} lei`));
  const dr = p.filter(x => x.draft); if (dr.length) { L.push(`Au deja ciorna (nu se dubleaza): ${dr.length}`); dr.forEach(x => L.push(`       ${x.orderNo}: are deja ciorna (id ${x.draft})`)); }
  const sk = p.filter(x => x.skip); if (sk.length) { L.push(`Sarite: ${sk.length}`); sk.forEach(x => L.push(`       ${x.orderNo}: ${x.skip}`)); }
  L.push('Nota: inainte de fiecare ciorna se reverifica in SmartBill (facturi/ciorne/anulate); NU se emite nicio factura.');
  return { text: L.join('\n'), todo, sum };
}

async function askYes(q) {
  if (require('./testenv').hook('KIT_BULK_CONFIRM')) return require('./testenv').hook('KIT_BULK_CONFIRM');
  
  // Use readline but keep it very simple
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question(q, (answer) => {
      rl.close();
      // Clean up stdin properly
      process.stdin.pause();
      if (process.stdin.unref) process.stdin.unref();
      resolve(answer);
    });
  });
}

/**
 * opts: check (preview only), confirm (async fn(text) -> answer; default asks on stdin), batch (default 10), log.
 * Returns the report { created, alreadyDraft, skipped, errors, exit }.
 */
async function run(profile, { check = false, confirm = null, batch = 10, log = console.log } = {}) {
  const out = profile.dirs.out; const logs = path.join(out, '..', 'logs'); fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(logs, { recursive: true });
  const logFile = path.join(logs, `bulk-ciorne-${require('./auto').localDay()}.log`);
  const L = m => { log(m); af(logFile, `[${new Date().toLocaleString('ro-RO')}] ${m}\n`); };
  batch = Math.max(1, Math.min(50, Number(batch) || 10));
  const rep = { at: new Date().toISOString(), mode: check ? 'previzualizare' : 'ciorne', profileMode: profile.cfg.auto?.mode || 'ciorne', created: [], alreadyDraft: [], skipped: [], errors: [], remaining: [] };
  const unlock = lock(out); if (!unlock) { L('Alta rulare (auto / ciorne in bloc) e in curs; ies. Incearca din nou peste cateva minute.'); rep.busy = true; rep.exit = 13; return rep; }
  const stateFile = path.join(out, 'auto-state.json'); const state = require('./auto').readState(stateFile, L);
  try {
    if (rep.profileMode === 'automat') L('Profilul e in mod AUTOMAT, dar "ciorne in bloc" face DOAR ciorne (nu emite nicio factura).');
    L('Citesc TOATE comenzile din portalul Carrefour (fara limita de data)...');
    let orders;
    try { orders = (await require('./carrefourPortal').discoverCarrefour(profile, { maxDetails: 0, log: () => {} })).orders || []; }
    catch (e) { if (e.code === 'CAPTCHA') { notifyLogin(out, L); rep.loginNeeded = true; rep.exit = 3; rep.errors.push({ error: e.message.split('\n')[0] }); return rep; } throw e; }
    const { readLedger } = require('./fsx'); const ledgers = { issued: readLedger(path.join(out, 'issued.json')), drafts: readLedger(path.join(out, 'drafts.json')) };
    const p = bulkPlan(orders, { ledgers, state });
    rep.portalOrders = orders.length;
    for (const x of p) { if (x.skip) rep.skipped.push({ orderNo: x.orderNo, why: x.skip }); else if (x.draft) rep.alreadyDraft.push({ orderNo: x.orderNo, draftId: x.draft, why: `are deja ciorna (id ${x.draft})` }); }
    const pv = previewText(p); L(pv.text); rep.preview = pv.todo.map(x => ({ orderNo: x.orderNo, date: x.date, store: x.store, total: x.total })); rep.previewTotal = Number(money(pv.sum));
    if (check) { L('Doar lista (optiunea 10): nu am creat nimic. Ca sa le creezi, alege 9.'); return rep; }
    if (!pv.todo.length) { L('Nimic de facut: nu exista comenzi nefacturate fara ciorna.'); return rep; }
    const ans = String(await (confirm || askYes)(`\nCreez ${pv.todo.length} ciorne in SmartBill (in loturi de ${batch})? Scrie "da" pentru a continua: `) || '').trim().toLowerCase();
    if (ans !== 'da') { L('Nu ai confirmat cu "da": nu am creat nimic.'); rep.cancelled = true; rep.remaining = pv.todo.map(x => x.orderNo); return rep; }
    const fi = require('./fillInvoice'); const rate = Number(require('./testenv').hook('KIT_RATE_MS') || 30000);
    let stop = null;
    for (let b = 0; b < pv.todo.length && !stop; b += batch) {
      const lot = pv.todo.slice(b, b + batch); L(`Lot ${b / batch + 1}/${Math.ceil(pv.todo.length / batch)}: ${lot.map(x => x.orderNo).join(', ')}`);
      for (const o of lot) {
        if (stop) { rep.remaining.push(o.orderNo); continue; }
        if (unlock.held && !unlock.held()) { stop = 'alta rulare a preluat lucrul (calculatorul a stat in somn mult timp)'; rep.exit = 13; rep.remaining.push(o.orderNo); L('Calculatorul a stat (somn) prea mult si alta rulare a preluat lucrul; ma opresc. Ce e facut ramane; reia optiunea mai tarziu.'); continue; }
        try {
          // ALWAYS draft-only: issue:false + draftOnly:true (never finalized, whatever the profile mode)
          const r = await fi.run(profile, { orderNo: o.orderNo, issue: false, draftOnly: true, log: () => {} });
          const id = r && r.issued && r.issued.invoiceId || null;
          rep.created.push({ orderNo: o.orderNo, draftId: id, date: o.date, store: o.store, total: o.total }); L(`  ${o.orderNo}: CIORNA creata (id ${id || '?'})`);
          delete state[nz(o.orderNo)];
        } catch (e) {
          const msg = String(e.message || e).split('\n')[0];
          if (e.code === 'CAPTCHA' || e.code === 'WRONG_ACCOUNT') { if (e.code === 'CAPTCHA') { notifyLogin(out, L); rep.loginNeeded = true; } rep.exit = require('./errors').classify(e).exit; rep.errors.push({ orderNo: o.orderNo, error: msg }); stop = msg; L(`  ${o.orderNo}: OPRIT - ${msg}`); continue; }
          if (e.code === 'DUPLICATE' && e.kind === 'draft') { const id = e.draftId || (msg.match(/\(id (\d+)/) || [])[1] || '?'; rep.alreadyDraft.push({ orderNo: o.orderNo, draftId: id, why: `are deja ciorna (id ${id})` }); L(`  ${o.orderNo}: are deja ciorna (id ${id}) - nu o dublez`); continue; }
          const st = state[nz(o.orderNo)] = state[nz(o.orderNo)] || { fails: 0 };
          if (e.code === 'DUPLICATE') { if (e.kind === 'cancelled') { st.needsHuman = true; st.reason = msg; } rep.skipped.push({ orderNo: o.orderNo, why: msg }); L(`  ${o.orderNo}: sarita - ${msg}`); continue; }
          if (e.code === 'NETWORK' || e.code === 'RATE') { stop = e.code === 'RATE' ? 'SmartBill cere sa incetinim (prea multe cereri)' : 'fara internet / SmartBill nu raspunde'; rep.exit = 5; rep.errors.push({ orderNo: o.orderNo, error: msg, transient: true }); rep.remaining.push(o.orderNo); L(`  ${o.orderNo}: ${msg}`); L('Ma opresc. Pentru aceasta comanda nu s-a salvat nimic; reia optiunea mai tarziu (ce e facut nu se dubleaza).'); continue; }
          st.fails++; st.last = msg; if (e.code === 'NEEDS_HUMAN' || e.code === 'CONFIG' || e.code === 'SAVE_UNKNOWN') { st.needsHuman = true; st.reason = msg; }
          rep.errors.push({ orderNo: o.orderNo, error: msg }); L(`  ${o.orderNo}: EROARE - ${msg}`);
          if (/\b403\b|Forbidden/.test(msg)) { stop = 'SmartBill limiteaza temporar accesul (403)'; L('SmartBill limiteaza temporar accesul; ma opresc. Reia optiunea mai tarziu (ce e facut nu se dubleaza).'); }
          else if (require('./errors').classify(e).exit === 5) { stop = 'fara internet / SmartBill nu raspunde'; rep.exit = 5; L('Internetul sau SmartBill nu raspunde; ma opresc. Reia optiunea 9 mai tarziu (ce e facut nu se dubleaza).'); }
          else if (e.code === 'SAVE_UNKNOWN') { stop = msg; rep.exit = 11; L('Salvare neclara in SmartBill: ma opresc ca sa verifici tu (vezi mesajul).'); }
        } finally { if (!stop) await new Promise(r => setTimeout(r, rate)); }
      }
    }
    if (stop) { rep.stopped = stop; rep.exit = rep.exit || 11; }
  } catch (e) { const c = require('./errors').classify(e); rep.exit = rep.exit || c.exit; rep.errors.push({ error: c.message.split('\n')[0] }); L('EROARE: ' + c.message.split('\n')[0]); }
  finally {
    wf(stateFile, JSON.stringify(state, null, 2)); unlock();
    // the CAPTCHA OCR (tesseract.js) worker keeps a MessagePort open -> stop it, or the process hangs after the report
    try { await require('./captchaOcr').terminate(); } catch {}
    if (rep.exit == null) rep.exit = rep.errors.length ? 1 : 0;
    rep.text = reportText(rep); L(rep.text);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    wf(path.join(out, `bulk-ciorne-${stamp}.json`), JSON.stringify(rep, null, 2)); wf(path.join(out, 'bulk-ciorne-ultimul-raport.json'), JSON.stringify(rep, null, 2));
    // Opt. 9 catches per-order errors (exit 1) without throwing — mirror them into ultima-eroare for support ZIPs.
    if (rep.errors && rep.errors.length) {
      try {
        const logsDir = path.join(profile.root, 'logs');
        fs.mkdirSync(logsDir, { recursive: true });
        const lines = [`[${new Date().toLocaleString('ro-RO')}] comanda: bulk-ciorne | cod ${rep.exit}`,
          `EROARE: ${rep.errors.length} comenzi esuate la ciorne in bloc`,
          ...rep.errors.slice(0, 30).map(e => `  ${e.orderNo || '-'}: ${e.error || '?'}`),
          rep.stopped ? `oprit: ${rep.stopped}` : ''].filter(Boolean);
        fs.writeFileSync(path.join(logsDir, 'ultima-eroare.txt'), lines.join('\n') + '\n');
      } catch {}
    }
  }
  return rep;
}

function reportText(r) {
  const L = [`RAPORT CIORNE IN BLOC${r.mode === 'previzualizare' ? ' (doar previzualizare)' : ''}: ${r.created.length} create, ${r.alreadyDraft.length} aveau deja ciorna, ${r.skipped.length} sarite, ${r.errors.length} erori.`];
  if (r.created.length) { L.push('Create:'); r.created.forEach(x => L.push(`  ${x.orderNo}: ciorna id ${x.draftId || '?'}`)); }
  if (r.alreadyDraft.length) { L.push('Deja ciorna:'); r.alreadyDraft.forEach(x => L.push(`  ${x.orderNo}: are deja ciorna (id ${x.draftId})`)); }
  if (r.skipped.length) { L.push('Sarite:'); r.skipped.forEach(x => L.push(`  ${x.orderNo}: ${x.why}`)); }
  if (r.errors.length) { L.push('Erori:'); r.errors.forEach(x => L.push(`  ${x.orderNo || '-'}: ${x.error}`)); }
  if (r.remaining && r.remaining.length) L.push(`Neprocesate (${r.cancelled ? 'neconfirmat' : 'oprit'}): ${r.remaining.join(', ')}`);
  if (r.created.length) L.push('Ciornele sunt in SmartBill > Rapoarte > Facturi > Filtrare > Ciorna: verifica-le si emite-le tu. Programul NU a emis nicio factura.');
  return L.join('\n');
}
module.exports = { run, bulkPlan, previewText, reportText };
