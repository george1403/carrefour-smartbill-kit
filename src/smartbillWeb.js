'use strict';
/**
 * SmartBill Cloud web session + SAFETY GUARD.
 * After login, every non-GET request to *.smartbill.ro is ABORTED unless the caller explicitly unlocked writes
 * (only `--save-draft`, never used by default). This makes fill-only provably non-persistent: nothing can be saved,
 * autosaved, issued or sent to SPV, because those all need a POST/PUT/DELETE that never leaves the browser.
 */
const fs = require('fs');
const path = require('path');

const LOGIN_URL = 'https://cloud.smartbill.ro/auth/login/';
const APP_URL = 'https://cloud.smartbill.ro/';

async function firstVisible(locators) {
  for (const l of locators) {
    const n = await l.count().catch(() => 0);
    for (let i = 0; i < n; i++) { const x = l.nth(i); if (await x.isVisible().catch(() => false)) return x; }
  }
  return null;
}
async function isLoginPage(page) {
  if (/\/auth\/login\/?(?:[?#].*)?$/i.test(page.url())) return true;
  return (await page.locator('#id_username, input[name="username"]').count()) > 0
    && (await page.locator('#id_password, input[name="password"]').count()) > 0;
}
async function dismissCookies(page) {
  const b = await firstVisible([page.locator('#onetrust-accept-btn-handler')]);
  if (b) await b.click({ timeout: 5000 }).catch(() => {});
  await page.evaluate(() => { document.querySelector('#onetrust-consent-sdk')?.remove(); document.querySelectorAll('.onetrust-pc-dark-filter').forEach(n => n.remove()); }).catch(() => {});
}
async function detectChallenge(page) {
  const t = (await page.content().catch(() => '')).toLowerCase();
  if (/recaptcha|hcaptcha|captcha/.test(t) && await page.locator('iframe[src*="captcha"], .g-recaptcha, .h-captcha').count()) return 'CAPTCHA';
  if (await page.locator('input[name*="otp" i], input[name*="code" i][maxlength="6"], input[autocomplete="one-time-code"]').count()) return '2FA';
  return null;
}

// Read-like POST endpoints observed in SmartBill (names say get/exists/search/codes). Anything else non-GET is aborted.
const READ_POST = /(\/get(\/|$)|\/get[-_]|get_[a-z_]+\/?$|\/exists\/?$|search|autocomplete|cauta|-codes\/|\/codes\/|widget\/data\/|get_websocket_token|\/is_[a-z_]+\/?$|\/einvoice\/client\/additional-fields\/?$|\/partner-data\/check\/?$)/i;
// Never allowed (even if it also looks like a read): saving, issuing, drafts, SPV, e-mail, deletes, updates.
const DENY = /(salv|save|emit(e|ere)?\/?$|issue|ciorn|draft|trimit|send|upload|spv\/(send|trimite)|sterg|delete|update|modific|anul|storn|cancel|finaliz|create|adaug|add\/|import|set[-_])/i;

const LIST_PATH = /^\/(nomenclator\/(clienti|produse|furnizori)|raport\/[a-z_-]+)\/ajax\/?$|^\/dashboard\/widget\/current-periods\/?$/i;
function isListRead(pathname, body) {
  if (!LIST_PATH.test(pathname)) return false;
  if (/^\/dashboard\//.test(pathname)) return /^widget_dashboard_id=\d+$/.test(body);
  // every key must be a DataTables legacy paging/search/sort param
  // plus display toggles seen on SmartBill lists (use_product_code=true, displayCodes=false), boolean values only
  const q = [...new URLSearchParams(body).entries()];
  const keys = q.filter(([k, v]) => !((/^(use_[a-z_]+|display[A-Za-z]+)$/.test(k) && /^(true|false)$/.test(v)) || (/^(last_documents_ids|aaSorting)$/.test(k) && /^\[[\d,\s\[\]"a-z]*\]$/i.test(v)))).map(([k]) => k);
  return q.length > 0 && keys.every(k => /^(sEcho|iColumns|sColumns|iDisplayStart|iDisplayLength|mDataProp_\d+|sSearch(_\d+)?|bRegex(_\d+)?|bSearchable_\d+|iSortCol_\d+|sSortDir_\d+|iSortingCols|bSortable_\d+)$/.test(k));
}

class Guard {
  constructor(log) { this.xmlDownload = false; this.writeRe = null; this.writes = []; this.writesAllowed = false; this.loginPhase = true; this.blocked = []; this.allowed = []; this.log = log || (() => {}); }
  async attach(context) {
    await context.route('**/*', route => {
      const req = route.request();
      const m = req.method();
      const u = req.url();
      const sb = /(^|\.)smartbill\.ro$/i.test(new URL(u).hostname);
      if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS' || !sb) return route.continue();
      if (this.loginPhase && /\/auth\/login\/?/.test(u)) { this.allowed.push(`${m} ${u}`); return route.continue(); }
      const pth = new URL(u).pathname;
      // e-Factura XML *download* (SmartBill JS: getXmlInvoice -> POST /documente/send_xml/ {documentId}; it only returns the
      // XML text; the SPV upload is the separate /documente/efactura/upload-xml/, which stays hard-blocked) + mapping reads.
      if (/^\/documente\/(send_xml|get_mappings|get_vat_mappings|get_um_mappings)\/?$/.test(new URL(u).pathname) && this.xmlDownload) {
        this.allowed.push(`${m} ${u}`); return route.continue();
      }
      // NEVER, in any mode: SPV / e-Factura sending, e-mailing, deleting, cancelling.
      if (/spv|trimit|\/send|email|mail\/|sterg|delete|anul|storn|cancel/i.test(pth)) {
        this.blocked.push({ method: m, url: u, at: new Date().toISOString(), post: (req.postData() || '').slice(0, 4000), hard: true });
        this.log(`[guard] BLOCAT (interzis mereu) ${m} ${u}`); return route.abort('blockedbyclient');
      }
      // scoped write unlock (issue mode): only the exact endpoints named by the caller
      if (this.writeRe && this.writeRe.test(pth)) { this.allowed.push(`${m} ${u}`); this.writes.push({ method: m, url: u, at: new Date().toISOString(), post: (req.postData() || '').slice(0, 20000) }); return route.continue(); }
      if (this.writesAllowed) { this.allowed.push(`${m} ${u}`); return route.continue(); }
      // SmartBill does many READS as POST (Django CSRF XHR). Deny-list wins over allow-list.
      const p = new URL(u).pathname;
      // SmartBill UI-state flags (info boxes seen, form section open/closed, "company details validated" reminder):
      // never sent to SmartBill (no account change), answered locally as if saved, and not reported (no noise for producers).
      if (/^\/core\/set_flags\/?$/.test(p) && /^flag=[a-z0-9_]+&flag_value=[A-Za-z0-9_.-]{0,40}&(company|user)=true$/.test(req.postData() || '')) {
        this.stubbed = (this.stubbed || []).concat(`${m} ${u} ${req.postData()}`);
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"successfully":true}' });
      }
      if (!DENY.test(p) && READ_POST.test(p)) { this.allowed.push(`${m} ${u}`); return route.continue(); }
      // DataTables list reads (nomenclator lists): POST .../ajax/ whose body is only paging/search params.
      if (!DENY.test(p) && isListRead(p, req.postData() || '')) { this.allowed.push(`${m} ${u}`); return route.continue(); }
      this.blocked.push({ method: m, url: u, at: new Date().toISOString(), post: (req.postData() || '').slice(0, 30000) });
      this.log(`[guard] BLOCAT ${m} ${u}`);
      return route.abort('blockedbyclient');
    });
  }
}

async function openSession({ profile, headless = true, log = console.log }) {
  const { chromium } = require('playwright');
  fs.mkdirSync(profile.dirs.state, { recursive: true, mode: 0o700 });
  const stateFile = path.join(profile.dirs.state, 'storage-state.json');
  require('./fsx').sessionOwnerOk(stateFile, profile.secrets && profile.secrets.email); // another account's session is never reused
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    ...(fs.existsSync(stateFile) ? { storageState: stateFile } : {}),
    viewport: { width: 1440, height: 1000 }, locale: 'ro-RO', timezoneId: 'Europe/Bucharest',
  });
  const guard = new Guard(log);
  await guard.attach(context);
  const page = await context.newPage();

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (await isLoginPage(page)) {
    if (!profile.secrets.email || !profile.secrets.password) throw Object.assign(new Error('Lipsesc emailul sau parola SmartBill din configurare. Alege 6 (Configurare) si scrie-le din nou.'), { code: 'CONFIG' });
    await dismissCookies(page);
    await page.locator('#id_username, input[name="username"]').first().fill(profile.secrets.email);
    await page.locator('#id_password, input[name="password"]').first().fill(profile.secrets.password);
    const submit = await firstVisible([page.getByRole('button', { name: /Intra in cont|Autentificare|Login/i }), page.locator('button[type="submit"], input[type="submit"]')]);
    if (!submit) throw new Error('butonul de login nu a fost gasit');
    await dismissCookies(page);
    await submit.click();
    await page.waitForURL(u => !/\/auth\/login\/?(?:[?#].*)?$/i.test(String(u)), { timeout: 45000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    const ch = await detectChallenge(page);
    if (ch) { const e = new Error(`${ch} la login: ${page.url()}`); e.code = ch; throw e; }
    if (await isLoginPage(page)) throw new Error('login esuat (verifica emailul/parola din .env)');
  }
  guard.loginPhase = false; // from now on every non-GET is blocked unless writesAllowed
  await selectCompany(page, profile.cfg.company);
  await context.storageState({ path: stateFile });
  fs.chmodSync(stateFile, 0o600); require('./fsx').stampSessionOwner(stateFile, profile.secrets && profile.secrets.email);
  return { browser, context, page, guard, stateFile };
}

async function selectCompany(page, company) {
  if (!company?.name) return;
  const re = new RegExp(company.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s*&\s*/g, '\\s*&\\s*').replace(/\s+/g, '\\s*'), 'i');
  const el = await firstVisible([page.getByRole('link', { name: re }), page.getByRole('button', { name: re })]);
  // only click if we're on a company chooser page (avoid clicking random text in the app)
  if (el && /alege|selecteaza|firma|companie|select/i.test(page.url() + ' ' + (await page.title()))) {
    await el.click(); await page.waitForLoadState('domcontentloaded').catch(() => {});
  }
}

module.exports = { READ_POST, DENY, isListRead, openSession, firstVisible, dismissCookies, detectChallenge, LOGIN_URL, APP_URL };
