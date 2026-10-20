'use strict';
// Culori si text ingrosat in fereastra programului (un singur loc). Rosu = eroare / CE FACI, verde = reusit,
// galben = atentie / confirmare, ingrosat = numerele din meniu. Fara culori cand iesirea nu e o fereastra (TTY),
// cand exista NO_COLOR, sau pe Windows mai vechi decat Windows 10 (1511) unde consola nu intelege codurile.
// Pe Windows 10/11 Node.js porneste singur modul VT al consolei pentru stdout/stderr TTY; FORCE_COLOR=1 forteaza culorile.
const os = require('os');
function winVtOk(release = os.release()) { const [maj, , build] = String(release).split('.').map(Number); return maj > 10 || (maj === 10 && (build || 0) >= 10586); }
function enabled(stream = process.stdout, env = process.env, platform = process.platform, release) {
  if (env.NO_COLOR != null && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR && env.FORCE_COLOR !== '0') return true;
  if (!stream || !stream.isTTY || env.TERM === 'dumb') return false;
  if (platform === 'win32' && !winVtOk(release)) return false;
  return true;
}
const CODES = { red: [31, 39], green: [32, 39], yellow: [33, 39], cyan: [36, 39], bold: [1, 22] };
function make(on) {
  const f = {}; for (const [k, [a, b]] of Object.entries(CODES)) f[k] = s => on ? `\x1b[${a}m${s}\x1b[${b}m` : String(s);
  f.err = s => f.bold(f.red(s)); f.ok = s => f.bold(f.green(s)); f.warn = s => f.bold(f.yellow(s)); f.on = on; return f;
}
const out = make(enabled(process.stdout)); const err = make(enabled(process.stderr));
const strip = s => String(s).replace(/\x1b\[\d+m/g, '');
module.exports = { ...out, stdout: out, stderr: err, make, enabled, winVtOk, strip };
