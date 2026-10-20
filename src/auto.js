'use strict';
const { wf, af, mv } = require('./fsx');
/**
 * Unattended run ("auto"): new Carrefour portal orders -> SmartBill DRAFTS (mode "ciorne", default) or invoices (mode "automat").
 * Idempotent: an order is skipped if Carrefour already lists an invoice for it, if it is in the local ledgers
 * (out/issued.json, out/drafts.json, out/auto-state.json) or if SmartBill already has an invoice/draft/CANCELLED invoice
 * mentioning it (checked again by fillInvoice before anything is saved). A cancelled invoice is never re-issued automatically.
 * Orders older than auto.startFrom (setup date) or auto.maxAgeDays are never invoiced automatically.
 * No AI: plain rules only.
 */
const fs = require('fs'); const path = require('path');
const nz = s => String(s || '').replace(/^0+/, '');
const iso = d => { const m = String(d || '').match(/^(\d{2})\.(\d{2})\.(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : (String(d || '').match(/^\d{4}-\d{2}-\d{2}/) || [null])[0]; };
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const os = require('os'); const HOST = (() => { try { return os.hostname(); } catch { return '?'; } })();
/** One run at a time (auto, bulk-ciorne, a single draft/invoice, the UI jobs).
 * Lock file = "pid\nhost\ntoken", created atomically (O_EXCL); a heartbeat refreshes its mtime every minute.
 * - same computer, process gone (crash, power cut) -> taken over at once;
 * - same computer, process alive -> busy; after 2 h without heartbeat the pid is assumed reused and the lock is taken over;
 *   the old holder (e.g. a laptop that slept for hours) notices with held() before its next order and stops;
 * - lock written by ANOTHER computer (folder synced by OneDrive/iCloud) -> busy for 2 h after its last heartbeat. */
const LOCK_STALE_MS = 2 * 3600e3; const LOCK_BEAT_MS = 60e3;
function readLock(f) { let st, txt; try { st = fs.statSync(f); txt = fs.readFileSync(f, 'utf8'); } catch { return null; }
  const [pid, host, token] = txt.split('\n'); return { pid: Number(pid) || 0, host: host || HOST, token: token || '', age: Date.now() - st.mtimeMs }; }
/** Read-only: is the lock held by a live run right now? (the UI polls this; it never creates or deletes the lock) */
function lockHeld(dir) { const l = readLock(path.join(dir, 'auto.lock')); if (!l) return false;
  if (l.pid === process.pid && l.host === HOST) return false;
  if (l.host !== HOST) return l.age < LOCK_STALE_MS;
  if (!l.pid) return l.age < 60e3;
  return l.age < LOCK_STALE_MS && alive(l.pid); }
function lock(dir) {
  const f = path.join(dir, 'auto.lock'); fs.mkdirSync(dir, { recursive: true });
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36); let got = false;
  for (let i = 0; i < 3 && !got; i++) {
    try { const fd = fs.openSync(f, 'wx'); fs.writeSync(fd, `${process.pid}\n${HOST}\n${token}`); fs.closeSync(fd); got = true; }
    catch (e) { if (e.code !== 'EEXIST') throw e;
      const l = readLock(f); if (!l) continue; // vanished meanwhile: try again
      if (lockHeld(dir)) return null;
      if (l.pid === process.pid && l.host === HOST) return null; // this process already holds it (nested call)
      try { fs.unlinkSync(f); } catch {} }
  }
  if (!got) return null;
  const mine = () => { const l = readLock(f); return !!l && l.token === token; };
  const beat = setInterval(() => { try { if (mine()) { const t = new Date(); fs.utimesSync(f, t, t); } } catch {} }, LOCK_BEAT_MS); beat.unref();
  const release = () => { clearInterval(beat); try { if (mine()) fs.unlinkSync(f); } catch {} };
  release.held = mine; return release;
}

/** Clear Romanian notice when the Carrefour session expired during an automatic check: file + desktop notification (max once per 6 h). */
function notifyLogin(out, L) {
  const msg = 'Sesiunea portalului Carrefour a expirat (sau portalul cere un cod CAPTCHA). Verificarea automata s-a oprit. Deschide programul si alege optiunea 5 (Autentificare Carrefour), apoi totul merge din nou singur.';
  wf(path.join(out, '..', '..', 'ATENTIE-autentificare-Carrefour.txt'), `[${new Date().toLocaleString('ro-RO')}]\r\n${msg}\r\n`);
  L('ATENTIE: ' + msg);
  const f = path.join(out, 'notificare-login.json'); const last = readJ(f, {}).at || 0;
  if (Date.now() - last < 6 * 3600e3 || process.env.KIT_NO_NOTIFY === '1') return false;
  wf(f, JSON.stringify({ at: Date.now() }));
  const { spawn } = require('child_process'); const short = 'Carrefour: autentificare necesara. Deschide programul, optiunea 5.';
  try {
    if (process.platform === 'darwin') spawn('osascript', ['-e', `display notification "${short}" with title "Carrefour -> SmartBill" sound name "Glass"`], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'win32') spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', `Add-Type -AssemblyName System.Windows.Forms; $n=New-Object System.Windows.Forms.NotifyIcon; $n.Icon=[System.Drawing.SystemIcons]::Warning; $n.Visible=$true; $n.ShowBalloonTip(20000,'Carrefour -> SmartBill','${short}','Warning'); Start-Sleep 21; $n.Dispose()`], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    else spawn('notify-send', ['Carrefour -> SmartBill', short], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch {}
  return true;
}

function desktopNotice(short) {
  if (process.env.KIT_NO_NOTIFY === '1') return false;
  const { spawn } = require('child_process'); short = String(short).replace(/["'`$\\]/g, ' ').slice(0, 240);
  try {
    if (process.platform === 'darwin') spawn('osascript', ['-e', `display notification "${short}" with title "Carrefour -> SmartBill" sound name "Glass"`], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'win32') spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', `Add-Type -AssemblyName System.Windows.Forms; $n=New-Object System.Windows.Forms.NotifyIcon; $n.Icon=[System.Drawing.SystemIcons]::Information; $n.Visible=$true; $n.ShowBalloonTip(20000,'Carrefour -> SmartBill','${short}','Info'); Start-Sleep 21; $n.Dispose()`], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    else spawn('notify-send', ['Carrefour -> SmartBill', short], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch { return false; }
  return true;
}
/** automat: hard ceiling on invoices per run, whatever the profile says (default 3). */
const AUTOMAT_MAX = 10;
const maxPerRun = (cfg, mode) => mode === 'automat' ? Math.max(1, Math.min(AUTOMAT_MAX, Math.floor(Number(cfg.auto?.maxPerRun)) || 3))
  : Math.max(1, Math.min(50, Math.floor(Number(cfg.auto?.maxPerRun ?? 10)) || 10));
const localDay = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

/** Decide, without touching SmartBill, which portal orders are candidates. */
function plan(orders, { cfg, ledgers, state, today = localDay() }) {
  const a = cfg.auto || {}; const start = /^\d{4}-\d{2}-\d{2}$/.test(String(a.startFrom || '')) && !isNaN(new Date(a.startFrom)) ? a.startFrom : today;
  const ma = Number(a.maxAgeDays ?? 14); const maxAge = Number.isFinite(ma) ? Math.max(0, Math.min(365, ma)) : 14;
  const minDate = new Date(Math.max(new Date(start), new Date(today) - maxAge * 864e5)).toISOString().slice(0, 10);
  const known = new Set([...Object.keys(ledgers.issued || {}), ...Object.keys(ledgers.drafts || {})].map(nz));
  const seen = new Set();
  return orders.filter(o => o && o.orderNo && !seen.has(nz(o.orderNo)) && seen.add(nz(o.orderNo))).map(o => {
    const d = iso(o.date); let skip = null;
    if (o.invoiceNumbers && String(o.invoiceNumbers).trim()) skip = `deja facturata la Carrefour (${o.invoiceNumbers})`;
    else if (known.has(nz(o.orderNo))) skip = 'deja in registrul local';
    else if (state[nz(o.orderNo)]?.needsHuman) skip = 'necesita verificare manuala: ' + state[nz(o.orderNo)].reason;
    else if (/anulat|respins|cancel/i.test(o.status || '')) skip = `stare portal: ${o.status}`;
    else if (!d || d < minDate) skip = `mai veche decat ${minDate} (nu se factureaza automat)`;
    return { orderNo: o.orderNo, date: d, store: o.store, total: o.total, skip };
  });
}

/** auto-state.json (per-order failure counters + "needs a person" flags). Damaged -> kept aside as .deteriorat-<time> and a warning;
 *  never silently forgotten (the ledgers + SmartBill report still block duplicates). */
function readState(f, L = () => {}) { let t; try { t = fs.readFileSync(f, 'utf8'); } catch { return {}; }
  try { const j = JSON.parse(t.replace(/^\uFEFF/, '') || '{}'); if (j && typeof j === 'object' && !Array.isArray(j)) return j; } catch {}
  const b = `${f}.deteriorat-${Date.now()}`; try { fs.renameSync(f, b); } catch {}
  L(`ATENTIE: fisierul ${path.basename(f)} era deteriorat; l-am pus deoparte (${path.basename(b)}). Comenzile marcate "necesita verificare" se verifica din nou in SmartBill inainte de orice salvare.`); return {}; }
/** Logs and screenshots must not grow forever (hundreds of orders x screenshots). Removed: logs/*.log older than 180 days,
 *  *.png/*.html diagnostics in out/<profil>/fill, login-diag, recon older than 60 days. NEVER: ledgers, invoice PDF/XML, .json results. */
function pruneOld(root, out, now = Date.now()) {
  const marker = path.join(out, '.curatare.json'); try { if (now - JSON.parse(fs.readFileSync(marker, 'utf8')).at < 86400e3) return 0; } catch {}
  let n = 0; const old = (f, days) => { try { return now - fs.statSync(f).mtimeMs > days * 86400e3; } catch { return false; } };
  const walk = (d, fn, depth = 0) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory() && depth < 3) walk(p, fn, depth + 1); else if (e.isFile()) fn(p); } };
  walk(path.join(root, 'logs'), f => { if (/\.log$/i.test(f) && old(f, 180)) { try { fs.unlinkSync(f); n++; } catch {} } });
  for (const sub of ['fill', 'login-diag', 'recon']) walk(path.join(out, sub), f => { if (/\.(png|html)$/i.test(f) && old(f, 60)) { try { fs.unlinkSync(f); n++; } catch {} } });
  for (const p of ['meniu-istoric.log', 'ui.log'].map(f => path.join(root, 'logs', f)).concat(['auto-launchd.log', 'auto-cron.log'].map(f => path.join(root, 'out', f)))) { try { if (fs.statSync(p).size > 5e6) { const t = fs.readFileSync(p, 'utf8'); fs.writeFileSync(p, t.slice(-2e6)); n++; } } catch {} }
  wf(marker, JSON.stringify({ at: now, removed: n })); return n;
}

async function runOnce(profile, { log = console.log, mode: forced, check = false } = {}) {
  let issuedNow = [];
  const cfg = profile.cfg; const out = profile.dirs.out; const logs = path.join(out, '..', 'logs');
  fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(logs, { recursive: true });
  const mode = forced || cfg.auto?.mode || 'ciorne';
  // automat, first run in this folder = dry-run only (lists what WOULD be issued); real issuing starts from the next run
  const armFile = path.join(out, 'automat-armat.json');
  if (mode === 'automat' && !check && !fs.existsSync(armFile)) { check = true; var firstDry = true; }
  const logFile = path.join(logs, `auto-${localDay()}.log`);
  const L = m => { const line = `[${new Date().toLocaleString('ro-RO')}] ${m}`; log(line); af(logFile, line + '\n'); };
  const unlock = lock(out); if (!unlock) { L('Alta operatiune a programului ruleaza deja (verificare automata, ciorne in bloc sau o ciorna); nu pornesc a doua oara. Reincerc la urmatoarea verificare.'); return { busy: true, exit: 13 }; }
  const stateFile = path.join(out, 'auto-state.json'); const state = readState(stateFile, L);
  try { pruneOld(profile.root || path.join(out, '..', '..'), out); } catch {}
  const summary = { at: new Date().toISOString(), mode: check ? 'verificare' : mode, done: [], skipped: [], errors: [] };
  try {
    if (firstDry) L('Prima rulare in mod AUTOMAT: doar verificare (nu emit nimic). Facturile se emit de la urmatoarea rulare.');
    L(`Verific comenzile noi din portalul Carrefour (mod: ${check ? 'doar verificare' : mode === 'automat' ? 'AUTOMAT - emite facturi' : 'DOAR CIORNE'})...`);
    let orders;
    try { orders = (await require('./carrefourPortal').discoverCarrefour(profile, { maxDetails: 0, log: () => {} })).orders || []; }
    catch (e) { if (e.code === 'CAPTCHA') { notifyLogin(out, L); summary.errors.push({ captcha: true }); summary.loginNeeded = true; summary.exit = 3; return summary; }
      const c = require('./errors').classify(e); summary.exit = c.exit; throw e; }
    { const n = path.join(out, '..', '..', 'ATENTIE-autentificare-Carrefour.txt'); if (fs.existsSync(n)) { fs.mkdirSync(path.join(out, 'notificari'), { recursive: true }); mv(n, path.join(out, 'notificari', `rezolvat-${Date.now()}.txt`)); } }
    const { readLedger } = require('./fsx'); const ledgers = { issued: readLedger(path.join(out, 'issued.json')), drafts: readLedger(path.join(out, 'drafts.json')) };
    const p = plan(orders, { cfg, ledgers, state });
    const todo = p.filter(x => !x.skip).slice(0, maxPerRun(cfg, mode));
    summary.skipped = p.filter(x => x.skip).map(x => ({ orderNo: x.orderNo, why: x.skip }));
    L(`${orders.length} comenzi in portal; ${todo.length} noi de procesat.`);
    for (const o of todo) {
      if (!check && unlock.held && !unlock.held()) { summary.stopped = 'lacatul a fost preluat de alta rulare'; L('Calculatorul a stat (somn) prea mult si alta rulare a preluat lucrul; ma opresc aici ca sa nu lucram doi deodata. Ce e facut ramane.'); break; }
      if (check) { summary.done.push({ orderNo: o.orderNo, would: mode === 'automat' ? 'factura' : 'ciorna' }); L(`  ${o.orderNo} (${o.date}, ${o.store}) -> ar fi ${mode === 'automat' ? 'facturata' : 'ciorna'}`); continue; }
      try {
        const r = await require('./fillInvoice').run(profile, { orderNo: o.orderNo, issue: mode === 'automat', draftOnly: mode !== 'automat', log: () => {} });
        const i = r.issued || {}; summary.done.push({ orderNo: o.orderNo, result: mode === 'automat' ? `factura ${i.number || i.invoiceId || ''}` : `ciorna id ${i.invoiceId || ''}` });
        L(`  ${o.orderNo}: ${mode === 'automat' ? 'FACTURA emisa ' + (i.number || i.invoiceId || '') : 'CIORNA creata (id ' + (i.invoiceId || '?') + ') - verific-o si emite-o din SmartBill > Rapoarte > Facturi > Filtrare > Ciorna'}`);
        if (mode === 'automat') issuedNow.push({ orderNo: o.orderNo, number: i.number || null, invoiceId: i.invoiceId || null, store: o.store, total: o.total });
        delete state[nz(o.orderNo)];
      } catch (e) {
        if (e.code === 'CAPTCHA' || e.code === 'WRONG_ACCOUNT') { if (e.code === 'CAPTCHA') { notifyLogin(out, L); summary.loginNeeded = true; } summary.exit = require('./errors').classify(e).exit; summary.errors.push({ orderNo: o.orderNo, error: e.message.split('\n')[0] }); break; }
        const msg = e.message.split('\n')[0];
        // SmartBill busy / rate limit / no internet BEFORE anything was saved: not the order's fault -> no failure counted, stop, retry next hour
        if (e.code === 'NETWORK' || e.code === 'RATE') { summary.exit = 5; summary.errors.push({ orderNo: o.orderNo, error: msg, transient: true }); L(`  ${o.orderNo}: ${msg}`); L(e.code === 'RATE' ? 'SmartBill cere sa incetinim (prea multe cereri); ma opresc si reiau la urmatoarea verificare. Nu s-a salvat nimic pentru aceasta comanda.' : 'Internetul sau SmartBill nu raspunde; ma opresc si reiau la urmatoarea verificare. Nu s-a salvat nimic pentru aceasta comanda.'); break; }
        const st = state[nz(o.orderNo)] = state[nz(o.orderNo)] || { fails: 0 };
        if (e.code === 'DUPLICATE') { st.needsHuman = e.kind === 'cancelled'; st.reason = msg; summary.skipped.push({ orderNo: o.orderNo, why: msg }); L(`  ${o.orderNo}: sarita - ${msg}`); }
        else { st.fails++; st.last = msg; if (e.code === 'NEEDS_HUMAN' || e.code === 'CONFIG' || e.code === 'SAVE_UNKNOWN' || st.fails >= 3) { st.needsHuman = true; st.reason = st.fails >= 3 ? `3 incercari esuate: ${msg}` : msg; } summary.errors.push({ orderNo: o.orderNo, error: msg }); L(`  ${o.orderNo}: EROARE - ${msg}${st.needsHuman ? ' (nu mai incerc automat)' : ''}`); }
        // automat: any doubt (unknown save result, XML check, needs a person) stops the WHOLE run, not only this order
        if (mode === 'automat' && e.code !== 'DUPLICATE') { st.needsHuman = true; st.reason = st.reason || msg; summary.stopped = msg; summary.exit = 11; if (e.code === 'SAVE_UNKNOWN') summary.saveUnknown = { orderNo: o.orderNo, invoiceId: e.invoiceId || null }; L('Mod AUTOMAT: m-am oprit dupa aceasta eroare (nu continui cu alte comenzi).'); break; }
        if (/\b403\b|Forbidden/.test(msg)) { L('SmartBill limiteaza temporar accesul (403); ma opresc si reiau la urmatoarea verificare.'); break; }
        if (require('./errors').classify(e).exit === 5) { summary.exit = 5; L('Internetul sau SmartBill nu raspunde; ma opresc si reiau la urmatoarea verificare.'); break; }
      }
      await new Promise(r => setTimeout(r, Number(process.env.KIT_RATE_MS || 30000))); // SmartBill rate limit (tests: KIT_RATE_MS)
    }
  } catch (e) { const c = require('./errors').classify(e); summary.exit = summary.exit || c.exit; summary.errors.push({ error: c.message.split('\n')[0] }); L('EROARE: ' + c.message.split('\n')[0]); }
  finally {
    wf(stateFile, JSON.stringify(state, null, 2)); unlock();
    if (firstDry && !summary.errors.length) wf(armFile, JSON.stringify({ at: new Date().toISOString(), wouldIssue: summary.done.map(d => d.orderNo) }, null, 2));
    if (mode === 'automat' && !check) {
      summary.issued = issuedNow;
      if (issuedNow.length || summary.stopped) {
        const lines = issuedNow.map(x => `factura ${x.number || '(nr necunoscut, id ' + x.invoiceId + ')'} - comanda ${x.orderNo}${x.store ? ' - ' + x.store : ''}`);
        af(path.join(out, '..', '..', 'FACTURI-EMISE-AUTOMAT.txt'), `[${new Date().toLocaleString('ro-RO')}] ${issuedNow.length} facturi emise${summary.stopped ? ' | OPRIT: ' + summary.stopped : ''}\r\n${lines.map(l => '  ' + l + '\r\n').join('')}`);
        summary.notified = desktopNotice(issuedNow.length ? `${issuedNow.length} facturi emise: ${issuedNow.map(x => x.number || x.orderNo).join(', ')}${summary.stopped ? '. OPRIT - verifica' : ''}` : 'Emitere automata OPRITA - verifica fisierul FACTURI-EMISE-AUTOMAT.txt');
      }
    }
    const line = `REZUMAT: ${summary.done.length} ${check ? 'de procesat' : 'procesate'}, ${summary.skipped.length} sarite, ${summary.errors.length} erori.`;
    L(line); wf(path.join(out, 'auto-ultimul-rezumat.json'), JSON.stringify({ ...summary, text: line }, null, 2));
  }
  return summary;
}

/** Repeat every N minutes. Stops (never loops) when a person is needed: Carrefour login, wrong account, broken config/install. */
async function watch(profile, { every = 60, maxRuns = Infinity, ...o } = {}) {
  for (let i = 0; i < maxRuns; i++) {
    const r = await runOnce(profile, o);
    if ([3, 4, 6, 9, 10, 12].includes(r.exit) || (r.exit === 11 && r.stopped)) { (o.log || console.log)('Verificarea automata s-a oprit: e nevoie de tine (vezi mesajul de mai sus).'); return r; }
    if (i + 1 < maxRuns) await new Promise(r => setTimeout(r, every * 60e3));
  }
  return { exit: 0 };
}
module.exports = { maxPerRun, desktopNotice, runOnce, watch, plan, lock, lockHeld, localDay, notifyLogin, pruneOld, readState };
