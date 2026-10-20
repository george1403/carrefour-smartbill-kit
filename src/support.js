'use strict';
// "Trimite raport la suport" (meniu 13): arhiva ZIP cu jurnalele si rapoartele, FARA parole / sesiuni / poze.
// "Reparare instalare" (meniu 14): descarca din nou browserul daca lipseste.
const fs = require('fs'); const path = require('path'); const os = require('os'); const zlib = require('zlib');
const ROOT = path.join(__dirname, '..');
const C = () => require('./color');

let T; const crc32 = b => { if (zlib.crc32) return zlib.crc32(b) >>> 0;
  if (!T) { T = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; } }
  let c = 0xFFFFFFFF; for (const x of b) c = T[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
/** Minimal ZIP writer (deflate), no dependencies. entries: [{ name, data: Buffer }] */
function zip(entries) {
  const parts = [], central = []; let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name.replace(/\\/g, '/'), 'utf8'); const raw = Buffer.from(e.data); const comp = zlib.deflateRawSync(raw); const crc = crc32(raw);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt32LE(0, 10);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    parts.push(h, name, comp);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10); c.writeUInt32LE(0, 12);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, name); off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16); return Buffer.concat([...parts, cd, end]);
}

/** Every value from .env files (passwords, emails, users) + well-known secret shapes are replaced by ***. */
function secretValues(root = ROOT) {
  const vals = new Set();
  for (const f of [path.join(root, '.env'), ...(fs.existsSync(path.join(root, 'profiles')) ? fs.readdirSync(path.join(root, 'profiles')).filter(x => x.endsWith('.env')).map(x => path.join(root, 'profiles', x)) : [])]) {
    try { for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*[A-Z0-9_]+\s*=\s*"?([^"\r\n]*)"?\s*$/i); if (m && m[1].trim().length >= 3) vals.add(m[1].trim()); } } catch {}
  }
  for (const k of Object.keys(process.env)) if (/PASS|SECRET|TOKEN|SMARTBILL_EMAIL|CARREFOUR_USER/i.test(k) && String(process.env[k]).length >= 3) vals.add(String(process.env[k]));
  return [...vals].sort((a, b) => b.length - a.length);
}
function redact(text, vals) {
  let t = String(text); for (const v of vals) t = t.split(v).join('***');
  return t.replace(/("?(password|parola|pass|pwd|token|cookie|authorization|secret|sessionid)"?\s*[:=]\s*)("[^"]*"|[^\s,;}]+)/gi, '$1"***"')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '***@***');
}
const SKIP_DIR = /^(node_modules|\.runtime|\.git|browser-profile|state|captcha-relay)$/i;
const OK_FILE = /\.(log|json|txt|png)$/i; const BAD_FILE = /^\.env|storage|cookie|session|secret/i;
function collect(root) {
  const files = [];
  const walk = (d, rel) => { let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) { const p = path.join(d, e.name), r = path.join(rel, e.name);
      if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) walk(p, r); }
      else if (OK_FILE.test(e.name) && !BAD_FILE.test(e.name)) { try { if (fs.statSync(p).size < 5e6) files.push({ p, r }); } catch {} } } };
  for (const d of ['logs', 'out']) walk(path.join(root, d), d);
  for (const f of fs.existsSync(root) ? fs.readdirSync(root) : []) if (/^ATENTIE.*\.txt$/.test(f)) files.push({ p: path.join(root, f), r: f });
  return files;
}
const git = root => { try { return require('child_process').execFileSync('git', ['-C', root, 'log', '-1', '--format=%h %ci'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { try { return fs.readFileSync(path.join(root, '.kit-commit'), 'utf8').trim(); } catch { return 'necunoscut'; } } };
const tail = (f, n) => { try { return fs.readFileSync(f, 'utf8').split('\n').slice(-n).join('\n'); } catch { return ''; } };
/** Status counts of the local ledgers (no amounts / clients). */
function ledgers(root) {
  const L = []; let outs = []; try { outs = fs.readdirSync(path.join(root, 'out')).filter(d => fs.statSync(path.join(root, 'out', d)).isDirectory()); } catch {}
  for (const d of outs) for (const f of ['issued.json', 'drafts.json', 'auto-state.json']) {
    const p = path.join(root, 'out', d, f); if (!fs.existsSync(p)) continue;
    try { const j = JSON.parse(fs.readFileSync(p, 'utf8')); const cnt = {}; for (const v of Object.values(j)) { const k = (v && (v.status || (v.needsHuman ? 'necesita-verificare' : v.fails ? 'esecuri' : 'alt'))) || 'alt'; cnt[k] = (cnt[k] || 0) + 1; }
      L.push(`  ${d}/${f}: ${Object.keys(j).length} comenzi ${JSON.stringify(cnt)}`); } catch (e) { L.push(`  ${d}/${f}: DETERIORAT (${e.message.split('\n')[0]})`); }
  }
  return L.length ? L.join('\n') : '  (niciun registru inca)';
}
/** Profile JSONs with every secret-looking key and value removed. */
function profiles(root, vals) {
  const out = []; let fsl = []; try { fsl = fs.readdirSync(path.join(root, 'profiles')).filter(f => f.endsWith('.json')); } catch {}
  const scrub = o => Array.isArray(o) ? o.map(scrub) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, /pass|parola|token|secret|key|cookie|email|user|iban|phone|telefon/i.test(k) && typeof v !== 'object' ? '***' : scrub(v)])) : o;
  for (const f of fsl) { try { out.push({ name: 'profil/' + f, data: Buffer.from(redact(JSON.stringify(scrub(JSON.parse(fs.readFileSync(path.join(root, 'profiles', f), 'utf8'))), null, 2), vals)) }); } catch (e) { out.push({ name: 'profil/' + f + '.txt', data: Buffer.from('nu se poate citi: ' + e.message) }); } }
  return out;
}
function selftestSummary(root) {
  if (process.env.KIT_SUPPORT_NO_SELFTEST) return '(sarit)';
  try { const r = require('child_process').spawnSync(process.execPath, [path.join(root, 'bin', 'kit.js'), 'selftest'], { encoding: 'utf8', timeout: 120000, env: { ...process.env, NO_COLOR: '1' } });
    const o = (r.stdout || '') + (r.stderr || ''); const fails = o.split('\n').filter(l => /^FAIL/.test(l)); return `cod ${r.status}, ${o.split('\n').filter(l => /^OK/.test(l)).length} OK, ${fails.length} FAIL${fails.length ? '\n' + fails.join('\n') : ''}`; } catch (e) { return 'nu a rulat: ' + e.message; }
}
function info(root) {
  let ver = '?'; try { ver = require(path.join(root, 'package.json')).version; } catch {}
  let sched = ''; try { sched = require('./schedule').current() ? 'da' : 'nu'; } catch {}
  return [`Raport suport Carrefour -> SmartBill`, `Data: ${new Date().toLocaleString('ro-RO')}`, `Versiune kit: ${ver} (commit ${git(root)})`, `Sistem: ${process.platform} ${os.release()} ${process.arch}`, `Node.js: ${process.versions.node}`,
    `Browser instalat: ${fs.existsSync(path.join(root, '.runtime', 'browsers')) ? 'da' : 'nu'}`, `Biblioteci instalate: ${fs.existsSync(path.join(root, 'node_modules', 'playwright')) ? 'da' : 'nu'}`,
    `Configurare (.env) exista: ${fs.existsSync(path.join(root, '.env')) ? 'da' : 'nu'}`, `Verificare automata programata: ${sched}`].join('\n');
}
/** Builds the support ZIP. Returns { file, count, text }. */
function run({ root = ROOT, dest = null } = {}) {
  const vals = secretValues(root); const files = collect(root);
  const last = tail(path.join(root, 'logs', 'ultima-eroare.txt'), 40) || '(nicio eroare inregistrata)';
  const rez = [info(root), '', '== Ultimele optiuni alese din meniu ==', tail(path.join(root, 'logs', 'meniu-istoric.log'), 15) || '(niciuna)', '',
    '== Ultima eroare (cu caseta CE FACI) ==', last, '', '== Registre (stare) ==', ledgers(root), '', '== Verificare instalare (selftest) ==', selftestSummary(root), '',
    '== Continut ==', 'logs/ = jurnale, out/ = rapoarte + poze login-diag, profil/ = setari FARA parole. Parolele, emailurile si sesiunile au fost inlocuite cu ***.'].join('\n');
  const entries = [{ name: 'REZUMAT.txt', data: Buffer.from(redact(rez, vals)) }];
  for (const f of files) { try { entries.push({ name: f.r, data: /\.png$/i.test(f.r) ? fs.readFileSync(f.p) : Buffer.from(redact(fs.readFileSync(f.p, 'utf8'), vals)) }); } catch {} }
  entries.push(...profiles(root, vals));
  const dir = dest || root; const d = new Date(); const p2 = n => String(n).padStart(2, '0');
  const file = path.join(dir, `RAPORT-SUPORT-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.zip`);
  fs.writeFileSync(file, zip(entries));
  if (!process.env.KIT_NO_OPEN && !dest) { try { const { spawn } = require('child_process'); const o = process.platform === 'win32' ? ['explorer.exe', ['/select,', file]] : process.platform === 'darwin' ? ['open', ['-R', file]] : ['xdg-open', [dir]]; spawn(o[0], o[1], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch {} }
  const c = C();
  const text = `${c.ok('GATA:')} am facut arhiva pentru suport (${entries.length} fisiere, FARA parole):\n  ${c.bold(file)}\n` +
    `Fisierul e in folderul programului (s-a deschis fereastra cu el selectat).\n` + c.warn('Trimite acest fisier lui George pe WhatsApp/email.') + ' Nu contine parolele tale.';
  return { file, count: entries.length, text };
}
/** Re-downloads the bundled Chromium (and tells what to do if the libraries themselves are missing). */
function repair({ root = ROOT, log = console.log } = {}) {
  const c = C(); const cli = path.join(root, 'node_modules', 'playwright', 'cli.js');
  if (!fs.existsSync(cli)) { log(c.err('Lipsesc bibliotecile programului.') + '\nInchide aceasta fereastra si da dublu-click pe ' + c.bold(process.platform === 'win32' ? 'install.bat' : 'install.command') + ' (reface instalarea; conturile raman).'); return { ok: false }; }
  log(c.warn('LUCREZ...') + ' descarc browserul programului (~150 MB, cateva minute). Nu inchide fereastra.');
  const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(root, '.runtime', 'browsers') };
  const r = require('child_process').spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit', env });
  if (r.status === 0) { log(c.ok('GATA: browserul este instalat.') + ' Poti folosi din nou programul.'); return { ok: true }; }
  log(c.err('Descarcarea nu a reusit.') + ' Verifica internetul si alege din nou 14. Daca tot nu merge, alege 13 (Trimite raport la suport).'); return { ok: false };
}
module.exports = { ledgers, profiles, run, repair, zip, redact, secretValues, collect };
