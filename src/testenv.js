'use strict';
// Test-only environment hooks (mock servers, fake setup data, shortened timeouts, stop points...). They are honoured ONLY
// when KIT_TEST_MODE=1 (set by the test scripts / demo). A real producer's computer can carry stale copies of them
// (e.g. an Explorer window that inherited a recording session's variables), so everywhere else they are removed.
const TEST_VARS = ['KIT_SETUP_MOCK', 'KIT_CARREFOUR_DOCS_URL', 'KIT_DEMO_MOCK_MODE', 'KIT_STOP_BEFORE_FINAL', 'KIT_BULK_CONFIRM', 'KIT_IMPORT_CONFIRM',
  'KIT_RATE_MS', 'KIT_RETRY_MS', 'KIT_SUBMIT_WAIT', 'KIT_NAV_TIMEOUT', 'KIT_MANUAL_TIMEOUT_MS', 'KIT_SLOW', 'KIT_SUPPORT_NO_SELFTEST',
  'KIT_TEST_CLOSE_MS', 'KIT_TEST_HEADLESS', 'KIT_TEST_DESKTOPS', 'KIT_TEST_DIALOG', 'KIT_TEST_SAC'];
const isTest = (env = process.env) => env.KIT_TEST_MODE === '1';
/** Removes the test hooks from env (default: this process, so every child started from it is clean too). Returns the names removed. */
function strip(env = process.env) { if (isTest(env)) return []; const gone = TEST_VARS.filter(k => k in env); for (const k of gone) delete env[k]; return gone; }
/** Value of a test hook, or undefined outside test mode. */
const hook = (name, env = process.env) => (isTest(env) ? env[name] : undefined);
module.exports = { TEST_VARS, isTest, strip, hook };
