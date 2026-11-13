// Telegram bot: registers users who arrive from the landing page, and answers /status, /stop, /help.
// Runs every few minutes in GitHub Actions (no server needed): reads new messages with getUpdates,
// stores users encrypted (lib/store.js), and starts a first search for a new user right away.
// Usage:
//   node bot.js                          process new Telegram messages
//   node bot.js --dry --updates file     test with saved updates; print replies instead of sending
// Public run logs show only counts, never names, chat ids or trip details.
const fs = require('fs');
const path = require('path');
const store = require('./lib/store');
const codec = require('./docs/codec.js');

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const updatesFile = argv.includes('--updates') ? argv[argv.indexOf('--updates') + 1] : null;
const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const OWNER_CHAT = (process.env.TELEGRAM_CHAT_ID || '').trim(); // the bot owner's chat (gets the extra searches)

const CITY = { TLV: 'תל אביב', MIA: 'מיאמי', JFK: 'ניו יורק', LHR: 'לונדון', CDG: 'פריז', BKK: 'בנגקוק', ATH: 'אתונה', BCN: 'ברצלונה' };
const AIRLINE = { LY: 'אל על', IZ: 'ארקיע', '6H': 'ישראייר' };
const d = (iso) => `${Number(iso.slice(8))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}`;

async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram ${method} failed (${res.status})`); // never log the token or URL
  return j.result;
}
async function reply(chatId, text) {
  if (DRY) { console.log(`--- reply to ${chatId} ---\n${text}\n---`); return; }
  await tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
}

function prefsText(p0) {
  const p = codec.withDefaults(p0);
  const stops = (n) => (n === 0 ? 'ישיר' : n === 1 ? 'עד עצירה אחת' : `עד ${n} עצירות`);
  const hours = (from, to) => (from === 0 && to === 24 ? '' : ` · המראה ${from}:00–${to}:00`);
  // A flexible date from the landing page arrives as a range around it: show it as "about X (±n days)".
  const when = (from, to) => {
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5);
    if (days === 0) return d(from);
    if (days % 2 === 0 && days <= 10) {
      const mid = new Date(Date.parse(from) + (days / 2) * 864e5).toISOString().slice(0, 10);
      return `בערך ${d(mid)} (±${days / 2} ${days / 2 === 1 ? 'יום' : 'ימים'})`;
    }
    return `${d(from)}–${d(to)}`;
  };
  const leg = (icon, name, from, to, airline, maxStops, maxHours, depFrom, depTo) =>
    `${icon} ${name}: ${when(from, to)} · ${airline ? AIRLINE[airline] || airline : 'כל חברה'} · ${stops(maxStops)}${maxHours ? ` · עד ${maxHours} ש׳` : ''}${hours(depFrom, depTo)}`;
  const pax = [`${p.adults} ${p.adults === 1 ? 'מבוגר' : 'מבוגרים'}`, p.children ? `${p.children} ${p.children === 1 ? 'ילד' : 'ילדים'}` : '', p.infants ? `${p.infants} ${p.infants === 1 ? 'תינוק' : 'תינוקות'}` : ''].filter(Boolean).join(', ');
  const cabin = { economy: 'תיירים', premium: 'פרימיום', business: 'עסקים', first: 'ראשונה' }[p.cabin];
  const bags = [p.carryOn ? 'תיק עלייה' : '', p.checkedBags ? (p.checkedBags === 1 ? 'מזוודה' : `${p.checkedBags} מזוודות`) : ''].filter(Boolean).join(' + ') || 'בלי כבודה';
  const lines = [
    `✈️ <b>${CITY[p.origin] || p.origin} ${p.oneWay ? '→' : '⇄'} ${CITY[p.destination] || p.destination}</b>`,
    `👥 ${pax} · מחלקת ${cabin}`,
    leg('🛫', 'הלוך', p.outFrom, p.outTo, p.airline, p.outMaxStops, p.outMaxHours, p.outDepFrom, p.outDepTo),
  ];
  if (!p.oneWay) {
    lines.push(leg('🛬', 'חזור', p.retFrom, p.retTo, p.retAirline, p.retMaxStops, p.retMaxHours, p.retDepFrom, p.retDepTo));
    if (p.maxTripDays) lines.push(`📅 אורך הטיול: עד ${p.maxTripDays} ימים`);
  }
  if (p.maxLayover) lines.push(`⏱️ עצירת ביניים: עד ${p.maxLayover} ש׳`);
  lines.push(`🧳 ${bags} לנוסע`);
  if (p.selfTransfer) lines.push('🔀 כולל כרטיסים נפרדים בהעברה עצמית (לא מוגן)');
  lines.push(`🔔 התראה מתחת ל-$${p.maxPrice.toLocaleString('en-US')}${p.adults + p.children + p.infants > 1 ? ' לנוסע' : ''}`);
  return lines.join('\n');
}

const HELP = [
  'הבוט מחפש עבורך טיסות כל כמה שעות, שולח התראה כשהמחיר יורד מתחת לסף שבחרת, וסיכום פעם ביום.',
  '',
  '/status · ההגדרות שלך והמחיר הכי טוב שנמצא',
  '/stop · הפסקת החיפוש ומחיקת הפרטים שלך',
  'כדי לשנות הגדרות: למלא שוב את הטופס בדף ההרשמה וללחוץ אישור.',
].join('\n');

// Start a first search for a user right away (instead of waiting for the next scheduled run).
async function dispatchSearch(userId) {
  const gh = (process.env.GITHUB_TOKEN || '').trim(); const repo = process.env.GITHUB_REPOSITORY;
  if (DRY || !gh || !repo) return false;
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/watch.yml/dispatches`, {
    method: 'POST',
    headers: { authorization: `Bearer ${gh}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
    body: JSON.stringify({ ref: process.env.GITHUB_REF_NAME || 'main', inputs: { mode: 'summary', user: userId } }),
  });
  return res.status === 204;
}

async function handle(db, msg, todayIso, toDispatch) {
  const chat = msg.chat || {};
  if (chat.type !== 'private') return; // only one-to-one chats
  const chatId = String(chat.id);
  const text = (msg.text || '').trim();
  const existing = Object.values(db.users).find((u) => u.chatId === chatId);

  if (text.startsWith('/start')) {
    const payload = text.split(/\s+/)[1];
    if (!payload) {
      await reply(chatId, existing ? `👋 אתה כבר רשום.\n\n${prefsText(existing.prefs)}\n\n${HELP}` : '👋 כדי להירשם צריך לפתוח את קישור ההרשמה שקיבלת, למלא את פרטי הטיסה וללחוץ "אישרתי".');
      return;
    }
    let p;
    try { p = codec.decode(payload); } catch { await reply(chatId, '⚠️ הקוד בקישור לא תקין. נסה למלא את הטופס שוב.'); return; }
    if (!CONFIG.invites.some((i) => i.sha256 === store.sha256(p.invite))) { await reply(chatId, '⚠️ קוד ההזמנה לא תקף. בקש קישור הרשמה חדש.'); return; }
    const errs = codec.validate(p, todayIso);
    if (errs.length) { await reply(chatId, `⚠️ יש בעיה בפרטים:\n• ${errs.join('\n• ')}\n\nמלא את הטופס שוב.`); return; }
    if (!existing && Object.keys(db.users).length >= CONFIG.maxUsers) { await reply(chatId, '😕 הבוט מלא כרגע. נסה שוב בהמשך.'); return; }
    const { invite, ...prefs } = p;
    const user = existing || { id: store.newUserId(), chatId, createdAt: new Date().toISOString() };
    user.name = (chat.first_name || '').slice(0, 40);
    user.prefs = prefs;
    user.owner = !!OWNER_CHAT && chatId === OWNER_CHAT;
    user.updatedAt = new Date().toISOString();
    db.users[user.id] = user;
    if (existing) store.deleteState(user.id); // new preferences: start fresh
    toDispatch.push(user.id);
    await reply(chatId, `✅ <b>${existing ? 'ההגדרות עודכנו' : 'נרשמת בהצלחה'}!</b>\n\n${prefsText(prefs)}\n\nהחיפוש הראשון מתחיל עכשיו, והתוצאות יגיעו לכאן בעוד כ-10 דקות. אחר כך אבדוק כל כמה שעות ואשלח סיכום פעם ביום.\n\n${HELP}`);
    return;
  }
  if (text === '/stop') {
    if (!existing) { await reply(chatId, 'אינך רשום כרגע.'); return; }
    delete db.users[existing.id];
    store.deleteState(existing.id);
    await reply(chatId, '🛑 החיפוש הופסק והפרטים שלך נמחקו. אפשר להירשם שוב בכל זמן דרך קישור ההרשמה.');
    return;
  }
  if (text === '/status') {
    if (!existing) { await reply(chatId, 'אינך רשום כרגע. כדי להירשם פתח את קישור ההרשמה שקיבלת.'); return; }
    let st = {}; try { st = store.loadState(existing.id); } catch {}
    const best = st.lastRun && st.lastRun.bestUsd ? `\n\n💰 הזול ביותר בבדיקה האחרונה: $${st.lastRun.bestUsd.toLocaleString('en-US')}` : '\n\n⏳ עוד לא הסתיימה בדיקה.';
    await reply(chatId, `${prefsText(existing.prefs)}${best}`);
    return;
  }
  await reply(chatId, existing ? HELP : '👋 כדי להירשם צריך לפתוח את קישור ההרשמה שקיבלת.');
}

async function main() {
  if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  const db = store.loadUsers();
  const updates = updatesFile ? JSON.parse(fs.readFileSync(updatesFile, 'utf8'))
    : await tg('getUpdates', { offset: (db.botOffset || 0) + 1, timeout: 0, allowed_updates: ['message'] });
  if (!updates.length) { console.log('no new messages'); return; }
  const today = new Date().toISOString().slice(0, 10);
  const toDispatch = [];
  for (const u of updates) {
    db.botOffset = Math.max(db.botOffset || 0, u.update_id);
    if (!u.message) continue;
    try { await handle(db, u.message, today, toDispatch); } catch (e) { console.log('message failed:', e.message.slice(0, 80)); }
  }
  store.saveUsers(db);
  let started = 0;
  for (const id of [...new Set(toDispatch)]) if (await dispatchSearch(id)) started++;
  console.log(`processed ${updates.length} messages; users: ${Object.keys(db.users).length}; first searches started: ${started}`);
}

if (require.main === module) main().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
module.exports = { prefsText };
