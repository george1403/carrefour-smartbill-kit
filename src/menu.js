'use strict';
// Meniu simplu pentru dublu-click (run.bat / run.command / run.sh fara argumente). Se repeta pana alegi 0.
// Numerele 1-9 NU se schimba (tutorialul video le foloseste); optiunile noi sunt 10-15.
const readline = require('readline');
const { spawnSync } = require('child_process');
const path = require('path'); const fs = require('fs'); const os = require('os');
const c = require('./color');
const { ceFaci, HELP } = require('./errors');
const kit = path.join(__dirname, '..', 'bin', 'kit.js');
const ITEMS = [
  ['1', 'Vezi comenzile Carrefour (care sunt noi / deja facturate)', () => ['orders']],
  ['2', 'Fa CIORNA pentru o comanda (se salveaza in SmartBill ca ciorna; NU se emite factura)', a => ['ciorna', a]],
  ['3', 'Previzualizare comanda (doar completeaza formularul si face o poza; nu salveaza nimic)', a => ['preview', a]],
  ['4', 'Verificare automata acum: comenzile noi -> ciorne (sau facturi, daca ai ales "automat")', () => ['auto']],
  ['5', 'Autentificare Carrefour (codul din imagine) - cand programul iti cere', () => ['login-carrefour']],
  ['6', 'Configurare (conturi, serie, mod de lucru)', () => ['setup']],
  ['7', 'Verificare instalare', () => ['selftest']],
  ['8', 'Actualizare: preia conturile si setarile din kitul vechi', () => ['import-config']],
  ['9', 'Ciorne in bloc: TOATE comenzile nefacturate din portal (lista + confirmare "da"; NU emite facturi)', () => ['bulk-ciorne']],
  ['10', 'Ciorne in bloc - DOAR LISTA (arata ce ar face optiunea 9; nu creeaza nimic)', () => ['bulk-ciorne', '--check']],
  ['11', 'Verificare automata la fiecare ora: porneste sau opreste', a => a === 'opreste' ? ['schedule', '--remove'] : ['schedule']],
  ['12', 'Reciteste datele din SmartBill si Carrefour (serii, produse, magazine)', () => ['discover']],
  ['13', 'Trimite raport la suport (face o arhiva cu jurnalele, FARA parole)', () => ['support']],
  ['14', 'Reparare instalare (descarca din nou browserul programului)', () => ['repair']],
  ['15', 'Dezinstalare (opreste verificarea automata; apoi poti sterge folderul)', () => ['uninstall']],
];
const NAME = Object.fromEntries(ITEMS.map(([k, t]) => [k, t.split(/[:(]/)[0].trim()]));

async function run() {
  // line queue: works in a window and with piped answers (lines typed ahead are not lost)
  const tty = !!process.stdin.isTTY;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
  const queue = [], waiters = []; let closed = false;
  rl.on('line', l => { const w = waiters.shift(); if (w) w(l); else queue.push(l); });
  rl.on('close', () => { closed = true; while (waiters.length) waiters.shift()(null); });
  const ask = q => { process.stdout.write(q); return new Promise(r => { const done = a => { if (!tty) process.stdout.write((a ?? '') + '\n'); r((a || '').trim()); };
    if (queue.length) done(queue.shift()); else if (closed) done(null); else waiters.push(done); }); };
  const yes = async q => /^da$/i.test(await ask(c.warn(q + ' Scrie da si apasa Enter (altceva = nu): ')));
  const exec = (args, extraEnv = {}, stdin = true) => {
    console.log('\n' + c.warn('LUCREZ...') + ' Nu inchide fereastra. Cand termin scrie ' + c.ok('GATA') + ' sau ' + c.err('EROARE') + '.\n');
    if (tty) rl.pause();
    const r = spawnSync(process.execPath, [kit, ...args], { stdio: [tty && stdin ? 'inherit' : 'ignore', 'inherit', 'inherit'],
      env: { ...process.env, KIT_NO_PAUSE: '1', KIT_INTERACTIVE: '1', KIT_IN_MENU: '1', ...extraEnv } });
    if (tty) rl.resume();
    return r.status == null ? 1 : r.status;
  };
  const hist = (k, rc) => { try { const d = path.join(__dirname, '..', 'logs'); fs.mkdirSync(d, { recursive: true }); fs.appendFileSync(path.join(d, 'meniu-istoric.log'), `[${new Date().toLocaleString('ro-RO')}] optiunea ${k} (${NAME[k]}) -> cod ${rc}\n`); } catch {} };
  const outcome = (rc, k) => { hist(k, rc);
    if (rc === 0) { console.log('\n' + c.ok('GATA.') + ` (${NAME[k]})`); return; }
    if (rc === 2) { console.log('\n' + c.warn('OPRIT, ca sa nu faci o dubla.') + ' ' + HELP[2]); return; }
    console.log('\n' + c.err(`NU S-A TERMINAT (${NAME[k]}).`)); console.log(ceFaci(rc, c));
  };
  const pause = async () => { if (tty && !closed) await ask('\nApasa ' + c.bold('Enter') + ' pentru a reveni la meniu...'); };

  for (;;) {
    console.log('\n' + c.bold('=== Carrefour -> SmartBill ===') + '  De aici, de aproape - kit pentru producatorii artizani');
    ITEMS.forEach(([k, t]) => console.log(`${c.bold(k.padStart(2))}) ${t}`)); console.log(`${c.bold(' 0')}) Iesire`);
    const k = await ask('Scrie numarul optiunii si apasa Enter: '); if (k === '0' || (k === '' && closed)) break; if (k === '') continue;
    const it = ITEMS.find(x => x[0] === k); if (!it) { console.log(c.warn(`Nu exista optiunea "${k}". Scrie un numar din lista (0-15).`)); continue; }
    try {
      let a = null;
      if (k === '2' || k === '3') { a = (await ask('Numarul comenzii Carrefour (ex. 1780308), apoi Enter: ')).replace(/\D/g, ''); if (!a) { console.log(c.warn('Nu ai scris un numar; revin la meniu.')); continue; } }
      if (k === '11') { const x = await ask(`${c.bold('1')} = porneste (la fiecare ora)   ${c.bold('2')} = opreste   (Enter = inapoi): `); if (x === '1') a = 'porneste'; else if (x === '2') a = 'opreste'; else continue; }
      if (k === '15' && !(await yes('Opresc verificarea automata si iti arat cum stergi programul?'))) { console.log('Nu am schimbat nimic.'); continue; }
      let rc;
      if (k === '8') rc = await importOld(yes, exec);
      else if (k === '9') rc = await bulk(exec, yes);
      else rc = exec(it[2](a));
      // auto-recovery: expired Carrefour session -> guided login window, then the same option again
      if (rc === 3 && k !== '5') { console.log('\n' + c.warn('Portalul Carrefour cere din nou autentificarea.'));
        if (await yes('Deschid acum fereastra de autentificare (optiunea 5)?')) { const l = exec(['login-carrefour']); if (l === 0) { console.log(c.ok('Autentificat.') + ' Reiau optiunea ' + c.bold(k) + '...'); rc = k === '9' ? await bulk(exec, yes) : exec(it[2](a)); } else rc = l; } }
      // auto-recovery: browser / libraries missing -> repair, then the same option again
      if (rc === 9 && k !== '14') { console.log('\n' + c.warn('Lipseste o parte din instalare.'));
        if (await yes('O repar acum (optiunea 14)?')) { const l = exec(['repair']); if (l === 0) rc = k === '9' ? await bulk(exec, yes) : exec(it[2](a)); } }
      outcome(rc, k);
    } catch (e) { console.log(c.err('EROARE neasteptata in meniu: ') + String(e && e.message || e)); console.log(ceFaci(1, c)); }
    await pause();
  }
  rl.close();
  console.log('La revedere. Poti inchide fereastra.');
}

/** Option 9 without any terminal edge case: 1) list only (child with no keyboard), 2) "da" asked HERE, 3) create with the answer passed in. */
async function bulk(exec, yes) {
  const sum = path.join(os.tmpdir(), `kit-bulk-${process.pid}-${Date.now()}.json`);
  try {
    const rc = exec(['bulk-ciorne', '--check'], { KIT_BULK_SUMMARY: sum }, false); if (rc !== 0) return rc;
    let todo = 0; try { todo = JSON.parse(fs.readFileSync(sum, 'utf8')).todo; } catch {}
    if (!todo) { console.log(c.ok('Nimic de facut:') + ' toate comenzile au deja factura sau ciorna.'); return 0; }
    if (!(await yes(`\nCreez ${todo} ciorne in SmartBill (NU se emite nicio factura)?`))) { console.log(c.warn('Nu ai confirmat cu "da": nu am creat nimic.')); return 0; }
    return exec(['bulk-ciorne'], { KIT_BULK_CONFIRM: 'da' }, false);
  } finally { try { fs.unlinkSync(sum); } catch {} }
}
/** Option 8: nothing is imported unless the person confirms the exact source folder. */
async function importOld(yes, exec) {
  const r = spawnSync(process.execPath, [kit, 'import-config', '--list'], { encoding: 'utf8' }); let list = []; try { list = JSON.parse(r.stdout.trim().split('\n').pop()); } catch {}
  if (!list.length) { console.log('Nu am gasit un kit vechi configurat in Descarcari, Desktop, Documente sau langa acest folder. Alege 6 (Configurare).'); return 0; }
  if (!(await yes(`Preiau conturile si setarile din kitul vechi:\n  ${list[0]}\nE kitul TAU vechi?`))) { console.log('Nu am preluat nimic.'); return 0; }
  return exec(['import-config', list[0]], { KIT_IMPORT_CONFIRM: 'da' }, false);
}
module.exports = { run, ITEMS, bulk, importOld };
