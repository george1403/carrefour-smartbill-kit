'use strict';
// Local mock of the Carrefour supplier portal (tests only; no real portal, no real account).
const http = require('http'); const fs = require('fs'); const path = require('path');
function start(opts = {}) {
  const st = { mode: 'image', supplier: '10001', supplierName: 'FIRMA MEA TEST SRL', submits: 0, docsHits: 0, expireAfterDocs: Infinity, slowMs: 0,
    manual: null, sessions: new Set(), answer: '3387', password: 'p', ...opts };
  const png = fs.readFileSync(path.join(__dirname, '..', 'test-data', 'captcha-3387.png'));
  const cookie = req => ((req.headers.cookie || '').match(/sess=(\w+)/) || [])[1];
  const authed = req => st.sessions.has(cookie(req));
  const loginPage = (err = '') => {
    const cap = st.mode === 'image' ? `<input id="_58_captchaText" name="c"><img id="_58_captcha" src="/captcha.png?${Date.now()}"><a id="refreshCaptcha" href="javascript:void(0)">alt</a>`
      : st.mode === 'recaptcha' ? '<div class="g-recaptcha" data-sitekey="x" style="width:300px;height:70px">robot?</div>'
      : st.mode === 'unknown-captcha' ? '<input id="_58_captchaText" name="c"><canvas width="100" height="40"></canvas>' : '';
    // "manual": a script plays the human typing the CAPTCHA in the visible window (first a wrong code if manual==='wrong-then-ok')
    const human = st.manual ? `<script>setTimeout(()=>{document.querySelector('#_58_captchaText')&&(document.querySelector('#_58_captchaText').value=${JSON.stringify(st.manual === 'wrong-then-ok' && !st.wrongDone ? '0000' : st.answer)});document.querySelector('#_58_login').value='u';document.querySelector('#_58_password').value=${JSON.stringify(st.password)};document.querySelector('#hc').value='1';document.querySelector('#_58_fm').submit();},800)</script>` : '';
    return `<html><head><title>Welcome - Liferay</title><script>Liferay={ThemeDisplay:{isSignedIn:()=>false}}</script></head><body>${err ? `<div class="alert-error">${err}</div>` : ''}
<form id="_58_fm" method="post" action="/c/portal/login?p_p_id=58"><input id="_58_login" name="u"><input id="_58_password" name="p" type="password"><input type="hidden" id="hc" name="hc" value="">${cap}<button type="submit">Autentificare</button></form>${human}</body></html>`;
  };
  const docsPage = () => `<html><head><title>Documente</title><script>Liferay={ThemeDisplay:{isSignedIn:()=>true}};EC={Url:{goTo:(u,p,o,t)=>window.open('/detail?id='+o.id)}};
var jsonModel = ${JSON.stringify({ data: (st.orders || [{ id: 11, nrComMeti: '1780308', magazin: 'CARREFOUR BRASOV', codGLN: '5940475006037', dataCom: '19.10.2026', totalFaraTvaML: 120.36, stare: 'Noua' }]).map(o => ({ furnizor: st.supplierName, codFurnizor: st.supplier, ...o })) })};</script></head><body><a href="/c/portal/logout">Iesire</a></body></html>`;
  const detail = () => `<html><head><script>Liferay={ThemeDisplay:{isSignedIn:()=>true}};var jsonModel = ${JSON.stringify({ data: { linii: [{ codEAN: '5940000000017', codArticol: 90000001, articol: 'PRODUS TEST 50G', cant: 6, um: 'PCE', pret: 20.06, cotaTva: 11 }] } })};</script></head><body>detaliu</body></html>`;
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const send = (code, body, h = {}) => { res.writeHead(code, { 'content-type': 'text/html', ...h }); res.end(body); };
    setTimeout(() => {
      if (st.mode === 'down') return send(503, 'Service Unavailable');
      if (u.pathname === '/captcha.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(png); }
      if (req.method === 'POST' && u.pathname.includes('/login')) {
        let b = ''; req.on('data', c => b += c); req.on('end', () => { st.submits++; const f = new URLSearchParams(b);
          if (st.rejectMsg) return send(200, loginPage(st.rejectMsg)); // tests: portal answers with an arbitrary message
          if (f.get('p') !== st.password) return send(200, loginPage('Autentificare esuata. Va rugam sa incercati din nou.'));
          if (st.mode === 'image' && f.get('c') !== st.answer) { if (st.manual) st.wrongDone = true; return send(200, loginPage('Textul introdus nu corespunde cu codul de verificare.')); }
          if (st.mode === 'recaptcha' && !f.get('hc')) return send(200, loginPage('Confirmati ca nu sunteti robot.'));
          const id = 'S' + Math.random().toString(36).slice(2); st.sessions.add(id); st.docsHits = 0;
          send(302, '', { location: '/docs', 'set-cookie': `sess=${id}; Path=/` }); });
        return;
      }
      if (st.mode === 'challenge') return send(200, '<html><head><title>Just a moment...</title></head><body><div id="challenge-stage"></div></body></html>');
      if (st.mode === 'layout') return send(200, '<html><head><title>Portal nou</title></head><body><div id="app">Bine ati venit</div></body></html>');
      if (u.pathname === '/docs' || u.pathname === '/detail') {
        if (authed(req) && u.pathname === '/docs' && ++st.docsHits > st.expireAfterDocs) { st.sessions.clear(); st.expireAfterDocs = Infinity; st.expired = (st.expired || 0) + 1; }
        if (!authed(req)) return send(200, loginPage());
        return send(200, u.pathname === '/docs' ? docsPage() : detail());
      }
      send(404, 'nu');
    }, st.slowMs);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ st, url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise(c => srv.close(c)), srv })));
}
module.exports = { start };
