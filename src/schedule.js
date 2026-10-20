'use strict';
const { wf, af, mv } = require('./fsx');
/** Start `auto` by itself every N minutes: Windows Task Scheduler (schtasks), macOS launchd, Linux cron. --remove undoes it. */
const fs = require('fs'); const path = require('path'); const os = require('os'); const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const NAME = 'CarrefourSmartBillKit';
const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...o });

function install({ every = 60, profile = null, dryRun = false } = {}) {
  every = Math.max(15, Math.min(1440, Number(every) || 60)); const pa = profile ? [`--profile=${profile}`] : [];
  fs.mkdirSync(path.join(ROOT, '.runtime'), { recursive: true });
  if (process.platform === 'win32') {
    const cmd = path.join(ROOT, '.runtime', 'auto-task.cmd');
    wf(cmd, `@echo off\r\nset "KIT_NO_PAUSE=1"\r\nset "KIT_UNATTENDED=1"\r\ncall "${path.join(ROOT, 'run.bat')}" auto ${pa.join(' ')}\r\n`);
    const a = ['/Create', '/F', '/TN', NAME, '/SC', 'MINUTE', '/MO', String(every), '/TR', `"${cmd}"`];
    if (!dryRun) sh('schtasks', a);
    return `Programat: Windows Task Scheduler "${NAME}", la fiecare ${every} minute (oprire: run.bat schedule --remove).`;
  }
  if (process.platform === 'darwin') {
    const label = 'ro.carrefour-smartbill-kit'; const f = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${label}</string>\n<key>ProgramArguments</key><array><string>/bin/bash</string><string>${esc(path.join(ROOT, 'run.sh'))}</string><string>auto</string>${pa.map(x => `<string>${esc(x)}</string>`).join('')}</array>\n<key>EnvironmentVariables</key><dict><key>KIT_UNATTENDED</key><string>1</string></dict>\n<key>StartInterval</key><integer>${every * 60}</integer>\n<key>RunAtLoad</key><false/>\n<key>StandardOutPath</key><string>${esc(path.join(ROOT, 'out', 'auto-launchd.log'))}</string>\n<key>StandardErrorPath</key><string>${esc(path.join(ROOT, 'out', 'auto-launchd.log'))}</string>\n</dict></plist>\n`;
    if (dryRun) return plist;
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true });
    try { sh('launchctl', ['unload', f]); } catch {}
    wf(f, plist); sh('launchctl', ['load', '-w', f]);
    return `Programat: macOS launchd (${f}), la fiecare ${every} minute (oprire: ./run.command schedule --remove).`;
  }
  const line = `*/${Math.min(every, 59)} * * * * KIT_UNATTENDED=1 /bin/bash ${JSON.stringify(path.join(ROOT, 'run.sh'))} auto ${pa.join(' ')} >> ${JSON.stringify(path.join(ROOT, 'out', 'auto-cron.log'))} 2>&1 # ${NAME}`;
  const cronLine = every >= 60 ? line.replace(/^\*\/\d+ \* /, `0 */${Math.min(23, Math.round(every / 60))} `) : line;
  if (dryRun) return cronLine;
  let cur = ''; try { cur = sh('crontab', ['-l']); } catch {}
  const next = cur.split('\n').filter(l => l && !l.includes(`# ${NAME}`)).concat(cronLine).join('\n') + '\n';
  sh('crontab', ['-'], { input: next });
  return `Programat: cron (Linux), la fiecare ${every} minute (oprire: ./run.sh schedule --remove).`;
}

function remove() {
  if (process.platform === 'win32') { try { sh('schtasks', ['/Delete', '/F', '/TN', NAME]); } catch {} return 'Programarea Windows a fost oprita.'; }
  if (process.platform === 'darwin') { const f = path.join(os.homedir(), 'Library', 'LaunchAgents', 'ro.carrefour-smartbill-kit.plist'); try { sh('launchctl', ['unload', f]); } catch {} try { fs.unlinkSync(f); } catch {} return 'Programarea macOS a fost oprita.'; }
  let cur = ''; try { cur = sh('crontab', ['-l']); } catch { return 'Nu exista programare.'; }
  sh('crontab', ['-'], { input: cur.split('\n').filter(l => l && !l.includes(`# ${NAME}`)).join('\n') + '\n' }); return 'Programarea cron a fost oprita.';
}
/** Text of the current schedule (to see which kit folder it starts), or '' when there is none. */
function current() {
  try {
    if (process.platform === 'win32') return sh('schtasks', ['/Query', '/TN', NAME, '/XML']);
    if (process.platform === 'darwin') return fs.readFileSync(path.join(os.homedir(), 'Library', 'LaunchAgents', 'ro.carrefour-smartbill-kit.plist'), 'utf8');
    return sh('crontab', ['-l']).split('\n').filter(l => l.includes(`# ${NAME}`)).join('\n');
  } catch { return ''; }
}
module.exports = { install, remove, current };
