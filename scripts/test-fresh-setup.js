'use strict';
process.env.KIT_TEST_MODE = '1'; // test hooks (mocks, short timeouts) are honoured only in test mode
const { rm: rmx } = require('../src/fsx'); // verified delete (Node 24 Windows: fs.rmSync is a no-op on non-ASCII paths)
/**
 * Test: setup from a FRESH extraction of the kit (as from the ZIP), with no profiles/, out/ or ~/.config folders.
 * Network steps (SmartBill, Carrefour portal, SmartBill preparation) are mocked; fake accounts only.
 * Run 1 answers everything; run 2 reuses the saved accounts and earlier answers (resume after an interruption).
 * Usage: node scripts/test-fresh-setup.js  (exit code 0 = OK). Also run by selftest.
 */
const fs = require('fs'); const path = require('path'); const os = require('os'); const { spawnSync } = require('child_process');
const SRC = path.join(__dirname, '..');
function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit fresh ă-')); const kit = path.join(tmp, 'carrefour-smartbill-kit'); const home = path.join(tmp, 'home');
  const files = require('../src/selftest').shippedFiles();
  for (const f of files) { const d = path.join(kit, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(SRC, f), d); }
  rmx(path.join(kit, 'profiles')); rmx(path.join(kit, 'out'));
  fs.symlinkSync(path.join(SRC, 'node_modules'), path.join(kit, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.mkdirSync(home);
  const mock = path.join(tmp, 'mock.json');
  fs.writeFileSync(mock, JSON.stringify({
    smartbill: { company: { name: 'Firma Test Kit SRL', cif: '1234567', iban: null }, products: [], series: [{ name: 'TSTA', next: 1 }, { name: 'TSTB', next: 5, selected: true }], carrefourClients: [], bankAccounts: [] },
    carrefour: { stores: [], products: [], orders: [], supplierCodes: ['999'], at: new Date().toISOString() },
    ensure: { unit: 'PCE', warnings: ['test: avertisment e-Factura'], efactura: { connected: true, autoSend: false, expires: null } } }));
  const env = { ...process.env, HOME: home, USERPROFILE: home, KIT_SETUP_MOCK: mock, KIT_NO_PAUSE: '1', KIT_PROFILE: '' };
  const setup = input => spawnSync(process.execPath, [path.join(kit, 'bin', 'kit.js'), 'setup'], { cwd: kit, env, input, encoding: 'utf8', timeout: 60000 });
  const fail = (m, r) => { throw new Error(m + (r ? `\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}` : '')); };
  try {
    // run 1: 4 answers, series 1 (TSTA), mode 2 (automat), schedule nu
    let r = setup('test@example.com\nparola-test\nutilizator-test\nparola-test-2\n7\n1\nda\n2\nnu\n'); // 7 = invalid series -> asked again
    const pf = path.join(kit, 'profiles', 'firma-test-kit.json');
    if (r.status !== 0 || !fs.existsSync(pf)) fail('run 1: profilul nu a fost creat', r);
    let p = JSON.parse(fs.readFileSync(pf, 'utf8'));
    if (p.smartbill.series !== 'TSTA' || p.auto.mode !== 'automat' || p.smartbill.carrefourUnit !== 'PCE' || p.carrefour.expectedSupplierCode !== '999') fail('run 1: valori gresite ' + JSON.stringify({ s: p.smartbill.series, m: p.auto.mode, c: p.carrefour.expectedSupplierCode }), r);
    if (!/nu e in lista/.test(r.stdout)) fail('run 1: seria invalida nu a fost refuzata', r);
    if (!fs.existsSync(path.join(kit, '.env')) || r.stdout.includes('parola-test')) fail('run 1: .env lipsa sau parola afisata', r);
    const envBefore = fs.readFileSync(path.join(kit, '.env'), 'utf8');
    // run 2 (resume): interrupted setup left progress; reuse saved accounts, keep earlier choices by pressing Enter
    fs.writeFileSync(path.join(kit, 'out', '.setup-progress.json'), JSON.stringify({ series: 'TSTA', mode: 'automat' }));
    rmx(path.join(kit, 'profiles'));
    r = setup('da\n\nda\n\nnu\n');
    if (r.status !== 0 || !fs.existsSync(pf)) fail('run 2: reluarea nu a creat profilul', r);
    p = JSON.parse(fs.readFileSync(pf, 'utf8'));
    if (p.smartbill.series !== 'TSTA' || p.auto.mode !== 'automat') fail('run 2: raspunsurile anterioare nu au fost refolosite', r);
    if (fs.readFileSync(path.join(kit, '.env'), 'utf8') !== envBefore) fail('run 2: .env modificat desi conturile au fost refolosite');
    if (fs.existsSync(path.join(kit, 'out', '.setup-progress.json'))) fail('run 2: progresul nu a fost sters la final');
    // run 3: the producer says the Carrefour account is NOT theirs -> stop, exit 12, profile not rewritten
    fs.writeFileSync(path.join(kit, 'profiles', 'firma-test-kit.json'), '{"keep":1}');
    r = setup('da\n1\nnu\n');
    if (r.status !== 12 || fs.readFileSync(pf, 'utf8') !== '{"keep":1}') fail('run 3: contul altui furnizor nu a fost refuzat', r);
    // run 4: several series and no answer -> no silent default
    rmx(path.join(kit, 'out', '.setup-progress.json'));
    r = setup('da\n');
    if (r.status !== 10) fail('run 4: seria a fost aleasa fara raspuns', r);
    return 'setup din ZIP proaspat (fara profiles/ si out/) + reluare + serie invalida/lipsa + cont Carrefour strain refuzat: OK';
  } finally { try { fs.unlinkSync(path.join(kit, 'node_modules')); } catch { try { fs.rmdirSync(path.join(kit, 'node_modules')); } catch {} } rmx(tmp); }
}
module.exports = { run };
if (require.main === module) { try { console.log('OK   ' + run()); } catch (e) { console.error('FAIL ' + e.message); process.exit(1); } }
