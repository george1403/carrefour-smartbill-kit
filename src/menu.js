'use strict';
// Meniu simplu pentru dublu-click (run.bat / run.command / run.sh fara argumente). Se repeta pana alegi 0.
const readline = require('readline');
const { spawnSync } = require('child_process');
const path = require('path');
const kit = path.join(__dirname, '..', 'bin', 'kit.js');
const ITEMS = [
  ['1', 'Vezi comenzile Carrefour (care sunt noi / deja facturate)', () => ['orders']],
  ['2', 'Fa CIORNA pentru o comanda (se salveaza in SmartBill ca ciorna; NU se emite factura)', a => ['ciorna', a]],
  ['3', 'Previzualizare comanda (doar completeaza formularul si face o poza; nu salveaza nimic)', a => ['preview', a]],
  ['4', 'Verificare automata acum: comenzile noi -> ciorne (sau facturi, daca ai ales "automat")', () => ['auto']],
  ['5', 'Autentificare Carrefour (CAPTCHA) - cand programul iti cere', () => ['login-carrefour']],
  ['6', 'Configurare (conturi, serie, mod de lucru)', () => ['setup']],
  ['7', 'Verificare instalare', () => ['selftest']],
  ['8', 'Actualizare: preia conturile si setarile din kitul vechi', () => ['import-config']],
];
async function run() {
  // line queue: works on a terminal and with piped answers (lines typed ahead are not lost)
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
  const queue = [], waiters = []; let closed = false;
  rl.on('line', l => { const w = waiters.shift(); if (w) w(l); else queue.push(l); });
  rl.on('close', () => { closed = true; while (waiters.length) waiters.shift()(null); });
  const ask = q => { process.stdout.write(q); return new Promise(r => { const done = a => { if (!process.stdin.isTTY) process.stdout.write((a ?? '') + '\n'); r((a || '').trim()); };
    if (queue.length) done(queue.shift()); else if (closed) done(null); else waiters.push(done); }); };
  for (;;) {
    console.log('\n=== Carrefour -> SmartBill ===');
    ITEMS.forEach(([k, t]) => console.log(`${k}) ${t}`)); console.log('0) Iesire');
    const c = await ask('Alege: '); if (c === '0' || (c === '' && closed)) break; if (c === '') continue;
    const it = ITEMS.find(x => x[0] === c); if (!it) { console.log('Optiune necunoscuta.'); continue; }
    let nr = null; if (c === '2' || c === '3') { nr = (await ask('Numarul comenzii Carrefour (ex. 1780308): ')).replace(/\D/g, ''); if (!nr) continue; }
    if (process.stdin.isTTY) rl.pause();
    const r = spawnSync(process.execPath, [kit, ...it[2](nr)], { stdio: [process.stdin.isTTY ? 'inherit' : 'ignore', 'inherit', 'inherit'], env: { ...process.env, KIT_NO_PAUSE: '1', KIT_INTERACTIVE: '1' } });
    if (r.status === 0) console.log('\n-> Gata.');
    else if (r.status === 3) console.log('\n-> Pasul urmator: alege 5 (Autentificare Carrefour), apoi repeta optiunea ' + c + '.');
    else if (r.status != null) console.log(`\n-> Nu s-a terminat (cod ${r.status}). Citeste mesajul CE FACI de mai sus.`);
    if (process.stdin.isTTY) rl.resume();
  }
  rl.close();
}
module.exports = { run, ITEMS };
