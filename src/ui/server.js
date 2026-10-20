'use strict';
/**
 * Interfata grafica locala (meniu 0-15 in browser). Serverul ruleaza in procesul kitului, DOAR pe 127.0.0.1,
 * pe un port liber ales la intamplare, cu un token pe sesiune (in adresa paginii). Nu contine logica noua:
 * fiecare buton porneste ACEEASI comanda ca meniul text (bin/kit.js <comanda>, proces copil), iar rezultatul
 * e citit din fisierele scrise de motor (rapoarte, registre). Regulile de siguranta raman cele din motor:
 * ciorne in bloc = doar ciorne, confirmare explicita; o singura actiune odata (+ lock-ul comun auto/bulk).
 * Securitate: Host + token (comparat in timp constant) la fiecare cerere; POST doar JSON + antet X-Kit-Token
 * (+ Origin, daca exista) => CSRF imposibil; .env / parolele nu sunt trimise niciodata (iesirea e cenzurata).
 */
const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto'); const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..', '..'); const KIT = path.join(ROOT, 'bin', 'kit.js');
const { wf } = require('../fsx');
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { return d; } };
const tail = (f, n) => { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).slice(-n); } catch { return []; } };
const DIGITS = s => String(s || '').replace(/\D/g, '').slice(0, 12);

// Actions = the same commands as menu.js ITEMS (same numbers in history)
const ACTIONS = {
  orders: { k: '1', title: 'Comenzile Carrefour', args: () => ['orders'] },
  ciorna: { k: '2', title: 'Ciornă pentru comanda', args: a => ['ciorna', a.order], need: 'order' },
  preview: { k: '3', title: 'Previzualizare comanda', args: a => ['preview', a.order], need: 'order' },
  auto: { k: '4', title: 'Verificare acum (comenzile noi)', args: () => ['auto'], lock: true },
  login: { k: '5', title: 'Autentificare Carrefour', args: () => ['login-carrefour'] },
  'import-list': { k: '8', title: 'Caut kitul vechi', args: () => ['import-config', '--list'], noProfile: true },
  import: { k: '8', title: 'Preiau setarile din kitul vechi', args: a => ['import-config', a.dir], noProfile: true, internal: true },
  setup: { k: '6', title: 'Configurare', args: () => ['setup'], noProfile: true },
  selftest: { k: '7', title: 'Verificare instalare', args: () => ['selftest'], noProfile: true },
  'bulk-check': { k: '10', title: 'Ciorne în bloc: lista', args: () => ['bulk-ciorne', '--check'], lock: true },
  'bulk-create': { k: '9', title: 'Ciorne în bloc: creare', args: () => ['bulk-ciorne'], lock: true, internal: true },
  'schedule-on': { k: '11', title: 'Verificare automată: pornire', args: () => ['schedule'] },
  'schedule-off': { k: '11', title: 'Verificare automată: oprire', args: () => ['schedule', '--remove'], noProfile: true },
  discover: { k: '12', title: 'Recitire date SmartBill și Carrefour', args: () => ['discover'] },
  support: { k: '13', title: 'Raport suport', args: () => ['support'], noProfile: true },
  repair: { k: '14', title: 'Reparare instalare', args: () => ['repair'], noProfile: true },
  uninstall: { k: '15', title: 'Dezinstalare', args: () => ['uninstall'], noProfile: true, confirm: true },
};

function create({ demo = null, idleMs = 30 * 60e3, log = () => {} } = {}) {
  const token = crypto.randomBytes(24).toString('hex');
  let port = 0; let job = null; let jobSeq = 0; let lastHit = Date.now(); let bulkOffer = null; let importOffer = null; let closing = false;
  const support = require('../support');
  const profileName = () => { try { return process.env.KIT_PROFILE || fs.readFileSync(path.join(ROOT, 'profiles', '.default'), 'utf8').trim() || null; } catch { return null; } };
  const outDir = () => { const p = profileName(); return p ? path.join(ROOT, 'out', p) : null; };
  // every value from .env + typed answers are replaced by *** before anything reaches the browser
  const extraSecrets = new Set();
  const clean = t => { const vals = support.secretValues(ROOT).concat([...extraSecrets]).sort((a, b) => b.length - a.length); return support.redact(String(t), vals).replace(/[\w.+-]*\*\*\*@[\w.-]+/g, '***@***').replace(/\x1b\[[0-9;]*m/g, ''); };
  const hist = (k, title, rc) => { try { fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true }); fs.appendFileSync(path.join(ROOT, 'logs', 'meniu-istoric.log'), `[${new Date().toLocaleString('ro-RO')}] optiunea ${k} (${title}, interfata) -> cod ${rc}\n`); } catch {} };

  function engineBusy() { // the shared lock of auto / bulk-ciorne (a scheduled run may hold it)
    const o = outDir(); if (!o || !fs.existsSync(path.join(o, 'auto.lock'))) return false;
    const { lock } = require('../auto'); const un = lock(o); if (!un) return true; un(); return false;
  }

  function status() {
    const name = profileName(); let prof = null, profErr = null;
    try { if (name) { const p = require('../config').loadProfile(name); prof = p; } } catch (e) { profErr = e.message.split('\n')[0]; }
    const o = outDir(); const cfg = prof ? prof.cfg : {};
    const problems = [];
    for (const f of fs.readdirSync(ROOT)) if (/^ATENTIE.*\.txt$/i.test(f)) { const t = tail(path.join(ROOT, f), 3).join(' '); problems.push({ kind: /autentific/i.test(f) ? 'login' : 'other', text: t.replace(/^\[[^\]]*\]\s*/, '').slice(0, 400), file: f }); }
    if (o) {
      const st = readJ(path.join(o, 'auto-state.json'), {}); for (const [nr, v] of Object.entries(st)) if (v && v.needsHuman) problems.push({ kind: 'order', text: `Comanda ${nr} are nevoie de verificarea ta: ${String(v.reason || v.last || '').slice(0, 200)}` });
      for (const L of ['issued.json', 'drafts.json']) for (const [nr, v] of Object.entries(readJ(path.join(o, L), {}))) if (v && /pending|unknown|finalizing/.test(v.status || '')) problems.push({ kind: 'order', text: `Comanda ${nr}: salvare neclara (${v.status}). Verifica in SmartBill > Facturi si Ciorne.` });
    }
    if (process.platform === 'win32') { try { if (fs.existsSync(path.join(ROOT, 'run.bat') + ':Zone.Identifier')) problems.push({ kind: 'other', text: require('../errors').BLOCKED_MSG }); } catch {} }
    if (!fs.existsSync(path.join(ROOT, '.env')) || !prof) problems.unshift({ kind: 'setup', text: profErr || 'Programul nu este configurat inca.' });
    let sched = false; try { sched = !!require('../schedule').current(); } catch {}
    const h = tail(path.join(ROOT, 'logs', 'meniu-istoric.log'), 1)[0] || null;
    return { demo: !!demo, configured: !!prof && !(prof.missing || []).length, profile: name, company: cfg.company && cfg.company.name || null, series: cfg.smartbill && cfg.smartbill.series || null,
      mode: cfg.auto && cfg.auto.mode || null, armed: !!(o && fs.existsSync(path.join(o, 'automat-armat.json'))), maxPerRun: cfg.auto && cfg.auto.maxPerRun || null,
      schedule: sched, envSaved: fs.existsSync(path.join(ROOT, '.env')), lastRun: h ? clean(h) : null, problems: problems.slice(0, 20).map(p => ({ ...p, text: clean(p.text) })),
      busy: !!(job && job.running) || engineBusy(), job: job ? { id: job.id, action: job.action, running: job.running } : null, platform: process.platform };
  }

  function history() {
    const o = outDir(); const reps = [];
    if (o && fs.existsSync(o)) for (const f of fs.readdirSync(o).filter(f => /^bulk-ciorne-\d.*\.json$/.test(f)).sort().reverse().slice(0, 10)) { const r = readJ(path.join(o, f), null); if (r) reps.push({ at: r.at, mode: r.mode, created: (r.created || []).length, alreadyDraft: (r.alreadyDraft || []).length, skipped: (r.skipped || []).length, errors: (r.errors || []).length }); }
    const drafts = o ? Object.entries(readJ(path.join(o, 'drafts.json'), {})).slice(-30).reverse().map(([nr, v]) => ({ orderNo: nr, status: v && v.status, id: v && v.invoiceId || null })) : [];
    return { menu: tail(path.join(ROOT, 'logs', 'meniu-istoric.log'), 60).reverse().map(clean), bulk: reps, drafts, issued: tail(path.join(ROOT, 'FACTURI-EMISE-AUTOMAT.txt'), 40).map(clean) };
  }

  // setup: the 4 answers (and mode / schedule) are typed by the kit, never shown; other questions go to the page
  function setupAnswers(a) {
    const s = v => String(v == null ? '' : v).replace(/[\r\n]/g, '').slice(0, 200);
    const reuse = !!a.reuse; const L = [[/Le folosesc\?/, reuse ? 'da' : 'nu']];
    if (!reuse) { const v = [s(a.email), s(a.password), s(a.carrefourUser), s(a.carrefourPassword)]; v.forEach(x => x.length >= 3 && extraSecrets.add(x));
      L.push([/^1\/4/, v[0], 1], [/^2\/4/, v[1], 1], [/^3\/4/, v[2], 1], [/^4\/4/, v[3], 1]); }
    L.push([/Scrie 1 sau 2/, a.mode === 'automat' ? '2' : '1'], [/la fiecare ora.*\(da\/nu\)/, a.schedule ? 'da' : 'nu']);
    return L.map(([re, val, secret]) => ({ re, val, secret: !!secret }));
  }

  function start(action, a = {}, extraEnv = {}) {
    const def = ACTIONS[action];
    if (job && job.running) return { error: 'busy', message: 'Programul lucreaza deja la: ' + job.title + '. Asteapta sa termine.' };
    if (def.lock && engineBusy()) return { error: 'busy', message: 'O verificare automata (programata) ruleaza chiar acum. Incearca din nou peste cateva minute.' };
    if (def.need === 'order' && !DIGITS(a.order)) return { error: 'input', message: 'Scrie numarul comenzii Carrefour (doar cifre, ex. 1780308).' };
    const args = def.args({ order: DIGITS(a.order), dir: a.dir });
    const env = { ...process.env, KIT_NO_PAUSE: '1', KIT_INTERACTIVE: '1', KIT_IN_MENU: '1', KIT_UI: '1', NO_COLOR: '1', FORCE_COLOR: '0', ...(demo ? demo.env : {}), ...extraEnv };
    delete env.KIT_BULK_CONFIRM; Object.assign(env, extraEnv);
    const pre = demo ? ['-r', demo.hooks] : [];
    const j = job = { id: ++jobSeq, action, title: def.title + (args[1] && !String(args[1]).startsWith('--') ? ' ' + args[1] : ''), running: true, lines: [], partial: '', question: null, exit: null, result: null, started: Date.now(), answers: action === 'setup' ? setupAnswers(a) : [] };
    const child = j.child = spawn(process.execPath, [...pre, KIT, ...args], { cwd: ROOT, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let idle = null;
    const push = s => { for (const l of clean(s).split(/\r?\n/)) j.lines.push(l); if (j.lines.length > 4000) j.lines.splice(0, j.lines.length - 4000); };
    const onData = b => { j.question = null; const t = j.partial + b.toString('utf8'); const parts = t.split('\n'); j.partial = parts.pop(); if (parts.length) push(parts.join('\n'));
      clearTimeout(idle); if (j.partial.trim()) idle = setTimeout(() => ask(j.partial), 350); };
    const ask = q => { if (!j.running) return; const qq = q.trim(); const auto = j.answers.find(x => x.re.test(qq));
      if (auto) { j.answers.splice(j.answers.indexOf(auto), 1); push(qq + (auto.secret ? ' ***' : ' ' + auto.val)); j.partial = ''; j.echo = auto.val; child.stdin.write(auto.val + '\n'); return; }
      // a question for the person: yes/no or one of the numbered rows printed just before
      const choices = []; for (let i = j.lines.length - 1; i >= 0 && choices.length < 30; i--) { const m = j.lines[i].match(/^\s+(\d{1,2})\)\s+(.*)$/); if (m) choices.unshift({ value: m[1], label: m[2].trim() }); else if (choices.length) break; }
      j.question = { text: clean(qq), kind: /\(da\/nu\)/i.test(qq) ? 'yesno' : choices.length ? 'choice' : 'text', choices }; };
    child.stdout.on('data', b => { if (j.echo != null) { const s = b.toString('utf8'); const e = j.echo; j.echo = null; if (s.startsWith(e + '\n') || s.startsWith('***\n')) b = Buffer.from(s.slice(s.indexOf('\n') + 1)); } onData(b); });
    child.stderr.on('data', onData);
    child.on('error', e => { push('EROARE: ' + e.message); });
    child.on('close', code => {
      clearTimeout(idle); if (j.partial) push(j.partial); j.partial = ''; j.question = null; j.running = false; j.exit = code == null ? 1 : code; j.ended = Date.now();
      try { j.result = finish(j); } catch (e) { j.result = null; }
      hist(def.k, def.title, j.exit); log(`${def.title} -> cod ${j.exit}`);
      if (action === 'uninstall' && j.exit === 0) setTimeout(() => close(), 4000).unref();
    });
    return { ok: true, job: view(j, 0) };
  }

  function finish(j) {
    const o = outDir();
    if (j.action === 'bulk-check' || j.action === 'bulk-create') {
      const r = o && readJ(path.join(o, 'bulk-ciorne-ultimul-raport.json'), null); if (!r || Date.parse(r.at) < j.started - 5000) return null;
      const res = { mode: r.mode, preview: r.preview || [], previewTotal: r.previewTotal || 0, created: r.created || [], alreadyDraft: r.alreadyDraft || [], skipped: r.skipped || [], errors: r.errors || [], remaining: r.remaining || [], stopped: r.stopped || null, busy: !!r.busy };
      if (j.action === 'bulk-check' && j.exit === 0 && res.preview.length) { bulkOffer = { id: crypto.randomBytes(12).toString('hex'), count: res.preview.length, at: Date.now() }; res.offer = { id: bulkOffer.id, count: bulkOffer.count }; }
      return JSON.parse(clean(JSON.stringify(res)));
    }
    if (j.action === 'import-list') { let l = []; try { l = JSON.parse(j.lines.filter(x => /^\[/.test(x)).pop() || '[]'); } catch {} importOffer = l.length ? { dir: l[0], at: Date.now() } : null; j.lines = j.lines.filter(x => !/^\[/.test(x)); j.lines.push(l.length ? 'Am gasit: ' + l[0] : 'Nu am gasit un kit vechi configurat.'); return { dir: l[0] || null }; }
    if (j.action === 'support') { const m = j.lines.join('\n').match(/RAPORT-SUPORT-[\d-]+\.zip/); return m ? { file: m[0] } : null; }
    return null;
  }

  const view = (j, since) => ({ id: j.id, action: j.action, title: j.title, running: j.running, exit: j.exit, since: Math.min(since, j.lines.length), lines: j.lines.slice(Math.min(since, j.lines.length)), total: j.lines.length, question: j.question, result: j.result, seconds: Math.round(((j.ended || Date.now()) - j.started) / 1000) });

  function reveal(file) { // only a support report from the kit folder
    if (!/^RAPORT-SUPORT-[\d-]+\.zip$/.test(file) || !fs.existsSync(path.join(ROOT, file))) return false;
    if (process.env.KIT_NO_OPEN) return true; const f = path.join(ROOT, file);
    const o = process.platform === 'win32' ? ['explorer.exe', ['/select,', f]] : process.platform === 'darwin' ? ['open', ['-R', f]] : ['xdg-open', [ROOT]];
    try { spawn(o[0], o[1], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch {} return true;
  }

  // ---------- HTTP ----------
  const safeEq = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(token); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const hostOk = h => h === `127.0.0.1:${port}` || h === `localhost:${port}`;
  const HDR = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin' };
  const json = (res, code, o) => { res.writeHead(code, { ...HDR, 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
  const page = () => { const nonce = crypto.randomBytes(16).toString('base64');
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').replace('/*CSS*/', () => fs.readFileSync(path.join(__dirname, 'app.css'), 'utf8')).replace('/*JS*/', () => fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8')).replace(/__NONCE__/g, nonce);
    return { html, csp: `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' data:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'` }; };

  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (!hostOk(req.headers.host)) return json(res, 403, { error: 'host' }); // DNS rebinding
    if (req.method === 'GET' && u.pathname === '/') {
      if (!safeEq(u.searchParams.get('t'))) { res.writeHead(403, { ...HDR, 'content-type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><meta charset="utf-8"><body style="font:20px sans-serif;padding:40px">Deschide programul cu dublu-click pe scurtătura <b>Carrefour SmartBill</b> de pe Desktop.</body>'); }
      lastHit = Date.now(); const p = page(); res.writeHead(200, { ...HDR, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': p.csp }); return res.end(p.html);
    }
    if (req.method === 'GET' && (u.pathname === '/logo.png' || u.pathname === '/favicon.ico')) { res.writeHead(200, { ...HDR, 'cache-control': 'max-age=86400', 'content-type': 'image/png' }); return res.end(fs.readFileSync(path.join(__dirname, 'logo.png'))); } // public brand image only
    if (!u.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });
    if (!safeEq(req.headers['x-kit-token'])) return json(res, 403, { error: 'token' });
    lastHit = Date.now();
    if (req.method === 'GET') {
      if (u.pathname === '/api/status') return json(res, 200, status());
      if (u.pathname === '/api/history') return json(res, 200, history());
      if (u.pathname === '/api/job') { const since = Math.max(0, Number(u.searchParams.get('since')) || 0); return json(res, 200, job ? view(job, since) : { id: 0 }); }
      return json(res, 404, { error: 'not found' });
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'method' });
    const origin = req.headers.origin; if (origin && !hostOk(origin.replace(/^http:\/\//, ''))) return json(res, 403, { error: 'origin' });
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'json' });
    let body = ''; let big = false;
    req.on('data', c => { body += c; if (body.length > 20000) { big = true; req.destroy(); } });
    req.on('end', () => {
      if (big) return; let a; try { a = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: 'json' }); } if (!a || typeof a !== 'object') a = {};
      if (u.pathname === '/api/run') {
        const def = ACTIONS[a.action]; if (!def || def.internal) return json(res, 400, { error: 'action', message: 'Actiune necunoscuta.' });
        if (def.confirm && a.confirm !== true) return json(res, 400, { error: 'confirm', message: 'Confirma intai.' });
        const r = start(a.action, a); return json(res, r.ok ? 200 : 409, r);
      }
      if (u.pathname === '/api/bulk-create') { // only after a list in THIS session, with its exact count, confirmed in the page
        if (a.confirm !== true || !bulkOffer || a.offer !== bulkOffer.id || Number(a.count) !== bulkOffer.count || Date.now() - bulkOffer.at > 30 * 60e3) return json(res, 400, { error: 'confirm', message: 'Fa intai lista (Ciorne in bloc) si confirma numarul de ciorne.' });
        const offer = bulkOffer; bulkOffer = null;
        const r = start('bulk-create', {}, { KIT_BULK_CONFIRM: 'da' }); if (!r.ok) bulkOffer = offer; return json(res, r.ok ? 200 : 409, r);
      }
      if (u.pathname === '/api/import') { // only the folder found by 'import-list' in THIS session, named and confirmed in the page
        if (a.confirm !== true || !importOffer || a.dir !== importOffer.dir) return json(res, 400, { error: 'confirm', message: 'Cauta intai kitul vechi si confirma folderul.' });
        const r = start('import', { dir: importOffer.dir }, { KIT_IMPORT_CONFIRM: 'da' }); if (r.ok) importOffer = null; return json(res, r.ok ? 200 : 409, r); }
      if (u.pathname === '/api/answer') {
        if (!job || !job.running || job.id !== a.job || !job.question) return json(res, 409, { error: 'noquestion' });
        const t = String(a.text == null ? '' : a.text).replace(/[\r\n]/g, '').slice(0, 200); job.lines.push(clean(job.question.text + ' ' + t)); job.question = null; job.partial = ''; job.echo = t; job.child.stdin.write(t + '\n'); return json(res, 200, { ok: true });
      }
      if (u.pathname === '/api/reveal') return json(res, 200, { ok: reveal(String(a.file || '')) });
      if (u.pathname === '/api/quit') { json(res, 200, { ok: !(job && job.running) }); if (!(job && job.running)) setTimeout(() => close(), 300); return; }
      json(res, 404, { error: 'not found' });
    });
  });
  const stateFile = path.join(ROOT, '.runtime', 'ui.json');
  function close() { if (closing) return; closing = true; try { if (readJ(stateFile, {}).pid === process.pid) fs.unlinkSync(stateFile); } catch {} srv.close(); setTimeout(() => process.exit(0), 500).unref(); if (demo && demo.close) demo.close().catch(() => {}); }
  const idleT = setInterval(() => { if (idleMs && Date.now() - lastHit > idleMs && !(job && job.running)) close(); }, 30e3); idleT.unref();
  return {
    token, srv, status, get url() { return `http://127.0.0.1:${port}/?t=${token}`; }, get port() { return port; }, close,
    listen: () => new Promise((r, j) => { srv.once('error', j); srv.listen(0, '127.0.0.1', () => { port = srv.address().port;
      try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); wf(stateFile, JSON.stringify({ port, token, pid: process.pid, demo: !!demo }), { mode: 0o600 }); } catch {}
      r({ port, url: `http://127.0.0.1:${port}/?t=${token}` }); }); }),
  };
}

function openBrowser(url) {
  if (process.env.KIT_NO_OPEN) return;
  const o = process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(o[0], o[1], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref(); } catch {}
}

/** kit.js ui: one server per kit folder; a second double-click only opens the browser again. */
async function main({ demo = false, open = true } = {}) {
  const stateFile = path.join(ROOT, '.runtime', 'ui.json'); const prev = readJ(stateFile, null);
  if (prev && prev.port && prev.token && !!prev.demo === !!demo) {
    const alive = await new Promise(r => { const q = http.get({ host: '127.0.0.1', port: prev.port, path: '/api/status', headers: { 'x-kit-token': prev.token, host: `127.0.0.1:${prev.port}` }, timeout: 2000 }, s => { s.resume(); r(s.statusCode === 200); }); q.on('error', () => r(false)); q.on('timeout', () => { q.destroy(); r(false); }); });
    if (alive) { const url = `http://127.0.0.1:${prev.port}/?t=${prev.token}`; if (open) openBrowser(url); console.log(`Interfata ruleaza deja (port ${prev.port}); am deschis din nou pagina.`); return { reused: true }; }
  }
  const d = demo ? await require('../../scripts/ui-demo').setup() : null;
  const s = create({ demo: d, log: m => console.log(`[${new Date().toLocaleTimeString('ro-RO')}] ${m}`) });
  const { port } = await s.listen();
  console.log(`Interfata Carrefour -> SmartBill pornita pe http://127.0.0.1:${port}/ ${demo ? '(MOD DEMONSTRATIE) ' : ''}- se deschide in browser.`);
  console.log('Lasa aceasta fereastra deschisa (o poti micsora). Programul se inchide singur dupa 30 de minute fara folosire.');
  if (open) openBrowser(s.url);
  return s;
}
module.exports = { create, main, ACTIONS, openBrowser };
