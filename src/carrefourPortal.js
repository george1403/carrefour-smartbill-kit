'use strict';
const { wf, af, mv } = require('./fsx');
const { kitError, classify, EXIT } = require('./errors');
/**
 * Portal furnizori Carrefour (apps.carrefour.ro/portal-furnizor) — READ-ONLY.
 * - Sesiunea salvata se refoloseste; daca portalul cere CAPTCHA, NU il rezolvam automat:
 *   producatorul il scrie o singura data (fereastra vizibila sau imagine + prompt).
 * - Dupa login, orice cerere non-GET catre carrefour.ro e blocata (nu confirmam/refuzam comenzi, nu trimitem nimic).
 * Descopera: cod furnizor, magazine (GLN), produse (EAN, cod articol Carrefour, UM, pret), comenzi.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DOCS_URL = process.env.KIT_CARREFOUR_DOCS_URL || 'https://apps.carrefour.ro/portal-furnizor/group/portal-furnizori/documente-furnizor'; // env: tests with a local mock only
const delay = ms => new Promise(r => setTimeout(r, ms));
const ask = q => new Promise(r => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, a => { rl.close(); r(a.trim()); }); });

const EXTRACT_JSON_MODEL = function () {
  for (const s of document.querySelectorAll('script')) {
    const t = s.textContent || ''; const k = t.indexOf('jsonModel'); if (k < 0) continue;
    let j = t.indexOf('=', k) + 1; while (/\s/.test(t[j])) j++; if (t[j] !== '{') continue;
    let d = 0, str = false, esc = false;
    for (let i = j; i < t.length; i++) { const c = t[i];
      if (esc) { esc = false; continue; } if (c === '\\') { esc = true; continue; } if (c === '"') { str = !str; continue; } if (str) continue;
      if (c === '{') d++; if (c === '}' && --d === 0) { try { return JSON.parse(t.slice(j, i + 1)); } catch { break; } } }
  }
  return null;
};

async function open(profile, { headless = true } = {}) {
  const { chromium } = require('playwright');
  const stateFile = path.join(profile.dirs.state, 'carrefour-storage-state.json');
  fs.mkdirSync(profile.dirs.state, { recursive: true, mode: 0o700 });
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ ...(fs.existsSync(stateFile) ? { storageState: stateFile } : {}), viewport: { width: 1600, height: 1000 }, locale: 'ro-RO' });
  const guard = { loginPhase: true, blocked: [] };
  await context.route('**/*', route => {
    const r = route.request(); const u = new URL(r.url());
    if (['GET', 'HEAD', 'OPTIONS'].includes(r.method()) || !/carrefour\.ro$/i.test(u.hostname)) return route.continue();
    if (guard.loginPhase && /p_p_id=58|\/login/i.test(u.search + u.pathname)) return route.continue();
    if (/^\/cdn-cgi\/challenge-platform\//.test(u.pathname)) return route.continue(); // Cloudflare bot check (no business data)
    // read-only grid queries (AG-Grid server model): body is only filter/sort/page, action "refresh"
    if (u.searchParams.get('p_p_lifecycle') === '2' && /^GRID_/.test(u.searchParams.get('p_p_resource_id') || '')) {
      try { const b = JSON.parse(r.postData() || '{}'); const keys = Object.keys(b);
        if (keys.every(k => ['filterModel', 'sortModel', 'startRow', 'endRow', 'action', 'rowGroupCols', 'valueCols', 'pivotCols', 'pivotMode', 'groupKeys'].includes(k)) && (!b.action || b.action === 'refresh')) return route.continue();
      } catch {}
    }
    guard.blocked.push(`${r.method()} ${r.url()}`); return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  const save = async () => { await context.storageState({ path: stateFile }); fs.chmodSync(stateFile, 0o600); };
  return { browser, context, page, guard, save, stateFile, profile };
}


// ---------- Sesiune / autentificare (robust: CAPTCHA simplu, CAPTCHA puternic, sesiune expirata, cont gresit) ----------
/** What the current page is: 'in' (logged in), 'login' (login form), 'challenge' (CAPTCHA widget / bot check, no form), 'logged-out', 'unknown'. */
const PAGE_STATE = () => {
  const shown = e => !!(e && (e.offsetParent || (e.getClientRects && e.getClientRects().length)));
  const pwd = shown(document.querySelector('#_58_password')) || shown(document.querySelector('input[type="password"]'));
  const ifr = [...document.querySelectorAll('iframe')].map(f => f.src || '');
  const widget = ifr.some(u => /recaptcha|hcaptcha|challenges\.cloudflare|arkoselabs|funcaptcha|geetest|captcha/i.test(u))
    || !!document.querySelector('.g-recaptcha,.h-captcha,.cf-turnstile,[data-sitekey],#challenge-form,#cf-challenge-running,#challenge-stage');
  const title = document.title || '';
  const challenge = widget || /just a moment|attention required|un moment|verificare|access denied|captcha/i.test(title);
  let signed = null; try { signed = window.Liferay && window.Liferay.ThemeDisplay ? window.Liferay.ThemeDisplay.isSignedIn() : null; } catch (e) {}
  const logout = !!document.querySelector('a[href*="/c/portal/logout"],a[href*="logout"]');
  const model = [...document.scripts].some(s => (s.textContent || '').includes('jsonModel'));
  const captchaInput = shown(document.querySelector('#_58_captchaText'));
  const err = [...document.querySelectorAll('.alert-error,.portlet-msg-error,.alert-danger')].map(e => e.textContent.trim()).filter(Boolean).join(' | ').slice(0, 300);
  const state = pwd ? 'login' : (signed === true || logout || model) ? 'in' : challenge ? 'challenge' : signed === false ? 'logged-out' : 'unknown';
  return { state, widget, captchaInput, err, title: title.slice(0, 80) };
};
const pageState = page => page.evaluate(PAGE_STATE).catch(() => ({ state: 'unknown' }));
const onLoginForm = async page => (await pageState(page)).state === 'login';
const captchaVisible = async page => !!(await pageState(page)).captchaInput;

/** Open a portal URL; network problems -> NETWORK; waits (slow portal) until the page is recognisable, else returns 'unknown'. */
async function nav(s, url = DOCS_URL, { settleMs = 15000 } = {}) {
  let resp;
  try { resp = await s.page.goto(url, { waitUntil: 'domcontentloaded', timeout: Number(process.env.KIT_NAV_TIMEOUT || 60000) }); }
  catch (e) { const c = classify(e); if (c.exit === EXIT.NETWORK) throw kitError('NETWORK', 'Portalul Carrefour nu raspunde: ' + c.message); throw e; }
  if (resp && resp.status() >= 500) throw kitError('NETWORK', `Portalul Carrefour nu functioneaza acum (eroare server ${resp.status()}). Incearca mai tarziu.`);
  const t0 = Date.now(); let st;
  do { await delay(1000); st = await pageState(s.page); if (st.state !== 'unknown') break; } while (Date.now() - t0 < settleMs);
  return st;
}

const LOGIN_MSG = 'Portalul Carrefour cere din nou autentificarea (cod CAPTCHA sau sesiune expirata). Alege optiunea 5 din meniu: Autentificare Carrefour (CAPTCHA).';
class CaptchaRequired extends Error { constructor(why = 'captcha') { super(LOGIN_MSG); this.code = 'CAPTCHA'; this.why = why; } }

/** Guard: the logged-in portal account must be the producer's own supplier account (never someone else's). */
const normName = x => String(x || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\b(SRL|SA|PFA|II|IF|S\.R\.L\.)\b/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();
function checkSupplier(profile, orders, s) {
  const exp = profile.cfg?.carrefour?.expectedSupplierCode ? String(profile.cfg.carrefour.expectedSupplierCode) : null;
  const codes = [...new Set(orders.map(o => o.supplierCode).filter(Boolean))]; const names = [...new Set(orders.map(o => o.supplierName).filter(Boolean))];
  if (!codes.length) return { verified: false, codes };
  const bad = () => {
    if (s && s.stateFile && fs.existsSync(s.stateFile)) { try { mv(s.stateFile, s.stateFile.replace(/\.json$/, `.cont-gresit-${Date.now()}.json`)); } catch {} }
    return kitError('WRONG_ACCOUNT', `STOP: contul Carrefour din configurare apartine altui furnizor (cod ${codes.join(', ')}), nu firmei tale${exp ? ` (cod ${exp})` : ''}. Nu am citit si nu am facut nimic. Alege optiunea 6 (Configurare) si scrie utilizatorul si parola portalului pentru firma ta.`);
  };
  if (exp) { if (codes.some(c => c !== exp)) throw bad(); return { verified: true, codes }; }
  // older profiles without expectedSupplierCode: the supplier name must match the company name from SmartBill
  const mine = normName(profile.cfg?.company?.name);
  if (mine && names.length && names.some(n => normName(n) !== mine && !normName(n).includes(mine) && !mine.includes(normName(n)))) throw bad();
  return { verified: !!mine && names.length > 0, codes };
}

/** Read one CAPTCHA with local OCR (no AI). Refreshes the image (GET only, never submits) until the OCR is confident. */
async function ocrCaptcha(page, { maxImages = 25, log = () => {} } = {}) {
  const { solve } = require('./captchaOcr');
  for (let i = 0; i < maxImages; i++) {
    const t = await detectCaptcha(page); if (!t.imageSrc) return null;
    const okImg = await page.waitForFunction(() => { const im = document.querySelector('img[data-kit-captcha]'); return im && im.complete && im.naturalWidth > 0; }, null, { timeout: 15000 }).then(() => true).catch(() => false);
    if (!okImg) return null;
    const r = await solve(await page.locator('img[data-kit-captcha]').first().screenshot());
    if (r.ok) { log(`CAPTCHA citit local (imaginea ${i + 1}, ${r.votes} variante de acord)`); return r.text; }
    if (!(await page.locator('#refreshCaptcha').count())) return null;
    const old = await page.getAttribute('img[data-kit-captcha]', 'src').catch(() => null);
    await page.click('#refreshCaptcha').catch(() => {});
    for (let k = 0; k < 20 && (await page.getAttribute('img[data-kit-captcha]', 'src').catch(() => null)) === old; k++) await delay(250);
    await delay(500);
  }
  return null;
}


/** Classify the portal's login error text. 'captcha' = the code was wrong (retry with a new image),
 *  'auth' = user/password rejected, 'locked' = account locked, 'unknown' = anything else (a person decides; never 'wrong password'). */
function classifyLoginError(err) {
  const t = String(err || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (!t) return 'unknown';
  if (/captcha|text verification|verificare|cod(ul)? (de )?(verificare|securitate|captcha)|text to identify|caracterele|characters/.test(t)) return 'captcha';
  if (/lock|blocat|dezactivat|inactive|disabled|suspend/.test(t)) return 'locked';
  if (/authentication failed|autentificare (a )?esuat|password|parola|user ?name|screen name|utilizator|credential|incorect|invalid (login|user|credentials)/.test(t)) return 'auth';
  return 'unknown';
}
/** On every rejected login: screenshot + HTML of the page (password field emptied first) into out/<profile>/login-diag/. */
async function saveLoginEvidence(s, profile, attempt, err, kind) {
  const dir = path.join(profile.dirs.out, 'login-diag'); fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await s.page.evaluate(() => document.querySelectorAll('input[type=password]').forEach(e => { e.value = ''; e.setAttribute('value', ''); })).catch(() => {});
  await s.page.screenshot({ path: path.join(dir, `login-respins-${stamp}-${attempt}.png`), fullPage: true }).catch(() => {});
  const html = (await s.page.content().catch(() => '')).replace(/(type="password"[^>]*value=")[^"]*"/gi, '$1"');
  fs.writeFileSync(path.join(dir, `login-respins-${stamp}-${attempt}.html`), html);
  fs.writeFileSync(path.join(dir, `login-respins-${stamp}-${attempt}.json`), JSON.stringify({ at: new Date().toISOString(), attempt, kind, portalMessage: err, url: s.page.url().split('?')[0] }, null, 2));
}

/**
 * Non-interactive login. 1) saved session; 2) user+password (+ simple image CAPTCHA read by local OCR, no AI).
 * Max 3 submits; wrong password => AUTH at once (no retries, no lock-out). Any CAPTCHA it cannot read
 * (reCAPTCHA/hCaptcha/Turnstile, new type, OCR unsure) => CaptchaRequired (a human solves it in a visible window).
 */
async function ensureLogin(s, profile, { log = () => {}, ocr = true } = {}) {
  let st = await nav(s);
  if (st.state === 'in') { s.guard.loginPhase = false; await s.save(); return 'sesiune-salvata'; }
  if (st.state === 'challenge' || st.state === 'logged-out') throw new CaptchaRequired(st.state === 'challenge' ? 'widget' : 'logged-out');
  if (st.state !== 'login') throw kitError('LAYOUT', 'Pagina de autentificare Carrefour nu a fost recunoscuta (portalul s-a schimbat?). Nu am trimis nimic.');
  const { carrefourUser, carrefourPassword } = profile.secrets;
  if (!carrefourUser || !carrefourPassword) throw kitError('CONFIG', 'Lipsesc utilizatorul/parola portalului Carrefour. Alege optiunea 6 (Configurare).');
  for (let attempt = 1; attempt <= 3; attempt++) {
    let code = null;
    if (st.widget) throw new CaptchaRequired('widget');
    if (st.captchaInput) {
      const t = await detectCaptcha(s.page);
      if (t.recaptcha || t.hcaptcha || t.turnstile) throw new CaptchaRequired('widget');
      if (!t.imageSrc || !ocr) throw new CaptchaRequired(t.imageSrc ? 'manual' : 'necunoscut');
      code = await ocrCaptcha(s.page, { log });
      if (!code) throw new CaptchaRequired('ocr-nesigur');
    }
    if (!(await s.page.locator('#_58_login').count()) || !(await s.page.locator('#_58_fm button[type="submit"]').count())) throw kitError('LAYOUT', 'Formularul de autentificare Carrefour s-a schimbat. Nu am trimis nimic.');
    await s.page.fill('#_58_login', carrefourUser); await s.page.fill('#_58_password', carrefourPassword);
    if (code) await s.page.fill('#_58_captchaText', code);
    await s.page.click('#_58_fm button[type="submit"]'); await delay(Number(process.env.KIT_SUBMIT_WAIT || 4000));
    const after = await pageState(s.page); const err = after.err || '';
    st = after.state === 'in' ? after : await nav(s);
    if (st.state === 'in') { s.guard.loginPhase = false; await s.save(); return code ? 'ocr' : 'parola'; }
    const kind = classifyLoginError(err);
    log(`Login respins (${attempt}/3)${err ? ': portalul spune "' + err.slice(0, 160) + '"' : ' (fara mesaj)'} -> ${kind}`);
    await saveLoginEvidence(s, profile, attempt, err, kind).catch(() => {});
    if (st.state === 'challenge') throw new CaptchaRequired('widget');
    if (!err) throw new CaptchaRequired('fara-mesaj'); // unclear answer: a person decides (no blind re-submits)
    if (kind === 'auth') throw kitError('AUTH', `Portalul Carrefour nu a acceptat utilizatorul sau parola (portalul spune: "${err.slice(0, 120)}"). Nu am reincercat, ca sa nu se blocheze contul. Verifica-le, apoi optiunea 6 (Configurare).`);
    if (kind === 'locked') throw kitError('AUTH', `Contul Carrefour pare blocat (portalul spune: "${err.slice(0, 120)}"). Nu am reincercat. Contacteaza suportul portalului Carrefour.`);
    if (kind === 'unknown') { const e = new CaptchaRequired('mesaj-necunoscut'); e.message += ` (portalul spune: "${err.slice(0, 120)}")`; throw e; } // never call an unknown message "wrong password"
    // kind === 'captcha': OCR misread -> a new image, next attempt
  }
  throw new CaptchaRequired('3-incercari');
}

const hasDisplay = () => process.platform === 'win32' || process.platform === 'darwin' || !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
/** Can we ask a person right now? Not in scheduled/unattended runs. */
const canAskHuman = () => process.env.KIT_UNATTENDED !== '1' && hasDisplay() && (!!process.stdin.isTTY || process.env.KIT_INTERACTIVE === '1');

/**
 * Visible (headed) browser at the Carrefour login page; the producer types the CAPTCHA (any kind) and logs in.
 * We never submit for them. Waits until the portal shows the logged-in page, saves the session, closes the window.
 * Ends with MANUAL_LOGIN if the window is closed or after timeoutMs (default 10 min). One window per call, never a loop.
 */
async function headedLogin(profile, { timeoutMs = Number(process.env.KIT_MANUAL_TIMEOUT_MS || 10 * 60e3), log = console.log } = {}) {
  if (!hasDisplay()) throw kitError('LOGIN_NEEDED', 'Calculatorul nu are ecran pentru fereastra de autentificare. Pe server: node bin/kit.js login-carrefour --relay');
  const s = await open(profile, { headless: process.env.KIT_TEST_HEADLESS === '1' });
  let closed = false; s.browser.on('disconnected', () => { closed = true; }); s.page.on('close', () => { closed = true; });
  if (process.env.KIT_TEST_CLOSE_MS) setTimeout(() => s.page.close().catch(() => {}), Number(process.env.KIT_TEST_CLOSE_MS)); // tests: 'window closed early'
  try {
    let st = await nav(s);
    if (st.state === 'in') { await s.save(); return 'deja-logat'; }
    const { carrefourUser, carrefourPassword } = profile.secrets;
    if (st.state === 'login') { if (carrefourUser) await s.page.fill('#_58_login', carrefourUser).catch(() => {}); if (carrefourPassword) await s.page.fill('#_58_password', carrefourPassword).catch(() => {}); }
    await s.page.bringToFront().catch(() => {});
    log(`\nS-a deschis o fereastra cu portalul Carrefour. Rezolva codul CAPTCHA (sau bifa "nu sunt robot") si apasa Autentificare.`);
    log(`Te astept cel mult ${Math.round(timeoutMs / 60000)} minute. Nu inchide fereastra; se inchide singura dupa autentificare.`);
    const t0 = Date.now(); let lastErr = '';
    while (Date.now() - t0 < timeoutMs) {
      await delay(1500);
      if (closed) throw kitError('MANUAL_LOGIN', 'Fereastra de autentificare a fost inchisa inainte de autentificare. Nu s-a salvat nimic.');
      st = await pageState(s.page);
      if (st.err && st.err !== lastErr) { lastErr = st.err; log('Portalul spune: ' + st.err.slice(0, 160) + '  (incearca din nou in fereastra)'); }
      if (st.state === 'in') {
        st = await nav(s).catch(() => ({ state: 'unknown' }));            // confirm on the documents page
        if (st.state === 'in') { s.guard.loginPhase = false; await s.save(); log('Autentificare reusita. Sesiunea a fost salvata.'); return 'manual'; }
      }
    }
    throw kitError('MANUAL_LOGIN', `Au trecut ${Math.round(timeoutMs / 60000)} minute fara autentificare. Nu s-a salvat nimic.`);
  } finally { await s.browser.close().catch(() => {}); }
}

/** Load the freshly saved session into an already open (headless) context, so the run continues. */
async function reloadSession(s) {
  const st = JSON.parse(fs.readFileSync(s.stateFile, 'utf8'));
  await s.context.clearCookies(); if (st.cookies?.length) await s.context.addCookies(st.cookies);
}

/** Login for a run: saved session / OCR; if that is not enough and a person is at the computer -> ONE visible window, then continue. */
async function loginForRun(s, profile, { log = () => {}, say = console.log } = {}) {
  try { return await ensureLogin(s, profile, { log }); }
  catch (e) {
    if (e.code !== 'CAPTCHA') throw e;
    if (!canAskHuman() || s.humanUsed) throw e;
    s.humanUsed = true;
    say('Portalul Carrefour cere un cod pe care programul nu il poate citi singur. Deschid fereastra de autentificare...');
    await headedLogin(profile, { log: say });
    await reloadSession(s);
    const st = await nav(s);
    if (st.state !== 'in') throw new CaptchaRequired('dupa-manual');
    s.guard.loginPhase = false; return 'manual';
  }
}

/** Go to a portal page; if the session expired meanwhile, log in again ONCE (saved session/OCR/visible window), else LOGIN_NEEDED. */
async function goAuthed(s, url) {
  let st = await nav(s, url);
  if (st.state === 'in') return st;
  if (st.state === 'unknown') throw kitError('LAYOUT', 'Pagina din portalul Carrefour nu a fost recunoscuta (s-a schimbat?). Nu am facut nimic.');
  if (s.reauthed) throw Object.assign(new CaptchaRequired('expirat'), { message: 'Sesiunea Carrefour a expirat in timpul rularii. ' + LOGIN_MSG });
  s.reauthed = true; s.guard.loginPhase = true;
  await loginForRun(s, s.profile);
  st = await nav(s, url);
  if (st.state !== 'in') throw Object.assign(new CaptchaRequired('expirat'), { message: 'Sesiunea Carrefour a expirat in timpul rularii. ' + LOGIN_MSG });
  return st;
}

/** Option 5: saved session -> local OCR -> visible window (any CAPTCHA). Without a screen: typed answer from an image file. */
async function interactiveLogin(profile, { headed = hasDisplay(), ocrFirst = true, manual = false } = {}) {
  if (!manual) {
    const s = await open(profile);
    try {
      const how = await ensureLogin(s, profile, { log: console.log, ocr: ocrFirst });
      const { rows } = await listOrders(s); checkSupplier(profile, rows.map(normOrder), s);
      return how === 'sesiune-salvata' ? 'Esti deja autentificat in portalul Carrefour (sesiunea salvata e valida).' : 'Autentificare reusita (cod citit automat). Sesiunea a fost salvata.';
    } catch (e) { if (e.code !== 'CAPTCHA') throw e; console.log('Codul nu poate fi citit automat; continuam cu tine.'); }
    finally { await s.browser.close().catch(() => {}); }
  }
  if (headed) {
    await headedLogin(profile);
    const s = await open(profile); // verify headless with the new session + supplier guard
    try { const st = await nav(s); if (st.state !== 'in') throw new CaptchaRequired('dupa-manual'); s.guard.loginPhase = false; const { rows } = await listOrders(s); checkSupplier(profile, rows.map(normOrder), s); }
    finally { await s.browser.close().catch(() => {}); }
    return 'Autentificare reusita. Sesiunea a fost salvata; verificarile automate o folosesc de acum.';
  }
  return promptLogin(profile);
}

/** No screen (server over SSH): the CAPTCHA image is saved to a file and the code is typed in the terminal. Max 3 submits. */
async function promptLogin(profile) {
  if (!process.stdin.isTTY) throw kitError('LOGIN_NEEDED', 'Fara ecran si fara terminal: foloseste node bin/kit.js login-carrefour --relay');
  const s = await open(profile);
  try {
    let st = await nav(s); if (st.state === 'in') { await s.save(); return 'deja-logat'; }
    if (st.state !== 'login' || st.widget) throw kitError('LOGIN_NEEDED', 'Acest tip de CAPTCHA se rezolva doar intr-o fereastra vizibila (pe un calculator cu ecran).');
    const { carrefourUser, carrefourPassword } = profile.secrets;
    const png = path.join(profile.dirs.out, 'carrefour-captcha.png'); fs.mkdirSync(profile.dirs.out, { recursive: true });
    for (let attempt = 1, refresh = 0; attempt <= 3;) {
      await detectCaptcha(s.page); await s.page.locator('img[data-kit-captcha]').first().screenshot({ path: png });
      const text = await ask(`Deschide imaginea ${png} si scrie codul CAPTCHA ("r" = alt cod): `);
      if (text.toLowerCase() === 'r' && refresh++ < 10) { await nav(s); continue; }
      await s.page.fill('#_58_login', carrefourUser); await s.page.fill('#_58_password', carrefourPassword);
      if (await captchaVisible(s.page)) await s.page.fill('#_58_captchaText', text);
      await s.page.click('#_58_fm button[type="submit"]'); await delay(4000);
      st = await nav(s); if (st.state === 'in') { s.guard.loginPhase = false; await s.save(); return 'ok'; }
      console.log(`Cod gresit sau expirat (${attempt}/3).`); attempt++;
    }
    throw kitError('MANUAL_LOGIN', 'STOP dupa 3 incercari (protectie anti-blocare cont).');
  } finally { await s.browser.close().catch(() => {}); }
}

const detectCaptcha = page => page.evaluate(() => {
  const ifr = [...document.querySelectorAll('iframe')].map(f => f.src || '');
  const inp = document.querySelector('#_58_captchaText');
  const imgs = [...document.querySelectorAll('img')].filter(i => i.offsetParent);
  const dist = i => { if (!inp) return 1e9; const a = i.getBoundingClientRect(), b = inp.getBoundingClientRect(); return Math.abs(a.top - b.top) + Math.abs(a.left - b.left); };
  const img = imgs.find(i => /captcha/i.test(i.src) && !/^data:/.test(i.src)) || imgs.filter(i => /captcha/i.test(i.src + i.id + i.className + (i.alt || ''))).sort((x, y) => dist(x) - dist(y))[0]
    || imgs.filter(i => !/logo/i.test(i.src + i.className + i.id)).sort((x, y) => dist(x) - dist(y))[0];
  document.querySelectorAll('[data-kit-captcha]').forEach(e => e.removeAttribute('data-kit-captcha')); if (img) img.setAttribute('data-kit-captcha', '1');
  return {
    recaptcha: ifr.some(u => /recaptcha|google\.com\/recaptcha/.test(u)) || !!document.querySelector('.g-recaptcha,[data-sitekey]'),
    hcaptcha: ifr.some(u => /hcaptcha/.test(u)) || !!document.querySelector('.h-captcha'),
    turnstile: ifr.some(u => /challenges\.cloudflare/.test(u)) || !!document.querySelector('.cf-turnstile'),
    imageText: !!document.querySelector('#_58_captchaText') && !!img,
    imageSrc: img ? String(img.getAttribute('src')).slice(0, 120) : null, url: location.href.split('?')[0],
    images: imgs.map(i => ({ src: String(i.getAttribute('src')).slice(0, 100), id: i.id, cls: i.className, w: i.width, h: i.height, d: dist(i) })),
  };
});

/**
 * CAPTCHA relay (headless servers): saves ONLY the captcha image to <dir>/captcha.png, waits for someone to write the
 * code into <dir>/answer.txt ("r" = new image), submits once per answer (max 3), saves the session (storageState).
 * Status in <dir>/status.json. Credentials come from .env and are never written to <dir>.
 */
async function captchaRelay(profile, { dir, timeoutMs = 10 * 60 * 1000 } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const st = o => wf(path.join(dir, 'status.json'), JSON.stringify({ ...o, at: new Date().toISOString() }, null, 2));
  const answerFile = path.join(dir, 'answer.txt'); const png = path.join(dir, 'captcha.png');
  const { carrefourUser, carrefourPassword } = profile.secrets;
  if (!carrefourUser || !carrefourPassword) throw new Error('Lipsesc CARREFOUR_PORTAL_USERNAME / CARREFOUR_PORTAL_PASSWORD din .env');
  const s = await open(profile, { headless: true });
  try {
    await s.page.goto(DOCS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }); await delay(2500);
    if (!(await onLoginForm(s.page))) { await s.save(); st({ state: 'deja-logat' }); return 'deja-logat'; }
    const type = await detectCaptcha(s.page); wf(path.join(dir, 'captcha-type.json'), JSON.stringify(type, null, 2));
    if (type.recaptcha || type.hcaptcha || type.turnstile) { st({ state: 'captcha-interactiv', type }); throw new Error('CAPTCHA interactiv (reCAPTCHA/hCaptcha): foloseste login-carrefour intr-o fereastra vizibila.'); }
    for (let attempt = 1; attempt <= 3;) {
      if (fs.existsSync(answerFile)) fs.unlinkSync(answerFile);
      const found = (await captchaVisible(s.page)) ? (await detectCaptcha(s.page)).imageSrc : null;
      const loc = found ? s.page.locator('img[data-kit-captcha]').first() : null;
      if (loc) await loc.screenshot({ path: png });
      st({ state: 'astept-raspuns', attempt, captcha: loc ? png : null, answerFile, timeoutMin: timeoutMs / 60000 });
      let text = null; const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) { await delay(1500); if (fs.existsSync(answerFile)) { text = fs.readFileSync(answerFile, 'utf8').trim(); if (text) break; } }
      if (!text) { st({ state: 'timeout' }); throw new Error('Timp expirat (10 min) fara raspuns CAPTCHA.'); }
      fs.unlinkSync(answerFile);
      if (text.toLowerCase() === 'r') { await s.page.reload(); await delay(2500); continue; }
      await s.page.fill('#_58_login', carrefourUser); await s.page.fill('#_58_password', carrefourPassword);
      if (await captchaVisible(s.page)) await s.page.fill('#_58_captchaText', text);
      st({ state: 'trimit', attempt });
      await s.page.click('#_58_fm button[type="submit"]'); await delay(4000);
      await s.page.goto(DOCS_URL, { waitUntil: 'domcontentloaded' }); await delay(2500);
      if (!(await onLoginForm(s.page))) { s.guard.loginPhase = false; await s.save(); st({ state: 'ok', session: s.stateFile }); return 'ok'; }
      const err = await s.page.evaluate(() => [...document.querySelectorAll('.alert-error,.portlet-msg-error,.alert-danger')].map(e => e.textContent.trim()).join(' | ')).catch(() => '');
      st({ state: 'esuat', attempt, err }); attempt++;
      if (attempt > 3) throw new Error('STOP dupa 3 incercari (protectie anti-blocare cont): ' + err);
    }
  } finally { await s.browser.close().catch(() => {}); }
}

async function listOrders(s) {
  await goAuthed(s, DOCS_URL); await delay(1000);
  const m = await s.page.evaluate(EXTRACT_JSON_MODEL);
  const rows = (m && (Array.isArray(m.data) ? m.data : m.records)) || [];
  const tpl = await s.page.evaluate(() => {
    if (!window.EC?.Url?.goTo) return null; let c = null; const o = window.open;
    window.open = u => { c = String(u); return { focus() {} }; };
    try { EC.Url.goTo('/html/receptie/detalii-comanda.jsp', '_receptiefurnizor_WAR_ECPFportlet_', { view: 'view', id: '__ID__', layout: 'fromFurnizor' }, '_blank'); } catch {}
    window.open = o; return c;
  });
  return { rows, detailTpl: tpl && tpl.includes('__ID__') ? tpl : null };
}

/** Read-only grid query on the documents page (same POST the page itself makes when you change the selection). */
async function gridQuery(s, body) {
  const url = await s.page.evaluate(() => { const a = [...document.scripts].map(x => x.textContent).join('\n').match(/https?:[^"']*p_p_resource_id=GRID_DOCUMENTE_FURNIZOR[^"']*/); return a ? a[0].replace(/\\u0026/g, '&').replace(/&amp;/g, '&') : null; });
  const u = url || (DOCS_URL + '?p_p_id=receptiefurnizor_WAR_ECPFportlet&p_p_lifecycle=2&p_p_state=normal&p_p_mode=view&p_p_resource_id=GRID_DOCUMENTE_FURNIZOR&p_p_cacheability=cacheLevelPage&p_p_col_id=column-1&p_p_col_count=1');
  return s.page.evaluate(async ({ u, body }) => { const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json;charset=UTF-8', Accept: 'application/json' }, body: JSON.stringify(body), credentials: 'include' });
    const t = await r.text(); try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, text: t.slice(0, 500), login: /_58_password|p_p_id=58/.test(t) }; } }, { u, body }).then(res => {
    if (res.login || res.status === 401) throw Object.assign(new CaptchaRequired('expirat'), { message: 'Sesiunea Carrefour a expirat in timpul rularii. ' + LOGIN_MSG });
    return res; });
}
const gridRows = res => { const j = res && res.json; if (!j) return []; const d = j.data || j.rows || j.records || (j.model && j.model.data) || j; return Array.isArray(d) ? d : (Array.isArray(d.rows) ? d.rows : []); };

async function orderDetail(s, tpl, docId) {
  await goAuthed(s, new URL(DOCS_URL).origin + tpl.replace('__ID__', String(docId))); await delay(1000);
  const m = await s.page.evaluate(EXTRACT_JSON_MODEL); const d = m && m.data;
  if (!d || !Array.isArray(d.linii)) return null;
  return { header: d, lines: d.linii.map(l => ({ ean: l.codEAN != null ? String(l.codEAN) : null, carrefourCode: l.codArticol != null ? String(l.codArticol) : null,
    name: l.articol || null, qty: Number(l.cant) || 0, unit: l.um || null, price: l.pret != null ? Number(l.pret) : null, vat: l.cotaTva != null ? Number(l.cotaTva) : null, raw: l })) };
}

const normOrder = r => ({ orderNo: String(r.nrComMeti || r.nrCom || '').trim(), docId: r.id, store: r.magazin || null, storeCode: r.codMagazin || null, gln: r.codGLN ? String(r.codGLN) : null,
  supplierName: r.furnizor || null, supplierCode: r.codFurnizor != null ? String(r.codFurnizor) : null, date: r.dataCom || null, delivery: r.dataReceptie || null, total: r.totalFaraTvaML ?? null, status: r.stare || null, invoiceNumbers: r.listaNrFact ? String(r.listaNrFact) : null });

/** Discover supplier code, stores, products from recent orders. maxDetails limits how many order pages are opened. */
async function discoverCarrefour(profile, { maxDetails = 15, log = console.log } = {}) {
  const s = await open(profile);
  const out = { at: new Date().toISOString() };
  try {
    out.login = await loginForRun(s, profile, { log });
    const { rows, detailTpl } = await listOrders(s);
    out.orders = rows.map(normOrder).filter(o => o.orderNo);
    out.supplierCheck = checkSupplier(profile, out.orders, s);
    out.supplierCodes = [...new Set(out.orders.map(o => o.supplierCode).filter(Boolean))];
    out.supplierNames = [...new Set(out.orders.map(o => o.supplierName).filter(Boolean))];
    const stores = new Map();
    for (const o of out.orders) if (o.gln && !stores.has(o.gln)) stores.set(o.gln, { gln: o.gln, name: o.store, storeCode: o.storeCode });
    out.stores = [...stores.values()];
    const products = new Map(); out.detailHeaderKeys = null;
    for (const o of out.orders.slice(0, detailTpl ? maxDetails : 0)) {
      const d = await orderDetail(s, detailTpl, o.docId).catch(e => { if (['CAPTCHA', 'LAYOUT', 'NETWORK', 'WRONG_ACCOUNT'].includes(e.code)) throw e; log(`detaliu ${o.orderNo}: ${e.message}`); return null; });
      if (!d) continue;
      out.detailHeaderKeys = out.detailHeaderKeys || Object.keys(d.header).filter(k => k !== 'linii');
      for (const l of d.lines) {
        const k = l.ean || l.carrefourCode; if (!k) continue;
        const p = products.get(k) || { ean: l.ean, carrefourCode: l.carrefourCode, name: l.name, unit: l.unit, vat: l.vat, prices: [], rawKeys: Object.keys(l.raw) };
        if (l.price != null && !p.prices.includes(l.price)) p.prices.push(l.price);
        products.set(k, p);
      }
    }
    out.products = [...products.values()].map(p => ({ ...p, lastPrice: p.prices[p.prices.length - 1] ?? null }));
    if (!detailTpl) out.warning = 'Nu am putut construi URL-ul de detaliu comanda; produsele nu au fost citite.';
  } finally {
    out.guardBlocked = s.guard.blocked;
    await s.browser.close().catch(() => {});
  }
  fs.mkdirSync(profile.dirs.out, { recursive: true });
  wf(path.join(profile.dirs.out, 'discovered-carrefour.json'), JSON.stringify(out, null, 2));
  return out;
}

async function fetchOrder(profile, orderNo) {
  const s = await open(profile);
  try {
    await loginForRun(s, profile);
    const { rows, detailTpl } = await listOrders(s);
    checkSupplier(profile, rows.map(normOrder), s);
    const nz = x => String(x).trim().replace(/^0+/, '');
    let r = rows.map(normOrder).find(o => nz(o.orderNo) === nz(orderNo));
    if (!r) { // not in "documente in procesare": query all documents, filtered by order number (read-only grid POST)
      for (const fm of [{ nrComMeti: { type: 'contains', filter: nz(orderNo), filterType: 'text' } }, {}]) {
        const res = await gridQuery(s, { filterModel: fm, sortModel: [], startRow: 0, endRow: fm.nrComMeti ? 100 : 2000, action: 'refresh' });
        r = gridRows(res).map(normOrder).find(o => nz(o.orderNo) === nz(orderNo)); if (r) break;
      }
    }
    if (!r) throw kitError('NEEDS_HUMAN', `Comanda ${orderNo} nu apare in portalul Carrefour. Verifica numarul (il gasesti la optiunea 1).`);
    checkSupplier(profile, [r], s);
    if (!detailTpl) throw kitError('LAYOUT', 'Nu pot deschide detaliile comenzii in portal (pagina s-a schimbat?).');
    const d = await orderDetail(s, detailTpl, r.docId);
    if (!d) throw kitError('LAYOUT', `Detaliile comenzii ${orderNo} nu au putut fi citite din portal (pagina s-a schimbat?). Nu am facut nimic.`);
    return { ...r, lines: d.lines };
  } finally { await s.browser.close().catch(() => {}); }
}

module.exports = { classifyLoginError, pageState, PAGE_STATE, nav, headedLogin, loginForRun, goAuthed, checkSupplier, canAskHuman, normOrder, gridQuery, gridRows, ensureLogin, ocrCaptcha, _open: open, _ensureLogin: ensureLogin, _listOrders: listOrders, _EXTRACT: EXTRACT_JSON_MODEL, captchaRelay, detectCaptcha, discoverCarrefour, interactiveLogin, fetchOrder, CaptchaRequired, DOCS_URL };
