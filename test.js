const assert = require('assert');
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'test-token';
const { pairOk, legOkOut, legOkRet, parseKayakCards } = require('./watch.js');
assert.equal(pairOk('2030-12-25','2031-01-25'), true);
assert.equal(pairOk('2030-12-24','2031-01-25'), false);
assert.equal(pairOk('2030-12-16','2031-01-16'), true);
assert.equal(pairOk('2030-12-16','2031-01-17'), false);
assert.equal(legOkRet({date:'2031-01-12',stops:1,hours:26}), false);
assert.equal(legOkRet({date:'2031-01-12',stops:2,hours:20}), false);
assert.equal(legOkRet({date:'2031-01-12',stops:1,hours:24.9}), true);
assert.equal(legOkRet({date:'2031-01-26',stops:0,hours:12}), false);
assert.equal(legOkOut({date:'2030-12-16',stops:0}), true);
assert.equal(legOkOut({date:'2030-12-16',stops:1}), false);
assert.equal(legOkOut({date:'2030-12-31',stops:0}), false);
const he = 'המשך לפרטי התוצאה\n17.12\n01:00 – 07:50\nAAAנמל\n-\nBBBנמל\nללא עצירה\n13 שעות 50 דקות\n16.01\n23:00 – 17:40+1\nBBB\n-\nAAA\nללא עצירה\n11 שעות 40 דקות\nEL AL\n1\n1\n₪3,846\nמחקלת תיירים\n';
const c = parseKayakCards(he, 'ILS')[0];
assert.deepEqual([c.legs[0].date, c.legs[1].date, c.legs[0].stops, c.legs[1].stops, Math.round(c.legs[1].hours*60), c.price, c.airline, c.bags.join('/')], ['2030-12-17','2031-01-16',0,0,700,3846,'EL AL','1/1']);
const au = 'Go to result details\n16/01\n12:05 – 10:15+1\nBBB City\n-\nAAA Airport\n1 stop\nYYZ\n15h 10m\nAir Canada\n$1,127\nEconomy\n';
const a = parseKayakCards(au, 'AUD')[0];
assert.deepEqual([a.legs[0].date, a.legs[0].stops, Math.round(a.legs[0].hours*60), a.price, a.airline], ['2031-01-16',1,910,1127,'Air Canada']);
console.log('all rule and parser tests passed');

// pickDiverse: one option per trip type first, then different outbound dates
{
  const { pickDiverse, tripType } = require('./watch.js');
  const rt = (out, ret, usd, retAirline, retStops) => ({ kind: 'rt', out, ret, usd, offers: [{ legs: [{ date: out, stops: 0, airline: 'אל על' }, { date: ret, stops: retStops, airline: retAirline }] }] });
  const list = [
    rt('2030-12-30', '2031-01-11', 1130, 'אל על', 1), rt('2030-12-17', '2031-01-11', 1131, 'אל על', 1),
    rt('2030-12-16', '2031-01-11', 1131, 'אל על', 1), rt('2030-12-17', '2031-01-16', 1204, 'אל על', 0),
    rt('2030-12-20', '2031-01-16', 1590, 'ITA', 1),
  ].sort((a, b) => a.usd - b.usd);
  const p = pickDiverse(list, 5);
  assert.equal(tripType(p[0]), 'אל על, חזור עם עצירה');
  assert.ok(p.some((c) => tripType(c) === 'אל על ישיר הלוך וחזור'));
  assert.ok(p.some((c) => tripType(c) === 'חזור עם עצירה בחברה אחרת'));
  assert.equal(p.length, 4); // 1131 x2 grouped as "same price, other dates"
  console.log('pickDiverse tests passed');
}

// Kayak filter must include nonstop AND 1-stop (Kayak's "~1" means exactly one stop)
assert.ok(/fs=airlines=LY;stops=0,1|fs=stops=0,1;airlines=LY/.test(require('./watch.js').kayakUrlForTest('www.he.kayak.com', 'rt', '2030-12-18', '2031-01-16')));
console.log('kayak filter test passed');

// Checked bag rule: only offers that are known to include a checked bag can trigger an alert
{
  const { bagOk } = require('./watch.js');
  assert.equal(bagOk({ bags: [1] }), false);            // Kayak card: carry-on only
  assert.equal(bagOk({ bags: [] }), false);             // unknown (e.g. Kayak Australia, Google)
  assert.equal(bagOk({ bags: [1, 1] }), true);          // carry-on + checked
  assert.equal(bagOk({ bags: [1, 0] }), false);
  assert.equal(bagOk({ bags: [], bagChecked: true }), true); // Kayak with the bag filter
  console.log('bag rule tests passed');
}

// Trip code: landing page -> Telegram link -> bot
{
  const C = require('./docs/codec.js');
  const p = { invite: 'Ab3_x9', origin: 'LHR', destination: 'CDG', adults: 2, children: 1, infants: 1, cabin: 'business',
    checkedBags: 2, carryOn: 1, airline: 'LY', outMaxStops: 0, outMaxHours: 14, outDepFrom: 6, outDepTo: 23,
    outFrom: '2030-12-16', outTo: '2030-12-30', oneWay: false, retAirline: 'UA', retMaxStops: 1, retMaxHours: 25,
    retDepFrom: 0, retDepTo: 24, retFrom: '2031-01-10', retTo: '2031-01-25', maxTripDays: 31, maxLayover: 6, selfTransfer: true, maxPrice: 950 };
  const code = C.encode(p);
  assert.ok(/^[A-Za-z0-9_-]{1,64}$/.test(code), 'fits in a Telegram start link');
  const q = C.decode(code);
  for (const k of Object.keys(p)) assert.deepEqual(q[k], p[k], k);
  assert.deepEqual(C.validate(p, '2030-11-01'), []);
  assert.deepEqual(C.validate({ ...p, outTo: '2031-03-31', retFrom: '2031-04-01', retTo: '2031-09-30', maxTripDays: 0 }, '2030-11-01'), [], 'long ranges allowed');
  const long = C.decode(C.encode({ ...p, outTo: '2031-03-31', retFrom: '2031-04-01', retTo: '2031-09-30' }));
  assert.equal(long.outTo, '2031-03-31'); assert.equal(long.retTo, '2031-09-30');
  assert.ok(C.validate({ ...p, invite: 'x' }, '2030-11-01').length > 0, 'bad invite');
  assert.ok(C.validate(p, '2030-12-20').length > 0, 'past date');
  assert.ok(C.validate({ ...p, infants: 3 }, '2030-11-01').length > 0, 'more infants than adults');
  assert.ok(C.validate({ ...p, outDepFrom: 20, outDepTo: 10 }, '2030-11-01').length > 0, 'bad hour window');
  const ow = C.decode(C.encode({ invite: 'Ab3_x9', origin: 'LHR', destination: 'CDG', outFrom: '2030-12-01', outTo: '2030-12-05', oneWay: true, maxPrice: 200 }));
  assert.equal(ow.oneWay, true); assert.equal(ow.retFrom, undefined); assert.equal(ow.adults, 1); assert.equal(ow.cabin, 'economy');
  assert.equal(ow.checkedBags, 1); assert.equal(ow.carryOn, 1);
  console.log('codec tests passed');
}

// Encryption: readable only with the right bot token
{
  const store = require('./lib/store');
  const enc = store.encrypt({ chatId: '123', prefs: { origin: 'LHR' } });
  assert.ok(!enc.includes('123') && !enc.includes('LHR'), 'nothing readable in the stored text');
  assert.deepEqual(store.decrypt(enc), { chatId: '123', prefs: { origin: 'LHR' } });
  const saved = process.env.TELEGRAM_BOT_TOKEN; process.env.TELEGRAM_BOT_TOKEN = 'another-token';
  assert.throws(() => store.decrypt(enc)); process.env.TELEGRAM_BOT_TOKEN = saved;
  console.log('encryption tests passed');
}

// Profiles: one-way config, passengers in the Kayak link, airline departure slot
{
  const { configFor, slotFrom } = require('./watch.js');
  const c = configFor({ origin: 'AAA', destination: 'LHR', outFrom: '2030-12-01', outTo: '2030-12-05', oneWay: true, maxPrice: 300, adults: 2, infants: 1, cabin: 'business' });
  assert.equal(c.return, null); assert.equal(c.maxTripDays, 0); assert.equal(c.outbound.airline, '');
  assert.deepEqual(c.pax, { adults: 2, children: 0, infants: 1 }); assert.equal(c.cabin, 'business');
  assert.deepEqual(slotFrom([{ kind: 'out', legs: [{ time: '01:00 – 07:50' }] }, { kind: 'out', legs: [{ time: '01:20 – 08:10' }] }]), [0, 2]);
  assert.equal(slotFrom([]), null);
  console.log('profile tests passed');
}

// Leg rules: departure hours, layover, airline, stops (test profile: outbound LY nonstop, return up to 1 stop and 25 h)
{
  const { legOkOut, legOkRet } = require('./watch.js');
  assert.equal(legOkOut({ date: '2030-12-20', stops: 0, time: '01:00 – 07:50', carriers: ['LY'] }), true);
  assert.equal(legOkOut({ date: '2030-12-20', stops: 0, time: '01:00 – 07:50', carriers: ['UA'] }), false);
  assert.equal(legOkOut({ date: '2030-12-20', stops: 1, time: '01:00 – 07:50' }), false);
  assert.equal(legOkRet({ date: '2031-01-12', stops: 1, hours: 24, time: '23:15 – 20:20+1', carriers: ['AZ'] }), true);
  console.log('leg rule tests passed');
}

// Bag states: known, missing, unknown (unknown is shown with "*")
{
  const { bagState, bagReq } = require('./watch.js');
  assert.equal(bagState({ bags: [1, 1] }), 'yes');
  assert.equal(bagState({ bags: [1, 0] }), 'no');
  assert.equal(bagState({ bags: [] }), 'unknown');
  assert.equal(bagState({ bags: [1] }), 'unknown');
  assert.equal(bagState({ bags: [], bagChecked: true }), 'yes');
  assert.equal(bagReq({ bags: [1, 0] }), false);
  assert.equal(bagReq({ bags: [] }), true);
  console.log('bag state tests passed');
}

// Messages: a price with unknown bags gets "*"
{
  const { candText, setIlsRate } = require('./watch.js');
  setIlsRate(3.2);
  const offer = (bags) => ({ kind: 'out', usd: 300, source: 'kiwi.com', url: 'https://example.com', bags, legs: [{ date: '2030-12-20', time: '06:00 – 09:00', stops: 0, hours: 3, airline: 'X' }] });
  const unknown = candText({ kind: 'ow', out: '2030-12-20', usd: 300, offers: [offer([])] }, 0);
  const known = candText({ kind: 'ow', out: '2030-12-20', usd: 300, offers: [offer([1, 1])] }, 0);
  assert.ok(unknown.includes('*</b>') && unknown.includes('לא ידוע'), 'unknown bags marked');
  assert.ok(!known.includes('*</b>') && known.includes('כלולים'), 'known bags not marked');
  console.log('message tests passed');
}

// Trip length must leave at least one allowed outbound/return pair
{
  const C = require('./docs/codec.js');
  const base = { invite: 'Ab3_x9', origin: 'AAA', destination: 'BBB', outFrom: '2030-11-14', outTo: '2030-11-20', oneWay: false, retFrom: '2030-12-11', retTo: '2030-12-17', maxPrice: 900 };
  assert.ok(C.validate({ ...base, maxTripDays: 15 }, '2030-11-01').some((e) => e.includes('אורך הטיול')), 'too short');
  assert.deepEqual(C.validate({ ...base, maxTripDays: 21 }, '2030-11-01'), []);
  assert.deepEqual(C.validate({ ...base, maxTripDays: 0 }, '2030-11-01'), []);
  console.log('trip length tests passed');
}

// Language: the code carries the page language; old codes (v2/v3) decode as Hebrew; errors come in the user's language
{
  const C = require('./docs/codec.js');
  const p = { invite: 'Ab3_x9', origin: 'TLV', destination: 'ATH', outFrom: '2030-11-14', outTo: '2030-11-20', oneWay: true, maxPrice: 300, lang: 'en' };
  assert.equal(C.decode(C.encode(p)).lang, 'en');
  assert.equal(C.decode(C.encode({ ...p, lang: 'he' })).lang, 'he');
  assert.ok(C.validate({ ...p, destination: 'TLV' }, '2030-11-01', 'en')[0].match(/[a-z]/i), 'English error');
  assert.ok(/[֐-׿]/.test(C.validate({ ...p, destination: 'TLV' }, '2030-11-01', 'he')[0]), 'Hebrew error');
  assert.ok(C.describe(p, 'en').join(' ').includes('Alert under'), 'English description');
  console.log('language tests passed');
}

// Chat edits: dates, destinations, commands; one user per chat, an update replaces the old settings
{
  process.env.TELEGRAM_BOT_TOKEN = 'unit-test-token';
  const bot = require('./bot.js');
  assert.deepEqual(bot.parseDates('21.12 3', '2030-11-13'), ['2030-12-18', '2030-12-24']);
  assert.deepEqual(bot.parseDates('20.12-30.12', '2030-11-13'), ['2030-12-20', '2030-12-30']);
  assert.deepEqual(bot.parseDates('28.12-5.1', '2030-11-13'), ['2030-12-28', '2031-01-05']);
  assert.deepEqual(bot.parseDates('5.1', '2030-11-13'), ['2031-01-05', '2031-01-05']);
  assert.equal(bot.parseDates('31.2', '2030-11-13'), null);
  assert.equal(bot.parseDates('soon', '2030-11-13'), null);
  assert.deepEqual(bot.findPlaces('אתונה').map((r) => r[0]), ['ATH']);
  assert.deepEqual(bot.findPlaces('athens').map((r) => r[0]), ['ATH']);
  assert.ok(bot.findPlaces('london').length > 1, 'several London airports to choose from');
  assert.deepEqual(bot.parseCommand('מחיר 900'), { cmd: 'price', arg: '900' });
  assert.deepEqual(bot.parseCommand('/price@SomeBot 800'), { cmd: 'price', arg: '800' });
  assert.equal(bot.parseCommand('hello'), null);
  console.log('chat edit tests passed');
}

// Google Flights: the search link carries the filters (checked live 13.11.2026), and result labels are parsed
{
  const W = require('./watch.js');
  assert.equal(W.googleTfs([{ date: '2027-01-14', from: 'TLV', to: 'BKK', maxStops: 1 }], 2), 'GhwSCjIwMjctMDEtMTQoAWoFEgNUTFZyBRIDQktLQAFIAZgBAg==');
  const g = W.parseGoogleLabel('From 1,496 US dollars. 1 stop flight with ITA. Leaves Ben Gurion Airport at 8:30 PM on Thursday, January 14 and arrives at Suvarnabhumi Airport at 8:10 AM on Friday, January 15. Total duration 18 hr 40 min.  Layover (1 of 1) is a 3 hr 50 min layover at Leonardo da Vinci International Airport in Rome. Select flight', '2027-01-14');
  assert.equal(g.price, 1496); assert.equal(g.rt, false);
  assert.deepEqual([g.leg.time, g.leg.stops, Math.round(g.leg.hours * 60), Math.round(g.leg.layover * 60), g.leg.airline], ['20:30 – 08:10+1', 1, 1120, 230, 'ITA']);
  const n = W.parseGoogleLabel('From 812 US dollars round trip total. Nonstop flight with El Al. Leaves Ben Gurion Airport at 1:05 AM on Wednesday, December 30 and arrives at Miami International Airport at 7:50 AM on Wednesday, December 30. Total duration 14 hr 45 min.', '2026-12-30');
  assert.deepEqual([n.price, n.rt, n.leg.stops, n.leg.airline, n.leg.time], [812, true, 0, 'אל על', '01:05 – 07:50']);
  assert.equal(W.parseGoogleLabel('496 US dollars', '2027-01-14'), null);
  const tasks = W.googleTasks(1); // test profile: round trip
  assert.ok(tasks.length > 0 && tasks.length <= 10 && tasks.every((t) => t.kind === 'rt' && t.b > t.a && W.pairOk(t.a, t.b)));
  console.log('google tests passed');
}

// Links to low-cost airline sites; retry once
{
  const W = require('./watch.js');
  const leg = (date, airline) => ({ date, airline, stops: 0, time: '10:00 – 12:00' });
  const ow = (l) => ({ kind: 'ow', offers: [{ legs: [l] }] });
  assert.ok(W.lowCostLinks(ow(leg('2030-12-20', 'Wizz Air'))).includes('wizzair.com/en-gb/booking/select-flight/AAA/BBB/2030-12-20/null/1/0/0/null'));
  const rt = W.lowCostLinks({ kind: 'rt', offers: [{ legs: [leg('2030-12-20', 'Ryanair'), leg('2031-01-12', 'Ryanair')] }] });
  assert.ok(rt.includes('dateOut=2030-12-20&amp;') === false && rt.includes('dateOut=2030-12-20&dateIn=2031-01-12') && rt.includes('isReturn=true'));
  assert.equal(W.lowCostLinks(ow(leg('2030-12-20', 'אל על'))), '');
  assert.equal(W.lowCostLinks(ow(leg('2030-12-20', 'Wizz Air + Ryanair'))), ''); // a mix can't be booked on one airline's site
  const mixed = W.lowCostLinks({ kind: 'mixed', offers: [{ legs: [leg('2030-12-20', 'easyJet')] }, { legs: [leg('2031-01-12', 'Wizz Air')] }] });
  assert.ok(mixed.includes('easyjet.com') && mixed.includes('select-flight/BBB/AAA/2031-01-12/null'));
  let calls = 0;
  W.retryOnce(async () => { calls++; if (calls === 1) throw new Error('blocked'); return 'ok'; }, 1).then((r) => { assert.equal(r, 'ok'); assert.equal(calls, 2); console.log('low-cost link and retry tests passed'); });
}

// Search log: retry once, no retry after a block, CSV rows readable, summary for the owner
{
  const W = require('./watch.js');
  const L = require('./lib/logs.js');
  const os = require('os'); const fsx = require('fs'); const px = require('path');
  (async () => {
    let n = 0;
    const r1 = await W.tracked('kiwi', 'm', 'out', async () => { n++; if (n === 1) throw new Error('HTTP 502'); return [1, 2]; }, 1);
    assert.deepEqual([r1.length, n], [2, 2]);
    let b = 0;
    await W.tracked('kayak', 'h', 'rt', async () => { b++; throw Object.assign(new Error('blocked: check'), { blocked: true }); }, 1).catch(() => {});
    assert.equal(b, 1, 'a block is not retried');
    let f = 0;
    await W.tracked('google', 'g', 'out', async () => { f++; throw new Error('timeout at https://x.example/TLV-BKK/2027-01-14'); }, 1).catch(() => {});
    assert.equal(f, 2, 'a failure is retried once');
    assert.equal(W.scrub('Timeout navigating to "https://www.kayak.com/flights/TLV-BKK/2027-01-14", now'), 'Timeout navigating to <link> now');
    const dir = fsx.mkdtempSync(px.join(os.tmpdir(), 'logs-'));
    const now = new Date().toISOString().slice(0, 19) + 'Z';
    W.appendCsv(px.join(dir, 'searches.csv'), ['time_utc', 'run', 'user', 'mode', 'source', 'market', 'kind', 'status', 'attempts', 'seconds', 'results', 'error'],
      [[now, '1', 'u1', 'check', 'kayak', 'www.he.kayak.com', 'rt', 'blocked', 1, 9, 0, 'blocked: Kayak security check'], [now, '1', 'u1', 'check', 'kiwi', 'mcp', 'out', 'ok-after-retry', 2, 3, 15, 'HTTP 502, "x"']]);
    const head = ['time_utc', 'run', 'user', 'mode', 'seconds', 'kayak_ok', 'kayak_failed', 'kayak_blocked', 'kayak_skipped', 'kiwi_ok', 'kiwi_failed', 'kiwi_blocked', 'kiwi_skipped', 'google_ok', 'google_failed', 'google_blocked', 'google_skipped', 'valid_offers', 'outcome'];
    W.appendCsv(px.join(dir, 'runs.csv'), head, [[now, '1', 'u1', 'check', 60, 0, 0, 1, 15, 3, 0, 0, 0, 0, 0, 0, 0, 44, 'prices']]);
    W.appendCsv(px.join(dir, 'runs.csv'), head, [[now, '2', 'u2', 'summary', 80, 0, 0, 1, 15, 3, 0, 0, 0, 10, 0, 0, 0, 140, 'prices']]);
    const rows = L.readCsv('searches.csv', dir);
    assert.equal(rows.length, 2); assert.equal(rows[1].error, 'HTTP 502, "x"');
    assert.equal(L.readCsv('runs.csv', dir).length, 2, 'one header, two runs');
    const sm = L.summarize(24, Date.now(), dir);
    assert.ok(sm.includes('ריצות: 2') && sm.includes('kayak: ✅ 0') && sm.includes('🚫 2 נחסמו') && sm.includes('1× kayak · blocked: Kayak security check') && sm.includes('🔁 1'), sm);
    console.log('search log tests passed');
  })().catch((e) => { console.error(e); process.exit(1); });
}

// Airline match for per-user preferred airlines (codes from Kiwi, names from Google/Kayak)
{
  const W = require('./watch.js');
  assert.ok(W.flies({ carriers: ['Y4'], airline: 'Volaris' }, 'Y4'));
  assert.ok(!W.flies({ carriers: ['Y4', 'AM'], airline: 'Volaris + Aeromexico' }, 'Y4'));
  assert.ok(W.flies({ airline: 'Aeromexico' }, 'AM') && W.flies({ airline: 'Aeroméxico' }, 'AM'));
  assert.ok(!W.flies({ airline: 'Volaris, Aeromexico' }, 'AM'));
  assert.deepEqual(W.preferredFirst([{ kind: 'ow' }]).pref, []); // test profile has no preferred airlines
  console.log('preferred airline tests passed');
}
