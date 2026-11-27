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
const I18n = require('./docs/i18n.js');
const Regions = require('./docs/regions.js');

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const updatesFile = argv.includes('--updates') ? argv[argv.indexOf('--updates') + 1] : null;
const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const OWNER_CHAT = (process.env.TELEGRAM_CHAT_ID || '').trim(); // the bot owner (admin)
const PENDING = path.join(process.env.RUNNER_TEMP || require('os').tmpdir(), 'flight-bot-pending.json'); // outside the repo

const AIRPORTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'docs', 'airports.json'), 'utf8'));
codec.setPlaces(AIRPORTS);
const d = (iso, lang) => I18n.fullDate(lang || 'he', iso);
const esc = (t) => String(t || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

// ---------- texts ----------
// Every text is in docs/locales/<language>.js (section "bot" for users, "owner" for the bot owner). See LANGUAGES.md.
const tx = (lang, key, a, b) => I18n.t(lang, 'bot.' + key, a, b);
const ox = (lang, key, ...args) => I18n.t(lang, 'owner.' + key, ...args);
const prefsText = (p) => codec.describe(p, p.lang || 'he').join('\n');
const SUMMARY_AT = `${String(CONFIG.summaryHour ?? 21).padStart(2, '0')}:00`; // the daily summary, in each user's own time
function routeOf(p, lang = 'he') {
  const n = (c) => codec.placeName(c, lang);
  if (!codec.isTrip(p)) return `${n(p.origin)} ${p.oneWay ? '→' : '⇄'} ${n(p.destination)}`;
  const parts = [n(p.legs[0].origin)]; // a flight that does not start where the last one landed: its origin in brackets
  p.legs.forEach((l, i) => { if (i && l.origin !== p.legs[i - 1].destination) parts.push(`(${n(l.origin)})`); parts.push(n(l.destination)); });
  return tx(lang, 'tripRoute', parts.join(' → '));
}
// Users the owner paused (config.json "pausedUsers"): their data stays, but nothing is searched or sent.
const isPaused = (u) => !!u && (CONFIG.pausedUsers || []).includes(u.id);
// The owner reads owner messages in their own language (Hebrew until the owner has signed up).
const ownerLang = (db) => { const o = db && Object.values(db.users || {}).find((u) => u.owner); return (o && o.prefs && o.prefs.lang) || 'he'; };
function userLine(u, lang = 'he') { // one short line about a user's search, for the owner
  const loc = codec.localOf(u.prefs);
  const local = ox(lang, 'local', `${loc.currency} · ${loc.tz}`);
  if (codec.isTrip(u.prefs)) {
    const t = u.prefs; const legs = t.legs.map((_, i) => codec.legPrefs(t, i));
    return ox(lang, 'lineTrip', routeOf(t, lang), legs.length, d(legs[0].outFrom, lang), d(legs[legs.length - 1].outTo, lang), legs.map((l) => `$${l.maxPrice.toLocaleString('en-US')}`).join('/')) + local;
  }
  const p = codec.withDefaults(u.prefs);
  const pax = p.adults + p.children + p.infants;
  const dates = p.oneWay ? d(p.outFrom, lang) : `${d(p.outFrom, lang)} → ${d(p.retFrom, lang)}`;
  return ox(lang, 'lineOne', routeOf(p, lang), dates, pax > 1 ? ox(lang, 'paxN', pax) : '', `$${p.maxPrice.toLocaleString('en-US')}`) + local;
}
// "$1,000 (€920)" with the rate the last search saved; "$1,000" when the user's currency is USD or no rate is known.
function priceText(usd, prefs, st) {
  const cur = codec.localOf(prefs).currency; const rate = st && st.rates && st.rates.rates && st.rates.rates[cur];
  const base = `$${Math.round(usd).toLocaleString('en-US')}`;
  return cur !== 'USD' && rate ? `${base} (${I18n.money(usd * rate, cur)})` : base;
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
async function reply(chatId, text, kind) {
  const row = { at: new Date().toISOString().slice(0, 19) + 'Z', user: kind === 'admin-notice' ? 'admin' : CURRENT.user, sender: 'bot', type: kind || CURRENT.type, chars: text.length };
  if (DRY) { console.log(`--- reply to ${chatId} ---\n${text}\n---`); MESSAGES.push({ ...row, status: 'sent' }); return; }
  try { await tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }); } catch (e) {
    MESSAGES.push({ ...row, status: 'failed' }); throw e;
  }
  MESSAGES.push({ ...row, status: 'sent' });
}
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

// Commands may be typed with or without "/", in English or in any language that names them (locale "commands").
const COMMANDS = ['start', 'stop', 'status', 'edit', 'price', 'dest', 'out', 'back', 'lang', 'help', 'users', 'errors', 'currency', 'tz'];
const ALIASES = Object.fromEntries(COMMANDS.map((cmd) => [cmd, [cmd, ...I18n.list().flatMap(({ code }) => {
  const c = I18n.get(code).commands || {};
  return [...(c[cmd] || []), ...(cmd === 'dest' ? c.destination || [] : [])];
}).map((w) => w.toLowerCase())]]));
function parseCommand(text) {
  const m = text.match(/^\/?([^\s@]+)(?:@\S+)?\s*([\s\S]*)$/);
  if (!m) return null;
  const word = m[1].toLowerCase();
  for (const [cmd, names] of Object.entries(ALIASES)) if (names.includes(word)) return { cmd, arg: m[2].trim() };
  return null;
}

const firstSearchText = (p) => tx(p.lang || 'he', 'firstSearch', SUMMARY_AT, codec.localOf(p).tz);

// ---------- applying a change from the chat ----------
// The new settings replace the user's settings; the search restarts (fresh state if the route or dates changed).
async function saveChange(db, user, newPrefs, todayIso, toDispatch, resetSearch) {
  const lang = newPrefs.lang || 'he';
  const errs = codec.validate({ ...newPrefs, invite: user.invite || 'xxxxxx' }, todayIso, lang);
  if (errs.length) { await reply(user.chatId, `${tx(lang, 'problems')}\n• ${errs.map(esc).join('\n• ')}`); return; }
  user.prefs = newPrefs; user.updatedAt = new Date().toISOString();
  db.users[user.id] = user;
  if (resetSearch) store.deleteState(user.id);
  else { // new price: may alert again
    const st = store.loadState(user.id); delete st.lastAlert;
    (st.legs || []).forEach((l) => { if (l) delete l.lastAlert; });
    store.saveState(user.id, st);
  }
  if (!isPaused(user)) toDispatch.push(user.id);
  await reply(user.chatId, `${tx(lang, 'updated')}\n\n${prefsText(newPrefs)}\n\n${isPaused(user) ? tx(lang, 'paused') : firstSearchText(newPrefs)}`);
  if (!user.owner) { const OL = ownerLang(db); await notifyOwner(ox(OL, 'updated', esc(user.name) || ox(OL, 'noName'), userLine(user, OL))); }
}

async function handle(db, msg, todayIso, toDispatch) {
  const chat = msg.chat || {};
  if (chat.type !== 'private') return; // only one-to-one chats
  const chatId = String(chat.id);
  const text = (msg.text || '').trim();
  const existing = Object.values(db.users).find((u) => u.chatId === chatId); // one user per chat
  const tgLang = msg.from && msg.from.language_code;
  const lang = existing ? (existing.prefs.lang || 'he') : I18n.resolve(tgLang);
  const OL = ownerLang(db);
  const help = (u, L) => tx(L, 'help') + (u && codec.isTrip(u.prefs) ? '\n\n' + tx(L, 'tripHelp') : '') + (u && u.owner ? '\n' + tx(L, 'ownerHelp') : '');

  // The sign-up code arrives as "/start CODE" (Start button) or pasted as "/start CODE" / "CODE" by hand.
  const pasted = new RegExp(`^[A-Za-z0-9_-]{20,${codec.MAX_CODE}}$`).test(text) ? text : null; // a long trip code is pasted
  const c = pasted ? { cmd: 'start', arg: pasted } : parseCommand(text);
  CURRENT = { type: c ? c.cmd : 'other', user: existing ? existing.id : '-' };

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
    CURRENT.user = user.id; CURRENT.type = existing ? 'update' : 'signup';
    const paused = isPaused(user);
    if (!paused) toDispatch.push(user.id);
    if (!user.owner) await notifyOwner(ox(OL, existing ? 'signupUpdate' : 'signup', esc(user.name) || ox(OL, 'noName'), paused ? ox(OL, 'pausedNote') : '', userLine(user, OL), Object.keys(db.users).length));
    await reply(chatId, `${existing ? tx(L, 'updated') : tx(L, 'registered')}\n\n${prefsText(prefs)}\n\n${paused ? tx(L, 'paused') : firstSearchText(prefs)}\n\n${help(user, L)}`);
    return;
  }

  if (c && c.cmd === 'errors' && OWNER_CHAT && chatId === OWNER_CHAT) { // owner only: the search log
    const hours = Math.min(24 * 14, Number(c.arg) || 24);
    const repo = process.env.GITHUB_REPOSITORY || 'mrTal77/flight-bot';
    await reply(chatId, `${require('./lib/logs').summarize(hours)}\n\n${ox(OL, 'logLinks', `https://github.com/${repo}/blob/main/logs/searches.csv`, `https://github.com/${repo}/blob/main/logs/runs.csv`)}`);
    return;
  }

  if (c && c.cmd === 'users' && OWNER_CHAT && chatId === OWNER_CHAT) {
    const list = Object.values(db.users).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    if (!list.length) { await reply(chatId, ox(OL, 'noUsers')); return; }
    const rows = list.map((u, i) => {
      const st = store.loadState(u.id);
      const best = st.lastRun && st.lastRun.bestUsd ? `$${st.lastRun.bestUsd.toLocaleString('en-US')}${codec.isTrip(u.prefs) ? ox(OL, 'wholeTrip') : ''}` : ox(OL, 'none');
      const last = st.lastRun ? d(st.lastRun.at.slice(0, 10), OL) : '—';
      return `${ox(OL, 'userRow', i + 1, esc(u.name) || ox(OL, 'noName'), u.owner ? ox(OL, 'you') : '', isPaused(u) ? ox(OL, 'pausedMark') : '', d(u.createdAt.slice(0, 10), OL), userLine(u, OL))}\n${ox(OL, 'userRow2', best, last)}`;
    });
    await reply(chatId, `${ox(OL, 'usersHead', list.length, CONFIG.maxUsers)}\n\n${rows.join('\n\n')}`);
    return;
  }

  if (!existing) { await reply(chatId, tx(lang, 'notRegistered')); return; }
  const u = existing;
  const trip = codec.isTrip(u.prefs);
  const p = trip ? u.prefs : codec.withDefaults(u.prefs);

  switch (c && c.cmd) {
    case 'stop': {
      delete db.users[u.id];
      store.deleteState(u.id);
      await reply(chatId, tx(lang, 'stopped'));
      if (!u.owner) await notifyOwner(ox(OL, 'stopped', esc(u.name) || ox(OL, 'noName'), routeOf(u.prefs, OL), Object.keys(db.users).length));
      return;
    }
    case 'status': {
      const st = store.loadState(u.id);
      let best;
      if (trip) {
        const legs = st.legs || [];
        best = st.lastRun ? [tx(lang, 'bestLeg'), ...u.prefs.legs.map((_, i) => `${i + 1}. ${legs[i] && legs[i].bestUsd ? priceText(legs[i].bestUsd, u.prefs, st) : '—'}`)].join('\n') : tx(lang, 'noRunYet');
      } else best = st.lastRun && st.lastRun.bestUsd ? tx(lang, 'best', priceText(st.lastRun.bestUsd, u.prefs, st)) : tx(lang, 'noRunYet');
      await reply(chatId, `${prefsText(u.prefs)}\n\n${best}${isPaused(u) ? `\n\n${tx(lang, 'paused')}` : ''}\n\n${trip ? '/edit · /price' : '/edit · /price · /dest · /out · /back'} · /currency · /tz · /lang`);
      return;
    }
    case 'edit': {
      const url = `${CONFIG.pagesUrl}?p=${codec.encode({ ...p, invite: u.invite || 'xxxxxx' })}`;
      await reply(chatId, tx(lang, 'editLink', esc(url)));
      return;
    }
    case 'lang': { // "/lang en", "/lang English"; "/lang" alone lists the languages
      const L = I18n.find(c.arg);
      if (!L) { await reply(chatId, tx(lang, 'langList', I18n.list().map((x) => `<code>/lang ${x.code}</code> · ${x.name}`).join('\n'))); return; }
      u.prefs = { ...u.prefs, lang: L }; db.users[u.id] = u;
      await reply(chatId, tx(L, 'langSet'));
      return;
    }
    case 'currency': { // "/currency EUR": prices are shown in USD and in this currency
      const cur = (c.arg || '').trim().toUpperCase();
      if (!Regions.isCurrency(cur)) { await reply(chatId, tx(lang, 'currencyUsage', Regions.CURRENCIES.slice(1).join(' '), codec.localOf(u.prefs).currency)); return; }
      u.prefs = { ...u.prefs, currency: cur }; db.users[u.id] = u;
      await reply(chatId, tx(lang, 'currencySet', cur));
      return;
    }
    case 'tz': { // "/tz Europe/Berlin" or "/tz Berlin": the daily summary comes at 21:00 on this clock
      // a zone name ("Europe/Berlin", "Berlin"), or a city or airport ("TLV", "Tel Aviv") -> the zone of that place
      let z = Regions.findZone(c.arg);
      if (!z && c.arg) { const f = findPlaces(c.arg); if (f.length) z = Regions.zoneOf(f[0][3], f[0][0]); }
      if (!z) { await reply(chatId, tx(lang, 'tzUsage', codec.localOf(u.prefs).tz)); return; }
      u.prefs = { ...u.prefs, tz: z }; db.users[u.id] = u;
      await reply(chatId, tx(lang, 'tzSet', z, SUMMARY_AT));
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
        const list = found.map((r) => `<code>/dest ${r[0]}</code> · ${esc(codec.placeName(r[0], lang))} (${esc(r[2])})`).join('\n');
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

// The "/" menu in Telegram, from each language file ("menu"): English by default, and each language for Telegram
// apps set to it. Set again when the version changes.
const MENU_VERSION = 2;
async function setCommandMenu(db) {
  if (DRY || db.menuVersion === MENU_VERSION) return false;
  try {
    const cmds = (L) => I18n.get(L).menu.map(([command, description]) => ({ command, description }));
    await tg('setMyCommands', { commands: cmds('en') });
    for (const { code } of I18n.list()) await tg('setMyCommands', { commands: cmds(code), language_code: code });
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
  if (!DRY && !updatesFile) await require('./lib/clicks').pullClicks(); // link clicks -> logs/clicks.csv (CLICKS-SETUP.md)
  if (!updates.length) { if (menuSet) store.saveUsers(db); console.log('no new messages'); return; }
  const today = new Date().toISOString().slice(0, 10);
  const toDispatch = [];
  for (const u of updates) {
    db.botOffset = Math.max(db.botOffset || 0, u.update_id);
    if (!u.message) continue;
    try { await handle(db, u.message, today, toDispatch); } catch (e) { console.log('message failed:', e.message.slice(0, 80)); }
  }
  store.saveUsers(db);
  saveMessageLog();
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
module.exports = { prefsText, parseDates, parseDate, findPlaces, parseCommand, handle, routeOf, userLine, isPaused, priceText, ownerLang };
