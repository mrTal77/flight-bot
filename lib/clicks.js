// Click tracking through a Cloudflare Worker (cloudflare/worker.js; setup in CLICKS-SETUP.md).
// - trackLinks(): before a search message is sent, each link is changed to go through the Worker, which counts the
//   click and redirects to the original link at once.
// - pullClicks(): the bot (bot.js, every 5 minutes) reads the counts from the Worker into logs/clicks.csv.
// Logged: date, random user id, site (kayak / kiwi / google / airline / other) and message type. No links, no routes.
// Off (links stay as they are) until both CLICK_URL and CLICK_SECRET are set as repository secrets.
const crypto = require('crypto');
const path = require('path');
const { readCsv, appendCsv, DIR } = require('./logs');

const env = () => ({ url: (process.env.CLICK_URL || '').trim().replace(/\/+$/, ''), secret: (process.env.CLICK_SECRET || '').trim() });
const sign = (secret, text) => crypto.createHmac('sha256', secret).update(text).digest('hex').slice(0, 16);
function siteOf(url) {
  const h = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  return /kayak/.test(h) ? 'kayak' : /kiwi\.com$/.test(h) ? 'kiwi' : /google\./.test(h) ? 'google'
    : /wizzair|ryanair|volaris|aeromexico|easyjet|flypgs|airasia|bluebird|smartwings|vueling|transavia|jet2|flyscoot|goindigo|airarabia|flydubai|vietjet|nokair|lionair/.test(h) ? 'airline' : 'other';
}
// Rewrites every <a href="https://..."> in a Telegram HTML message. user: the random id; type: alert / summary / ...
function trackLinks(text, user, type, cfg = env()) {
  if (!cfg.url || !cfg.secret || !user) return text;
  const t = String(type || 'message').toLowerCase().replace(/[^a-z-]/g, '').slice(0, 20) || 'message';
  return text.replace(/href="(https:\/\/[^"]+)"/g, (all, raw) => {
    const to = raw.replace(/&amp;/g, '&');
    if (to.startsWith(cfg.url)) return all;
    const s = siteOf(to);
    const k = sign(cfg.secret, `${user}|${s}|${t}|${to}`);
    return `href="${cfg.url}/c?u=${encodeURIComponent(user)}&s=${s}&t=${t}&k=${k}&to=${encodeURIComponent(to)}"`;
  });
}

// logs/clicks.csv: one row per day, user, site and message type with the number of clicks so far.
const HEAD = ['date', 'user', 'site', 'type', 'clicks'];
async function pullClicks(dir = DIR, cfg = env()) {
  if (!cfg.url || !cfg.secret) return null;
  let counts;
  try {
    const res = await fetch(`${cfg.url}/stats`, { headers: { authorization: `Bearer ${cfg.secret}` }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    counts = await res.json();
  } catch (e) { console.log(`clicks not read: ${e.message.slice(0, 60)}`); return null; }
  return mergeClicks(counts, dir);
}
// Counts only grow, so the larger number wins; days that left the Worker (after 90 days) stay in the file.
function mergeClicks(counts, dir = DIR) {
  const file = path.join(dir, 'clicks.csv');
  const rows = new Map();
  const add = (key, n) => rows.set(key, Math.max(rows.get(key) || 0, Number(n) || 0));
  for (const r of readCsv('clicks.csv', dir)) add([r.date, r.user, r.site, r.type].join('|'), r.clicks);
  const before = JSON.stringify([...rows].sort());
  for (const [key, n] of Object.entries(counts || {})) {
    const parts = key.split('|');
    if (parts.length !== 4 || !/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) continue;
    add(key, n);
  }
  const sorted = [...rows].sort();
  if (JSON.stringify(sorted) === before) return 0;
  require('fs').rmSync(file, { force: true });
  appendCsv(file, HEAD, sorted.map(([k, n]) => [...k.split('|'), n]), 20000);
  return sorted.length;
}

module.exports = { trackLinks, pullClicks, mergeClicks, sign, siteOf };
