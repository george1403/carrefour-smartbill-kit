'use strict';
// All kit writes go through here: parent folders (profiles/, out/, logs/, ~/.config/...) are created first,
// so a fresh ZIP extraction (no profiles/ or out/ folder) never fails with ENOENT.
const fs = require('fs'); const path = require('path');
const ensureDir = d => { fs.mkdirSync(d, { recursive: true }); return d; };
// atomic: write a temp file then rename, so a crash/power cut never leaves a half-written ledger (issued.json/drafts.json).
// Windows: rename can fail (EPERM/EBUSY: antivirus/indexer holds the file) -> fall back to a direct write.
const wf = (f, data, opt) => { ensureDir(path.dirname(f)); const t = `${f}.${process.pid}.tmp`;
  try { fs.writeFileSync(t, data, opt); fs.renameSync(t, f); } catch (e) { try { fs.unlinkSync(t); } catch {} if (['EPERM', 'EBUSY', 'EACCES', 'EXDEV'].includes(e.code)) fs.writeFileSync(f, data, opt); else throw e; } };
/** Read a ledger: missing -> {}, unreadable -> NEEDS_HUMAN error (never treat a damaged ledger as empty: that would re-do orders). */
const readLedger = f => { let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
  if (!txt.trim()) return {}; try { const j = JSON.parse(txt.replace(/^\uFEFF/, '')); if (j && typeof j === 'object' && !Array.isArray(j)) return j; } catch {}
  throw Object.assign(new Error(`Jurnalul ${f} este deteriorat (nu se poate citi). M-am oprit ca sa nu fac dubluri. Trimite fisierul persoanei de contact tehnic; nu il sterge.`), { code: 'NEEDS_HUMAN' }); };
const af = (f, data, opt) => { ensureDir(path.dirname(f)); fs.appendFileSync(f, data, opt); };
const mv = (a, b) => { ensureDir(path.dirname(b)); fs.renameSync(a, b); };
module.exports = { wf, af, mv, ensureDir, readLedger };
