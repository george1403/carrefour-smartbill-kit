'use strict';
// Actualizare fara pierderi: copiaza (NU muta, NU sterge) .env, profiles/*.json, profiles/.default si out/ dintr-un kit vechi
// in kitul nou. Pe Mac, dezarhivarea peste folderul vechi face adesea "carrefour-smartbill-kit 2": de aici nevoia.
// Sesiunea Carrefour/SmartBill e in folderul utilizatorului (~/.config/carrefour-smartbill-kit), deci ramane oricum.
const fs = require('fs'); const path = require('path'); const os = require('os');
const ROOT = path.resolve(__dirname, '..');
const isKit = d => { try { return fs.existsSync(path.join(d, 'bin', 'kit.js')) && fs.existsSync(path.join(d, '.env')) && path.resolve(d) !== ROOT; } catch { return false; } };
function candidates() {
  const dirs = new Set(); const parents = [path.dirname(ROOT), path.join(os.homedir(), 'Downloads'), path.join(os.homedir(), 'Desktop'), path.join(os.homedir(), 'Documents'), os.homedir(), ...['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial'].filter(k => process.env[k]).flatMap(k => ['Desktop', 'Documents', 'Downloads'].map(x => path.join(process.env[k], x)))];
  for (const p of parents) { let es = []; try { es = fs.readdirSync(p, { withFileTypes: true }); } catch { continue; }
    for (const e of es) if (e.isDirectory() && /carrefour.*smartbill|smartbill.*carrefour/i.test(e.name)) { const d = path.join(p, e.name); if (isKit(d)) dirs.add(d); const inner = path.join(d, 'carrefour-smartbill-kit'); if (isKit(inner)) dirs.add(inner); } }
  return [...dirs].sort((a, b) => fs.statSync(path.join(b, '.env')).mtimeMs - fs.statSync(path.join(a, '.env')).mtimeMs);
}
function copyTree(src, dst, stats) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) { const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyTree(s, d, stats); }
    else if (!fs.existsSync(d)) { fs.copyFileSync(s, d); stats.n++; } else stats.kept++; }
}
/** Only on explicit request (menu 8 / UI button), after the person confirmed the source folder by name. */
function run({ from = null, auto = false, confirmed = (process.env.KIT_TEST_MODE === '1' ? process.env.KIT_IMPORT_CONFIRM : undefined) === 'da' } = {}) {
  if (auto) return ''; // installs no longer import by themselves (they could pick up ANOTHER kit's accounts)
  if (fs.existsSync(path.join(ROOT, '.env')) && !from) return 'Acest kit are deja configurarea (.env). Nu am schimbat nimic.';
  const list = from ? [path.resolve(from)] : candidates();
  if (!list.length) return auto ? '' : 'Nu am gasit un kit vechi configurat (cu .env) in Descarcari, Desktop, Documente sau langa acest folder. Daca il ai in alta parte: import-config "CALEA/catre/kitul-vechi". Altfel alege 6 (Configurare).';
  const src = list[0]; if (!isKit(src)) return `In ${src} nu e un kit configurat (lipseste .env).`;
  if (!confirmed) return `Am gasit un kit configurat in: ${src}\nNu am preluat nimic: confirma intai ca e kitul TAU vechi.`;
  const stats = { n: 0, kept: 0 };
  if (!fs.existsSync(path.join(ROOT, '.env'))) { fs.copyFileSync(path.join(src, '.env'), path.join(ROOT, '.env')); try { fs.chmodSync(path.join(ROOT, '.env'), 0o600); } catch {} stats.n++; }
  for (const sub of ['profiles', 'out']) if (fs.existsSync(path.join(src, sub))) { fs.mkdirSync(path.join(ROOT, sub), { recursive: true }); copyTree(path.join(src, sub), path.join(ROOT, sub), stats); }
  // the hourly check of the OLD folder is NOT moved (it may be another person's / the real kit): the person starts it here
  let sched = ''; try { if (require('./schedule').current()) sched = ''; else sched = '\n  Verificarea automata NU a fost mutata. Daca o vrei aici: Verificare automata > Porneste (si opreste-o in kitul vechi).'; } catch {}
  return `Am preluat configurarea din kitul vechi: ${src}\n  ${stats.n} fisiere copiate (conturi, profil, jurnalul comenzilor facute), ${stats.kept} existente pastrate. Kitul vechi a ramas neatins; il poti arhiva.${sched}`;
}
function list() { return candidates(); }
module.exports = { run, candidates, list };
