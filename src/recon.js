'use strict';
const { wf, af, mv } = require('./fsx');
// READ-ONLY reconnaissance of the SmartBill web UI: screenshots + DOM field inventory. Writes are blocked by the Guard.
const fs = require('fs');
const path = require('path');
const { openSession, dismissCookies } = require('./smartbillWeb');

async function inventory(page) {
  return page.evaluate(() => {
    const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const labelOf = el => {
      if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return l.innerText.trim(); }
      const p = el.closest('label, .form-group, .control-group, .field, div'); return p ? (p.querySelector('label')?.innerText || '').trim().slice(0, 80) : '';
    };
    const css = el => el.id ? `#${el.id}` : el.name ? `${el.tagName.toLowerCase()}[name="${el.name}"]` : null;
    const fields = [...document.querySelectorAll('input, select, textarea')].map(el => ({
      tag: el.tagName.toLowerCase(), type: el.type, id: el.id || null, name: el.name || null, css: css(el), placeholder: el.placeholder || null,
      label: labelOf(el), visible: vis(el), value: el.type === 'password' ? '***' : (el.value || '').slice(0, 60),
      options: el.tagName === 'SELECT' ? [...el.options].slice(0, 15).map(o => o.text.trim()) : undefined,
    }));
    const buttons = [...document.querySelectorAll('button, a.btn, input[type=submit], input[type=button], [role=button]')].map(el => ({
      text: (el.innerText || el.value || '').trim().slice(0, 60), id: el.id || null, cls: (el.className || '').toString().slice(0, 80), visible: vis(el), href: el.getAttribute('href') }))
      .filter(b => b.text || b.id);
    const links = [...document.querySelectorAll('a[href]')].map(a => ({ t: a.innerText.trim().slice(0, 50), h: a.href })).filter(l => /factur|emit|client|produs|nomencl|firm|compan/i.test(l.t + l.h));
    return { url: location.href, title: document.title, fields, buttons, links };
  });
}

async function recon(profile, { targets = [], log = console.log } = {}) {
  const outDir = path.join(profile.dirs.out, 'recon');
  fs.mkdirSync(outDir, { recursive: true });
  const s = await openSession({ profile, log });
  const res = { at: new Date().toISOString(), pages: [] };
  try {
    const shot = async name => { const f = path.join(outDir, `${name}.png`); await s.page.screenshot({ path: f, fullPage: true }); return f; };
    await dismissCookies(s.page);
    res.pages.push({ name: 'home', shot: await shot('00-home'), inv: await inventory(s.page) });
    let i = 1;
    for (const t of targets) {
      try {
        await s.page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await s.page.waitForTimeout(t.wait || 8000);
        await dismissCookies(s.page);
        if (t.after) await t.after(s.page);
        res.pages.push({ name: t.name, shot: await shot(`${String(i).padStart(2, '0')}-${t.name}`), inv: await inventory(s.page) });
      } catch (e) { res.pages.push({ name: t.name, error: e.message, url: s.page.url() }); }
      i++;
    }
  } finally {
    res.guard = { blocked: s.guard.blocked, allowed: s.guard.allowed };
    wf(path.join(outDir, 'recon.json'), JSON.stringify(res, null, 2));
    await s.browser.close();
  }
  return { outDir, res };
}
module.exports = { recon, inventory };
