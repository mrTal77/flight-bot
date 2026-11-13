// Telegram bot: registers users who arrive from the landing page, lets them change their settings in the
// chat or in the form, and answers /status, /stop, /help (and /users for the owner).
// Runs every few minutes in GitHub Actions (no server needed): reads new messages with getUpdates,
// stores users encrypted (lib/store.js), and starts a search right away after a sign-up or a change.
// One user per Telegram chat: a new sign-up or edit from the same chat replaces that user's settings.
// Usage:
//   node bot.js                          process new Telegram messages
//   node bot.js --owner-start CODE       owner only: sign the owner up with a form code (no Telegram message needed)
//   node bot.js --start-searches         after the users file is pushed: start searches for new or changed users
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
const OWNER_CHAT = (process.env.TELEGRAM_CHAT_ID || '').trim(); // the bot owner (admin)
const PENDING = path.join(process.env.RUNNER_TEMP || require('os').tmpdir(), 'flight-bot-pending.json'); // outside the repo

const AIRPORTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'docs', 'airports.json'), 'utf8'));
codec.setPlaces(AIRPORTS);
const d = (iso) => `${Number(iso.slice(8))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}`;
const esc = (t) => String(t || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

// ---------- texts (Hebrew / English) ----------
const TX = {
  he: {
    help: [
      'הבוט מחפש עבורך טיסות כל כמה שעות, שולח התראה כשהמחיר יורד מתחת לסף שבחרת, וסיכום פעם ביום.',
      '',
      '<b>שינוי הגדרות בצ׳אט:</b>',
      '/price 900 · סף מחיר חדש (בדולרים, לנוסע)',
      '/dest אתונה · יעד חדש (שם או קוד)',
      '/out 21.12 3 · תאריך הלוך, אפשר עם גמישות בימים (או טווח: 20.12-30.12)',
      '/back 10.1 3 · תאריך חזור, באותה צורה',
      '/edit · קישור לטופס עם כל ההגדרות שלך, לשינוי של כל השאר',
      '',
      '/status · ההגדרות שלך והמחיר הכי טוב שנמצא',
      '/lang en · English',
      '/stop · הפסקת החיפוש ומחיקת הפרטים שלך',
    ].join('\n'),
    ownerHelp: '/users · רשימת המשתמשים (רק לך)\n/errors · יומן החיפושים שנכשלו (רק לך; /errors 72 ל-72 שעות)',
    notRegistered: '👋 כדי להירשם צריך לפתוח את קישור ההרשמה שקיבלת, למלא את פרטי הטיסה וללחוץ "אישרתי".',
    alreadyIn: '👋 אתה כבר רשום.',
    badCode: '⚠️ הקוד בקישור לא תקין. נסה למלא את הטופס שוב.',
    badInvite: '⚠️ קוד ההזמנה לא תקף. בקש קישור הרשמה חדש.',
    problems: '⚠️ יש בעיה בפרטים:', fillAgain: 'מלא את הטופס שוב.', full: '😕 הבוט מלא כרגע. נסה שוב בהמשך.',
    registered: '✅ <b>נרשמת בהצלחה!</b>', updated: '✅ <b>ההגדרות עודכנו!</b> (ההגדרות הקודמות הוחלפו)',
    firstSearch: 'החיפוש מתחיל עכשיו, והתוצאות יגיעו לכאן בעוד כ-10 דקות. אחר כך אבדוק כל כמה שעות ואשלח סיכום פעם ביום.',
    stopped: '🛑 החיפוש הופסק והפרטים שלך נמחקו. אפשר להירשם שוב בכל זמן דרך קישור ההרשמה.',
    best: '💰 הזול ביותר בבדיקה האחרונה: ${a}', noRunYet: '⏳ עוד לא הסתיימה בדיקה.',
    editLink: '✏️ <b>עדכון הגדרות</b>\nהקישור פותח את הטופס עם כל ההגדרות הנוכחיות שלך. משנים מה שרוצים, לוחצים "שמירת השינויים", וההגדרות החדשות מחליפות את הקודמות.\n\n<a href="{a}">פתיחת הטופס שלי</a>',
    priceUsage: 'כך משנים מחיר: <code>/price 900</code> (בדולרים, לנוסע)',
    destUsage: 'כך משנים יעד: <code>/dest אתונה</code> או <code>/dest ATH</code>',
    dateUsage: 'כך משנים תאריך: <code>/{a} 21.12 3</code> (בערך 21.12, ±3 ימים), <code>/{a} 21.12</code> (בדיוק), או טווח <code>/{a} 20.12-30.12</code>',
    noReturn: 'החיפוש שלך הוא בכיוון אחד. כדי להוסיף חזור, פתח את הטופס עם /edit.',
    notFound: 'לא מצאתי יעד בשם "{a}". נסה שם אחר באנגלית או קוד בן 3 אותיות.',
    choose: 'מצאתי כמה אפשרויות. שלח את הפקודה של היעד שרצית:\n{a}',
    langSet: '✅ השפה עודכנה לעברית.',
    unknown: 'לא הבנתי. הנה מה שאפשר לעשות:',
  },
  en: {
    help: [
      'The bot searches flights for you every few hours, alerts you when the price drops below your limit, and sends a daily summary.',
      '',
      '<b>Change settings in the chat:</b>',
      '/price 900 · new price limit (USD, per passenger)',
      '/dest Athens · new destination (name or code)',
      '/out 21.12 3 · outbound date, optionally ± days (or a range: 20.12-30.12)',
      '/back 10.1 3 · return date, the same way',
      '/edit · link to the form with all your settings, to change anything else',
      '',
      '/status · your settings and the best price found',
      '/lang he · עברית',
      '/stop · stop searching and delete your details',
    ].join('\n'),
    ownerHelp: '/users · list of users (only you)\n/errors · log of failed searches (only you; /errors 72 for 72 hours)',
    notRegistered: '👋 To sign up, open the sign-up link you received, fill in your flight and tap "Confirm".',
    alreadyIn: '👋 You are already signed up.',
    badCode: '⚠️ The code in the link is not valid. Please fill in the form again.',
    badInvite: '⚠️ The invite code is not valid. Ask for a new sign-up link.',
    problems: '⚠️ There is a problem with the details:', fillAgain: 'Please fill in the form again.', full: '😕 The bot is full right now. Please try again later.',
    registered: '✅ <b>You are signed up!</b>', updated: '✅ <b>Settings updated!</b> (the previous settings were replaced)',
    firstSearch: 'The search starts now; results arrive here in about 10 minutes. After that I check every few hours and send a daily summary.',
    stopped: '🛑 Search stopped and your details were deleted. You can sign up again any time with the sign-up link.',
    best: '💰 Best price in the last check: ${a}', noRunYet: '⏳ No check has finished yet.',
    editLink: '✏️ <b>Update settings</b>\nThe link opens the form with all your current settings. Change what you want, tap "Save changes", and the new settings replace the old ones.\n\n<a href="{a}">Open my form</a>',
    priceUsage: 'To change the price: <code>/price 900</code> (USD, per passenger)',
    destUsage: 'To change the destination: <code>/dest Athens</code> or <code>/dest ATH</code>',
    dateUsage: 'To change a date: <code>/{a} 21.12 3</code> (around 21.12, ±3 days), <code>/{a} 21.12</code> (exact), or a range <code>/{a} 20.12-30.12</code>',
    noReturn: 'Your search is one way. To add a return, open the form with /edit.',
    notFound: 'I could not find a destination called "{a}". Try another name or a 3-letter code.',
    choose: 'I found several options. Send the command of the one you want:\n{a}',
    langSet: '✅ Language set to English.',
    unknown: 'I did not understand. Here is what you can do:',
  },
};
const tx = (lang, key, a) => (TX[lang === 'en' ? 'en' : 'he'][key] || '').split('{a}').join(a == null ? '' : a);
const prefsText = (p) => codec.describe(p, p.lang || 'he').join('\n');
const routeOf = (p) => `${codec.placeName(p.origin)} ${p.oneWay ? '→' : '⇄'} ${codec.placeName(p.destination)}`;
function userLine(u) { // one short line about a user's search, for the owner (Hebrew)
  const p = codec.withDefaults(u.prefs);
  const pax = p.adults + p.children + p.infants;
  const dates = p.oneWay ? d(p.outFrom) : `${d(p.outFrom)} → ${d(p.retFrom)}`;
  return `✈️ ${routeOf(p)} · ${dates}${pax > 1 ? ` · ${pax} נוסעים` : ''} · סף $${p.maxPrice.toLocaleString('en-US')}`;
}

// ---------- Telegram ----------
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
async function notifyOwner(text) { if (OWNER_CHAT) { try { await reply(OWNER_CHAT, text); } catch (e) { console.log('owner notice failed'); } } }

// Start a search for a user right away (instead of waiting for the next scheduled run).
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

// ---------- parsing chat edits ----------
// "21.12", "21.12.2026", "21/12", "2026-12-21" -> ISO date (the next such date on or after `fromIso` when no year).
function parseDate(s, fromIso) {
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let y; let mo; let da;
  if (m) { y = +m[1]; mo = +m[2]; da = +m[3]; } else {
    m = s.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?$/);
    if (!m) return null;
    da = +m[1]; mo = +m[2]; y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null;
  }
  const mk = (yy) => `${yy}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
  const real = (iso) => { const t = new Date(iso + 'T00:00:00Z'); return !isNaN(t) && t.toISOString().slice(0, 10) === iso; };
  if (y) return real(mk(y)) ? mk(y) : null;
  const ty = Number(fromIso.slice(0, 4));
  const iso = mk(ty) >= fromIso ? mk(ty) : mk(ty + 1);
  return real(iso) ? iso : null;
}
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
// "21.12" (exact), "21.12 3" / "21.12 ±3" (around, ± days), "20.12-30.12" (range) -> [from, to]
function parseDates(arg, todayIso) {
  const range = arg.split(/\s*[-–]\s*(?=\d{1,2}[./])/);
  if (range.length === 2) {
    const f = parseDate(range[0].trim(), todayIso); const t = f && parseDate(range[1].trim(), f);
    return f && t ? [f, t] : null;
  }
  const parts = arg.trim().split(/\s+/);
  if (parts.length > 2) return null;
  const day = parseDate(parts[0] || '', todayIso); if (!day) return null;
  const flex = parts[1] ? Number(parts[1].replace(/^[±+]/, '')) : 0;
  if (!(Number.isInteger(flex) && flex >= 0 && flex <= 30)) return null;
  let from = addDays(day, -flex); if (from < todayIso) from = todayIso;
  return [from, addDays(day, flex)];
}
const norm = (t) => (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[׳'"`.,()-]/g, ' ').replace(/\s+/g, ' ').trim();
// Destination by code or by city name (Hebrew or English). One result = a clear match; several = let the user pick.
function findPlaces(q) {
  const up = q.trim().toUpperCase(); const nq = norm(q);
  if (!nq) return [];
  const exact = AIRPORTS.find((r) => r[0] === up);
  if (exact) return [exact];
  const hits = AIRPORTS.map((r) => {
    const he = norm(r[5]); const city = norm(r[1]);
    const s = he === nq || city === nq ? 0 : he.startsWith(nq) || city.startsWith(nq) ? 1 : he.includes(nq) || city.includes(nq) || norm(r[2]).includes(nq) ? 2 : -1;
    return { s, r };
  }).filter((x) => x.s >= 0).sort((a, b) => a.s - b.s || a.r[4] - b.r[4]);
  const exacts = hits.filter((x) => x.s === 0);
  if (exacts.length === 1) return [exacts[0].r];
  return (exacts.length ? exacts : hits).slice(0, 6).map((x) => x.r);
}

// Commands may be in English or Hebrew, with or without "/".
const ALIASES = {
  start: ['start'], stop: ['stop', 'עצור', 'הפסק'], status: ['status', 'סטטוס', 'מצב'], edit: ['edit', 'עריכה', 'עדכון', 'טופס'],
  price: ['price', 'מחיר', 'סף'], dest: ['dest', 'destination', 'יעד'], out: ['out', 'הלוך'], back: ['back', 'return', 'חזור'],
  lang: ['lang', 'language', 'שפה'], help: ['help', 'עזרה'], users: ['users', 'משתמשים'], errors: ['errors', 'שגיאות'],
};
function parseCommand(text) {
  const m = text.match(/^\/?([^\s@]+)(?:@\S+)?\s*([\s\S]*)$/);
  if (!m) return null;
  const word = m[1].toLowerCase();
  for (const [cmd, names] of Object.entries(ALIASES)) if (names.includes(word)) return { cmd, arg: m[2].trim() };
  return null;
}

// ---------- applying a change from the chat ----------
// The new settings replace the user's settings; the search restarts (fresh state if the route or dates changed).
async function saveChange(db, user, newPrefs, todayIso, toDispatch, resetSearch) {
  const lang = newPrefs.lang || 'he';
  const errs = codec.validate({ ...newPrefs, invite: user.invite || 'xxxxxx' }, todayIso, lang);
  if (errs.length) { await reply(user.chatId, `${tx(lang, 'problems')}\n• ${errs.map(esc).join('\n• ')}`); return; }
  user.prefs = newPrefs; user.updatedAt = new Date().toISOString();
  db.users[user.id] = user;
  if (resetSearch) store.deleteState(user.id);
  else { const st = store.loadState(user.id); delete st.lastAlert; store.saveState(user.id, st); } // new price: may alert again
  toDispatch.push(user.id);
  await reply(user.chatId, `${tx(lang, 'updated')}\n\n${prefsText(newPrefs)}\n\n${tx(lang, 'firstSearch')}`);
  if (!user.owner) await notifyOwner(`✏️ <b>משתמש עדכן הגדרות</b>: ${esc(user.name) || 'ללא שם'}\n${userLine(user)}`);
}

async function handle(db, msg, todayIso, toDispatch) {
  const chat = msg.chat || {};
  if (chat.type !== 'private') return; // only one-to-one chats
  const chatId = String(chat.id);
  const text = (msg.text || '').trim();
  const existing = Object.values(db.users).find((u) => u.chatId === chatId); // one user per chat
  const tgLang = msg.from && msg.from.language_code;
  const lang = existing ? (existing.prefs.lang || 'he') : (!tgLang || /^(he|iw)/.test(tgLang) ? 'he' : 'en');
  const help = (u, L) => tx(L, 'help') + (u && u.owner ? '\n' + tx(L, 'ownerHelp') : '');

  // The sign-up code arrives as "/start CODE" (Start button) or pasted as "/start CODE" / "CODE" by hand.
  const pasted = /^[A-Za-z0-9_-]{20,64}$/.test(text) ? text : null;
  const c = pasted ? { cmd: 'start', arg: pasted } : parseCommand(text);

  if (c && c.cmd === 'start') {
    if (!c.arg) { await reply(chatId, existing ? `${tx(lang, 'alreadyIn')}\n\n${prefsText(existing.prefs)}\n\n${help(existing, lang)}` : tx(lang, 'notRegistered')); return; }
    let p;
    try { p = codec.decode(c.arg); } catch { await reply(chatId, tx(lang, 'badCode')); return; }
    const L = p.lang || lang;
    // A new user needs a valid invite. A user already signed up in this chat may always update their settings.
    const isOwner = !!OWNER_CHAT && chatId === OWNER_CHAT; // the owner needs no invite
    if (!existing && !isOwner && !CONFIG.invites.some((i) => i.sha256 === store.sha256(p.invite))) { await reply(chatId, tx(L, 'badInvite')); return; }
    const errs = codec.validate(p, todayIso, L);
    if (errs.length) { await reply(chatId, `${tx(L, 'problems')}\n• ${errs.map(esc).join('\n• ')}\n\n${tx(L, 'fillAgain')}`); return; }
    if (!existing && Object.keys(db.users).length >= CONFIG.maxUsers) { await reply(chatId, tx(L, 'full')); return; }
    const { invite, ...prefs } = p;
    const user = existing || { id: store.newUserId(), chatId, createdAt: new Date().toISOString() };
    user.name = (chat.first_name || '').slice(0, 40);
    if (CONFIG.invites.some((i) => i.sha256 === store.sha256(invite))) user.invite = invite; // kept (encrypted) for the /edit link
    user.prefs = prefs; // replaces any earlier settings of this chat
    user.owner = !!OWNER_CHAT && chatId === OWNER_CHAT;
    user.updatedAt = new Date().toISOString();
    db.users[user.id] = user;
    if (existing) store.deleteState(user.id); // new settings: start fresh
    toDispatch.push(user.id);
    if (!user.owner) await notifyOwner(`👤 <b>${existing ? 'משתמש עדכן הגדרות' : 'משתמש חדש נרשם'}</b>: ${esc(user.name) || 'ללא שם'}\n${userLine(user)}\nסה״כ משתמשים: ${Object.keys(db.users).length}`);
    await reply(chatId, `${existing ? tx(L, 'updated') : tx(L, 'registered')}\n\n${prefsText(prefs)}\n\n${tx(L, 'firstSearch')}\n\n${help(user, L)}`);
    return;
  }

  if (c && c.cmd === 'errors' && OWNER_CHAT && chatId === OWNER_CHAT) { // owner only: the search log
    const hours = Math.min(24 * 14, Number(c.arg) || 24);
    const repo = process.env.GITHUB_REPOSITORY || 'mrTal77/flight-bot';
    await reply(chatId, `${require('./lib/logs').summarize(hours)}\n\nהטבלאות המלאות: <a href="https://github.com/${repo}/blob/main/logs/searches.csv">חיפושים שנכשלו</a> · <a href="https://github.com/${repo}/blob/main/logs/runs.csv">ריצות</a>`);
    return;
  }

  if (c && c.cmd === 'users' && OWNER_CHAT && chatId === OWNER_CHAT) {
    const list = Object.values(db.users).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    if (!list.length) { await reply(chatId, 'אין משתמשים רשומים כרגע.'); return; }
    const rows = list.map((u, i) => {
      const st = store.loadState(u.id);
      const best = st.lastRun && st.lastRun.bestUsd ? `$${st.lastRun.bestUsd.toLocaleString('en-US')}` : 'עוד אין';
      const last = st.lastRun ? d(st.lastRun.at.slice(0, 10)) : '—';
      return `${i + 1}. <b>${esc(u.name) || 'ללא שם'}</b>${u.owner ? ' (אתה)' : ''} · נרשם ${d(u.createdAt.slice(0, 10))}\n${userLine(u)}\n💰 הזול ביותר: ${best} · בדיקה אחרונה: ${last}`;
    });
    await reply(chatId, `👥 <b>${list.length} משתמשים</b> (מקסימום ${CONFIG.maxUsers})\n\n${rows.join('\n\n')}`);
    return;
  }

  if (!existing) { await reply(chatId, tx(lang, 'notRegistered')); return; }
  const u = existing;
  const p = codec.withDefaults(u.prefs);

  switch (c && c.cmd) {
    case 'stop': {
      delete db.users[u.id];
      store.deleteState(u.id);
      await reply(chatId, tx(lang, 'stopped'));
      if (!u.owner) await notifyOwner(`👋 משתמש הפסיק: ${esc(u.name) || 'ללא שם'} (${routeOf(u.prefs)}). נשארו ${Object.keys(db.users).length} משתמשים.`);
      return;
    }
    case 'status': {
      const st = store.loadState(u.id);
      const best = st.lastRun && st.lastRun.bestUsd ? tx(lang, 'best', st.lastRun.bestUsd.toLocaleString('en-US')) : tx(lang, 'noRunYet');
      await reply(chatId, `${prefsText(u.prefs)}\n\n${best}\n\n/edit · /price · /dest · /out · /back`);
      return;
    }
    case 'edit': {
      const url = `${CONFIG.pagesUrl}?p=${codec.encode({ ...p, invite: u.invite || 'xxxxxx' })}`;
      await reply(chatId, tx(lang, 'editLink', esc(url)));
      return;
    }
    case 'lang': {
      const L = /^(en|english|אנגלית)$/i.test(c.arg) ? 'en' : /^(he|hebrew|עברית)$/i.test(c.arg) ? 'he' : (lang === 'he' ? 'en' : 'he');
      u.prefs = { ...u.prefs, lang: L }; db.users[u.id] = u;
      await reply(chatId, tx(L, 'langSet'));
      return;
    }
    case 'price': {
      const n = Number((c.arg || '').replace(/[$,\s]/g, ''));
      if (!c.arg || !Number.isFinite(n)) { await reply(chatId, tx(lang, 'priceUsage')); return; }
      await saveChange(db, u, { ...u.prefs, maxPrice: Math.round(n) }, todayIso, toDispatch, false);
      return;
    }
    case 'dest': {
      if (!c.arg) { await reply(chatId, tx(lang, 'destUsage')); return; }
      const found = findPlaces(c.arg);
      if (!found.length) { await reply(chatId, tx(lang, 'notFound', esc(c.arg))); return; }
      if (found.length > 1) {
        const list = found.map((r) => `<code>/dest ${r[0]}</code> · ${esc(lang === 'en' ? r[1] : (r[5] || r[1]))} (${esc(r[2])})`).join('\n');
        await reply(chatId, tx(lang, 'choose', list)); return;
      }
      await saveChange(db, u, { ...u.prefs, destination: found[0][0] }, todayIso, toDispatch, true);
      return;
    }
    case 'out':
    case 'back': {
      if (c.cmd === 'back' && p.oneWay) { await reply(chatId, tx(lang, 'noReturn')); return; }
      const range = c.arg ? parseDates(c.arg, todayIso) : null;
      if (!range) { await reply(chatId, tx(lang, 'dateUsage', c.cmd)); return; }
      const next = c.cmd === 'out' ? { ...u.prefs, outFrom: range[0], outTo: range[1] } : { ...u.prefs, retFrom: range[0], retTo: range[1] };
      await saveChange(db, u, next, todayIso, toDispatch, true);
      return;
    }
    case 'help':
      await reply(chatId, help(u, lang));
      return;
    default:
      await reply(chatId, `${tx(lang, 'unknown')}\n\n${help(u, lang)}`);
  }
}

// The "/" menu in Telegram (Hebrew by default, English for English-language Telegram apps). Set once per version.
const MENU_VERSION = 1;
const MENU = {
  he: [['status', 'ההגדרות שלי והמחיר הכי טוב'], ['edit', 'עריכת ההגדרות בטופס'], ['price', 'סף מחיר חדש, למשל /price 900'], ['dest', 'יעד חדש, למשל /dest אתונה'],
    ['out', 'תאריך הלוך, למשל /out 21.12 3'], ['back', 'תאריך חזור, למשל /back 10.1 3'], ['lang', 'English'], ['help', 'עזרה'], ['stop', 'הפסקה ומחיקת הפרטים']],
  en: [['status', 'My settings and the best price'], ['edit', 'Edit my settings in the form'], ['price', 'New price limit, e.g. /price 900'], ['dest', 'New destination, e.g. /dest Athens'],
    ['out', 'Outbound date, e.g. /out 21.12 3'], ['back', 'Return date, e.g. /back 10.1 3'], ['lang', 'עברית'], ['help', 'Help'], ['stop', 'Stop and delete my details']],
};
async function setCommandMenu(db) {
  if (DRY || db.menuVersion === MENU_VERSION) return false;
  try {
    const cmds = (L) => MENU[L].map(([command, description]) => ({ command, description }));
    await tg('setMyCommands', { commands: cmds('he') });
    await tg('setMyCommands', { commands: cmds('en'), language_code: 'en' });
    db.menuVersion = MENU_VERSION;
    return true;
  } catch (e) { console.log('command menu not set'); return false; }
}

async function main() {
  if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  const db = store.loadUsers();
  const updates = updatesFile ? JSON.parse(fs.readFileSync(updatesFile, 'utf8'))
    : await tg('getUpdates', { offset: (db.botOffset || 0) + 1, timeout: 0, allowed_updates: ['message'] });
  const menuSet = await setCommandMenu(db);
  if (!updates.length) { if (menuSet) store.saveUsers(db); console.log('no new messages'); return; }
  const today = new Date().toISOString().slice(0, 10);
  const toDispatch = [];
  for (const u of updates) {
    db.botOffset = Math.max(db.botOffset || 0, u.update_id);
    if (!u.message) continue;
    try { await handle(db, u.message, today, toDispatch); } catch (e) { console.log('message failed:', e.message.slice(0, 80)); }
  }
  store.saveUsers(db);
  // Searches start only after the workflow has pushed the users file (a search started earlier would not see the change).
  const ids = [...new Set(toDispatch)];
  fs.writeFileSync(PENDING, JSON.stringify(ids));
  console.log(`processed ${updates.length} messages; users: ${Object.keys(db.users).length}; searches to start: ${ids.length}`);
}

// Owner only (manual run with an owner code): register or update the owner as if they had pressed Start.
async function ownerStart(code) {
  if (!TOKEN || !OWNER_CHAT) throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required');
  const db = store.loadUsers(); const toDispatch = [];
  const msg = { chat: { id: OWNER_CHAT, type: 'private', first_name: '' }, text: `/start ${code}` };
  await handle(db, msg, new Date().toISOString().slice(0, 10), toDispatch);
  store.saveUsers(db);
  fs.writeFileSync(PENDING, JSON.stringify([...new Set(toDispatch)]));
  console.log(`owner sign-up: ${toDispatch.length ? 'saved' : 'not saved'}; users: ${Object.keys(db.users).length}`);
}

// Second step, after the users file was pushed: start the searches recorded by main().
async function startPending() {
  let ids = []; try { ids = JSON.parse(fs.readFileSync(PENDING, 'utf8')); } catch {}
  let started = 0;
  for (const id of ids) if (await dispatchSearch(id)) started++;
  console.log(`searches started: ${started} of ${ids.length}`);
}

if (require.main === module) (argv.includes('--start-searches') ? startPending() : argv.includes('--owner-start') ? ownerStart(argv[argv.indexOf('--owner-start') + 1] || '') : main()).catch((e) => { console.error('ERROR', e.message); process.exit(1); });
module.exports = { prefsText, parseDates, parseDate, findPlaces, parseCommand, handle };
