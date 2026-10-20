'use strict';
/**
 * MOD DEMONSTRATIE al interfetei (kit.js ui --demo): pentru teste si pentru filmarea tutorialului.
 * Portalul Carrefour = portalul simulat local (scripts/mock-portal.js), SmartBill = simulat (scripts/ui-demo-hooks.js),
 * conturi false, HOME separat (nu atinge Desktopul, ~/.config sau programarea reala). Nicio autentificare reala.
 */
const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const O = (nr, date, total, store, more = {}) => ({ id: Number(nr), nrComMeti: String(nr), magazin: store, codGLN: '5940475006037', dataCom: date, totalFaraTvaML: total, stare: 'Noua', ...more });
const ORDERS = [O(1780301, '02.09.2026', 240.72, 'CARREFOUR BRASOV'), O(1780302, '15.09.2026', 120.36, 'CARREFOUR ORADEA'), O(1780303, '01.10.2026', 361.08, 'CARREFOUR BANEASA'),
  O(1780304, '12.10.2026', 180.54, 'CARREFOUR CLUJ'), O(1780305, '19.10.2026', 96.29, 'CARREFOUR IASI'), O(1780299, '20.08.2026', 120.36, 'CARREFOUR SIBIU', { listaNrFact: 'TST 41' }),
  O(1780298, '18.08.2026', 60.18, 'CARREFOUR PITESTI', { stare: 'Anulata' })];
async function setup({ orders = ORDERS } = {}) {
  const home = path.join(ROOT, '.demo-home'); const marker = path.join(home, 'DEMO');
  // never in a real kit folder: only a folder without accounts, or one that was already a demo folder
  if (fs.existsSync(path.join(ROOT, '.env')) && !fs.existsSync(marker)) throw Object.assign(new Error('Modul demonstratie merge doar intr-un folder de test (acesta are conturi reale).'), { code: 'CONFIG' });
  fs.mkdirSync(home, { recursive: true }); fs.writeFileSync(marker, 'folder demonstratie\n');
  const mock = await require('./mock-portal').start({ orders: JSON.parse(JSON.stringify(orders)) });
  // the simulated portal accepts the Carrefour password currently saved in .env (like the real portal accepts the producer's real password)
  mock.st.passwordFn = () => { try { return (fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^CARREFOUR_PORTAL_PASSWORD="?([^"\r\n]*)"?/m) || [])[1] || 'p'; } catch { return 'p'; } };
  if (process.env.KIT_DEMO_MOCK_MODE) mock.st.mode = process.env.KIT_DEMO_MOCK_MODE; // tests: 'down', 'recaptcha'...
  const setupMock = path.join(home, 'setup-mock.json');
  fs.writeFileSync(setupMock, JSON.stringify({
    smartbill: { company: { name: 'Firma Demo SRL', cif: '1234567', iban: null }, products: [], series: [{ name: 'DEMO', next: 101 }, { name: 'CRF', next: 7 }], carrefourClients: [], bankAccounts: [] },
    carrefour: { stores: [], products: [], orders: [], supplierCodes: ['10001'], supplierNames: ['FIRMA MEA TEST SRL'], at: new Date().toISOString() },
    ensure: { unit: 'XPP', warnings: [], efactura: { connected: true, autoSend: false, expires: null } } }));
  // demo accounts (fake) + a demo profile, only when the folder has none yet
  if (!fs.existsSync(path.join(ROOT, '.env'))) fs.writeFileSync(path.join(ROOT, '.env'), 'SMARTBILL_EMAIL="demo@firma-demo.ro"\nSMARTBILL_PASSWORD="parola-demo-sb"\nCARREFOUR_PORTAL_USERNAME="demo-furnizor"\nCARREFOUR_PORTAL_PASSWORD="p"\n', { mode: 0o600 });
  if (!fs.existsSync(path.join(ROOT, 'profiles', '.default'))) {
    fs.mkdirSync(path.join(ROOT, 'profiles'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'profiles', 'firma-demo.json'), JSON.stringify({ envFile: '.env', orderSource: { type: 'carrefour-portal' }, company: { name: 'Firma Demo SRL', cif: '1234567' },
      smartbill: { series: 'DEMO' }, carrefour: { ...JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'carrefour.json'), 'utf8')), expectedSupplierCode: '10001', supplierAccountId: '10001' }, stores: [], products: [],
      auto: { mode: 'ciorne', startFrom: '2026-10-01', maxAgeDays: 14, maxPerRun: 10 } }, null, 2));
    fs.writeFileSync(path.join(ROOT, 'profiles', '.default'), 'firma-demo');
  }
  // the demo HOME hides Playwright's default browser folder: keep pointing at the real one
  const os = require('os'); const pwb = process.env.PLAYWRIGHT_BROWSERS_PATH || (fs.existsSync(path.join(ROOT, '.runtime', 'browsers')) ? path.join(ROOT, '.runtime', 'browsers')
    : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright') : process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'ms-playwright') : path.join(os.homedir(), '.cache', 'ms-playwright'));
  process.env.PLAYWRIGHT_BROWSERS_PATH = pwb;
  const env = { PLAYWRIGHT_BROWSERS_PATH: pwb, HOME: home, USERPROFILE: home, KIT_CARREFOUR_DOCS_URL: mock.url + '/docs', KIT_SETUP_MOCK: setupMock, KIT_NO_NOTIFY: '1', KIT_RATE_MS: process.env.KIT_RATE_MS || '1500',
    KIT_NAV_TIMEOUT: '8000', KIT_SUBMIT_WAIT: '800', KIT_TEST_HEADLESS: '1', KIT_SUPPORT_NO_SELFTEST: process.env.KIT_SUPPORT_NO_SELFTEST || '', KIT_UI_DEMO: '1' };
  // the UI process itself also uses the demo schedule (status)
  process.env.KIT_UI_DEMO = '1'; process.env.HOME = home; process.env.USERPROFILE = home; require('./ui-demo-hooks');
  return { env, hooks: path.join(__dirname, 'ui-demo-hooks.js'), mock, close: () => mock.close() };
}
module.exports = { setup, ORDERS };
