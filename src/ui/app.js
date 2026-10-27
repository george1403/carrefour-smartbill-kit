'use strict';
(function () {
  // token: from the address once, then kept only in this tab (the address bar is cleaned)
  var q = new URLSearchParams(location.search); var T = q.get('t') || sessionStorage.getItem('kitT') || '';
  if (q.get('t')) { sessionStorage.setItem('kitT', T); history.replaceState(null, '', '/' + location.hash); }
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var money = function (n) { return n == null ? '?' : (Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ','); };
  var S = { status: null, job: null, since: 0, lines: [], seenEnd: 0, last: null, after: null, form: {}, qtext: '' };
  function api(method, url, body) {
    return fetch(url, { method: method, headers: Object.assign({ 'X-Kit-Token': T }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
      .then(function (r) { return r.json().then(function (j) { j._code = r.status; return j; }); })
      .catch(function () { return { _code: 0, error: 'down' }; });
  }

  // ---------- the "what to do" texts per exit code (same codes as the menu) ----------
  var FIX = {
    1: { t: 'Nu s-a terminat', s: ['Citește mesajul de mai jos.', 'Apasă „Încearcă din nou”.'], fix: ['retry', 'Încearcă din nou'] },
    3: { t: 'Portalul Carrefour cere autentificarea', s: ['Apasă „Autentificare Carrefour” (butonul de mai jos).', 'Dacă se deschide fereastra portalului, scrie codul din imagine și apasă Autentificare.', 'După ce scrie GATA, apasă „Reia”.'], fix: ['login', 'Autentificare Carrefour'] },
    4: { t: 'Utilizatorul sau parola nu sunt acceptate', s: ['Verifică-le intrând o dată în portal / SmartBill din browser.', 'Apasă „Configurare” și scrie-le din nou.', 'Nu am reîncercat, ca să nu se blocheze contul.'], fix: ['go:setup', 'Configurare'] },
    5: { t: 'Nu e internet sau portalul nu răspunde', s: ['Verifică internetul (deschide o pagină în browser).', 'Așteaptă câteva minute și apasă „Încearcă din nou”.', 'Ce era deja făcut nu se dublează.'], fix: ['retry', 'Încearcă din nou'] },
    6: { t: 'Pagina portalului s-a schimbat', s: ['Nu am făcut nimic.', 'Programul trebuie actualizat de George: apasă „Raport suport” și trimite-i fișierul.'], fix: ['go:support', 'Raport suport'] },
    7: { t: 'Autentificarea nu s-a terminat', s: ['Apasă din nou „Autentificare Carrefour” când ai câteva minute libere.', 'Nu închide fereastra portalului până nu se închide singură.'], fix: ['login', 'Autentificare Carrefour'] },
    8: { t: 'Nu pot scrie pe disc', s: ['Eliberează spațiu pe disc sau mută folderul programului în Documente.', 'Apoi apasă „Încearcă din nou”.'], fix: ['retry', 'Încearcă din nou'] },
    9: { t: 'Instalarea e incompletă', s: ['Apasă „Repară instalarea” și așteaptă să scrie GATA.', 'Apoi apasă „Reia”.'], fix: ['repair', 'Repară instalarea'] },
    10: { t: 'Configurarea lipsește sau e incompletă', s: ['Apasă „Configurare” și răspunde la întrebări.'], fix: ['go:setup', 'Configurare'] },
    11: { t: 'Are nevoie de verificarea ta', s: ['Citește mesajul de mai jos.', 'Verifică în SmartBill > Rapoarte > Facturi > Filtrare > Ciornă comanda respectivă.', 'Nu am salvat nimic nou.'], fix: ['go:history', 'Vezi istoricul'] },
    12: { t: 'Contul Carrefour NU este al firmei tale', s: ['Programul s-a oprit și nu a citit nimic.', 'Apasă „Configurare” și scrie utilizatorul și parola portalului pentru FIRMA TA.'], fix: ['go:setup', 'Configurare'] }
  };

  // ---------- job panel ----------
  function run(action, extra) {
    var body = Object.assign({ action: action }, extra || {}); S.last = body;
    return api('POST', '/api/run', body).then(startResp);
  }
  function startResp(r) {
    if (!r.ok) { showMsg(r.error === 'busy' ? 'Așteaptă puțin' : 'Atenție', r.message || 'Nu am putut porni.'); return r; }
    S.job = r.job; S.since = 0; S.lines = []; renderJob(); poll(); return r;
  }
  function poll() {
    api('GET', '/api/job?since=' + S.since).then(function (j) {
      if (!j.id) return;
      if (!S.job || S.job.id !== j.id) { S.lines = []; }
      S.job = j; S.lines = S.lines.concat(j.lines || []); S.since = j.total || S.since; renderJob();
      if (j.running) setTimeout(poll, 700); else { refresh(); if (S.onDone) { var f = S.onDone; S.onDone = null; f(j); } render(); }
    });
  }
  function renderJob() {
    var j = S.job; var el = $('#job'); document.body.classList.toggle('busy', !!(j && j.running));
    // Preserve current input value before re-rendering
    var prevInput = $('#qtext');
    if (prevInput && prevInput.id === 'qtext') S.qtext = prevInput.value;
    if (!j || (!j.running && S.dismissed === j.id)) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    var log = '<details' + (j.running ? ' open' : '') + '><summary>Ce face programul (detalii)</summary><div class="log" id="log">' + esc(S.lines.slice(-400).join('\n')) + '</div></details>';
    var h;
    if (j.running) {
      h = '<div class="work"><h2><span class="spin"></span>LUCREZ… Nu închide fereastra.</h2><p><b>' + esc(j.title) + '</b> · ' + j.seconds + ' secunde. Când termin scriu <b class="ok">GATA</b> sau îți arăt <b class="err">CE FACI</b>.</p>' + question(j) + log + '</div>';
    } else if (j.exit === 0) {
      h = '<div class="done"><h2>GATA ✓</h2><p><b>' + esc(j.title) + '</b> s-a terminat.</p>' + summary(j) + (S.after ? '<button class="btn green" data-act="resume">Reia: ' + esc(S.after.title) + '</button>' : '') + '<button class="btn grey" data-act="dismiss">Am înțeles</button>' + log + '</div>';
    } else if (j.exit === 2) {
      h = '<div class="stop"><h2>OPRIT, ca să nu faci o dublă</h2><p>Comanda are deja factură sau ciornă în SmartBill. Nu s-a salvat nimic.</p>' + lastMsg() + '<button class="btn grey" data-act="dismiss">Am înțeles</button>' + log + '</div>';
    } else {
      var f = FIX[j.exit] || FIX[1];
      h = '<div class="cefaci"><h2>CE FACI: ' + esc(f.t) + '</h2><ol>' + f.s.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>' + (lastMsg(true)) +
        '<div class="row" style="margin-top:12px"><button class="btn white big" data-fix="' + f.fix[0] + '">' + esc(f.fix[1]) + '</button>' + (f.fix[0] !== 'go:support' ? '<button class="btn grey" data-go="support">Raport suport</button>' : '') + '<button class="btn grey" data-act="dismiss">Închide</button></div>' +
        '<p style="font-size:16px">Dacă nu reușești: apasă „Raport suport” și trimite fișierul lui George.</p>' + log + '</div>';
    }
    el.innerHTML = h; var lg = $('#log'); if (lg) lg.scrollTop = lg.scrollHeight;
    var qi = $('#qtext'); if (qi && !qi.dataset.f) { qi.dataset.f = 1; qi.focus(); }
  }
  function lastMsg(dark) {
    var m = S.lines.filter(function (l) { return /EROARE|OPRIT|ATENTIE|nu a|Nu am|STOP/i.test(l); }).slice(-3).join('\n');
    return m ? '<div class="msg"' + (dark ? '' : ' style="background:#fff;padding:8px 12px;border-radius:8px"') + '>' + esc(m) + '</div>' : '';
  }
  function question(j) {
    var qq = j.question; if (!qq) return '';
    var h = '<div class="q"><p>Programul te întreabă: ' + esc(qq.text) + '</p>';
    if (qq.kind === 'yesno') h += '<button class="btn green" data-ans="da">Da</button><button class="btn grey" data-ans="nu">Nu</button>';
    else if (qq.kind === 'choice') h += qq.choices.map(function (c) { return '<button class="btn" data-ans="' + esc(c.value) + '">' + esc(c.value + ') ' + c.label) + '</button>'; }).join('<br>');
    else h += '<div class="row"><input type="text" id="qtext" autocomplete="off" value="' + esc(S.qtext) + '"><button class="btn" data-act="answer">Trimite</button></div>';
    return h + '</div>';
  }
  function summary(j) {
    var r = j.result; if (!r) return '';
    if (j.action === 'support' && r.file) return '<p>Am făcut fișierul <b>' + esc(r.file) + '</b> (în folderul programului, FĂRĂ parole). <b>Trimite-l lui George pe WhatsApp sau email.</b></p><button class="btn green big" data-reveal="' + esc(r.file) + '">Arată fișierul</button>';
    return '';
  }
  function answer(t) { api('POST', '/api/answer', { job: S.job.id, text: t }).then(function () { S.job.question = null; S.qtext = ''; renderJob(); }); }

  // ---------- modal ----------
  function showMsg(title, text) { var m = $('#modal'); m.innerHTML = '<div class="box"><h2>' + esc(title) + '</h2><p>' + esc(text) + '</p><button class="btn" data-act="close">Bine</button></div>'; m.classList.remove('hidden'); }
  function confirmBox(html, yes, onYes) { var m = $('#modal'); m.innerHTML = '<div class="box">' + html + '<label class="opt" id="ackl"><input type="checkbox" id="ack"><span>Am înțeles.</span></label><div class="row"><button class="btn green big" id="yes" disabled>' + esc(yes) + '</button><button class="btn grey" data-act="close">Renunț</button></div></div>'; m.classList.remove('hidden');
    $('#ack').addEventListener('change', function () { $('#yes').disabled = !this.checked; }); $('#yes').addEventListener('click', function () { m.classList.add('hidden'); onYes(); }); }

  // ---------- screens ----------
  var back = '<button class="back needidle" data-go="home">← Înapoi la ecranul principal</button>';
  function modeText(s) { return s.mode === 'automat' ? '<span class="warn">AUTOMAT (emite facturi singur)</span>' : s.mode ? 'Doar ciorne (tu emiți facturile)' : '—'; }
  var SCREENS = {
    home: function (s) {
      var probs = (s.problems || []).map(function (p) { var b = p.kind === 'login' ? '<button class="btn red" data-go="login">Autentificare</button>' : p.kind === 'setup' ? '<button class="btn red" data-go="setup">Configurare</button>' : '<button class="btn red" data-go="history">Vezi</button>';
        return '<div class="prob"><span>' + esc(p.text) + '</span>' + b + '</div>'; }).join('');
      return '<h1>Bună! Ce vrei să faci?</h1><div class="card"><div class="kv">' +
        '<div>Firma</div><div>' + esc(s.company || 'neconfigurat') + '</div>' +
        '<div>Seria facturilor</div><div>' + esc(s.series || '—') + '</div>' +
        '<div>Mod de lucru</div><div>' + modeText(s) + '</div>' +
        '<div>Verificare la fiecare oră</div><div>' + (s.schedule ? '<span class="ok">PORNITĂ</span>' : 'oprită') + '</div>' +
        '<div>Ultima acțiune</div><div style="font-weight:normal">' + esc(s.lastRun || '—') + '</div></div>' +
        (probs ? '<h2 class="err">Probleme deschise (' + s.problems.length + ')</h2>' + probs : '<p class="ok"><b>✓ Nicio problemă deschisă.</b></p>') + '</div>' +
        '<div class="grid needidle">' +
        tile('ciorna', 'Ciornă pentru o comandă', 'Scrii numărul comenzii; se face ciorna în SmartBill.', 'main') +
        tile('bulk', 'Ciorne în bloc', 'Toate comenzile nefacturate: lista, apoi confirmi.', 'main') +
        tile('login', 'Autentificare Carrefour', 'Când programul îți cere codul din imagine.') +
        tile('auto', 'Verificare automată', 'Pornită / oprită, la fiecare oră.') +
        tile('history', 'Istoric', 'Ce a făcut programul.') +
        tile('setup', 'Configurare', 'Conturile, seria, modul de lucru.') +
        tile('support', 'Raport suport', 'Un fișier pentru George, fără parole.') +
        tile('repair', 'Reparare', 'Dacă ceva nu mai pornește.') +
        tile('uninstall', 'Dezinstalare', 'Oprește programul de tot.', 'danger') + '</div>' +
        '<p style="margin-top:18px"><button class="back" data-act="quit">Închide programul</button></p>';
    },
    ciorna: function () {
      return back + '<h1>Ciornă pentru o comandă</h1><div class="card needidle"><label class="f" for="order">Numărul comenzii Carrefour</label><input class="order" type="text" id="order" inputmode="numeric" placeholder="ex. 1780308" value="' + esc(S.form.order || '') + '">' +
        '<p>Programul completează factura în SmartBill și o salvează ca <b>CIORNĂ</b>. Nu se emite nicio factură; o verifici și o emiți tu din SmartBill.</p>' +
        '<button class="btn big green" data-act="ciorna">Fă ciorna</button><button class="btn grey" data-act="preview">Doar previzualizare (nu salvează)</button>' +
        '<h2>Nu știi numărul?</h2><button class="btn grey" data-run="orders">Vezi lista comenzilor</button></div>';
    },
    bulk: function () {
      var r = S.bulk; var h = back + '<h1>Ciorne în bloc</h1><div class="card needidle"><p>Programul citește <b>toate</b> comenzile din portalul Carrefour, oricât de vechi, și îți arată lista celor care nu au factură sau ciornă. <b>Nu creează nimic până nu confirmi.</b> Face doar CIORNE, niciodată facturi.</p><button class="btn big" data-act="bulk-check">' + (r ? 'Arată din nou lista' : 'Arată lista') + '</button></div>';
      if (!r) return h;
      if (r.mode === 'ciorne') {
        h += '<div class="card"><h2>Rezultat: ' + r.created.length + ' ciorne create</h2>' + table(r.created, true) + listOf('Aveau deja ciornă', r.alreadyDraft, 'why') + listOf('Sărite', r.skipped, 'why') + listOf('Erori', r.errors, 'error') +
          (r.remaining.length ? '<p class="warn"><b>Neprocesate:</b> ' + esc(r.remaining.join(', ')) + '. Reia mai târziu; ce e făcut nu se dublează.</p>' : '') + '<p><b>Ciornele sunt în SmartBill > Rapoarte > Facturi > Filtrare > Ciornă. Verifică-le și emite-le tu.</b></p></div>';
        return h;
      }
      h += '<div class="card"><h2>De făcut ciornă: ' + r.preview.length + ' comenzi, total ' + money(r.previewTotal) + ' lei fără TVA</h2>' + (r.preview.length ? table(r.preview) : '<p class="ok"><b>Nimic de făcut: toate comenzile au deja factură sau ciornă.</b></p>') +
        listOf('Au deja ciornă (nu se dublează)', r.alreadyDraft, 'why') + listOf('Sărite', r.skipped, 'why') +
        (r.offer ? '<button class="btn big green needidle" data-act="bulk-create">Creează ciornele (' + r.offer.count + ')</button><p style="font-size:16px">Durează cam 1 minut pe comandă. Înainte de fiecare ciornă se verifică din nou în SmartBill, ca să nu se dubleze.</p>' : '') + '</div>';
      return h;
    },
    login: function () {
      return back + '<h1>Autentificare Carrefour</h1><div class="card needidle"><p>Folosește-o când programul îți cere („Portalul Carrefour cere autentificarea”).</p><ol><li>Apasă butonul de mai jos.</li><li>Programul încearcă singur să citească codul din imagine.</li><li>Dacă nu reușește, se deschide o fereastră a portalului Carrefour: <b>scrie codul din imagine și apasă Autentificare</b>. Fereastra se închide singură.</li></ol><button class="btn big green" data-run="login">Autentifică-mă</button></div>';
    },
    auto: function (s) {
      var lim = s.mode === 'automat' ? '<ul><li>Prima verificare automată într-un folder doar <b>arată</b> ce ar face; facturile se emit de la a doua.</li><li>Cel mult <b>' + esc(Math.min(10, s.maxPerRun || 3)) + '</b> facturi la o verificare (plafon 10).</li><li>La orice îndoială se oprește; comanda rămâne ciornă în SmartBill > Rapoarte > Facturi > Filtrare > Ciornă.</li><li>Facturile emise apar în fișierul FACTURI-EMISE-AUTOMAT.txt și primești o notificare.</li><li><b>Atenție:</b> dacă în SmartBill e pornită trimiterea automată în SPV, factura pleacă singură la ANAF.</li></ul>'
        : '<ul><li>Face doar <b>CIORNE</b> pentru comenzile noi (nicio factură emisă).</li><li>Doar comenzile primite după configurare și nu mai vechi de 14 zile (cele vechi: „Ciorne în bloc”).</li><li>Cel mult ' + esc(s.maxPerRun || 10) + ' ciorne la o verificare.</li><li>Nu dublează nimic: verifică în SmartBill înainte de fiecare ciornă.</li></ul>';
      return back + '<h1>Verificare automată</h1><div class="card needidle"><p class="big-state">Verificare la fiecare oră: ' + (s.schedule ? '<span class="ok">PORNITĂ</span>' : '<span class="err">OPRITĂ</span>') + '</p><p>Cât timp calculatorul e pornit, programul verifică singur comenzile noi.</p>' +
        (s.schedule ? '<button class="btn big red" data-run="schedule-off">Oprește verificarea</button>' : '<button class="btn big green" data-run="schedule-on">Pornește verificarea (la fiecare oră)</button>') + '<button class="btn grey" data-run="auto">Verifică acum, o dată</button>' +
        '<h2>Ce face, în modul ales: ' + modeText(s) + '</h2>' + lim + '<p>Modul de lucru (doar ciorne / automat) îl schimbi din <button class="back" data-go="setup">Configurare</button>.</p></div>';
    },
    history: function () {
      var h = S.hist; if (!h) { api('GET', '/api/history').then(function (x) { S.hist = x; render(); }); return back + '<h1>Istoric</h1><p>Se încarcă…</p>'; }
      return back + '<h1>Istoric</h1><div class="card"><h2>Ultimele acțiuni</h2>' + (h.menu.length ? '<table>' + h.menu.slice(0, 25).map(function (l) { return '<tr><td>' + esc(l) + '</td></tr>'; }).join('') + '</table>' : '<p>Nimic încă.</p>') + '</div>' +
        '<div class="card"><h2>Ciorne făcute de program</h2>' + (h.drafts.length ? '<table><tr><th>Comanda</th><th>Ciorna (id SmartBill)</th><th>Stare</th></tr>' + h.drafts.map(function (d) { return '<tr><td>' + esc(d.orderNo) + '</td><td>' + esc(d.id || '—') + '</td><td>' + esc(d.status === 'draft-only' ? 'ciornă' : d.status) + '</td></tr>'; }).join('') + '</table>' : '<p>Nicio ciornă încă.</p>') + '</div>' +
        '<div class="card"><h2>Ciorne în bloc</h2>' + (h.bulk.length ? '<table><tr><th>Când</th><th>Tip</th><th class="n">Create</th><th class="n">Deja ciornă</th><th class="n">Sărite</th><th class="n">Erori</th></tr>' + h.bulk.map(function (b) { return '<tr><td>' + esc(new Date(b.at).toLocaleString('ro-RO')) + '</td><td>' + esc(b.mode === 'previzualizare' ? 'doar lista' : 'creare') + '</td><td class="n">' + b.created + '</td><td class="n">' + b.alreadyDraft + '</td><td class="n">' + b.skipped + '</td><td class="n">' + b.errors + '</td></tr>'; }).join('') + '</table>' : '<p>Nimic încă.</p>') + '</div>' +
        (h.issued.length ? '<div class="card"><h2>Facturi emise automat</h2><div class="log">' + esc(h.issued.join('\n')) + '</div></div>' : '');
    },
    setup: function (s) {
      var f = S.form; if (f.reuse == null) f.reuse = !!s.envSaved; if (!f.mode) f.mode = s.mode || 'ciorne';
      var h = back + '<h1>Configurare</h1><div class="card needidle"><p>Ai nevoie doar de 2 conturi: <b>SmartBill</b> și <b>portalul de furnizori Carrefour</b>. Restul îl citește programul singur.</p>';
      if (s.envSaved) h += opt('reuse', '1', f.reuse, 'Folosesc conturile salvate', 'Le-ai scris la configurarea anterioară.') + opt('reuse', '0', !f.reuse, 'Scriu conturile din nou', '');
      if (!f.reuse || !s.envSaved) h += '<label class="f" for="email">1. Email cont SmartBill</label><input type="email" id="email" autocomplete="off"><label class="f" for="pw1">2. Parola SmartBill</label><input type="password" id="pw1" autocomplete="new-password"><label class="f" for="cu">3. Utilizator portal Carrefour</label><input type="text" id="cu" autocomplete="off"><label class="f" for="pw2">4. Parola portal Carrefour</label><input type="password" id="pw2" autocomplete="new-password"><p style="font-size:16px">Parolele se păstrează doar pe acest calculator și nu se afișează nicăieri.</p>';
      h += '<h2>Cum lucrează când verifică singur comenzile noi?</h2>' + opt('mode', 'ciorne', f.mode !== 'automat', 'Doar ciorne (recomandat)', 'Pregătește facturile ca CIORNE în SmartBill; tu le verifici și le emiți.') + opt('mode', 'automat', f.mode === 'automat', 'Automat', 'Emite singur factura pentru fiecare comandă nouă (cel mult 3 odată; se oprește la orice îndoială).') +
        '<label class="opt"><input type="checkbox" id="sch"' + (f.schedule ? ' checked' : '') + '><span><b>Verifică singur la fiecare oră</b><br><small>cât timp calculatorul e pornit</small></span></label>' +
        '<button class="btn big green" data-act="setup">Pornește configurarea</button><p style="font-size:16px">Programul citește apoi SmartBill și portalul și te întreabă aici ce serie folosești.</p></div>' +
        '<div class="card needidle"><h2>Alte acțiuni</h2><button class="btn grey" data-run="discover">Recitește datele din SmartBill și Carrefour</button><button class="btn grey" data-act="import-list">Preia setările din kitul vechi</button></div>';
      return h;
    },
    support: function () { return back + '<h1>Raport suport</h1><div class="card needidle"><p>Un singur clic face un fișier cu jurnalele programului, <b>fără parole</b>. Se deschide fereastra cu fișierul selectat; trimite-l lui George pe WhatsApp sau email.</p><button class="btn big green" data-run="support">Fă raportul pentru suport</button></div>'; },
    repair: function () { return back + '<h1>Reparare</h1><div class="card needidle"><p>Dacă programul spune că lipsește browserul sau o parte din instalare. Descarcă din nou browserul programului (~150 MB, câteva minute). Conturile rămân.</p><button class="btn big green" data-run="repair">Repară instalarea</button><button class="btn grey" data-run="selftest">Verificare instalare</button></div>'; },
    uninstall: function () { return back + '<h1>Dezinstalare</h1><div class="card needidle"><p>Oprește verificarea automată și șterge scurtăturile de pe Desktop. Apoi poți șterge folderul programului (trage-l în Coș / Recycle Bin).</p><p class="note">Dacă vrei să păstrezi istoricul, copiază înainte folderul „out”. Fișierul „.env” conține parolele tale: nu-l trimite nimănui.</p><button class="btn big red" data-act="uninstall">Dezinstalează</button></div>'; },
    bye: function () { return '<h1>Programul a fost dezinstalat</h1><div class="card"><p>Verificarea automată e oprită și scurtăturile au fost șterse. Poți închide această pagină și șterge folderul programului.</p></div>'; }
  };
  function tile(go, t, s, cls) { return '<button class="tile ' + (cls || '') + '" data-go="' + go + '"><b>' + esc(t) + '</b><small>' + esc(s) + '</small></button>'; }
  function opt(name, val, sel, t, s) { return '<label class="opt' + (sel ? ' sel' : '') + '"><input type="radio" name="' + name + '" value="' + val + '"' + (sel ? ' checked' : '') + '><span><b>' + esc(t) + '</b>' + (s ? '<br><small>' + esc(s) + '</small>' : '') + '</span></label>'; }
  function table(rows, ids) { return '<table><tr><th>#</th><th>Comanda</th><th>Data</th><th>Magazin</th><th class="n">Total fără TVA</th>' + (ids ? '<th>Ciornă (id)</th>' : '') + '</tr>' + rows.map(function (x, i) { return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(x.orderNo) + '</b></td><td>' + esc(x.date ? x.date.split('-').reverse().join('.') : '') + '</td><td>' + esc(x.store || '') + '</td><td class="n">' + money(x.total) + ' lei</td>' + (ids ? '<td>' + esc(x.draftId || '?') + '</td>' : '') + '</tr>'; }).join('') + '</table>'; }
  function listOf(t, rows, k) { if (!rows || !rows.length) return ''; return '<details><summary>' + esc(t) + ': ' + rows.length + '</summary><table>' + rows.map(function (x) { return '<tr><td>' + esc(x.orderNo || '—') + '</td><td>' + esc(x[k]) + '</td></tr>'; }).join('') + '</table></details>'; }

  var cur = (location.hash || '#home').slice(1);
  function go(n) { if (!SCREENS[n]) n = 'home'; cur = n; if (n === 'history') S.hist = null; if (location.hash !== '#' + n) location.hash = n; render(); window.scrollTo(0, 0); }
  window.addEventListener('hashchange', function () { var n = location.hash.slice(1); if (n !== cur) go(n); });
  function render() { if (!S.status) return; $('#screen').innerHTML = SCREENS[cur](S.status); }
  function refresh() {
    return api('GET', '/api/status').then(function (s) {
      if (s._code !== 200) { $('#pill').textContent = 'Programul e închis'; $('#pill').className = 'pill bad'; if (s._code === 403) $('#screen').innerHTML = '<div class="card"><h1>Deschide programul din nou</h1><p>Dă dublu-click pe scurtătura <b>Carrefour SmartBill</b> de pe Desktop.</p></div>'; return; }
      var first = !S.status; S.status = s; $('#demo').classList.toggle('hidden', !s.demo);
      var p = $('#pill'); p.textContent = s.busy ? 'LUCREZ…' : s.problems.length ? s.problems.length + ' probleme' : 'Totul e în regulă'; p.className = 'pill' + (s.busy ? ' busy' : s.problems.length ? ' bad' : '');
      if (first) { render(); if (s.job && s.job.running) { S.since = 0; poll(); } }
      else if (cur === 'home' && !document.querySelector('#screen input:focus')) render();
    });
  }

  // ---------- clicks ----------
  document.addEventListener('change', function (e) { var t = e.target; if (t.name === 'reuse') { S.form.reuse = t.value === '1'; render(); } if (t.name === 'mode') { S.form.mode = t.value; if (t.value === 'automat') showMsg('Mod automat', 'În modul automat programul EMITE facturi singur (cel mult 3 la o verificare, prima verificare doar arată ce ar face). Dacă nu ești sigur, alege „Doar ciorne”.'); render(); } if (t.id === 'sch') S.form.schedule = t.checked; if (t.id === 'order') S.form.order = t.value; });
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'qtext') answer(e.target.value); if (e.key === 'Enter' && e.target.id === 'order') act('ciorna'); });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.go) { if (b.dataset.go === 'support' || b.dataset.go === 'setup' || b.dataset.go === 'login') S.dismissed = S.job && !S.job.running ? S.job.id : S.dismissed; renderJob(); go(b.dataset.go); return; }
    if (b.dataset.run) { S.after = null; run(b.dataset.run); return; }
    if (b.dataset.ans != null) { answer(b.dataset.ans); return; }
    if (b.dataset.reveal) { api('POST', '/api/reveal', { file: b.dataset.reveal }); return; }
    if (b.dataset.fix) { var fx = b.dataset.fix; if (fx.indexOf('go:') === 0) { S.dismissed = S.job.id; renderJob(); go(fx.slice(3)); return; }
      if (fx === 'retry') { if (S.last && S.last.action === 'setup') { S.dismissed = S.job.id; renderJob(); go('setup'); showMsg('Configurare', 'Verifică datele și apasă din nou „Pornește configurarea”. Parolele nu se păstrează în pagină, așa că scrie-le din nou (sau alege „Folosesc conturile salvate”).'); return; }
        if (S.last && S.last.action) api('POST', '/api/run', S.last).then(startResp); else act('bulk-check'); return; }
      var prev = S.last; S.after = prev && prev.action !== fx ? { body: prev, title: S.job.title } : null; run(fx).then(function () { S.last = prev; }); return; }
    if (b.dataset.act) act(b.dataset.act, b);
  });
  function act(a) {
    if (a === 'close') { $('#modal').classList.add('hidden'); return; }
    if (a === 'dismiss') { S.dismissed = S.job.id; S.after = null; renderJob(); return; }
    if (a === 'resume') { var r = S.after; S.after = null; if (r.body.action) run(r.body.action, r.body); else act('bulk-check'); return; }
    if (a === 'answer') { answer(($('#qtext') || {}).value || ''); return; }
    if (a === 'quit') { api('POST', '/api/quit', {}).then(function (r) { if (r.ok) $('#screen').innerHTML = '<div class="card"><h1>Programul s-a închis</h1><p>Poți închide această pagină. Îl redeschizi cu dublu-click pe scurtătura de pe Desktop.</p></div>'; else showMsg('Așteaptă', 'Programul lucrează încă. Închide-l după ce scrie GATA.'); }); return; }
    if (a === 'ciorna' || a === 'preview') { var o = (($('#order') || {}).value || '').replace(/\D/g, ''); S.form.order = o; if (!o) { showMsg('Lipsește numărul', 'Scrie numărul comenzii Carrefour (doar cifre, ex. 1780308).'); return; } S.after = null; run(a, { order: o }); return; }
    if (a === 'import-list') { S.onDone = function (j) { var d = j.result && j.result.dir; if (!d) { showMsg('Nu am găsit', 'Nu am găsit un kit vechi configurat în Descărcări, Desktop, Documente sau lângă acest folder. Fă Configurarea.'); return; }
      confirmBox('<h2>Preiau setările din acest folder?</h2><p class="note"><b>' + esc(d) + '</b></p><p>Copiez conturile, profilul și jurnalul comenzilor din kitul vechi. Kitul vechi rămâne neatins. Confirmă doar dacă e <b>kitul TĂU</b>.</p>', 'Da, preia din acest folder', function () { api('POST', '/api/import', { dir: d, confirm: true }).then(startResp); }); }; run('import-list'); return; }
    if (a === 'bulk-check') { S.bulk = null; S.onDone = function (j) { if (j.result) { S.bulk = j.result; } }; run('bulk-check'); return; }
    if (a === 'bulk-create') { var of = S.bulk.offer; confirmBox('<h2>Creez ' + of.count + ' ciorne în SmartBill?</h2><p>Se fac <b>doar CIORNE</b>. <b>NU se emite nicio factură.</b> Le verifici și le emiți tu din SmartBill > Rapoarte > Facturi > Filtrare > Ciornă.</p>', 'Da, creează ' + of.count + ' ciorne', function () {
      var body = { offer: of.id, count: of.count, confirm: true }; S.last = body; S.onDone = function (j) { if (j.result) S.bulk = j.result; }; api('POST', '/api/bulk-create', body).then(startResp); }); return; }
    if (a === 'uninstall') { confirmBox('<h2>Dezinstalez programul?</h2><p>Se oprește verificarea automată și se șterg scurtăturile de pe Desktop.</p>', 'Da, dezinstalează', function () { S.onDone = function (j) { if (j.exit === 0) go('bye'); }; run('uninstall', { confirm: true }); }); return; }
    if (a === 'setup') { var f = S.form, s = S.status, body = { reuse: !!(s.envSaved && f.reuse), mode: f.mode === 'automat' ? 'automat' : 'ciorne', schedule: !!($('#sch') || {}).checked };
      if (!body.reuse) { body.email = $('#email').value.trim(); body.password = $('#pw1').value; body.carrefourUser = $('#cu').value.trim(); body.carrefourPassword = $('#pw2').value;
        if (!body.email || !body.password || !body.carrefourUser || !body.carrefourPassword) { showMsg('Lipsește ceva', 'Completează toate cele 4 câmpuri (email și parola SmartBill, utilizator și parola Carrefour).'); return; } }
      S.after = null; run('setup', body).then(function () { ['#pw1', '#pw2'].forEach(function (k) { var x = $(k); if (x) x.value = ''; }); delete S.last.password; delete S.last.carrefourPassword; }); return; }
  }
  refresh(); setInterval(refresh, 4000);
})();
