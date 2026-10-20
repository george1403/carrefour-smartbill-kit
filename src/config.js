'use strict';
// Loads a producer profile (profiles/<name>.json) + its secrets (.env). No producer data is hardcoded:
// the profile is written by `node bin/kit.js setup` from what it discovers in SmartBill and the Carrefour portal.
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const expand = p => (p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);
const SECRET_VARS = {
  email: 'SMARTBILL_EMAIL', password: 'SMARTBILL_PASSWORD',
  carrefourUser: 'CARREFOUR_PORTAL_USERNAME', carrefourPassword: 'CARREFOUR_PORTAL_PASSWORD',
};

function readDefaultProfile() {
  const f = path.join(ROOT, 'profiles', '.default');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : null;
}

function readSecrets(envFile, overrides = {}) {
  require('dotenv').config({ path: envFile, quiet: true, override: true });
  const vars = { ...SECRET_VARS, ...overrides };
  const secrets = {}; const missing = [];
  for (const [k, v] of Object.entries(vars)) { secrets[k] = process.env[v] || null; if (!secrets[k]) missing.push(v); }
  return { secrets, missing };
}

/** A bare profile used by the setup wizard before anything is discovered. */
function bareProfile(name, envFile = path.join(ROOT, '.env')) {
  const { secrets, missing } = readSecrets(envFile);
  return { name, cfg: {}, secrets, missing, envFile, root: ROOT,
    dirs: { state: expand(`~/.config/carrefour-smartbill-kit/${name}`), out: path.join(ROOT, 'out', name) } };
}

function loadProfile(name) {
  const profileName = name || process.env.KIT_PROFILE || readDefaultProfile();
  if (!profileName) throw Object.assign(new Error('Niciun profil. Deschide programul (scurtatura Carrefour SmartBill de pe Desktop) si alege 6 (Configurare).'), { code: 'CONFIG' });
  const file = path.join(ROOT, 'profiles', `${profileName}.json`);
  if (!fs.existsSync(file)) throw Object.assign(new Error(`Profilul ${profileName} nu exista (${file}). Deschide programul (scurtatura Carrefour SmartBill de pe Desktop) si alege 6 (Configurare).`), { code: 'CONFIG' });
  let cfg; try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    if (e.code && /^E[A-Z]+$/.test(e.code)) throw e;
    throw Object.assign(new Error(`Fisierul de configurare profiles/${profileName}.json este deteriorat (nu se poate citi). Alege optiunea 6 (Configurare) ca sa-l refaci; datele vechi raman in out/.`), { code: 'CONFIG' }); }
  // relative envFile is relative to the kit folder (Task Scheduler / launchd start in another folder)
  const envFile = cfg.envFile ? path.resolve(ROOT, expand(cfg.envFile)) : path.join(ROOT, '.env');
  if (cfg.orderSource?.type === 'carrefour-portal' && !cfg.smartbill?.series) throw Object.assign(new Error('Profilul nu are seria de factura aleasa. Alege optiunea 6 (Configurare).'), { code: 'CONFIG' });
  const { secrets, missing } = readSecrets(envFile, cfg.secretVars || {});
  const dirs = {
    state: expand(cfg.stateDir || `~/.config/carrefour-smartbill-kit/${profileName}`),
    out: path.join(ROOT, 'out', profileName),
  };
  // only SmartBill secrets are mandatory everywhere; Carrefour ones only when orders come from the portal
  const need = ['email', 'password'].concat(cfg.orderSource?.type === 'carrefour-portal' ? ['carrefourUser', 'carrefourPassword'] : []);
  const vars = { ...SECRET_VARS, ...(cfg.secretVars || {}) };
  return { name: profileName, cfg, secrets, missing: missing.filter(v => need.some(k => vars[k] === v)), envFile, dirs, root: ROOT };
}

module.exports = { loadProfile, bareProfile, readSecrets, SECRET_VARS, ROOT, expand };
