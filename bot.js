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
// Sign-up rules (config.json "signup"). mode: "open" = anyone may sign up; "invite" = only with an invite code;
// "closed" = new people only join the waitlist. Above maxUsers, or after maxNewPerDay new users in a day (UTC),
// new people join the waitlist and are let in, in order, as soon as there is room.
const SIGNUP = { mode: 'invite', maxUsers: CONFIG.maxUsers || 10, maxNewPerDay: 0, maxWaitlist: 500, maxChangesPerDay: 10, maxMessagesPerRun: 10, ...(CONFIG.signup || {}) };
// Open sign-up: the landing page puts where the visitor came from (?src=igus1 or utm_source) in the invite field.
const adSource = (code) => (code && code !== 'public' && code !== 'xxxxxx' && !inviteOf(code) ? `src:${code.toLowerCase().replace(/_+$/, '')}` : null);
const inviteOf = (code) => (code ? (CONFIG.invites || []).find((i) => i.sha256 === store.sha256(code)) : null);
const argv = process.argv.slice(2);
let DRY = argv.includes('--dry');
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
    ownerHelp: '<b>רק לך:</b>\n/dashboard · מצב הבוט: משתמשים, הרשמות, רשימת המתנה\n/users · רשימת המשתמשים\n/waitlist · רשימת ההמתנה · /admit 3 · הכנסת 3 הראשונים בתור (גם מעל המגבלות)\n/block 4 · חסימת משתמש 4 ברשימה ומחיקתו · /blocked · /unblock 1\n/errors · יומן החיפושים שנכשלו (/errors 72 ל-72 שעות)',
    notRegistered: '👋 כדי להירשם צריך לפתוח את קישור ההרשמה שקיבלת, למלא את פרטי הטיסה וללחוץ "אישרתי".',
    alreadyIn: '👋 אתה כבר רשום.',
    badCode: '⚠️ הקוד בקישור לא תקין. נסה למלא את הטופס שוב.',
    badInvite: '⚠️ קוד ההזמנה לא תקף. בקש קישור הרשמה חדש.',
    problems: '⚠️ יש בעיה בפרטים:', fillAgain: 'מלא את הטופס שוב.', full: '😕 הבוט מלא כרגע. נסה שוב בהמשך.',
    registered: '✅ <b>נרשמת בהצלחה!</b>', updated: '✅ <b>ההגדרות עודכנו!</b> (ההגדרות הקודמות הוחלפו)',
    firstSearch: 'החיפוש מתחיל עכשיו, והתוצאות יגיעו לכאן בעוד כ-10 דקות. אחר כך אבדוק כל כמה שעות ואשלח סיכום פעם ביום ב-21:00.',
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
    tripHelp: '<b>במסע:</b> <code>/price 2 400</code> · סף חדש לטיסה 2 (<code>/price 400</code> משנה את כל הטיסות). תאריכים ויעדים משנים דרך /edit.',
    tripEdit: 'במסע משנים תאריכים ויעדים דרך הטופס: /edit',
    tripPriceUsage: 'כך משנים מחיר במסע: <code>/price 2 400</code> (טיסה 2, בדולרים לנוסע), או <code>/price 400</code> לכל הטיסות.',
    noLeg: 'אין במסע טיסה מספר {a}.',
    bestLeg: '💰 הזול ביותר בבדיקה האחרונה:',
    paused: '⏸️ החיפוש שלך מושהה כרגע, ולא יישלחו התראות או סיכומים. ההגדרות שלך שמורות.',
    welcome: [
      '✈️ <b>ברוכים הבאים!</b>',
      'אני עוקב בשבילכם אחרי מחירי טיסות, בחינם, ושולח הודעה כשכרטיס מתאים יורד מתחת לסף שבחרתם.',
      '',
      '<b>איך מתחילים:</b>',
      '1. לוחצים על הכפתור למטה וממלאים איזו טיסה מחפשים (דקה אחת).',
      '2. לוחצים "אישרתי" וחוזרים לכאן.',
      '3. אני מאשר תוך כמה דקות, והתוצאות הראשונות מגיעות תוך כ-20 דקות.',
      '',
      'ℹ️ אני עונה תוך כמה דקות, לא מיד. הפרטים נשמרים מוצפנים, ו-/stop מוחק אותם.',
    ].join('\n'),
    welcomeInvite: '👋 כרגע ההרשמה היא בהזמנה בלבד. אם קיבלתם קישור הרשמה, פתחו אותו. אפשר גם למלא את הטופס ולהיכנס לרשימת ההמתנה.',
    welcomeWait: '⏳ כרגע יש רשימת המתנה. אחרי מילוי הטופס תיכנסו לתור, ואשלח הודעה ברגע שיתפנה מקום.',
    formBtn: '✈️ למילוי הטופס', editBtn: '✏️ פתיחת הטופס שלי',
    waitlisted: '⏳ <b>נכנסתם לרשימת ההמתנה</b> (מקום {a} בתור).\nהבוט מלא כרגע. ההגדרות שלכם שמורות, ואשלח הודעה ברגע שתיכנסו והחיפוש יתחיל. אפשר לעדכן את הטופס בינתיים, ו-/stop מוציא אתכם מהתור.',
    waitStatus: '⏳ אתם ברשימת ההמתנה, מקום {a} בתור. אשלח הודעה ברגע שיתפנה מקום.',
    waitFull: '😕 הבוט ורשימת ההמתנה מלאים כרגע. נסו שוב בעוד כמה ימים.',
    waitLeft: '👋 יצאתם מרשימת ההמתנה והפרטים נמחקו.',
    admitted: '🎉 <b>התפנה מקום, ונרשמתם!</b>',
    admitExpired: '⏳ התפנה מקום, אבל התאריכים שבחרתם כבר עברו. מלאו את הטופס שוב עם תאריכים חדשים:',
    tooManyChanges: '✋ היום כבר עדכנתם את ההגדרות הרבה פעמים. אפשר לעדכן שוב מחר.',
    tooManyMessages: '✋ הגיעו הרבה הודעות בבת אחת. אני עונה על הראשונות, ועל השאר לא. נסו שוב בעוד כמה דקות.',
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
    ownerHelp: '<b>Only you:</b>\n/dashboard · bot status: users, sign-ups, waitlist\n/users · list of users\n/waitlist · the waitlist · /admit 3 · let the first 3 in (even above the limits)\n/block 4 · block user 4 of the list and delete them · /blocked · /unblock 1\n/errors · log of failed searches (/errors 72 for 72 hours)',
    notRegistered: '👋 To sign up, open the sign-up link you received, fill in your flight and tap "Confirm".',
    alreadyIn: '👋 You are already signed up.',
    badCode: '⚠️ The code in the link is not valid. Please fill in the form again.',
    badInvite: '⚠️ The invite code is not valid. Ask for a new sign-up link.',
    problems: '⚠️ There is a problem with the details:', fillAgain: 'Please fill in the form again.', full: '😕 The bot is full right now. Please try again later.',
    registered: '✅ <b>You are signed up!</b>', updated: '✅ <b>Settings updated!</b> (the previous settings were replaced)',
    firstSearch: 'The search starts now; results arrive here in about 10 minutes. After that I check every few hours and send a daily summary at 21:00 (Israel time).',
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
    tripHelp: '<b>In a trip:</b> <code>/price 2 400</code> · new limit for flight 2 (<code>/price 400</code> changes every flight). Change dates and places with /edit.',
    tripEdit: 'In a trip, change dates and places in the form: /edit',
    tripPriceUsage: 'To change a price in a trip: <code>/price 2 400</code> (flight 2, USD per passenger), or <code>/price 400</code> for every flight.',
    noLeg: 'There is no flight number {a} in your trip.',
    bestLeg: '💰 Best prices in the last check:',
    paused: '⏸️ Your search is paused right now: no alerts or summaries. Your settings are saved.',
    welcome: [
      '✈️ <b>Welcome!</b>',
      'I watch flight prices for you, for free, and message you when a matching ticket drops below your price limit.',
      '',
      '<b>How to start:</b>',
      '1. Tap the button below and fill in the flight you are looking for (1 minute).',
      '2. Tap "Confirm" and come back here.',
      '3. I confirm within a few minutes, and the first results arrive in about 20 minutes.',
      '',
      'ℹ️ I answer within a few minutes, not instantly. Your details are stored encrypted, and /stop deletes them.',
    ].join('\n'),
    welcomeInvite: '👋 Sign-up is by invitation right now. If you got a sign-up link, open it. You can also fill in the form to join the waitlist.',
    welcomeWait: '⏳ There is a waitlist right now. Fill in the form to get in line, and I will message you as soon as there is room.',
    formBtn: '✈️ Open the form', editBtn: '✏️ Open my form',
    waitlisted: '⏳ <b>You are on the waitlist</b> (number {a} in line).\nThe bot is full right now. Your settings are saved, and I will message you as soon as you are in and the search starts. You can update the form meanwhile; /stop takes you off the list.',
    waitStatus: '⏳ You are on the waitlist, number {a} in line. I will message you as soon as there is room.',
    waitFull: '😕 The bot and its waitlist are full right now. Please try again in a few days.',
    waitLeft: '👋 You left the waitlist and your details were deleted.',
    admitted: '🎉 <b>A place opened up, and you are signed up!</b>',
    admitExpired: '⏳ A place opened up, but your dates have already passed. Please fill in the form again with new dates:',
    tooManyChanges: '✋ You changed your settings many times today. You can change them again tomorrow.',
    tooManyMessages: '✋ Many messages arrived at once. I answered the first ones and skipped the rest. Please try again in a few minutes.',
  },
};
const tx = (lang, key, a) => (TX[lang === 'en' ? 'en' : 'he'][key] || '').split('{a}').join(a == null ? '' : a);
const prefsText = (p) => codec.describe(p, p.lang || 'he').join('\n');
function routeOf(p) {
  if (!codec.isTrip(p)) return `${codec.placeName(p.origin)} ${p.oneWay ? '→' : '⇄'} ${codec.placeName(p.destination)}`;
  const parts = [codec.placeName(p.legs[0].origin)]; // a flight that does not start where the last one landed: its origin in brackets
  p.legs.forEach((l, i) => { if (i && l.origin !== p.legs[i - 1].destination) parts.push(`(${codec.placeName(l.origin)})`); parts.push(codec.placeName(l.destination)); });
  return `מסע: ${parts.join(' → ')}`;
}
// Users the owner paused (config.json "pausedUsers"): their data stays, but nothing is searched or sent.
const isPaused = (u) => !!u && (CONFIG.pausedUsers || []).includes(u.id);
function userLine(u) { // one short line about a user's search, for the owner (Hebrew)
  if (codec.isTrip(u.prefs)) {
    const t = u.prefs; const legs = t.legs.map((_, i) => codec.legPrefs(t, i));
    return `🧳 ${routeOf(t)} · ${legs.length} טיסות · ${d(legs[0].outFrom)}–${d(legs[legs.length - 1].outTo)} · ספים ${legs.map((l) => `$${l.maxPrice.toLocaleString('en-US')}`).join('/')}`;
  }
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
// Every message sent is counted in logs/messages.csv (user id and kind only; no text, no chat id).
const MESSAGES = [];
let CURRENT = { type: 'other', user: '-' }; // what the message being answered is, and whose
const SENT = []; // dry runs and tests: what would have been sent
// button: [text, url] shows one link button under the message.
async function reply(chatId, text, kind, button) {
  const row = { at: new Date().toISOString().slice(0, 19) + 'Z', user: kind === 'admin-notice' ? 'admin' : CURRENT.user, sender: 'bot', type: kind || CURRENT.type, chars: text.length };
  const markup = button ? { inline_keyboard: [[{ text: button[0], url: button[1] }]] } : undefined;
  if (DRY) { SENT.push({ chatId, text, button }); if (!QUIET) console.log(`--- reply to ${chatId} ---\n${text}${button ? `\n[${button[0]}] ${button[1]}` : ''}\n---`); MESSAGES.push({ ...row, status: 'sent' }); return; }
  try { await tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: markup }); } catch (e) {
    MESSAGES.push({ ...row, status: 'failed' }); throw e;
  }
  MESSAGES.push({ ...row, status: 'sent' });
}
// A long list (the owner's /users, /waitlist) split into messages under Telegram's 4096-character limit.
async function replyLong(chatId, head, blocks) {
  const msgs = []; let cur = head;
  for (const b of blocks) { if (cur.length + b.length + 2 > 3800) { msgs.push(cur); cur = b; } else cur += (cur ? '\n\n' : '') + b; }
  msgs.push(cur);
  for (const m of msgs) await reply(chatId, m);
}
let QUIET = false;
const formUrl = (lang, extra) => `${CONFIG.pagesUrl}?lang=${lang === 'en' ? 'en' : 'he'}${extra || ''}`;
async function notifyOwner(text) { if (OWNER_CHAT) { try { await reply(OWNER_CHAT, text, 'admin-notice'); } catch (e) { console.log('owner notice failed'); } } }
function saveMessageLog() { if (!DRY) require('./lib/logs').logMessages(MESSAGES); }

// Start a search for a user right away (instead of waiting for the next scheduled run).
async function dispatchSearch(userId) {
  const gh = (process.env.GITHUB_TOKEN || '').trim(); const repo = process.env.GITHUB_REPOSITORY;
  if (DRY || !gh || !repo) return false;
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/watch.yml/dispatches`, {
    method: 'POST',
    headers: { authorization: `Bearer ${gh}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
    body: JSON.stringify({ ref: process.env.GITHUB_REF_NAME || 'main', inputs: { mode: 'first', user: userId } }),
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
  dashboard: ['dashboard', 'stats', 'דשבורד', 'סטטיסטיקה'], waitlist: ['waitlist', 'queue', 'המתנה', 'תור'], admit: ['admit', 'הכנס'],
  block: ['block', 'חסום'], blocked: ['blocked', 'חסומים'], unblock: ['unblock', 'שחרר'],
};
const OWNER_CMDS = ['errors', 'users', 'dashboard', 'waitlist', 'admit', 'block', 'blocked', 'unblock'];
const ownerCommand = (cmd) => OWNER_CMDS.includes(cmd);
function parseCommand(text) {
  const m = text.match(/^\/?([^\s@]+)(?:@\S+)?\s*([\s\S]*)$/);
  if (!m) return null;
  const word = m[1].toLowerCase();
  for (const [cmd, names] of Object.entries(ALIASES)) if (names.includes(word)) return { cmd, arg: m[2].trim() };
  return null;
}

// ---------- open sign-up: limits, waitlist, blocked chats ----------
// db.waitlist: [{ chatId, name, prefs, invite, at }] in arrival order (encrypted with the users file).
// db.blocked:  [{ chatId, name, at }] chats the owner blocked: everything they send is ignored.
const isOwnerChat = (chatId) => !!OWNER_CHAT && String(chatId) === OWNER_CHAT;
const others = (db) => Object.values(db.users).filter((u) => !u.owner);
const newToday = (db, todayIso) => others(db).filter((u) => (u.createdAt || '').slice(0, 10) === todayIso).length;
// Why a new person cannot get in right now ('closed' | 'full' | 'daily'), or null when there is room.
function noRoom(db, todayIso) {
  if (SIGNUP.mode === 'closed') return 'closed';
  if (others(db).length >= SIGNUP.maxUsers) return 'full';
  if (SIGNUP.maxNewPerDay && newToday(db, todayIso) >= SIGNUP.maxNewPerDay) return 'daily';
  return null;
}
const isBlocked = (db, chatId) => (db.blocked || []).some((b) => b.chatId === String(chatId));
const waitPos = (db, chatId) => (db.waitlist || []).findIndex((w) => w.chatId === String(chatId)) + 1;
// Each user may change their settings maxChangesPerDay times a day (every change starts a new search).
function changeAllowed(user, todayIso) {
  if (user.owner || !SIGNUP.maxChangesPerDay) return true;
  const c = user.changes && user.changes.day === todayIso ? user.changes : { day: todayIso, n: 0 };
  if (c.n >= SIGNUP.maxChangesPerDay) return false;
  user.changes = { day: todayIso, n: c.n + 1 };
  return true;
}
function addUser(db, chatId, name, prefs, invite, createdAt) {
  const user = { id: store.newUserId(), chatId: String(chatId), createdAt: createdAt || new Date().toISOString() };
  user.name = name; user.prefs = prefs; user.owner = isOwnerChat(chatId); user.updatedAt = new Date().toISOString();
  const inv = inviteOf(invite);
  if (inv) { user.invite = invite; user.source = inv.label; } // kept (encrypted) for the /edit link; the label shows in /users
  else if (adSource(invite)) user.source = adSource(invite); // came from an ad or a shared link (landing page ?src= / utm_source)
  db.users[user.id] = user;
  return user;
}
// Let people in from the waitlist, in order, while there is room (or `force` people regardless of the limits).
async function admitWaiting(db, todayIso, toDispatch, force = 0) {
  let admitted = 0;
  while ((db.waitlist || []).length && (force ? admitted < force : !noRoom(db, todayIso))) {
    const w = db.waitlist.shift();
    const L = w.prefs.lang || 'he';
    CURRENT = { type: 'admitted', user: '-' };
    if (codec.validate({ ...w.prefs, invite: w.invite || 'xxxxxx' }, todayIso, L).length) { // dates passed while waiting
      try { await reply(w.chatId, tx(L, 'admitExpired'), 'admit-expired', [tx(L, 'formBtn'), formUrl(L)]); } catch {}
      continue;
    }
    const user = addUser(db, w.chatId, w.name, w.prefs, w.invite);
    CURRENT.user = user.id; admitted++;
    if (!isPaused(user)) toDispatch.push(user.id);
    try { await reply(w.chatId, `${tx(L, 'admitted')}\n\n${prefsText(w.prefs)}\n\n${tx(L, 'firstSearch')}\n\n${tx(L, 'help')}`, 'admitted'); } catch {}
  }
  if (admitted) await notifyOwner(`🎟️ ${admitted} נכנסו מרשימת ההמתנה. בתור נשארו ${(db.waitlist || []).length}. משתמשים: ${Object.keys(db.users).length}`);
  return admitted;
}

// ---------- applying a change from the chat ----------
// The new settings replace the user's settings; the search restarts (fresh state if the route or dates changed).
async function saveChange(db, user, newPrefs, todayIso, toDispatch, resetSearch) {
  const lang = newPrefs.lang || 'he';
  const errs = codec.validate({ ...newPrefs, invite: user.invite || 'xxxxxx' }, todayIso, lang);
  if (errs.length) { await reply(user.chatId, `${tx(lang, 'problems')}\n• ${errs.map(esc).join('\n• ')}`); return; }
  if (!changeAllowed(user, todayIso)) { await reply(user.chatId, tx(lang, 'tooManyChanges')); return; }
  user.prefs = newPrefs; user.updatedAt = new Date().toISOString();
  db.users[user.id] = user;
  if (resetSearch) store.deleteState(user.id);
  else { // new price: may alert again
    const st = store.loadState(user.id); delete st.lastAlert;
    (st.legs || []).forEach((l) => { if (l) delete l.lastAlert; });
    store.saveState(user.id, st);
  }
  if (!isPaused(user)) toDispatch.push(user.id);
  await reply(user.chatId, `${tx(lang, 'updated')}\n\n${prefsText(newPrefs)}\n\n${isPaused(user) ? tx(lang, 'paused') : tx(lang, 'firstSearch')}`);
  if (!user.owner) await notifyOwner(`✏️ <b>משתמש עדכן הגדרות</b>: ${esc(user.name) || 'ללא שם'}\n${userLine(user)}`);
}

// ---------- owner-only commands ----------
const sortedUsers = (db) => Object.values(db.users).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
async function ownerCmd(db, chatId, c, todayIso, toDispatch) {
  const repo = process.env.GITHUB_REPOSITORY || 'mrTal77/flight-bot';
  const n = Math.max(1, Math.min(50, parseInt(c.arg, 10) || 1));
  switch (c.cmd) {
    case 'errors': {
      const hours = Math.min(24 * 14, Number(c.arg) || 24);
      await reply(chatId, `${require('./lib/logs').summarize(hours)}\n\nהטבלאות המלאות: <a href="https://github.com/${repo}/blob/main/logs/searches.csv">חיפושים שנכשלו</a> · <a href="https://github.com/${repo}/blob/main/logs/runs.csv">ריצות</a>`);
      return;
    }
    case 'dashboard': {
      const all = Object.values(db.users);
      const week = new Date(Date.parse(todayIso) - 6 * 864e5).toISOString().slice(0, 10);
      const trips = all.filter((u) => codec.isTrip(u.prefs)).length;
      const sources = new Map();
      for (const u of others(db)) { const k = u.source || 'ללא הזמנה'; sources.set(k, (sources.get(k) || 0) + 1); }
      const mode = { open: 'פתוחה לכולם', invite: 'בהזמנה בלבד', closed: 'סגורה (רק רשימת המתנה)' }[SIGNUP.mode] || SIGNUP.mode;
      const room = noRoom(db, todayIso);
      await reply(chatId, [
        '📊 <b>מצב הבוט</b>',
        `הרשמה: ${mode}${room ? ` · כרגע אין מקום (${{ closed: 'סגורה', full: 'הבוט מלא', daily: 'המכסה היומית נגמרה' }[room]})` : ''}`,
        `👥 משתמשים: ${others(db).length} מתוך ${SIGNUP.maxUsers} (בלעדיך) · מושהים ${all.filter(isPaused).length} · מסעות ${trips}`,
        `🆕 נרשמו היום: ${newToday(db, todayIso)}${SIGNUP.maxNewPerDay ? ` מתוך ${SIGNUP.maxNewPerDay}` : ''} · ב-7 ימים: ${others(db).filter((u) => (u.createdAt || '') >= week).length}`,
        `⏳ ברשימת המתנה: ${(db.waitlist || []).length} (עד ${SIGNUP.maxWaitlist}) · 🚫 חסומים: ${(db.blocked || []).length}`,
        `🌍 לפי שפה: ${['he', 'en'].map((L) => `${L} ${others(db).filter((u) => (u.prefs.lang || 'he') === L).length}`).join(' · ')}`,
        `🎟️ לפי מקור: ${[...sources].map(([k, v]) => `${esc(k)} ${v}`).join(' · ') || '—'}`,
        '',
        `גרפים (מספרים בלבד, בלי פרטים אישיים): <a href="${CONFIG.pagesUrl}dashboard.html">הדשבורד</a>`,
        'המגבלות נקבעות ב-config.json תחת "signup".',
      ].join('\n'));
      return;
    }
    case 'users': {
      const list = sortedUsers(db);
      if (!list.length) { await reply(chatId, 'אין משתמשים רשומים כרגע.'); return; }
      const rows = list.map((u, i) => {
        const st = store.loadState(u.id);
        const best = st.lastRun && st.lastRun.bestUsd ? `$${st.lastRun.bestUsd.toLocaleString('en-US')}${codec.isTrip(u.prefs) ? ' (כל המסע)' : ''}` : 'עוד אין';
        const last = st.lastRun ? d(st.lastRun.at.slice(0, 10)) : '—';
        return `${i + 1}. <b>${esc(u.name) || 'ללא שם'}</b>${u.owner ? ' (אתה)' : ''}${isPaused(u) ? ' ⏸️ מושהה' : ''}${u.source ? ` · 🎟️ ${esc(u.source)}` : ''} · נרשם ${d(u.createdAt.slice(0, 10))}\n${userLine(u)}\n💰 הזול ביותר: ${best} · בדיקה אחרונה: ${last}`;
      });
      await replyLong(chatId, `👥 <b>${list.length} משתמשים</b> (מקסימום ${SIGNUP.maxUsers} בלעדיך) · /block N לחסימה`, rows);
      return;
    }
    case 'waitlist': {
      const w = db.waitlist || [];
      if (!w.length) { await reply(chatId, 'רשימת ההמתנה ריקה.'); return; }
      await replyLong(chatId, `⏳ <b>${w.length} ברשימת ההמתנה</b> · /admit 3 מכניס את 3 הראשונים`, w.map((x, i) => `${i + 1}. <b>${esc(x.name) || 'ללא שם'}</b> · מחכה מ-${d(x.at.slice(0, 10))}\n${userLine({ prefs: x.prefs })}`));
      return;
    }
    case 'admit': {
      if (!(db.waitlist || []).length) { await reply(chatId, 'רשימת ההמתנה ריקה.'); return; }
      const k = await admitWaiting(db, todayIso, toDispatch, n);
      await reply(chatId, `✅ נכנסו ${k}. בתור נשארו ${db.waitlist.length}.`);
      return;
    }
    case 'block': {
      const u = sortedUsers(db)[n - 1];
      if (!c.arg || !u || u.owner) { await reply(chatId, 'כך חוסמים: <code>/block 4</code> (המספר מתוך /users). החסימה מוחקת את המשתמש ומתעלמת מכל מה שהוא שולח.'); return; }
      delete db.users[u.id]; store.deleteState(u.id);
      db.blocked = db.blocked || []; db.blocked.push({ chatId: u.chatId, name: u.name, at: new Date().toISOString() });
      await reply(chatId, `🚫 ${esc(u.name) || 'ללא שם'} נחסם ונמחק. /blocked · /unblock`);
      return;
    }
    case 'blocked': {
      const b = db.blocked || [];
      await reply(chatId, b.length ? `🚫 <b>${b.length} חסומים</b>\n${b.map((x, i) => `${i + 1}. ${esc(x.name) || 'ללא שם'} · מ-${d(x.at.slice(0, 10))}`).join('\n')}\n\n/unblock N לשחרור` : 'אין חסומים.');
      return;
    }
    case 'unblock': {
      const b = db.blocked || []; const x = b[n - 1];
      if (!c.arg || !x) { await reply(chatId, 'כך משחררים: <code>/unblock 1</code> (המספר מתוך /blocked).'); return; }
      b.splice(n - 1, 1);
      await reply(chatId, `✅ ${esc(x.name) || 'ללא שם'} שוחרר, ויכול להירשם שוב.`);
      return;
    }
    default:
  }
}

async function handle(db, msg, todayIso, toDispatch) {
  const chat = msg.chat || {};
  if (chat.type !== 'private') return; // only one-to-one chats
  const chatId = String(chat.id);
  if (isBlocked(db, chatId)) return; // blocked by the owner: no answer at all
  const text = (msg.text || '').trim();
  const existing = Object.values(db.users).find((u) => u.chatId === chatId); // one user per chat
  const tgLang = msg.from && msg.from.language_code;
  const lang = existing ? (existing.prefs.lang || 'he') : (!tgLang || /^(he|iw)/.test(tgLang) ? 'he' : 'en');
  const help = (u, L) => tx(L, 'help') + (u && codec.isTrip(u.prefs) ? '\n\n' + tx(L, 'tripHelp') : '') + (u && u.owner ? '\n' + tx(L, 'ownerHelp') : '');

  // The sign-up code arrives as "/start CODE" (Start button) or pasted as "/start CODE" / "CODE" by hand.
  const pasted = new RegExp(`^[A-Za-z0-9_-]{20,${codec.MAX_CODE}}$`).test(text) ? text : null; // a long trip code is pasted
  const c = pasted ? { cmd: 'start', arg: pasted } : parseCommand(text);
  CURRENT = { type: c ? c.cmd : 'other', user: existing ? existing.id : '-' };

  if (c && c.cmd === 'start') {
    const waiting = !existing && waitPos(db, chatId);
    if (!c.arg) { // a stranger who found the bot in Telegram: explain, and give the form as a button
      if (existing) { await reply(chatId, `${tx(lang, 'alreadyIn')}\n\n${prefsText(existing.prefs)}\n\n${help(existing, lang)}`); return; }
      if (waiting) { await reply(chatId, tx(lang, 'waitStatus', waiting)); return; }
      const room = noRoom(db, todayIso);
      const extra = SIGNUP.mode === 'invite' && !isOwnerChat(chatId) ? tx(lang, 'welcomeInvite') : room ? tx(lang, 'welcomeWait') : '';
      CURRENT.type = 'welcome';
      await reply(chatId, `${tx(lang, 'welcome')}${extra ? `\n\n${extra}` : ''}`, null, [tx(lang, 'formBtn'), formUrl(lang)]);
      return;
    }
    let p;
    try { p = codec.decode(c.arg); } catch { await reply(chatId, tx(lang, 'badCode'), null, [tx(lang, 'formBtn'), formUrl(lang)]); return; }
    const L = p.lang || lang;
    const isOwner = isOwnerChat(chatId); // the owner needs no invite and is never on the waitlist
    const errs = codec.validate(p, todayIso, L);
    if (errs.length) { await reply(chatId, `${tx(L, 'problems')}\n• ${errs.map(esc).join('\n• ')}\n\n${tx(L, 'fillAgain')}`, null, [tx(L, 'formBtn'), formUrl(L)]); return; }
    const { invite, ...prefs } = p;
    const name = (chat.first_name || '').slice(0, 40);
    if (existing) { // a user already signed up in this chat may always update their settings
      if (!changeAllowed(existing, todayIso)) { await reply(chatId, tx(L, 'tooManyChanges')); return; }
      existing.name = name; existing.prefs = prefs; existing.owner = isOwner; existing.updatedAt = new Date().toISOString();
      if (!existing.invite && inviteOf(invite)) { existing.invite = invite; existing.source = inviteOf(invite).label; }
      else if (!existing.source && adSource(invite)) existing.source = adSource(invite);
      store.deleteState(existing.id); // new settings: start fresh
    }
    // A new person: an invite is needed in "invite" mode; with no room they join the waitlist (in order).
    const goodInvite = !!inviteOf(invite);
    if (!existing && !isOwner) {
      if (SIGNUP.mode === 'invite' && !goodInvite && !waiting) { await reply(chatId, tx(L, 'badInvite')); return; }
      if (waiting || noRoom(db, todayIso) || (db.waitlist || []).length) {
        db.waitlist = db.waitlist || [];
        const entry = { chatId, name, prefs, invite, at: new Date().toISOString() }; // the invite or source is used when they get in
        if (waiting) db.waitlist[waiting - 1] = { ...entry, at: db.waitlist[waiting - 1].at }; // keeps their place in line
        else if (db.waitlist.length >= SIGNUP.maxWaitlist) { await reply(chatId, tx(L, 'waitFull')); return; }
        else db.waitlist.push(entry);
        CURRENT.type = 'waitlist';
        await reply(chatId, tx(L, 'waitlisted', waitPos(db, chatId)));
        if (!waiting) await notifyOwner(`⏳ <b>מישהו נכנס לרשימת ההמתנה</b>: ${esc(name) || 'ללא שם'} (${{ closed: 'ההרשמה סגורה', full: 'הבוט מלא', daily: 'הגיעה המכסה היומית' }[noRoom(db, todayIso)] || 'יש תור'})\n${userLine({ prefs })}\nבתור: ${db.waitlist.length} · /waitlist · /admit`);
        return;
      }
    }
    const user = existing || addUser(db, chatId, name, prefs, invite);
    CURRENT.user = user.id; CURRENT.type = existing ? 'update' : 'signup';
    const paused = isPaused(user);
    if (!paused) toDispatch.push(user.id);
    if (!user.owner) await notifyOwner(`👤 <b>${existing ? 'משתמש עדכן הגדרות' : 'משתמש חדש נרשם'}</b>: ${esc(user.name) || 'ללא שם'}${user.source ? ` (הזמנה: ${esc(user.source)})` : ''}${paused ? ' (מושהה: כדי להפעיל אותו מחדש, להוציא אותו מ-pausedUsers ב-config.json)' : ''}\n${userLine(user)}\nסה״כ משתמשים: ${Object.keys(db.users).length}`);
    await reply(chatId, `${existing ? tx(L, 'updated') : tx(L, 'registered')}\n\n${prefsText(prefs)}\n\n${paused ? tx(L, 'paused') : tx(L, 'firstSearch')}\n\n${help(user, L)}`);
    return;
  }

  if (c && ownerCommand(c.cmd) && isOwnerChat(chatId)) { await ownerCmd(db, chatId, c, todayIso, toDispatch); return; }

  if (!existing) {
    const pos = waitPos(db, chatId);
    if (pos && c && c.cmd === 'stop') { db.waitlist.splice(pos - 1, 1); await reply(chatId, tx(lang, 'waitLeft')); return; }
    if (pos) { await reply(chatId, tx(lang, 'waitStatus', pos)); return; }
    CURRENT.type = 'welcome';
    await reply(chatId, SIGNUP.mode === 'invite' ? tx(lang, 'notRegistered') : tx(lang, 'welcome'), null, [tx(lang, 'formBtn'), formUrl(lang)]);
    return;
  }
  const u = existing;
  const trip = codec.isTrip(u.prefs);
  const p = trip ? u.prefs : codec.withDefaults(u.prefs);

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
      let best;
      if (trip) {
        const legs = st.legs || [];
        best = st.lastRun ? [tx(lang, 'bestLeg'), ...u.prefs.legs.map((_, i) => `${i + 1}. ${legs[i] && legs[i].bestUsd ? `$${legs[i].bestUsd.toLocaleString('en-US')}` : '—'}`)].join('\n') : tx(lang, 'noRunYet');
      } else best = st.lastRun && st.lastRun.bestUsd ? tx(lang, 'best', st.lastRun.bestUsd.toLocaleString('en-US')) : tx(lang, 'noRunYet');
      await reply(chatId, `${prefsText(u.prefs)}\n\n${best}${isPaused(u) ? `\n\n${tx(lang, 'paused')}` : ''}\n\n${trip ? '/edit · /price' : '/edit · /price · /dest · /out · /back'}`);
      return;
    }
    case 'edit': {
      const url = `${CONFIG.pagesUrl}?p=${codec.encode({ ...p, invite: u.invite || 'xxxxxx' })}`;
      await reply(chatId, tx(lang, 'editLink', esc(url)), null, [tx(lang, 'editBtn'), url]);
      return;
    }
    case 'lang': {
      const L = /^(en|english|אנגלית)$/i.test(c.arg) ? 'en' : /^(he|hebrew|עברית)$/i.test(c.arg) ? 'he' : (lang === 'he' ? 'en' : 'he');
      u.prefs = { ...u.prefs, lang: L }; db.users[u.id] = u;
      await reply(chatId, tx(L, 'langSet'));
      return;
    }
    case 'price': {
      if (trip) { // "/price 2 400" = flight 2; "/price 400" = every flight
        const m = (c.arg || '').replace(/[$,]/g, '').trim().match(/^(?:(\d)\s+)?(\d+(?:\.\d+)?)$/);
        if (!m) { await reply(chatId, tx(lang, 'tripPriceUsage')); return; }
        const leg = m[1] ? Number(m[1]) : 0; const price = Math.round(Number(m[2]));
        if (m[1] && (leg < 1 || leg > u.prefs.legs.length)) { await reply(chatId, tx(lang, 'noLeg', leg)); return; }
        const legs = u.prefs.legs.map((l, i) => (!leg || i === leg - 1 ? { ...l, maxPrice: price } : l));
        await saveChange(db, u, { ...u.prefs, legs }, todayIso, toDispatch, false);
        return;
      }
      const n = Number((c.arg || '').replace(/[$,\s]/g, ''));
      if (!c.arg || !Number.isFinite(n)) { await reply(chatId, tx(lang, 'priceUsage')); return; }
      await saveChange(db, u, { ...u.prefs, maxPrice: Math.round(n) }, todayIso, toDispatch, false);
      return;
    }
    case 'dest': {
      if (trip) { await reply(chatId, tx(lang, 'tripEdit')); return; }
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
      if (trip) { await reply(chatId, tx(lang, 'tripEdit')); return; }
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

// The bot's Telegram profile (name, short description, description, "/" menu): lib/profile.js.
// Set once per PROFILE_VERSION. English is the default for every language; Hebrew Telegram apps get Hebrew.
// The owner's chat also gets the owner-only commands in its menu.
const { PROFILE, PROFILE_VERSION } = require('./lib/profile');
const OWNER_MENU = [['dashboard', 'מצב הבוט'], ['users', 'רשימת המשתמשים'], ['waitlist', 'רשימת ההמתנה'], ['admit', 'הכנסה מהתור, למשל /admit 3'], ['errors', 'יומן החיפושים']];
async function setProfile(db) {
  if (DRY || db.profileVersion === PROFILE_VERSION) return false;
  const cmds = (list) => list.map(([command, description]) => ({ command, description }));
  let ok = true;
  const call = async (method, body) => { try { await tg(method, body); } catch (e) { ok = false; console.log(`${method} not set`); } };
  for (const [L, p] of Object.entries(PROFILE)) {
    const lc = L === 'default' ? {} : { language_code: L };
    await call('setMyCommands', { commands: cmds(p.commands), ...lc });
    await call('setMyName', { name: p.name, ...lc });
    await call('setMyShortDescription', { short_description: p.short, ...lc });
    await call('setMyDescription', { description: p.description, ...lc });
  }
  if (OWNER_CHAT) await call('setMyCommands', { commands: cmds([...PROFILE.he.commands, ...OWNER_MENU]), scope: { type: 'chat', chat_id: Number(OWNER_CHAT) } });
  if (ok) db.profileVersion = PROFILE_VERSION; // a failure (e.g. Telegram's rate limit on names) is tried again next run
  return ok;
}

async function main() {
  if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  const db = store.loadUsers();
  const updates = updatesFile ? JSON.parse(fs.readFileSync(updatesFile, 'utf8'))
    : await tg('getUpdates', { offset: (db.botOffset || 0) + 1, timeout: 0, allowed_updates: ['message'] });
  const profileSet = await setProfile(db);
  if (!DRY && !updatesFile) await require('./lib/clicks').pullClicks(); // link clicks -> logs/clicks.csv (CLICKS-SETUP.md)
  const today = new Date().toISOString().slice(0, 10);
  const toDispatch = [];
  // People on the waitlist get in first (a new day, or a place freed since the last run), then the new messages.
  const before = await admitWaiting(db, today, toDispatch);
  const perChat = new Map(); // abuse limit: at most maxMessagesPerRun messages from one chat in one run
  for (const u of updates) {
    db.botOffset = Math.max(db.botOffset || 0, u.update_id);
    if (!u.message) continue;
    const chat = String((u.message.chat || {}).id); const k = (perChat.get(chat) || 0) + 1; perChat.set(chat, k);
    if (SIGNUP.maxMessagesPerRun && k > SIGNUP.maxMessagesPerRun && !isOwnerChat(chat)) {
      if (k === SIGNUP.maxMessagesPerRun + 1 && (u.message.chat || {}).type === 'private' && !isBlocked(db, chat)) {
        const ex = Object.values(db.users).find((x) => x.chatId === chat);
        const tl = u.message.from && u.message.from.language_code;
        CURRENT = { type: 'rate-limit', user: ex ? ex.id : '-' };
        try { await reply(chat, tx(ex ? ex.prefs.lang : (!tl || /^(he|iw)/.test(tl) ? 'he' : 'en'), 'tooManyMessages')); } catch {}
      }
      continue;
    }
    try { await handle(db, u.message, today, toDispatch); } catch (e) { console.log('message failed:', e.message.slice(0, 80)); }
  }
  const after = updates.length ? await admitWaiting(db, today, toDispatch) : 0; // places freed by /stop in this run
  if (!updates.length && !before && !profileSet) { console.log('no new messages'); return; }
  store.saveUsers(db);
  saveMessageLog();
  // Searches start only after the workflow has pushed the users file (a search started earlier would not see the change).
  const ids = [...new Set(toDispatch)];
  fs.writeFileSync(PENDING, JSON.stringify(ids));
  console.log(`processed ${updates.length} messages; users: ${Object.keys(db.users).length}; waitlist: ${(db.waitlist || []).length}; admitted: ${before + after}; searches to start: ${ids.length}`);
}

// Owner only (manual run with an owner code): register or update the owner as if they had pressed Start.
async function ownerStart(code) {
  if (!TOKEN || !OWNER_CHAT) throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required');
  const db = store.loadUsers(); const toDispatch = [];
  const msg = { chat: { id: OWNER_CHAT, type: 'private', first_name: '' }, text: `/start ${code}` };
  await handle(db, msg, new Date().toISOString().slice(0, 10), toDispatch);
  store.saveUsers(db);
  saveMessageLog();
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
module.exports = { prefsText, parseDates, parseDate, findPlaces, parseCommand, handle, routeOf, userLine, isPaused, noRoom, admitWaiting, SIGNUP,
  // tests: replies are collected in SENT instead of being sent
  testMode(on = true) { DRY = on; QUIET = on; SENT.length = 0; MESSAGES.length = 0; return SENT; } };
