// Flight price watcher for several users. Each user registers through the landing page and the
// Telegram bot (bot.js); their preferences are stored encrypted (lib/store.js).
//   Outbound: inside the user's dates, optionally one airline and nonstop.
//   Return:   any airline, at most N stops and H hours, inside the return dates, and no later than
//             maxTripDays after the outbound. Or one-way only.
// Kinds of results:
//   "rt"    one round-trip ticket (Kayak, Kiwi)
//   "mixed" two separate one-way tickets (outbound + cheapest valid return)
//   "ow"    one-way trips (when the user asked for one-way)
// Usage:
//   node watch.js --user <id> [--summary] [--dry]    search for a registered user
//   node watch.js --profile file.json [--summary] --dry   local test with a plain profile file
// Public run logs: only counts and timings are printed (no routes, dates or prices) unless VERBOSE=1.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const store = require('./lib/store');

const argv = process.argv.slice(2);
const args = new Set(argv);
const argVal = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const DRY = args.has('--dry');
const SUMMARY = args.has('--summary');
const VERBOSE = process.env.VERBOSE === '1';
const vlog = (...a) => { if (VERBOSE) console.log(...a); };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
// Default profile for unit tests (require('./watch.js')).
const codec = require('./docs/codec.js');
const TEST_PREFS = { origin: 'AAA', destination: 'BBB', airline: 'LY', outMaxStops: 0, outFrom: '2030-12-16', outTo: '2030-12-30',
  oneWay: false, retFrom: '2031-01-10', retTo: '2031-01-25', retMaxStops: 1, retMaxHours: 25, maxTripDays: 31, maxPrice: 950, checkedBags: 1, carryOn: 1 };

// Who are we searching for?
const USER_ID = argVal('--user');
const PROFILE_FILE = argVal('--profile');
let USER;
if (USER_ID) {
  USER = store.loadUsers().users[USER_ID];
  if (!USER) { console.error('unknown user id'); process.exit(require.main === module ? 1 : 0); }
} else if (PROFILE_FILE) {
  USER = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
} else {
  USER = { id: 'test', prefs: TEST_PREFS, owner: false };
}
function configFor(p0) {
  const p = codec.withDefaults(p0);
  const leg = (k, from, to) => ({ from, to, airline: p[k === 'out' ? 'airline' : 'retAirline'] || '', maxStops: p[k + 'MaxStops'],
    maxHours: p[k + 'MaxHours'] || 0, depFrom: p[k + 'DepFrom'], depTo: p[k + 'DepTo'] });
  return {
    ...BASE,
    origin: p.origin, destination: p.destination,
    pax: { adults: p.adults, children: p.children, infants: p.infants }, cabin: p.cabin,
    checkedBags: p.checkedBags, carryOn: p.carryOn, maxLayover: p.maxLayover, selfTransfer: !!p.selfTransfer,
    outbound: leg('out', p.outFrom, p.outTo),
    return: p.oneWay ? null : leg('ret', p.retFrom, p.retTo),
    maxTripDays: p.oneWay ? 0 : p.maxTripDays, maxPriceUsd: p.maxPrice, // price limit is per passenger
  };
}
const CONFIG = configFor(USER.prefs);
if (process.env.MAX_PRICE_USD) CONFIG.maxPriceUsd = Number(process.env.MAX_PRICE_USD); // for testing the alert
const OUT = CONFIG.outbound;
const RET = CONFIG.return; // null for one-way
const OWNER = !!USER.owner; // the bot owner also gets Duffel (El Al nonstop fares; needs DUFFEL_TOKEN)
const PAX = CONFIG.pax.adults + CONFIG.pax.children + CONFIG.pax.infants;
const BAG_PAX = CONFIG.pax.adults + CONFIG.pax.children; // infants get no bag allowance
const SIMPLE_PAX = PAX === 1 && CONFIG.cabin === 'economy'; // sources that only handle 1 adult in economy

const PRICE_RE = {
  ILS: /₪\s?([\d,]+)/,
  EUR: /([\d.]+)\s?€/,
  GBP: /£\s?([\d,]+)/,
  USD: /\$\s?([\d,]+)/,
  AUD: /\$\s?([\d,]+)/,
};
const DATE_LINE_RE = /^(\d{1,2})[./](\d{1,2})\.?$/; // 16.12 / 20.12. / 20/12 (day first)
const CARD_SPLIT_RE = /המשך לפרטי התוצאה|Go to result details|Zu den Ergebnisdetails/;
const DAYS_HE = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'שבת'];
const AIRLINE_HE = { LY: 'אל על', IZ: 'ארקיע', '6H': 'ישראייר' };
const CITY_HE = { TLV: 'תל אביב', MIA: 'מיאמי', JFK: 'ניו יורק', EWR: 'ניו יורק', LAX: 'לוס אנג׳לס', LHR: 'לונדון', CDG: 'פריז',
  BKK: 'בנגקוק', FCO: 'רומא', ATH: 'אתונה', BCN: 'ברצלונה', MAD: 'מדריד', BER: 'ברלין', AMS: 'אמסטרדם', DXB: 'דובאי', BUD: 'בודפשט',
  PRG: 'פראג', VIE: 'וינה', LCA: 'לרנקה', IST: 'איסטנבול', SFO: 'סן פרנסיסקו', ORD: 'שיקגו', YYZ: 'טורונטו', NRT: 'טוקיו', HND: 'טוקיו' };
codec.setPlaces(JSON.parse(fs.readFileSync(path.join(__dirname, 'docs', 'airports.json'), 'utf8')));
const cityHe = (c) => CITY_HE[c] || codec.placeName(c);
const outAirlineHe = () => (OUT.airline ? AIRLINE_HE[OUT.airline] || OUT.airline : '');
function heAirline(name) {
  if (!name) return '';
  if (AIRLINE_HE[name]) return AIRLINE_HE[name];
  if (/^el ?al/i.test(name) || /אל על/.test(name)) return 'אל על';
  if (/^israir/i.test(name)) return 'ישראייר';
  if (/^arkia/i.test(name)) return 'ארקיע';
  return name.replace(/\s+(Airlines?|Airways|Israel Airlines)$/i, '');
}

// ---------- small helpers ----------
function loadState() { return USER_ID ? store.loadState(USER_ID) : {}; }
function saveState(s) { if (USER_ID && !DRY) store.saveState(USER_ID, s); }
function isoDate(d) { return d.toISOString().slice(0, 10); }
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoDate(d); }
function dateRange(from, to) { const a = []; for (let d = from; d <= to; d = addDays(d, 1)) a.push(d); return a; }
function heDate(iso) { const d = new Date(iso + 'T00:00:00Z'); return `${DAYS_HE[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}`; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fmtUsd(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
let ILS_PER_USD = null; // today's rate, set in main()
function fmtIls(usd) { return ILS_PER_USD ? '₪' + Math.round(usd * ILS_PER_USD).toLocaleString('en-US') : ''; }
// "$1,000 (₪3,200)" for messages
function fmtBoth(usd) { const ils = fmtIls(usd); return ils ? `${fmtUsd(usd)} (${ils})` : fmtUsd(usd); }
function fmtLocal(o) {
  const sym = { ILS: '₪', EUR: '€', GBP: '£', USD: '$', AUD: 'AUD ' }[o.currency] || o.currency + ' ';
  return `${sym}${Math.round(o.price).toLocaleString('en-US')}`;
}

// Centers for "±3 days" searches that together cover from..to.
function searchCenters(from, to) {
  const centers = [];
  let c = addDays(from, 3);
  while (addDays(c, 3) < to) { centers.push(c); c = addDays(c, 7); }
  const last = addDays(to, -3);
  centers.push(last < addDays(from, 3) ? addDays(from, 3) : last);
  return [...new Set(centers)];
}

// A failed search (blocked page, timeout, network error) is tried once more after a short pause.
async function retryOnce(fn, waitMs = 8000) {
  try { return await fn(); } catch (e) { await sleep(waitMs); return fn(); }
}

// ---------- search log (public, no personal data) ----------
// logs/searches.csv: one row per search that failed, was blocked, or worked only on the second try.
// logs/runs.csv: one row per user run, with counts per source. No routes, dates, prices or names: the user is
// the random id, and error texts have links and dates removed. Read them with `node tools/logs.js` or /errors.
const SEARCH_LOG = [];
const scrub = (msg) => String(msg || '').split('\n')[0].replace(/https?:\/\/\S+/g, '<link>').replace(/\d{4}-\d{2}-\d{2}/g, '<date>').replace(/[",;\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
function logSearch(source, market, kind, status, attempts, sec, results, error) {
  SEARCH_LOG.push({ source, market, kind, status, attempts, sec, results, error: scrub(error) });
}
const blockedError = (why) => Object.assign(new Error(`blocked: ${why}`), { blocked: true });
// Runs one search and records the outcome. A failure is tried once more after a pause; a block is not
// (the site has decided we are a bot, and trying again would only hit the block again).
async function tracked(source, market, kind, fn, waitMs = 8000, count = (r) => (Array.isArray(r) ? r.length : 0)) {
  const t = Date.now();
  const done = (status, attempts, results, err) => logSearch(source, market, kind, status, attempts, Math.round((Date.now() - t) / 1000), results, err);
  let first;
  try { const r = await fn(); done('ok', 1, count(r)); return r; } catch (e) {
    if (e.blocked) { done('blocked', 1, 0, e.message); throw e; }
    first = e;
  }
  await sleep(waitMs);
  try { const r = await fn(); done('ok-after-retry', 2, count(r), first.message); return r; } catch (e) {
    done(e.blocked ? 'blocked' : 'failed', 2, 0, e.message); throw e;
  }
}
const csvCell = (v) => (/[,"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
function appendCsv(file, header, rows, keep = 5000) {
  if (!rows.length) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
  if (!lines.length || lines[0] !== header.join(',')) lines = [header.join(','), ...lines.filter((l) => l !== header.join(','))];
  lines.push(...rows.map((r) => r.map(csvCell).join(',')));
  if (lines.length > keep + 1) lines = [lines[0], ...lines.slice(lines.length - keep)];
  fs.writeFileSync(file, lines.join('\n') + '\n');
}
// Written at the end of every real run (not dry runs), and also when a run crashes.
function writeLogs(outcome, offersCount, startedMs) {
  if (DRY || !USER_ID) return;
  const at = new Date().toISOString().slice(0, 19) + 'Z'; const run = process.env.GITHUB_RUN_ID || 'local';
  const mode = process.env.TEST_ALERT === '1' ? 'test' : SUMMARY ? 'summary' : 'check';
  const dir = path.join(__dirname, 'logs');
  appendCsv(path.join(dir, 'searches.csv'), ['time_utc', 'run', 'user', 'mode', 'source', 'market', 'kind', 'status', 'attempts', 'seconds', 'results', 'error'],
    SEARCH_LOG.filter((x) => x.status !== 'ok' && x.status !== 'skipped').map((x) => [at, run, USER_ID, mode, x.source, x.market, x.kind, x.status, x.attempts, x.sec, x.results, x.error]));
  const n = (src, st) => SEARCH_LOG.filter((x) => x.source === src && (Array.isArray(st) ? st.includes(x.status) : x.status === st)).length;
  const per = (src) => [n(src, ['ok', 'ok-after-retry']), n(src, 'failed'), n(src, 'blocked'), n(src, 'skipped')];
  appendCsv(path.join(dir, 'runs.csv'), ['time_utc', 'run', 'user', 'mode', 'seconds', 'kayak_ok', 'kayak_failed', 'kayak_blocked', 'kayak_skipped',
    'kiwi_ok', 'kiwi_failed', 'kiwi_blocked', 'kiwi_skipped', 'google_ok', 'google_failed', 'google_blocked', 'google_skipped', 'valid_offers', 'outcome'],
  [[at, run, USER_ID, mode, Math.round((Date.now() - startedMs) / 1000), ...per('kayak'), ...per('kiwi'), ...per('google'), offersCount, scrub(outcome)]]);
}

// Run async jobs with a concurrency limit (keeps memory use on the runner low).
async function pool(items, limit, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// ---------- rules ----------
// One leg against the user's rules for that direction (unknown values pass; they are shown, not hidden).
function legOk(l, R) {
  if (!R || !l || !(l.date >= R.from && l.date <= R.to)) return false;
  if (l.stops != null && l.stops > R.maxStops) return false;
  if (R.maxHours && l.hours != null && l.hours > R.maxHours) return false;
  const dep = Number((l.time || '').slice(0, 2));
  if (l.time && dep >= 0 && (dep < R.depFrom || dep >= R.depTo)) return false;
  if (CONFIG.maxLayover && l.layover != null && l.layover > CONFIG.maxLayover) return false;
  if (R.airline && l.carriers && !l.carriers.every((c) => c === R.airline)) return false;
  return true;
}
const legOkOut = (l) => legOk(l, OUT);
const legOkRet = (l) => legOk(l, RET);
// Bags the user asked for: 'yes' (known to be included), 'no' (known to be missing) or 'unknown'.
// o.bags = [carry-on, checked] per passenger. Kayak with its bag filter prices the checked bags in (bagChecked).
// 'unknown' offers are shown and can alert, marked with "*"; 'no' offers are never shown.
function bagState(o) {
  const b = Array.isArray(o.bags) ? o.bags : [];
  const part = (want, idx) => {
    if (!want) return 'yes';
    if (idx === 1 && o.bagChecked === true) return 'yes';
    if (b.length === 2 || (idx === 0 && b.length === 1)) return b[idx] >= want ? 'yes' : (b[idx] === 0 && b.length === 2 ? 'no' : 'unknown');
    if (idx === 0 && o.bagChecked === true) return 'yes'; // fares with a checked bag include a carry-on
    return 'unknown';
  };
  const st = [part(CONFIG.checkedBags, 1), part(CONFIG.carryOn, 0)];
  return st.includes('no') ? 'no' : st.includes('unknown') ? 'unknown' : 'yes';
}
const bagOk = (o) => bagState(o) === 'yes';
const pairOk = (outDate, retDate) => !CONFIG.maxTripDays || retDate <= addDays(outDate, CONFIG.maxTripDays);
// Offers that may be shown and alerted: bags included, or not known (marked "*").
const bagReq = (o) => bagState(o) !== 'no';
const bagUnknown = (c) => c.offers.some((o) => bagState(o) === 'unknown');

// ---------- Kayak ----------
// Kayak's stops filter: "stops=0,1" = nonstop or 1 stop. ("stops=~1" means exactly 1 stop; checked 8.11.)
const upTo = (n) => Array.from({ length: Math.min(n, 2) + 1 }, (_, i) => i).join(',');
function kayakFs(kind) {
  const R = kind === 'ret' ? RET : OUT;
  // Round trips: up to the larger of the two stop limits; each leg is checked afterwards (legOk).
  const stops = kind === 'rt' ? Math.max(OUT.maxStops, RET.maxStops) : R.maxStops;
  const airlines = kind === 'rt' ? [...new Set([OUT.airline, RET.airline].filter(Boolean))] : [R.airline].filter(Boolean);
  return [stops >= 3 ? '' : `stops=${upTo(stops)}`, airlines.length ? `airlines=${airlines.join(',')}` : ''].filter(Boolean).join(';');
}
// Kayak path parts for passengers and cabin, e.g. /2adults/children-8-1L/business
function kayakPaxPath() {
  const { adults, children, infants } = CONFIG.pax;
  const kids = [...Array(children).fill('8'), ...Array(infants).fill('1L')];
  const cabin = { economy: '', premium: 'premium', business: 'business', first: 'first' }[CONFIG.cabin] || '';
  return [adults > 1 || kids.length ? `${adults}adults` : '', kids.length ? `children-${kids.join('-')}` : '', cabin].filter(Boolean).map((x) => '/' + x).join('');
}
function kayakUrl(host, kind, a, b, fsOverride) {
  const route = kind === 'ret' ? `${CONFIG.destination}-${CONFIG.origin}` : `${CONFIG.origin}-${CONFIG.destination}`;
  return `https://${host}/flights/${route}/${a}${b ? '/' + b : ''}${kayakPaxPath()}?sort=price_a&fs=${fsOverride || kayakFs(kind)}`;
}
function yearFor(month, day) {
  // Dates on the page have no year: pick the year that puts the date nearest the search window.
  const y0 = Number(OUT.from.slice(0, 4));
  const cands = [y0 - 1, y0, y0 + 1].map((y) => `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  const mid = new Date(OUT.from).getTime();
  return cands.sort((a, b) => Math.abs(new Date(a) - mid) - Math.abs(new Date(b) - mid))[0];
}
function parseHours(l) {
  let m = l.match(/^(\d+) שעות (\d+) דקות$/) || l.match(/^(\d+)h (\d+)m$/) || l.match(/^(\d+) Std\. (\d+) Min\.$/);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  m = l.match(/^(\d+):(\d+) Std\.$/);
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
}
function parseStops(l) {
  if (/^(ללא עצירה|direct|nonstop)$/i.test(l)) return 0;
  if (/^(עצירה 1|1 stop|1 Stopp)$/i.test(l)) return 1;
  const m = l.match(/^(\d+) (עצירות|stops|Stopps)$/i);
  return m ? Number(m[1]) : undefined;
}
// Each Kayak result card: one or two legs (date, times, stops, duration), airline, bag icons, price.
function parseKayakCards(text, currency) {
  const re = PRICE_RE[currency];
  const offers = [];
  for (const chunk of text.split(CARD_SPLIT_RE).slice(1)) {
    const lines = chunk.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 80);
    const legs = []; let leg = null; let price = null; const bags = []; let airline = '';
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const dm = l.match(DATE_LINE_RE);
      if (dm && price == null) { leg = { date: yearFor(Number(dm[2]), Number(dm[1])), time: '', stops: undefined, hours: null }; legs.push(leg); continue; }
      if (!leg) continue;
      if (price == null && /\d{1,2}:\d{2}\s?[–-]\s?\d{1,2}:\d{2}/.test(l) && !leg.time) { leg.time = l.replace(/\s+/g, ' '); continue; }
      const st = parseStops(l); if (st !== undefined && leg.stops === undefined) { leg.stops = st; continue; }
      const lay = l.match(/^עצירת ביניים של (\d+) שעות(?: (\d+) דקות)?/) || l.match(/^(\d+)h (\d+)m (?:layover|stopover)/i);
      if (lay) { const lh = Number(lay[1]) + Number(lay[2] || 0) / 60; leg.layover = Math.max(leg.layover || 0, lh); continue; }
      const h = parseHours(l); if (h != null && leg.hours == null) { leg.hours = h; airline = lines[i + 1] || ''; continue; }
      if (/^\d$/.test(l) && price == null) { bags.push(Number(l)); continue; }
      const p = l.match(re);
      if (p && price == null) { price = Number(currency === 'EUR' ? p[1].replace(/\./g, '') : p[1].replace(/,/g, '')); break; }
    }
    if (legs.length && price) offers.push({ legs, price, bags: bags.slice(0, 2), airline: /\d/.test(airline) ? '' : airline });
  }
  return offers;
}

// Every search opens a brand-new browser context (no cookies, cache or storage from any
// earlier search), and every GitHub Actions run starts on a fresh machine with a new browser.
async function kayakSearch(browser, market, task) {
  const ctx = await browser.newContext({
    locale: market.host.includes('.he.') ? 'he-IL' : market.host.endsWith('.au') ? 'en-AU' : 'en-GB',
    userAgent: UA, viewport: { width: 1366, height: 1000 },
  });
  try {
    const page = await ctx.newPage();
    // Kayak's fare assistant: with bfc=N the prices include N checked bags per passenger.
    const bagFs = market.bagFilter && CONFIG.checkedBags ? `bfc=${CONFIG.checkedBags}` : '';
    const fsWithBag = [task.fs || kayakFs(task.kind), bagFs].filter(Boolean).join(';');
    const url = kayakUrl(market.host, task.kind, `${task.a}-flexible-3days`, task.b && `${task.b}-flexible-3days`, fsWithBag);
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (resp && resp.status() >= 400) throw new Error(`HTTP ${resp.status()}`);
    const isCheck = () => /\/security\/check|\/help\/bots/.test(page.url()); // Kayak's "are you a real user" pages
    let cards = [];
    for (let k = 0; k < 16; k++) {
      await page.waitForTimeout(5000);
      const text = await page.evaluate(() => (document.body ? document.body.innerText : ''));
      if (isCheck()) throw blockedError('Kayak security check');
      if (/robot|captcha|human side|unusual traffic|תעבורה חריגה|Security Check/i.test(text.slice(0, 2000))) throw blockedError('bot check');
      cards = parseKayakCards(text, market.currency);
      if (cards.length && !/\d+\s?%/.test(text.slice(0, 4000)) && k >= 2) break;
    }
    if (!cards.length) throw new Error('no results parsed');
    const linkHost = market.linkHost || market.host;
    return cards.map((c) => ({
      kind: task.kind, legs: c.legs.map((l) => ({ ...l, airline: heAirline(c.airline) || (task.kind === 'ret' ? '' : heAirline(OUT.airline)) })), price: c.price, currency: market.currency, bags: c.bags,
      source: (task.labelPrefix || '') + (market.label || market.host), algo: task.algo, method: task.method,
      airlines: task.kind === 'ret' ? [c.airline] : [outAirlineHe() || c.airline],
      url: kayakUrl(linkHost, task.kind, c.legs[0].date, task.kind === 'rt' && c.legs[1] ? c.legs[1].date : null, fsWithBag),
      bagChecked: bagFs ? true : null, // with the bag filter Kayak prices include the checked bags
    }));
  } finally { await ctx.close(); }
}

// Pick n items spread evenly over the list, shifted by `turn` so later runs cover the others.
function rotate(list, n, turn) {
  if (list.length <= n) return list;
  const out = []; const step = list.length / n;
  for (let i = 0; i < n; i++) out.push(list[(Math.floor(i * step) + turn) % list.length]);
  return [...new Set(out)];
}
function kayakTasks(turn) {
  const max = CONFIG.kayakMaxTasks || 24;
  const outC = searchCenters(OUT.from, OUT.to);
  if (!RET) return rotate(outC, max, turn).map((a) => ({ kind: 'out', a }));
  const retC = searchCenters(RET.from, RET.to);
  // Round trips: only center pairs where at least one date combination is allowed.
  const pairs = [];
  for (const a of outC) for (const b of retC) if (pairOk(addDays(a, 3), addDays(b, -3))) pairs.push({ kind: 'rt', a, b });
  const oneWays = Math.max(2, Math.floor(max / 4));
  return [
    ...rotate(outC, oneWays, turn).map((a) => ({ kind: 'out', a })),
    ...rotate(retC, oneWays, turn).map((a) => ({ kind: 'ret', a })),
    ...rotate(pairs, max - 2 * oneWays, turn),
  ];
}

// ---------- Kiwi.com public MCP server (free, no key): https://mcp.kiwi.com ----------
async function kiwiCall(argsObj) {
  const res = await fetch('https://mcp.kiwi.com', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search-flight', arguments: argsObj } }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.text();
  const dataLines = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5));
  const msg = JSON.parse(dataLines.length ? dataLines[dataLines.length - 1] : raw);
  if (msg.error || msg.result?.isError) throw new Error('tool error');
  return msg.result.structuredContent || JSON.parse(msg.result.content[0].text);
}
function kiwiLeg(l) {
  return {
    date: l.departureTime.slice(0, 10),
    time: `${l.departureTime.slice(11, 16)} – ${l.arrivalTime.slice(11, 16)}${l.arrivalTime.slice(0, 10) > l.departureTime.slice(0, 10) ? '+1' : ''}`,
    stops: l.stops, hours: l.durationSeconds / 3600, carriers: [...new Set(l.segments.map((s) => s.carrier))],
    names: [...new Set(l.segments.map((s) => s.carrierName || s.carrier))],
    airline: [...new Set(l.segments.map((s) => heAirline(s.carrierName || s.carrier)))].join(' + '),
  };
}
// Departure-hour window of the user's outbound airline on this route, from the one-way results
// (used to pin Kiwi round trips to that airline's outbound, since Kiwi can't filter per direction).
function slotFrom(results) {
  const hours = results.filter((o) => o.kind === 'out').map((o) => Number((o.legs[0].time || '').slice(0, 2))).filter((h) => h >= 0 && h <= 23);
  if (!hours.length) return null;
  return [Math.max(0, Math.min(...hours) - 1), Math.min(23, Math.max(...hours) + 1)];
}
const dmy = (iso) => iso.split('-').reverse().join('/');
function kiwiCommon() {
  const { adults, children, infants } = CONFIG.pax;
  return {
    adults, children, infants, cabinClass: { economy: 'M', premium: 'W', business: 'C', first: 'F' }[CONFIG.cabin] || 'M',
    currency: 'USD', locale: 'en', sort: 'price', allow_self_transfer: CONFIG.selfTransfer,
    adults_hold_bags: Array(adults).fill(CONFIG.checkedBags), adults_hand_bags: Array(adults).fill(CONFIG.carryOn),
    ...(children ? { children_hold_bags: Array(children).fill(CONFIG.checkedBags), children_hand_bags: Array(children).fill(CONFIG.carryOn) } : {}),
    ...(CONFIG.maxLayover ? { stopover_to: CONFIG.maxLayover } : {}),
  };
}
// Kiwi's departure-hour filters for one direction ("dtime" outbound, "ret_dtime" return).
function kiwiTimes(R, prefix) {
  if (R.depFrom === 0 && R.depTo === 24) return {};
  return { [`${prefix}dtime_from`]: R.depFrom, [`${prefix}dtime_to`]: Math.max(R.depFrom, R.depTo - 1) };
}
function kiwiPush(results, sc, kind, extra) {
  for (const it of sc.itineraries || []) {
    const legs = [kiwiLeg(it.outbound), ...(it.inbound ? [kiwiLeg(it.inbound)] : [])];
    if (kind === 'rt' && legs.length < 2) continue;
    results.push({
      kind, legs, price: it.price / PAX, currency: sc.currency || 'USD', source: 'kiwi.com', url: it.bookingUrl, // price per passenger
      bags: it.baggage ? [it.baggage.cabinBag / BAG_PAX, it.baggage.checkedBag / BAG_PAX] : [],
      airlines: kind === 'ret' ? legs[0].names : [outAirlineHe() || legs[0].airline], ...(extra || {}),
    });
  }
}
async function searchKiwi() {
  const results = []; const errors = [];
  const call = (kind, a, extra) => tracked('kiwi', 'mcp.kiwi.com', kind, () => kiwiCall({ ...kiwiCommon(), ...a }), 5000, (sc) => (sc.itineraries || []).length)
    .then((sc) => kiwiPush(results, sc, kind, extra))
    .catch((e) => errors.push(`kiwi.com ${kind}: ${e.message}`));
  const outArgs = { flyFrom: CONFIG.origin, flyTo: CONFIG.destination, departureDate: dmy(OUT.from), departureDateTo: dmy(OUT.to),
    max_sector_stopovers: OUT.maxStops, ...(OUT.maxHours ? { max_fly_duration: OUT.maxHours } : {}), ...kiwiTimes(OUT, ''),
    ...(OUT.airline ? { select_airlines: OUT.airline } : {}) };
  await call('out', outArgs);
  if (!RET) return { results, errors, slot: null };
  const maxH = Math.max(OUT.maxHours || 0, RET.maxHours || 0);
  const rtBase = { flyFrom: CONFIG.origin, flyTo: CONFIG.destination, departureDate: dmy(OUT.from), departureDateTo: dmy(OUT.to),
    returnDate: dmy(RET.from), returnDateTo: dmy(RET.to), max_sector_stopovers: Math.max(OUT.maxStops, RET.maxStops),
    ...(OUT.maxHours && RET.maxHours ? { max_fly_duration: maxH } : {}), ...kiwiTimes(OUT, ''), ...kiwiTimes(RET, 'ret_') };
  const slot = OUT.airline && !RET.airline ? slotFrom(results) : null;
  const airlines = [...new Set([OUT.airline, RET.airline].filter(Boolean))];
  const jobs = [
    call('ret', { flyFrom: CONFIG.destination, flyTo: CONFIG.origin, departureDate: dmy(RET.from), departureDateTo: dmy(RET.to),
      max_sector_stopovers: RET.maxStops, ...(RET.maxHours ? { max_fly_duration: RET.maxHours } : {}), ...kiwiTimes(RET, ''),
      ...(RET.airline ? { select_airlines: RET.airline } : {}) }),
    // Round trip on the chosen airline(s), or any airline when none was chosen.
    call('rt', { ...rtBase, ...(airlines.length ? { select_airlines: airlines.join(',') } : {}) }),
  ];
  // One ticket with the return on any airline: pin the outbound to its airline's departure hours (learned 6.11),
  // within the user's own departure window.
  if (slot) {
    const from = Math.max(slot[0], OUT.depFrom); const to = Math.min(slot[1], OUT.depTo - 1);
    if (from <= to) jobs.push(call('rt', { ...rtBase, dtime_from: from, dtime_to: to }));
  }
  await Promise.all(jobs);
  return { results, errors, slot };
}

// ---------- Google Flights (browser, once a day, every user) ----------
// The search link carries the user's filters in Google's "tfs" parameter (a small protobuf): the route, the
// date(s), passengers, cabin, and for every leg the stop limit and the airline. Each result has an accessibility
// label with the price, airline, stops, times, duration and layovers ("From 496 US dollars. 1 stop flight with ...").
const pbVarint = (n) => { const b = []; do { let x = n & 0x7f; n = Math.floor(n / 128); if (n) x |= 0x80; b.push(x); } while (n); return b; };
const pbKey = (f, wire) => pbVarint((f << 3) | wire);
const pbStr = (f, s) => { const d = [...Buffer.from(s, 'utf8')]; return [...pbKey(f, 2), ...pbVarint(d.length), ...d]; };
const pbMsg = (f, bytes) => [...pbKey(f, 2), ...pbVarint(bytes.length), ...bytes];
const pbInt = (f, n) => [...pbKey(f, 0), ...pbVarint(n)];
// legs: [{ date, from, to, maxStops, airline }]; trip: 1 = round trip, 2 = one way.
function googleTfs(legs, trip) {
  const out = [];
  for (const l of legs) {
    const fd = [...pbStr(2, l.date)];
    if (l.maxStops != null && l.maxStops < 3) fd.push(...pbInt(5, l.maxStops));
    if (l.airline) fd.push(...pbStr(6, l.airline));
    fd.push(...pbMsg(13, pbStr(2, l.from)), ...pbMsg(14, pbStr(2, l.to)));
    out.push(...pbMsg(3, fd));
  }
  const { adults, children, infants } = CONFIG.pax;
  for (let i = 0; i < adults; i++) out.push(...pbInt(8, 1));
  for (let i = 0; i < children; i++) out.push(...pbInt(8, 2));
  for (let i = 0; i < infants; i++) out.push(...pbInt(8, 4)); // infant on lap
  out.push(...pbInt(9, { economy: 1, premium: 2, business: 3, first: 4 }[CONFIG.cabin] || 1), ...pbInt(19, trip));
  return Buffer.from(out).toString('base64');
}
function googleUrl(task, gl) {
  const leg = (R, date, from, to) => ({ date, from, to, maxStops: R.maxStops, airline: R.airline });
  const legs = task.kind === 'ret' ? [leg(RET, task.a, CONFIG.destination, CONFIG.origin)]
    : [leg(OUT, task.a, CONFIG.origin, CONFIG.destination), ...(task.kind === 'rt' ? [leg(RET, task.b, CONFIG.destination, CONFIG.origin)] : [])];
  return `https://www.google.com/travel/flights/search?tfs=${encodeURIComponent(googleTfs(legs, task.kind === 'rt' ? 1 : 2))}&curr=USD&hl=en&gl=${gl}`;
}
const MONTH_N = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
function to24(h, m, ap) { let x = Number(h) % 12; if (/pm/i.test(ap)) x += 12; return `${String(x).padStart(2, '0')}:${m}`; }
// One result label -> { price, rt, leg } (leg in the same shape as Kayak/Kiwi legs); null if it is not a result.
function parseGoogleLabel(label, date) {
  const pm = label.match(/^From ([\d,]+) US dollars( round trip total)?\./);
  if (!pm) return null;
  const st = label.match(/(Nonstop|(\d+) stops?) flight with (.+?)\./);
  const tm = label.match(/Leaves .+? at (\d{1,2}):(\d{2})\s?([AP]M) on \w+, (\w+) (\d+) and arrives at .+? at (\d{1,2}):(\d{2})\s?([AP]M) on \w+, (\w+) (\d+)/);
  const dur = label.match(/Total duration (\d+) hr(?: (\d+) min)?/);
  const lays = [...label.matchAll(/is a (?:(\d+) hr)?\s?(?:(\d+) min)? (?:overnight )?layover/g)].map((m) => Number(m[1] || 0) + Number(m[2] || 0) / 60);
  let time = '';
  if (tm) {
    const days = (mo, d) => Date.UTC(2000, MONTH_N[mo.toLowerCase()] - 1, Number(d));
    let diff = Math.round((days(tm[9], tm[10]) - days(tm[4], tm[5])) / 864e5); if (diff < 0) diff += 366; // across New Year
    time = `${to24(tm[1], tm[2], tm[3])} – ${to24(tm[6], tm[7], tm[8])}${diff > 0 ? '+' + diff : ''}`;
  }
  const names = st ? st[3].split(/,\s*|\s+and\s+/).map((s) => s.replace(/^Operated by .*/i, '').trim()).filter(Boolean) : [];
  return {
    price: Number(pm[1].replace(/,/g, '')), rt: !!pm[2],
    leg: { date, time, stops: st ? (st[1] === 'Nonstop' ? 0 : Number(st[2])) : undefined, hours: dur ? Number(dur[1]) + Number(dur[2] || 0) / 60 : null,
      ...(lays.length ? { layover: Math.max(...lays) } : {}), airline: [...new Set(names.map(heAirline))].join(' + ') },
  };
}
// Which searches today: one-way legs on dates spread over the range, or outbound/return date pairs for round trips.
// The spread moves every day (turn), so over several days every date gets a look.
function googleTasks(turn) {
  const max = CONFIG.googleMaxSearches || 10;
  const outD = dateRange(OUT.from, OUT.to);
  if (!RET) return rotate(outD, max, turn).map((a) => ({ kind: 'out', a }));
  const pairs = [];
  for (const a of rotate(outD, 4, turn)) for (const b of rotate(dateRange(RET.from, RET.to), 4, turn + 1)) if (b > a && pairOk(a, b)) pairs.push({ kind: 'rt', a, b });
  return rotate(pairs, max, turn);
}
async function googleSearch(browser, gm, task) {
  const ctx = await browser.newContext({ locale: 'en-US', userAgent: UA, viewport: { width: 1366, height: 1000 } });
  try {
    const page = await ctx.newPage();
    const url = googleUrl(task, gm.gl);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => /US dollars/.test([...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label')).join(' '))
      || /unusual traffic|No results|no flights/i.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const text = await page.evaluate(() => document.body.innerText);
    if (/unusual traffic/i.test(text)) throw blockedError('Google unusual traffic');
    const labels = await page.$$eval('[aria-label]', (els) => [...new Set(els.map((e) => e.getAttribute('aria-label')).filter((a) => /^From [\d,]+ US dollars/.test(a)))]);
    if (!labels.length) {
      if (/No results|no flights|0 results/i.test(text)) return [];
      throw new Error('no results parsed');
    }
    const forN = text.match(/fees for (\d+) (?:adults?|passengers?)/i); // Google prices are for all passengers
    const n = forN ? Number(forN[1]) : 1;
    return labels.slice(0, 20).map((l) => parseGoogleLabel(l, task.a)).filter(Boolean).map((g) => {
      const legs = task.kind === 'rt'
        ? [g.leg, { date: task.b, time: '', stops: undefined, hours: null, airline: 'פרטים בקישור' }] // Google lists the outbound with the round-trip total
        : [g.leg];
      return { kind: task.kind, legs, price: g.price / n, currency: 'USD', source: gm.label, bags: [], airlines: [g.leg.airline], url };
    });
  } finally { await ctx.close(); }
}
async function searchGoogle(browser, gm, tasks) {
  const results = []; const errors = [];
  let failedInARow = 0;
  for (const t of tasks) {
    if (failedInARow >= 2) { errors.push(`${gm.label}: stopped after 2 failed searches in a row`); break; }
    try { results.push(...await tracked('google', `google ${gm.gl}`, t.kind, () => googleSearch(browser, gm, t), 10000)); failedInARow = 0; } catch (e) {
      if (e.blocked) { errors.push(`${gm.label}: blocked`); break; }
      failedInARow++; errors.push(`${gm.label} ${t.kind} ${t.a}: ${e.message.split('\n')[0].slice(0, 120)}`);
    }
    await sleep(2500);
  }
  return { results, errors };
}

// ---------- Duffel API (the airline's own fares, outbound one-way; bot owner only). Needs DUFFEL_TOKEN. ----------
// Duffel bills searches beyond 1,500 a month with no bookings, so this runs at most every
// CONFIG.duffelEveryHours hours: 15 dates x 3 a day x 30 days = ~1,350 searches a month.
async function searchDuffel(dates) {
  const token = (process.env.DUFFEL_TOKEN || '').trim();
  const results = []; const errors = [];
  for (const d of dates) {
    try {
      const res = await fetch('https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=20000', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'duffel-version': 'v2', 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ data: {
          slices: [{ origin: CONFIG.origin, destination: CONFIG.destination, departure_date: d }],
          passengers: [{ type: 'adult' }], cabin_class: 'economy', max_connections: OUT.maxStops,
        } }),
        signal: AbortSignal.timeout(45000),
      });
      const j = await res.json();
      if (!res.ok) { errors.push(`duffel ${d}: HTTP ${res.status} ${(j.errors && j.errors[0] && j.errors[0].title) || ''}`.trim()); if (res.status === 401 || res.status === 403) break; continue; }
      const offers = (j.data.offers || []).filter((o) => o.slices[0].segments.every((sg) => (sg.marketing_carrier || {}).iata_code === OUT.airline || (sg.operating_carrier || {}).iata_code === OUT.airline));
      const bagsOf = (o) => o.slices[0].segments[0].passengers?.[0]?.baggages || [];
      const withBag = offers.filter((o) => bagsOf(o).some((b) => b.type === 'checked' && b.quantity > 0));
      const pick = (withBag.length ? withBag : offers).sort((a, b) => Number(a.total_amount) - Number(b.total_amount))[0];
      if (!pick) continue;
      const sg = pick.slices[0].segments[0];
      const n = (t) => bagsOf(pick).filter((b) => b.type === t).reduce((x, b) => x + b.quantity, 0);
      results.push({
        kind: 'out', legs: [{ date: d, time: `${sg.departing_at.slice(11, 16)} – ${sg.arriving_at.slice(11, 16)}`, stops: 0, hours: null, airline: outAirlineHe() }],
        price: Number(pick.total_amount), currency: pick.total_currency, source: 'duffel',
        bags: bagsOf(pick).length ? [n('carry_on'), n('checked')] : [], fare: pick.slices[0].fare_brand_name || '',
        airlines: [outAirlineHe()], url: null,
      });
    } catch (e) { errors.push(`duffel ${d}: ${e.message.slice(0, 80)}`); }
  }
  return { results, errors };
}

// ---------- Telegram ----------
async function telegram(text) {
  if (DRY) { console.log('--- TELEGRAM (dry run) ---\n' + text + '\n---'); return; }
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = USER.chatId;
  if (!token || !chatId) throw new Error('bot token or chat id missing');
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`Telegram send failed: HTTP ${res.status}`); // never log the token or URL
}

// ---------- formatting ----------
function hoursText(h) { return h ? `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')} ש׳` : ''; }
function stopsText(n) { return n === 0 ? 'ישיר' : n === 1 ? 'עצירה אחת' : n != null ? `${n} עצירות` : ''; }
function link(o, label) { return o.url ? `<a href="${o.url}">${label}</a>` : label; }
function cleanTime(t) { return (t || '').replace(/\s?[–-]\s?/, '–').replace(/\s+/g, ' ').trim(); }
// One leg on one line: who · when · times · stops · flight time [· price]
function legLine(icon, label, l, priceText) {
  return `${icon} <b>${label}</b> ${[l.airline || '?', heDate(l.date), cleanTime(l.time), stopsText(l.stops), hoursText(l.hours), priceText].filter(Boolean).join(' · ')}`;
}
function bagsLine(offers) {
  if (!CONFIG.checkedBags && !CONFIG.carryOn) return '🧳 בלי כבודה';
  const want = [CONFIG.carryOn ? 'תיק עלייה' : '', CONFIG.checkedBags ? (CONFIG.checkedBags === 1 ? 'מזוודה' : `${CONFIG.checkedBags} מזוודות`) : ''].filter(Boolean).join(' + ');
  return offers.every(bagOk) ? `🧳 ${want} כלולים${PAX > 1 ? ' (לנוסע)' : ''}` : `🧳 * לא ידוע אם ${want} כלולים, לבדוק בהזמנה`;
}
// Price with "*" when it is not known whether the bags are included.
const priceTag = (c) => `<b>${fmtBoth(c.usd)}${bagUnknown(c) ? '*' : ''}</b>`;
const NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
// Pick up to n options with different prices; note the other date pairs that share each price.
function pickDistinct(list, n) {
  const groups = [];
  for (const c of list) {
    const g = groups.find((x) => x.kind === c.kind && Math.round(x.usd) === Math.round(c.usd));
    if (g) g.alsoDates.push(c); else if (groups.length < n) groups.push({ ...c, alsoDates: [] });
  }
  return groups;
}
// Trip type, used to show varied options rather than the same trip at different dates.
function tripType(c) {
  if (c.kind === 'mixed') return 'שני כרטיסים';
  if (c.kind === 'ow') return c.offers[0].legs[0].stops === 0 ? 'כיוון אחד, ישיר' : 'כיוון אחד';
  const o = c.offers[0].legs[0] || {}; const r = c.offers[0].legs[1] || {};
  const name = (o.airline || '').split(' + ')[0];
  const sameBack = name && (r.airline || '').includes(name);
  const out = o.stops === 0 ? 'ישיר' : 'עם עצירה';
  if (r.stops === undefined && !r.time) return `${name || 'הלוך-חזור'}, הלוך ${out}`; // Google: return details in the link
  if (r.stops === 0) return sameBack ? `${name} ${out === 'ישיר' ? 'ישיר הלוך וחזור' : 'הלוך-חזור'}` : 'חזור ישיר בחברה אחרת';
  return sameBack ? `${name}, חזור עם עצירה` : 'חזור עם עצירה בחברה אחרת';
}
// The cheapest option of every trip type first, then other cheap options on different dates.
function pickDiverse(list, n) {
  const groups = pickDistinct(list, 200);
  const chosen = []; const types = new Set(); const outDates = new Set();
  for (const g of groups) if (chosen.length < n && !types.has(tripType(g))) { chosen.push(g); types.add(tripType(g)); outDates.add(g.out); }
  for (const g of groups) if (chosen.length < n && !chosen.includes(g) && !outDates.has(g.out)) { chosen.push(g); outDates.add(g.out); }
  for (const g of groups) if (chosen.length < n && !chosen.includes(g)) chosen.push(g);
  return chosen.sort((a, b) => a.usd - b.usd);
}
function alsoText(c) {
  if (!c.alsoDates || !c.alsoDates.length) return '';
  const uniq = [...new Map(c.alsoDates.filter((x) => `${x.out}>${x.ret || ''}` !== `${c.out}>${c.ret || ''}`).map((x) => [`${x.out}>${x.ret || ''}`, x])).values()];
  if (!uniq.length) return '';
  c = { ...c, alsoDates: uniq };
  const dd = (iso) => `${Number(iso.slice(8))}.${Number(iso.slice(5, 7))}`;
  const ds = c.alsoDates.slice(0, 5).map((x) => (x.ret ? `${dd(x.out)}→${dd(x.ret)}` : dd(x.out)));
  return `\n📅 אותו מחיר גם: ${ds.join(', ')}${c.alsoDates.length > 5 ? ` ועוד ${c.alsoDates.length - 5}` : ''}`;
}
// Low-cost airlines: also a link to the airline's own site (often the same fare or cheaper, without agency fees).
// Wizz Air and Ryanair open with the route, dates and passengers filled in (checked 13.11.2026); the other sites
// block automated checks, so they get their home page rather than an untested search link.
const LOW_COST = [
  [/wizz/i, 'Wizz Air', (o, d, a, b, p) => `https://wizzair.com/en-gb/booking/select-flight/${o}/${d}/${a}/${b || 'null'}/${p.adults}/${p.children}/${p.infants}/null`],
  [/ryanair/i, 'Ryanair', (o, d, a, b, p) => `https://www.ryanair.com/gb/en/trip/flights/select?adults=${p.adults}&teens=0&children=${p.children}&infants=${p.infants}&dateOut=${a}&dateIn=${b || ''}&isConnectedFlight=false&isReturn=${!!b}&discount=0&originIata=${o}&destinationIata=${d}`],
  [/easy ?jet/i, 'easyJet', 'https://www.easyjet.com/en'], [/pegasus/i, 'Pegasus', 'https://www.flypgs.com/en'],
  [/air ?asia/i, 'AirAsia', 'https://www.airasia.com'], [/blue ?bird/i, 'Blue Bird', 'https://www.bluebirdair.com'],
  [/smartwings/i, 'Smartwings', 'https://www.smartwings.com'], [/vueling/i, 'Vueling', 'https://www.vueling.com'],
  [/transavia/i, 'Transavia', 'https://www.transavia.com'], [/jet2/i, 'Jet2', 'https://www.jet2.com'],
  [/scoot/i, 'Scoot', 'https://www.flyscoot.com'], [/indigo/i, 'IndiGo', 'https://www.goindigo.in'],
  [/air ?arabia/i, 'Air Arabia', 'https://www.airarabia.com'], [/fly ?dubai/i, 'flydubai', 'https://www.flydubai.com'],
  [/vietjet/i, 'VietJet', 'https://www.vietjetair.com'], [/nok ?air/i, 'Nok Air', 'https://www.nokair.com'],
  [/thai lion|lion ?air/i, 'Thai Lion Air', 'https://www.lionairthai.com'],
];
// Links for the low-cost airlines of a trip: one round-trip link when both legs are on the same airline,
// otherwise one link per leg. Only legs flown by a single airline (a mix of airlines can't be booked there).
function lowCostLinks(c) {
  const legs = c.kind === 'mixed' ? [c.offers[0].legs[0], c.offers[1].legs[0]] : c.offers[0].legs;
  const lcc = (l) => (l && l.airline && !/[+,]/.test(l.airline) ? LOW_COST.find(([re]) => re.test(l.airline)) : null);
  const mk = ([, name, u], o, d, a, b) => `<a href="${typeof u === 'function' ? u(o, d, a, b, CONFIG.pax) : u}">${name}</a>`;
  const out = lcc(legs[0]); const back = legs[1] && lcc(legs[1]);
  const links = [];
  if (out && back && out === back) links.push(mk(out, CONFIG.origin, CONFIG.destination, legs[0].date, legs[1].date));
  else {
    if (out) links.push(mk(out, CONFIG.origin, CONFIG.destination, legs[0].date, null));
    if (back) links.push(mk(back, CONFIG.destination, CONFIG.origin, legs[1].date, null));
  }
  return links.length ? `\n🔗 גם באתר החברה: ${[...new Set(links)].join(' · ')}` : '';
}
function candText(c, i) {
  if (c.kind === 'ow') {
    const o = c.offers[0];
    return [
      `${NUM[i] || i + 1 + ')'} ${priceTag(c)} · ${tripType(c)} · ${link(o, 'להזמנה ב-' + o.source)}`,
      legLine('🛫', 'הלוך', o.legs[0]),
      bagsLine([o]),
    ].join('\n') + lowCostLinks(c) + alsoText(c);
  }
  if (c.kind === 'rt') {
    const o = c.offers[0];
    return [
      `${NUM[i] || i + 1 + ')'} ${priceTag(c)} · ${tripType(c)} · ${link(o, 'להזמנה ב-' + o.source)}`,
      legLine('🛫', 'הלוך', o.legs[0]),
      legLine('🛬', 'חזור', o.legs[1]),
      bagsLine([o]),
    ].join('\n') + lowCostLinks(c) + alsoText(c);
  }
  const [o, r] = c.offers;
  return [
    `${NUM[i] || i + 1 + ')'} ${priceTag(c)} · 2 כרטיסים נפרדים`,
    legLine('🛫', 'הלוך', o.legs[0], `${link(o, fmtBoth(o.usd))} · ${o.source}`),
    legLine('🛬', 'חזור', r.legs[0], `${link(r, fmtBoth(r.usd))} · ${r.source}`),
    bagsLine([o, r]),
  ].join('\n') + lowCostLinks(c) + alsoText(c);
}

// ---------- main ----------
async function getRates() {
  const res = await fetch('https://open.er-api.com/v6/latest/USD');
  if (!res.ok) throw new Error(`rates HTTP ${res.status}`);
  const j = await res.json();
  const keep = new Set(['USD', 'EUR', 'GBP', ...CONFIG.markets.map((m) => m.currency)]);
  return { at: j.time_last_update_utc, rates: Object.fromEntries(Object.entries(j.rates).filter(([k]) => keep.has(k))) };
}

const STARTED = Date.now();
async function main() {
  const state = loadState();
  const now = new Date();
  let rates;
  try { rates = await getRates(); state.rates = rates; } catch (e) {
    if (!state.rates) throw e;
    rates = state.rates;
    console.log(`rates fetch failed (${e.message}); using saved rates`);
  }
  ILS_PER_USD = rates.rates.ILS || null;

  const browser = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  const t0 = Date.now();
  const timed = (name, pr) => pr.then((r) => { console.log(`[${name}] ${r.results.length} results, ${r.errors.length} errors, ${Math.round((Date.now() - t0) / 1000)}s`); return r; });

  // Kayak: every market x every task, a few pages at a time.
  // Wide date ranges: each run checks a different slice of the Kayak windows (Kiwi always covers everything).
  state.kayakTurn = (state.kayakTurn || 0) + 1;
  const tasks = kayakTasks(state.kayakTurn);
  console.log(`kayak tasks per market: ${tasks.length}`);
  const kayakJob = (async () => {
    const jobs = CONFIG.markets.flatMap((m) => tasks.map((t) => ({ m, t })));
    const blockedHosts = new Set(); // after a block, the rest of that site's searches in this run are skipped
    const res = await pool(jobs, CONFIG.concurrency || 6, async ({ m, t }) => {
      if (blockedHosts.has(m.host)) { logSearch('kayak', m.host, t.kind, 'skipped', 0, 0, 0, 'site blocked earlier in this run'); return { results: [], errors: [] }; }
      try { return { results: await tracked('kayak', m.host, t.kind, () => kayakSearch(browser, m, t)), errors: [] }; } catch (e) {
        if (e.blocked) blockedHosts.add(m.host);
        return { results: [], errors: [`${m.label || m.host} ${t.kind}: ${e.message.split('\n')[0].slice(0, 80)}`] };
      }
    });
    return { results: res.flatMap((r) => r.results), errors: res.flatMap((r) => r.errors) };
  })();
  const kiwiJob = CONFIG.kiwi === false ? Promise.resolve({ results: [], errors: [], slot: null }) : searchKiwi();
  const outDates = dateRange(OUT.from, OUT.to);
  // Google Flights once a day (with the daily summary), for every user, with the user's own filters.
  const googleOn = SUMMARY && CONFIG.googleDaily !== false;
  const googleJob = googleOn
    ? (async () => {
      const out = { results: [], errors: [] }; const gTasks = googleTasks(state.kayakTurn);
      for (const gm of CONFIG.googleMarkets || []) { const r = await searchGoogle(browser, gm, gTasks); out.results.push(...r.results); out.errors.push(...r.errors); }
      return out;
    })()
    : Promise.resolve({ results: [], errors: [] });
  const duffelDue = OWNER && SIMPLE_PAX && !!OUT.airline && OUT.maxStops === 0 && !!(process.env.DUFFEL_TOKEN || '').trim()
    && (!state.lastDuffelAt || (now - new Date(state.lastDuffelAt)) / 36e5 >= (CONFIG.duffelEveryHours || 8) - 0.5);
  if (duffelDue) state.lastDuffelAt = now.toISOString();
  const duffelJob = duffelDue ? searchDuffel(outDates) : Promise.resolve({ results: [], errors: [] });

  const parts = await Promise.all([timed('kayak', kayakJob), timed('kiwi', kiwiJob), timed('google', googleJob), timed('duffel', duffelJob)]);
  await browser.close();

  const errors = parts.flatMap((p) => p.errors);
  const valid = (list) => list
    .map((o) => ({ ...o, usd: o.price / (rates.rates[o.currency] || NaN) }))
    .filter((o) => Number.isFinite(o.usd))
    .filter((o) => (o.kind === 'out' ? legOkOut(o.legs[0])
      : o.kind === 'ret' ? legOkRet(o.legs[0])
        : o.legs.length === 2 && legOkOut(o.legs[0]) && legOkRet(o.legs[1]) && pairOk(o.legs[0].date, o.legs[1].date)));
  const offers = valid(parts.flatMap((p) => p.results));

  // Cheapest one-way per date (kept apart by bag status), then all allowed combinations.
  const cheapestBy = (kind, state) => {
    const m = new Map();
    for (const o of offers.filter((x) => x.kind === kind && bagState(x) === state)) if (!m.has(o.legs[0].date) || o.usd < m.get(o.legs[0].date).usd) m.set(o.legs[0].date, o);
    return m;
  };
  const cands = [];
  if (!RET) {
    for (const wb of ['yes', 'unknown']) for (const [od, o] of cheapestBy('out', wb)) cands.push({ kind: 'ow', out: od, ret: null, usd: o.usd, offers: [o] });
  } else {
    for (const o of offers.filter((x) => x.kind === 'rt')) cands.push({ kind: 'rt', out: o.legs[0].date, ret: o.legs[1].date, usd: o.usd, offers: [o] });
    // Every pairing of bag states, so a with-bag outbound can combine with an unknown-bag return and so on.
    for (const so of ['yes', 'unknown']) for (const sr of ['yes', 'unknown']) {
      const outBy = cheapestBy('out', so); const retBy = cheapestBy('ret', sr);
      for (const [od, o] of outBy) for (const [rd, r] of retBy) if (pairOk(od, rd)) cands.push({ kind: 'mixed', out: od, ret: rd, usd: o.usd + r.usd, offers: [o, r] });
    }
  }
  cands.sort((a, b) => a.usd - b.usd);
  // One line per (kind, dates, bag known): a cheaper no-bag price must not hide the with-bag price of the same trip.
  const seen = new Set();
  const top = cands.filter((c) => { const k = `${c.kind}|${c.out}|${c.ret}|${c.offers.map(bagState).join(',')}`; if (seen.has(k)) return false; seen.add(k); return true; });
  if (process.env.DUMP_OFFERS) fs.writeFileSync(process.env.DUMP_OFFERS, JSON.stringify({ at: now.toISOString(), ils: ILS_PER_USD, offers }, null, 0));
  const best = top[0];
  const bestBag = top.find((c) => c.offers.every(bagReq)); // cheapest that meets the bag rule

  vlog(errors.map((e) => 'WARN ' + e).join('\n'));
  // Public logs: error kinds and counts only, with links (route, dates) removed.
  const errKinds = new Map();
  for (const e of errors) { const k = e.replace(/https?:\/\/\S+/g, '<link>').replace(/\d{4}-\d{2}-\d{2}/g, '<date>').slice(0, 140); errKinds.set(k, (errKinds.get(k) || 0) + 1); }
  for (const [k, n] of errKinds) console.log(`error x${n}: ${k}`);
  console.log(`valid offers: ${offers.length}; combinations: ${cands.length}; errors: ${errors.length}`);
  top.slice(0, 8).forEach((c) => vlog(c.kind, c.out, '->', c.ret, fmtUsd(c.usd), c.offers.map((o) => `${o.source} ${fmtUsd(o.usd)}`).join(' + ')));

  state.lastRun = { at: now.toISOString(), ok: !!best, bestUsd: bestBag ? Math.round(bestBag.usd) : null, errors: errors.length };
  state.failStreak = best ? 0 : (state.failStreak || 0) + 1;

  if (!best) {
    if (state.failStreak === 6 && OWNER) await telegram('⚠️ בוט הטיסות לא הצליח לקרוא מחירים 6 פעמים ברצף. אני ממשיך לנסות.');
    writeLogs('no prices', offers.length, STARTED);
    saveState(state);
    if (SUMMARY) await telegram('🛫 סיכום יומי: לא הצלחתי לקרוא מחירים היום. אנסה שוב בהרצה הבאה.');
    console.log('no prices found');
    return;
  }

  const under = top.filter((c) => c.usd <= CONFIG.maxPriceUsd && c.offers.every(bagReq));
  const last = state.lastAlert;
  const hoursSince = last ? (now - new Date(last.at)) / 36e5 : Infinity;
  const TEST = process.env.TEST_ALERT === '1'; // test runs always alert and do not touch the real alert history
  const shouldAlert = under.length > 0 && (TEST || !last || under[0].usd <= last.usd - CONFIG.realertDropUsd || hoursSince >= CONFIG.realertHours);
  const outDesc = [OUT.airline ? `ב${outAirlineHe()}` : '', OUT.maxStops === 0 ? 'ישיר' : ''].filter(Boolean).join(' ');
  const stopsTxt = (n) => (n === 0 ? 'ישיר' : n === 1 ? 'עד עצירה אחת' : `עד ${n} עצירות`);
  const paxTxt = PAX > 1 ? ` · ${PAX} נוסעים, מחירים לנוסע` : '';
  const cabinTxt = CONFIG.cabin === 'economy' ? '' : ` · ${{ premium: 'פרימיום', business: 'עסקים', first: 'ראשונה' }[CONFIG.cabin]}`;
  const bagTxt = CONFIG.checkedBags ? ` · ${CONFIG.checkedBags === 1 ? 'מזוודה' : CONFIG.checkedBags + ' מזוודות'} לנוסע` : '';
  const title = `✈️ ${cityHe(CONFIG.origin)} ${RET ? '⇄' : '→'} ${cityHe(CONFIG.destination)}${outDesc ? ' · הלוך ' + outDesc : ''}`;
  const rules = RET
    ? `<i>הלוך ${heDate(OUT.from)}–${heDate(OUT.to)} (${stopsTxt(OUT.maxStops)}) · חזור ${heDate(RET.from)}–${heDate(RET.to)} (${stopsTxt(RET.maxStops)}${RET.maxHours ? `, עד ${RET.maxHours} ש׳` : ''})${CONFIG.maxTripDays ? ` · עד ${CONFIG.maxTripDays} ימים` : ''}${bagTxt}${cabinTxt}${paxTxt}</i>`
    : `<i>כיוון אחד · ${heDate(OUT.from)}–${heDate(OUT.to)} (${stopsTxt(OUT.maxStops)})${bagTxt}${cabinTxt}${paxTxt}</i>`;

  if (shouldAlert) {
    await telegram([
      ...(TEST ? ['🧪 <i>הודעת בדיקה, הסף הועלה זמנית</i>'] : []),
      `🔔 <b>נמצא מחיר מתחת ל-${fmtBoth(CONFIG.maxPriceUsd)}!</b>`,
      title, '',
      pickDiverse(under, 5).map(candText).join('\n\n'), '',
      ...(under.slice(0, 5).some(bagUnknown) ? ['<i>* לא ידוע אם הכבודה כלולה במחיר</i>'] : []),
      '💡 לפתוח בגלישה בסתר, לוודא שהמזוודה כלולה, ולקנות מהר.',
    ].join('\n'));
    if (!TEST) state.lastAlert = { at: now.toISOString(), usd: under[0].usd };
  }

  // When Kayak gave nothing (it blocks automated searches from GitHub's servers), links to check it yourself.
  const kayakCount = offers.filter((o) => /kayak/i.test(o.url || '')).length;
  const kc = bestBag || best;
  const kayakLinks = kayakCount ? '' : `🔎 לבדוק גם ב-Kayak בעצמך (±3 ימים): ${CONFIG.markets.map((m) => {
    const bag = m.bagFilter && CONFIG.checkedBags ? `bfc=${CONFIG.checkedBags}` : '';
    const kind = RET ? 'rt' : 'out';
    return `<a href="${kayakUrl(m.linkHost || m.host, kind, `${kc.out}-flexible-3days`, RET && kc.ret && `${kc.ret}-flexible-3days`, [kayakFs(kind), bag].filter(Boolean).join(';'))}">${m.label || m.host}</a>`;
  }).join(' · ')}`;

  if (SUMMARY) {
    const mixed = top.find((c) => c.kind === 'mixed' && c.offers.every(bagReq));
    const rtBySource = [...new Set(offers.filter((o) => o.kind === 'rt' && bagReq(o)).map((o) => o.source))]
      .map((s) => [s, Math.min(...offers.filter((o) => o.kind === 'rt' && bagReq(o) && o.source === s).map((o) => o.usd))])
      .sort((a, b) => a[1] - b[1]).map(([s, u]) => `${s} ${fmtBoth(u)}`).join(' · ');
    await telegram([
      `☀️ <b>סיכום יומי</b> · ${title}`,
      rules, '',
      bestBag ? `הזול ביותר${PAX > 1 ? ' (לנוסע)' : ''}: ${priceTag(bestBag)} · הסף: ${fmtBoth(CONFIG.maxPriceUsd)}` : `לא נמצא מחיר מתאים · הסף: ${fmtBoth(CONFIG.maxPriceUsd)}`,
      ...(ILS_PER_USD ? [`💱 שער היום: $1 = ₪${ILS_PER_USD.toFixed(2)}`] : []), '',
      pickDiverse(top.filter((c) => c.offers.every(bagReq)), 5).map(candText).join('\n\n'), '',
      ...(top.filter((c) => c.offers.every(bagReq)).slice(0, 5).some(bagUnknown) ? ['<i>* לא ידוע אם הכבודה כלולה במחיר</i>'] : []),
      ...(rtBySource ? [`📊 הלוך-חזור לפי אתר: ${rtBySource}`] : []),
      ...(mixed ? [`🔀 שני כרטיסים נפרדים: מ-${fmtBoth(mixed.usd)}`] : []),
      ...(kayakLinks ? [kayakLinks] : []),
      ...(OWNER && errors.length ? [`⚠️ ${errors.length} חיפושים נכשלו (רק אתה רואה את זה · /errors)`] : []),
      '', '<i>/status הגדרות · /stop הפסקה</i>',
    ].join('\n'));
  }
  delete state.duels; // history of the retired algorithm B
  writeLogs('prices', offers.length, STARTED);
  saveState(state);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('ERROR', scrub(e.message));
    try { writeLogs(`crash: ${e.message}`, 0, STARTED); } catch {}
    process.exit(1);
  });
}
module.exports = { scrub, tracked, appendCsv, googleTfs, googleUrl, parseGoogleLabel, googleTasks, lowCostLinks, retryOnce, bagState, configFor, slotFrom, bagReq, bagOk, kayakUrlForTest: kayakUrl, pickDiverse, tripType, setIlsRate: (r) => { ILS_PER_USD = r; }, pairOk, legOkOut, legOkRet, parseKayakCards, candText, pickDistinct, searchCenters };
