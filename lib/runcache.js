// Shared cache and budgets for one GitHub Actions job.
// A job searches a batch of users one after the other (lib/list-users.js groups users with the same route into a
// batch). Their searches go to the same Kiwi and Google queries often, so a search result is kept in a folder on
// the runner (RUN_CACHE_DIR, outside the repository, gone when the job ends) and the next user reuses it.
// The same folder holds the job's Google counter: every search in a job comes from the same IP address, and
// Google shows its "unusual traffic" page after about 50 searches from one address.
// Nothing here is committed: the files hold routes and prices, and the repository is public.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const dir = () => process.env.RUN_CACHE_DIR || path.join(os.tmpdir(), 'flight-bot-run-cache');
const file = (name) => { fs.mkdirSync(dir(), { recursive: true }); return path.join(dir(), name); };
const keyOf = (ns, req) => `${ns}-${crypto.createHash('sha256').update(JSON.stringify(req)).digest('hex').slice(0, 32)}.json`;

// The cached value of a request, or undefined. ttlMin: how old a value may be (default 90 minutes).
function get(ns, req, ttlMin = 90) {
  try {
    const j = JSON.parse(fs.readFileSync(file(keyOf(ns, req)), 'utf8'));
    return Date.now() - j.at <= ttlMin * 60000 ? j.value : undefined;
  } catch { return undefined; }
}
function put(ns, req, value) {
  try { fs.writeFileSync(file(keyOf(ns, req)), JSON.stringify({ at: Date.now(), value })); } catch {}
}
// Runs fn once per request in this job; later calls with the same request get the saved result.
// Returns { value, hit }.
async function cached(ns, req, fn, ttlMin) {
  const v = get(ns, req, ttlMin);
  if (v !== undefined) return { value: v, hit: true };
  const value = await fn();
  put(ns, req, value);
  return { value, hit: false };
}

// A counter shared by the users of this job (for example the Google searches made from this runner's address).
function count(name) { try { return Number(fs.readFileSync(file(`count-${name}`), 'utf8')) || 0; } catch { return 0; } }
function add(name, n = 1) { const v = count(name) + n; try { fs.writeFileSync(file(`count-${name}`), String(v)); } catch {} return v; }
// A flag shared by the users of this job (for example "Google blocked this runner").
function flag(name, value) {
  if (value === undefined) { try { return fs.readFileSync(file(`flag-${name}`), 'utf8'); } catch { return ''; } }
  try { fs.writeFileSync(file(`flag-${name}`), String(value)); } catch {}
  return value;
}

module.exports = { get, put, cached, count, add, flag, dir };
