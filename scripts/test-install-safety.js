'use strict';
process.env.KIT_TEST_MODE = '1'; // test hooks (mocks, short timeouts) are honoured only in test mode
/** Siguranta instalare / programare (bugurile gasite la testele pe Mac/Windows reale, 20.10.2026). Fara retea, fara programari reale.
 * Usage: node scripts/test-install-safety.js   exit 0 = toate trecute. */
const fs = require('fs'); const path = require('path'); const os = require('os'); const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..'); const results = []; const assert = (c, m) => { if (!c) throw new Error(m); };
function T(id, name, fn) { let ok = false, ev = ''; try { ev = String(fn() || 'ok'); ok = true; } catch (e) { ev = 'FAIL: ' + String(e && e.message || e).split('\n')[0]; } results.push({ ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name} :: ${ev}`); }
const sc = require('../src/schedule');
T('S01', 'Numele programarii e PER FOLDER (hash din cale), diferit de vechiul nume global', () => { assert(sc.NAME.startsWith(sc.LEGACY + '-') && sc.NAME !== sc.LEGACY && sc.LABEL.startsWith(sc.LEGACY_LABEL + '.'), sc.NAME);
  const other = spawnSync(process.execPath, ['-e', `const p=require('path');const h=require('crypto').createHash('sha1').update(p.resolve(${JSON.stringify(ROOT + '-copie')}).toLowerCase()).digest('hex').slice(0,8);console.log(h)`], { encoding: 'utf8' }).stdout.trim();
  assert(!sc.NAME.endsWith(other), 'alt folder = acelasi nume'); const pl = sc.install({ dryRun: true }); if (process.platform === 'darwin') assert(pl.includes(sc.LABEL)); return sc.NAME; });
T('S02', 'Vechea programare globala: o atinge DOAR daca porneste acest folder (alt kit / prefix de cale = neatins)', () => {
  const mine = `<string>${path.join(ROOT, 'run.sh')}</string>`; const other = `<string>${path.join(path.dirname(ROOT), 'Downloads', 'carrefour-smartbill-kit', 'run.sh')}</string>`; const prefix = `<string>${ROOT}2/run.sh</string>`;
  const win = `<Command>"${path.join(ROOT, '.runtime', 'auto-task.cmd')}"</Command>`;
  assert(sc.pointsHere(mine) && sc.pointsHere(win), 'al meu'); assert(!sc.pointsHere(other), 'alt kit'); assert(!sc.pointsHere(prefix), 'prefix'); assert(!sc.pointsHere(''), 'gol');
  const src = fs.readFileSync(path.join(ROOT, 'src', 'schedule.js'), 'utf8'); assert(/function remove\(\) \{\n\s*removeLegacyIfMine\(\)/.test(src) && /if \(!t \|\| !pointsHere\(t\)\) return false/.test(src), 'remove'); return 'ok'; });
T('S03', 'Instalarea NU mai preia singura conturile altui kit; preluarea cere confirmarea folderului', () => {
  for (const f of ['install.ps1', 'scripts/install-unix.sh', 'install.bat']) if (fs.existsSync(path.join(ROOT, f))) assert(!/import-config/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), f);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-imp-')); try {
    const old = path.join(tmp, 'carrefour-smartbill-kit-vechi'); fs.mkdirSync(path.join(old, 'bin'), { recursive: true }); fs.writeFileSync(path.join(old, 'bin', 'kit.js'), ''); fs.writeFileSync(path.join(old, '.env'), 'X="1"\n');
    const neu = path.join(tmp, 'kit-nou'); for (const f of ['bin/kit.js', 'src/importConfig.js', 'src/schedule.js', 'src/fsx.js']) { fs.mkdirSync(path.dirname(path.join(neu, f)), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), path.join(neu, f)); }
    const run = (code, env = {}) => spawnSync(process.execPath, ['-e', code], { cwd: neu, encoding: 'utf8', env: { ...process.env, HOME: tmp, USERPROFILE: tmp, KIT_IMPORT_CONFIRM: '', ...env } });
    let r = run(`console.log(JSON.stringify(require('./src/importConfig').run({ auto: true })))`); assert(r.stdout.trim() === '""' && !fs.existsSync(path.join(neu, '.env')), 'auto a preluat ' + r.stdout + r.stderr);
    r = run(`console.log(require('./src/importConfig').run({}))`); assert(/confirma/.test(r.stdout) && r.stdout.includes(old) && !fs.existsSync(path.join(neu, '.env')), 'fara confirmare ' + r.stdout + r.stderr);
    r = run(`console.log(require('./src/importConfig').run({ from: ${JSON.stringify(old)} }))`, { KIT_IMPORT_CONFIRM: 'da' }); assert(/Am preluat/.test(r.stdout) && fs.existsSync(path.join(neu, '.env')) && !/porneste de acum acest folder/.test(r.stdout), 'cu confirmare ' + r.stdout + r.stderr);
  } finally { require('../src/fsx').rm(tmp); } return 'auto = nimic, fara "da" = nimic, cu "da" = copiat, programarea veche nemutata'; });
T('S04', 'Meniul 8 cere confirmarea folderului; UI: /api/import doar dupa cautare + confirmare', () => { const m = fs.readFileSync(path.join(ROOT, 'src', 'menu.js'), 'utf8'); assert(/E kitul TAU vechi\?/.test(m) && /KIT_IMPORT_CONFIRM: 'da'/.test(m));
  const s = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'server.js'), 'utf8'); assert(/a\.confirm !== true \|\| !importOffer \|\| a\.dir !== importOffer\.dir/.test(s)); return 'ok'; });
T('S05', 'Ecranul final al configurarii nu mai spune "run setup / run orders / run fill"', () => { const s = fs.readFileSync(path.join(ROOT, 'src', 'setup.js'), 'utf8').split('\n').filter(l => /console\.log/.test(l)).join('\n'); assert(!/run (setup|orders|auto|fill)|ruleaza din nou: setup/.test(s), 'gasit'); assert(/scurtatura Carrefour SmartBill de pe Desktop/.test(s)); return 'ok'; });
T('S06', 'Windows: install.bat deblocheaza fisierele si explica "Proprietati > Deblocheaza" la esec; kit.js/UI detecteaza Zone.Identifier', () => { if (!fs.existsSync(path.join(ROOT, 'install.bat'))) return 'sarit (ZIP Mac, fara install.bat)'; const b = fs.readFileSync(path.join(ROOT, 'install.bat'), 'utf8'); assert(/Unblock-File/.test(b) && /Deblocheaza/.test(b) && /\r\n/.test(b), 'install.bat');
  assert(/Zone\.Identifier/.test(fs.readFileSync(path.join(ROOT, 'bin', 'kit.js'), 'utf8')) && /Zone\.Identifier/.test(fs.readFileSync(path.join(ROOT, 'src', 'ui', 'server.js'), 'utf8'))); return 'ok'; });
T('S07', 'Optiunea 7: valorile demo din mock/test/demo NU dau FAIL "date de producator"; un profil local cu aceleasi valori nu strica verificarea', () => {
  const st = require('../src/selftest'); const hits = st.forbiddenValues(); assert(!hits.some(h => /^(scripts\/(test-|mock-portal|ui-demo)|test-data\/)/.test(h)), hits.join('; ')); return hits.length + ' gasite'; });
const bad = results.filter(r => !r.ok).length; console.log(`\n${results.length - bad}/${results.length} teste siguranta instalare trecute.`); process.exit(bad ? 1 : 0);
