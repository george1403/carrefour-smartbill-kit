'use strict';
// Desktop shortcuts of THIS kit folder. Uninstall removes a shortcut only when it starts this folder (a second kit /
// a test copy never deletes the real kit's shortcuts). Windows: the Desktop can be redirected (OneDrive), so every
// known Desktop folder is checked.
const fs = require('fs'); const path = require('path'); const os = require('os');
const ROOT = path.join(__dirname, '..');
const NAMES = ['Carrefour SmartBill.lnk', 'Carrefour SmartBill.command', 'Carrefour SmartBill.app', 'Carrefour SmartBill - Meniu text.lnk', 'Carrefour SmartBill - Meniu text.command'];
function desktops() {
  const d = new Set([path.join(os.homedir(), 'Desktop')]);
  if (process.platform === 'win32') {
    for (const k of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) if (process.env[k]) d.add(path.join(process.env[k], 'Desktop'));
    if (!process.env.KIT_TEST_DESKTOPS) { try { const p = require('child_process').execFileSync('powershell', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('Desktop')"], { encoding: 'utf8', timeout: 15000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); if (p) d.add(p); } catch {} }
  }
  if (process.env.KIT_TEST_DESKTOPS) for (const x of process.env.KIT_TEST_DESKTOPS.split(path.delimiter)) d.add(x);
  return [...d].filter(x => { try { return fs.statSync(x).isDirectory(); } catch { return false; } });
}
const files = p => { const st = fs.statSync(p); if (!st.isDirectory()) return [p]; const o = []; for (const n of fs.readdirSync(p)) o.push(...files(path.join(p, n))); return o; };
/** Does the shortcut (file or .app bundle) contain this kit's folder path (UTF-8 / UTF-16, case-insensitive on Windows)? */
function pointsHere(p, root = ROOT) {
  const r = path.resolve(root); const want = [r, r.replace(/\\/g, '/')];
  for (const f of files(p)) { let b; try { b = fs.readFileSync(f); } catch { continue; } if (b.length > 5e6) continue;
    const txt = [b.toString('utf8'), b.toString('latin1'), b.toString('utf16le'), b.length > 1 ? Buffer.from(b.subarray(1)).toString('utf16le') : ''];
    for (const t of txt) for (const w of want) if ((process.platform === 'win32' ? t.toLowerCase().includes(w.toLowerCase()) : t.includes(w))) return true; }
  return false;
}
/** Removes this kit's shortcuts. Returns { removed: [names], kept: [names of shortcuts of ANOTHER kit folder] }. */
function removeMine(root = ROOT) {
  const removed = [], kept = [];
  for (const d of desktops()) for (const n of NAMES) { const f = path.join(d, n); if (!fs.existsSync(f)) continue;
    if (pointsHere(f, root)) { try { require('./fsx').rm(f); removed.push(n); } catch {} } else kept.push(n); }
  return { removed, kept };
}
module.exports = { NAMES, desktops, pointsHere, removeMine };
