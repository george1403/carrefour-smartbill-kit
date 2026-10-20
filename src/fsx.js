'use strict';
// All kit writes go through here: parent folders (profiles/, out/, logs/, ~/.config/...) are created first,
// so a fresh ZIP extraction (no profiles/ or out/ folder) never fails with ENOENT.
const fs = require('fs'); const path = require('path');
const ensureDir = d => { fs.mkdirSync(d, { recursive: true }); return d; };
// atomic: write a temp file then rename, so a crash/power cut never leaves a half-written ledger (issued.json/drafts.json).
// Windows: rename over an existing file can fail for a moment (EPERM/EBUSY/EACCES: antivirus/indexer holds it) -> retry with
// short back-off, then fall back to copying the temp file over the target and unlinking it. The temp file is never left behind.
const sleep = ms => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {} };
const BUSY = ['EPERM', 'EBUSY', 'EACCES'];
const wf = (f, data, opt) => { ensureDir(path.dirname(f)); const t = `${f}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    fs.writeFileSync(t, data, opt);
    for (let i = 0; ; i++) {
      try { fs.renameSync(t, f); return; } catch (e) {
        if (e.code === 'EXDEV') break;
        if (!BUSY.includes(e.code)) throw e;
        if (i >= 6) break; sleep(25 * 2 ** i); // 25..800 ms, ~1.6 s total
      }
    }
    for (let i = 0; ; i++) { try { fs.copyFileSync(t, f); break; } catch (e) { if (!BUSY.includes(e.code) || i >= 4) throw e; sleep(100 * (i + 1)); } }
  } finally { try { fs.unlinkSync(t); } catch {} } };
/** Remove a file or folder, verified. Node 24 on Windows: fs.rmSync silently does nothing on paths with non-ASCII characters
 *  (e.g. "C:\Users\Ana Știr\..."); fall back to unlink/rmdir, which work. Missing path = ok. */
const rm = p => {
  try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let st; try { st = fs.lstatSync(p); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  if (st.isDirectory() && !st.isSymbolicLink()) { for (const n of fs.readdirSync(p)) rm(path.join(p, n)); fs.rmdirSync(p); }
  else { try { fs.unlinkSync(p); } catch (e) { if (st.isSymbolicLink() && e.code === 'EPERM') fs.rmdirSync(p); else throw e; } }
};
/** Read a ledger: missing -> {}, unreadable -> NEEDS_HUMAN error (never treat a damaged ledger as empty: that would re-do orders). */
const readLedger = f => { let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
  if (!txt.trim()) return {}; try { const j = JSON.parse(txt.replace(/^\uFEFF/, '')); if (j && typeof j === 'object' && !Array.isArray(j)) return j; } catch {}
  throw Object.assign(new Error(`Jurnalul ${f} este deteriorat (nu se poate citi). M-am oprit ca sa nu fac dubluri. Trimite fisierul persoanei de contact tehnic; nu il sterge.`), { code: 'NEEDS_HUMAN' }); };
const af = (f, data, opt) => { ensureDir(path.dirname(f)); fs.appendFileSync(f, data, opt); };
const mv = (a, b) => { ensureDir(path.dirname(b)); fs.renameSync(a, b); };
module.exports = { wf, af, mv, ensureDir, readLedger, rm };
