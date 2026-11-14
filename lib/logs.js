// Reads the public search logs (logs/searches.csv, logs/runs.csv; written by watch.js) and summarizes them.
// Used by the bot's owner-only /errors command and by `node tools/logs.js [hours]`.
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'logs');

const csvCell = (v) => (/[,"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
// Appends rows to a CSV log (keeps the newest `keep` rows). Parallel runs merge line by line (.gitattributes).
function appendCsv(file, header, rows, keep = 5000) {
  if (!rows.length) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
  if (!lines.length || lines[0] !== header.join(',')) lines = [header.join(','), ...lines.filter((l) => l !== header.join(','))];
  lines.push(...rows.map((r) => r.map(csvCell).join(',')));
  if (lines.length > keep + 1) lines = [lines[0], ...lines.slice(lines.length - keep)];
  fs.writeFileSync(file, lines.join('\n') + '\n');
}
// logs/messages.csv: one row per Telegram message the bot sent (or failed to send). No text, no chat ids:
// the user is the random id ("admin" for notices to the owner, "-" for someone not signed up).
const MSG_HEAD = ['time_utc', 'run', 'user', 'sender', 'type', 'status', 'chars'];
function logMessages(rows, dir = DIR) {
  const run = process.env.GITHUB_RUN_ID || 'local';
  appendCsv(path.join(dir, 'messages.csv'), MSG_HEAD, rows.map((m) => [m.at, run, m.user, m.sender, m.type, m.status, m.chars]));
}

function readCsv(name, dir = DIR) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) return [];
  const [head, ...rows] = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const cols = head.split(',');
  const parse = (line) => { // handles quoted cells
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur); return out;
  };
  return rows.filter((l) => l !== head).map((l) => Object.fromEntries(parse(l).map((v, i) => [cols[i], v])));
}

// Summary of the last `hours` hours: per source, searches that worked / failed / were blocked / skipped,
// and the most common errors.
function summarize(hours = 24, now = Date.now(), dir = DIR) {
  const since = new Date(now - hours * 36e5).toISOString();
  const runs = readCsv('runs.csv', dir).filter((r) => r.time_utc >= since);
  const fails = readCsv('searches.csv', dir).filter((r) => r.time_utc >= since);
  const lines = [`📋 <b>יומן חיפושים · ${hours} שעות אחרונות</b>`, `ריצות: ${runs.length} · משתמשים: ${new Set(runs.map((r) => r.user)).size}`];
  if (!runs.length) return lines.concat('אין עדיין ריצות ביומן.').join('\n');
  const sum = (k) => runs.reduce((a, r) => a + Number(r[k] || 0), 0);
  for (const src of ['kayak', 'kiwi', 'google']) {
    const [ok, failed, blocked, skipped] = ['ok', 'failed', 'blocked', 'skipped'].map((s) => sum(`${src}_${s}`));
    if (ok + failed + blocked + skipped) lines.push(`• ${src}: ✅ ${ok} · ❌ ${failed} נכשלו · 🚫 ${blocked} נחסמו · ⏭️ ${skipped} דולגו`);
  }
  const msgFailed = sum('messages_failed');
  if (msgFailed) lines.push(`✉️ ${msgFailed} הודעות טלגרם למשתמשים לא נשלחו`);
  const msgs = readCsv('messages.csv', dir).filter((m) => m.time_utc >= since && m.status === 'sent');
  if (msgs.length) {
    const by = (t) => msgs.filter((m) => m.type === t).length;
    lines.push(`✉️ הודעות שנשלחו: ${msgs.length} · סיכומים ${by('summary')} · התראות ${by('alert')} · תשובות בצ׳אט ${msgs.filter((m) => m.sender === 'bot' && m.user !== 'admin').length}`);
  }
  const retried = fails.filter((f) => f.status === 'ok-after-retry').length;
  if (retried) lines.push(`🔁 ${retried} חיפושים הצליחו רק בניסיון השני`);
  const crashes = runs.filter((r) => /^crash/.test(r.outcome));
  if (crashes.length) lines.push(`💥 ${crashes.length} ריצות קרסו: ${[...new Set(crashes.map((r) => r.outcome))].slice(0, 3).join(' | ')}`);
  const kinds = new Map();
  for (const f of fails.filter((x) => x.status !== 'ok-after-retry')) { const k = `${f.source} · ${f.error}`; kinds.set(k, (kinds.get(k) || 0) + 1); }
  if (kinds.size) {
    lines.push('', '<b>השגיאות הנפוצות:</b>');
    for (const [k, n] of [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 6)) lines.push(`${n}× ${k.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}`);
  }
  return lines.join('\n');
}

module.exports = { readCsv, summarize, appendCsv, logMessages, DIR };
