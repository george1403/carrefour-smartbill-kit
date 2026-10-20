'use strict';
// All kit writes go through here: parent folders (profiles/, out/, logs/, ~/.config/...) are created first,
// so a fresh ZIP extraction (no profiles/ or out/ folder) never fails with ENOENT.
const fs = require('fs'); const path = require('path');
const ensureDir = d => { fs.mkdirSync(d, { recursive: true }); return d; };
const wf = (f, data, opt) => { ensureDir(path.dirname(f)); fs.writeFileSync(f, data, opt); };
const af = (f, data, opt) => { ensureDir(path.dirname(f)); fs.appendFileSync(f, data, opt); };
const mv = (a, b) => { ensureDir(path.dirname(b)); fs.renameSync(a, b); };
module.exports = { wf, af, mv, ensureDir };
