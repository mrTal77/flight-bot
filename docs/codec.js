// Trip preferences <-> a short code that fits in a Telegram "start" link (max 64 chars, A-Z a-z 0-9 _ -).
// Shared by the landing page (browser) and the bot (Node), so both read and write the same format.
// The code carries only flight preferences, the user's language and an invite code: no personal details.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlightCodec = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var EPOCH = Date.UTC(2026, 0, 1); // day 0 of the date fields
  var AIRLINE_CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; // index 0 = none
  var CABINS = ['economy', 'premium', 'business', 'first'];
  var LANGS = ['he', 'en'];
  // v4 adds the language. v2 (ranges up to 31 days) and v3 codes are still accepted.
  var VERSION = 4;
  var LIMITS = {
    maxStops: 3, maxHours: 63, maxLayover: 31, maxTripDays: 127, maxPrice: 32767, minPrice: 20,
    maxAdults: 9, maxChildren: 8, maxInfants: 4, maxPassengers: 9, maxCheckedPerPax: 2,
  };

  function dayNum(iso) { return Math.round((Date.parse(iso + 'T00:00:00Z') - EPOCH) / 864e5); }
  function isoOf(n) { return new Date(EPOCH + n * 864e5).toISOString().slice(0, 10); }
  function diff(a, b) { return dayNum(b) - dayNum(a); }
  function inRange(v, a, b) { return typeof v === 'number' && v >= a && v <= b && Math.floor(v) === v; }

  // Defaults for fields a form may leave out.
  function withDefaults(p) {
    var d = {
      adults: 1, children: 0, infants: 0, cabin: 'economy', checkedBags: 1, carryOn: 1,
      airline: '', outMaxStops: 0, outMaxHours: 0, outDepFrom: 0, outDepTo: 24,
      retAirline: '', retMaxStops: 1, retMaxHours: 0, retDepFrom: 0, retDepTo: 24,
      maxLayover: 0, selfTransfer: false, maxTripDays: 0, oneWay: false, lang: 'he',
    };
    var o = {}; var k;
    for (k in d) o[k] = d[k];
    for (k in p) if (p[k] !== undefined && p[k] !== null && p[k] !== '') o[k] = p[k];
    return o;
  }

  // Validation messages, Hebrew and English. {a} {b} are filled in.
  var MSG = {
    origin: ['צריך לבחור מוצא מהרשימה', 'Choose an origin from the list'],
    destination: ['צריך לבחור יעד מהרשימה', 'Choose a destination from the list'],
    same: ['המוצא והיעד זהים', 'Origin and destination are the same'],
    airlineOut: ['קוד חברת התעופה בהלוך לא תקין (2 תווים, למשל LY)', 'Outbound airline code is not valid (2 characters, e.g. LY)'],
    airlineRet: ['קוד חברת התעופה בחזור לא תקין (2 תווים)', 'Return airline code is not valid (2 characters)'],
    adults: ['מבוגרים: 1 עד {a}', 'Adults: 1 to {a}'],
    children: ['ילדים: 0 עד {a}', 'Children: 0 to {a}'],
    infants: ['תינוקות: עד תינוק אחד לכל מבוגר', 'Infants: at most one per adult'],
    pax: ['עד {a} נוסעים בסך הכול', 'At most {a} passengers in total'],
    cabin: ['מחלקה לא תקינה', 'Cabin is not valid'],
    checked: ['מזוודות לנוסע: 0 עד {a}', 'Checked bags per passenger: 0 to {a}'],
    carry: ['תיק עלייה לנוסע: 0 או 1', 'Carry-on per passenger: 0 or 1'],
    stops: ['עצירות ב{a}: 0 עד {b}', 'Stops on the {a}: 0 to {b}'],
    hours: ['משך ה{a}: 0 עד {b} שעות', '{a} flight time: 0 to {b} hours'],
    dep: ['שעות ההמראה של ה{a} לא תקינות', 'Departure hours of the {a} are not valid'],
    layover: ['עצירת ביניים מקסימלית: 0 עד {a} שעות', 'Longest layover: 0 to {a} hours'],
    outDates: ['חסרים תאריכי הלוך', 'Outbound dates are missing'],
    outOrder: ['תאריך הסיום של ההלוך לפני תאריך ההתחלה', 'Outbound end date is before the start date'],
    outPast: ['תאריך ההלוך כבר עבר', 'The outbound date has already passed'],
    outRange: ['תאריך הלוך מחוץ לטווח הנתמך', 'Outbound date is out of the supported range'],
    retDates: ['חסרים תאריכי חזור', 'Return dates are missing'],
    retOrder: ['תאריך הסיום של החזור לפני תאריך ההתחלה', 'Return end date is before the start date'],
    retBefore: ['החזור מתחיל לפני ההלוך', 'The return starts before the outbound'],
    retRange: ['תאריך חזור מחוץ לטווח הנתמך', 'Return date is out of the supported range'],
    tripDays: ['אורך טיול מקסימלי: 0 עד {a} ימים', 'Longest trip: 0 to {a} days'],
    tripShort: ['אורך הטיול המקסימלי ({a} ימים) קצר מדי לתאריכים שבחרת: בין ההלוך האחרון לחזור הראשון יש {b} ימים. אפשר להגדיל את אורך הטיול או לשים 0',
      'The longest trip ({a} days) is too short for these dates: there are {b} days between the latest outbound and the earliest return. Make it longer, or set 0'],
    price: ['מחיר מקסימלי לנוסע: {a} עד {b} דולר', 'Price limit per passenger: ${a} to ${b}'],
    invite: ['קוד ההזמנה חסר או לא תקין', 'The invite code is missing or not valid'],
  };
  var LEG = { out: ['הלוך', 'outbound'], ret: ['חזור', 'return'] };
  function msg(lang, key, a, b) { return MSG[key][lang === 'en' ? 1 : 0].replace('{a}', a).replace('{b}', b); }

  // Check a preferences object; returns a list of problems in the user's language, empty if OK.
  function validate(p0, todayIso, lang) {
    var p = withDefaults(p0); var e = []; var L = lang || p.lang;
    var m = function (k, a, b) { e.push(msg(L, k, a, b)); };
    var iata = /^[A-Z]{3}$/; var al = /^[A-Z0-9]{2}$/; var d = /^\d{4}-\d{2}-\d{2}$/;
    if (!iata.test(p.origin || '')) m('origin');
    if (!iata.test(p.destination || '')) m('destination');
    if (p.origin && p.origin === p.destination) m('same');
    if (p.airline && !al.test(p.airline)) m('airlineOut');
    if (p.retAirline && !al.test(p.retAirline)) m('airlineRet');
    if (!inRange(p.adults, 1, LIMITS.maxAdults)) m('adults', LIMITS.maxAdults);
    if (!inRange(p.children, 0, LIMITS.maxChildren)) m('children', LIMITS.maxChildren);
    if (!inRange(p.infants, 0, LIMITS.maxInfants) || p.infants > p.adults) m('infants');
    if (p.adults + p.children + p.infants > LIMITS.maxPassengers) m('pax', LIMITS.maxPassengers);
    if (CABINS.indexOf(p.cabin) < 0) m('cabin');
    if (!inRange(p.checkedBags, 0, LIMITS.maxCheckedPerPax)) m('checked', LIMITS.maxCheckedPerPax);
    if (!inRange(p.carryOn, 0, 1)) m('carry');
    (p.oneWay ? ['out'] : ['out', 'ret']).forEach(function (k) {
      var name = LEG[k][L === 'en' ? 1 : 0];
      if (!inRange(p[k + 'MaxStops'], 0, LIMITS.maxStops)) m('stops', name, LIMITS.maxStops);
      if (!inRange(p[k + 'MaxHours'], 0, LIMITS.maxHours)) m('hours', name, LIMITS.maxHours);
      if (!inRange(p[k + 'DepFrom'], 0, 23) || !inRange(p[k + 'DepTo'], 1, 24) || p[k + 'DepTo'] <= p[k + 'DepFrom']) m('dep', name);
    });
    if (!inRange(p.maxLayover, 0, LIMITS.maxLayover)) m('layover', LIMITS.maxLayover);
    if (!d.test(p.outFrom || '') || !d.test(p.outTo || '')) m('outDates');
    else {
      if (p.outTo < p.outFrom) m('outOrder');
      if (todayIso && p.outFrom < todayIso) m('outPast');
      if (dayNum(p.outFrom) < 0 || dayNum(p.outTo) > 4095) m('outRange');
    }
    if (!p.oneWay) {
      if (!d.test(p.retFrom || '') || !d.test(p.retTo || '')) m('retDates');
      else {
        if (p.retTo < p.retFrom) m('retOrder');
        if (p.outFrom && p.retFrom < p.outFrom) m('retBefore');
        if (dayNum(p.retFrom) < 0 || dayNum(p.retTo) > 4095) m('retRange');
      }
      if (!inRange(p.maxTripDays, 0, LIMITS.maxTripDays)) m('tripDays', LIMITS.maxTripDays);
      // With a trip-length limit, at least one outbound/return pair must fit: latest outbound + limit >= earliest return.
      else if (p.maxTripDays && d.test(p.outTo || '') && d.test(p.retFrom || '') && diff(p.outTo, p.retFrom) > p.maxTripDays) m('tripShort', p.maxTripDays, diff(p.outTo, p.retFrom));
    }
    if (!inRange(p.maxPrice, LIMITS.minPrice, LIMITS.maxPrice)) m('price', LIMITS.minPrice, LIMITS.maxPrice);
    if (!/^[A-Za-z0-9_-]{6}$/.test(p.invite || '')) m('invite');
    return e;
  }

  function Writer() { this.bits = []; }
  Writer.prototype.put = function (value, n) {
    if (!(value >= 0 && value < Math.pow(2, n))) throw new Error('value out of range');
    for (var i = n - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  };
  Writer.prototype.toString = function () {
    while (this.bits.length % 6) this.bits.push(0);
    var s = '';
    for (var i = 0; i < this.bits.length; i += 6) {
      var v = 0; for (var j = 0; j < 6; j++) v = (v << 1) | this.bits[i + j];
      s += ALPHA[v];
    }
    return s;
  };
  function Reader(s) {
    this.bits = []; this.pos = 0;
    for (var i = 0; i < s.length; i++) {
      var v = ALPHA.indexOf(s[i]); if (v < 0) throw new Error('bad character');
      for (var j = 5; j >= 0; j--) this.bits.push((v >> j) & 1);
    }
  }
  Reader.prototype.get = function (n) {
    if (this.pos + n > this.bits.length) throw new Error('code too short');
    var v = 0; for (var i = 0; i < n; i++) v = v * 2 + this.bits[this.pos++];
    return v;
  };
  function putAirline(w, code) { var c = (code || '  ').padEnd(2, ' '); for (var i = 0; i < 2; i++) w.put(AIRLINE_CHARS.indexOf(c[i]), 6); }
  function getAirline(r) { var c = AIRLINE_CHARS[r.get(6)] + AIRLINE_CHARS[r.get(6)]; return c.trim().length === 2 ? c : ''; }

  function encode(p0) {
    var p = withDefaults(p0); var w = new Writer();
    w.put(VERSION, 4);
    for (var i = 0; i < 6; i++) w.put(ALPHA.indexOf(p.invite[i]), 6);
    [p.origin, p.destination].forEach(function (c) { for (var k = 0; k < 3; k++) w.put(c.charCodeAt(k) - 65, 5); });
    w.put(p.adults, 4); w.put(p.children, 4); w.put(p.infants, 3);
    w.put(CABINS.indexOf(p.cabin), 2); w.put(p.checkedBags, 2); w.put(p.carryOn, 1);
    putAirline(w, p.airline); w.put(p.outMaxStops, 2); w.put(p.outMaxHours, 6); w.put(p.outDepFrom, 5); w.put(p.outDepTo, 5);
    w.put(dayNum(p.outFrom), 12); w.put(diff(p.outFrom, p.outTo), 11);
    w.put(p.oneWay ? 1 : 0, 1);
    if (!p.oneWay) {
      putAirline(w, p.retAirline); w.put(p.retMaxStops, 2); w.put(p.retMaxHours, 6); w.put(p.retDepFrom, 5); w.put(p.retDepTo, 5);
      w.put(dayNum(p.retFrom), 12); w.put(diff(p.retFrom, p.retTo), 11); w.put(p.maxTripDays, 7);
    }
    w.put(p.maxLayover, 5); w.put(p.selfTransfer ? 1 : 0, 1);
    w.put(p.maxPrice, 15);
    w.put(Math.max(0, LANGS.indexOf(p.lang)), 1);
    return w.toString();
  }

  function decode(s) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(s || '')) throw new Error('bad code');
    var r = new Reader(s);
    var ver = r.get(4); if (ver < 2 || ver > VERSION) throw new Error('unknown version');
    var RB = ver === 2 ? 5 : 11; var DB = ver === 2 ? 11 : 12; // bits of a range length / of a date
    var inv = ''; for (var i = 0; i < 6; i++) inv += ALPHA[r.get(6)];
    var iata = function () { var c = ''; for (var k = 0; k < 3; k++) c += String.fromCharCode(65 + r.get(5)); return c; };
    var p = { invite: inv, origin: iata(), destination: iata() };
    p.adults = r.get(4); p.children = r.get(4); p.infants = r.get(3);
    p.cabin = CABINS[r.get(2)]; p.checkedBags = r.get(2); p.carryOn = r.get(1);
    p.airline = getAirline(r); p.outMaxStops = r.get(2); p.outMaxHours = r.get(6); p.outDepFrom = r.get(5); p.outDepTo = r.get(5);
    var of = r.get(DB); p.outFrom = isoOf(of); p.outTo = isoOf(of + r.get(RB));
    p.oneWay = r.get(1) === 1;
    if (!p.oneWay) {
      p.retAirline = getAirline(r); p.retMaxStops = r.get(2); p.retMaxHours = r.get(6); p.retDepFrom = r.get(5); p.retDepTo = r.get(5);
      var rf = r.get(DB); p.retFrom = isoOf(rf); p.retTo = isoOf(rf + r.get(RB)); p.maxTripDays = r.get(7);
    }
    p.maxLayover = r.get(5); p.selfTransfer = r.get(1) === 1;
    p.maxPrice = r.get(15);
    p.lang = ver >= 4 ? LANGS[r.get(1)] : 'he';
    return p;
  }

  var CITY = { TLV: 'תל אביב', MIA: 'מיאמי', JFK: 'ניו יורק', EWR: 'ניו יורק', LAX: 'לוס אנג׳לס', LHR: 'לונדון', CDG: 'פריז',
    FCO: 'רומא', ATH: 'אתונה', BCN: 'ברצלונה', MAD: 'מדריד', BER: 'ברלין', AMS: 'אמסטרדם', PRG: 'פראג', BUD: 'בודפשט',
    VIE: 'וינה', LCA: 'לרנקה', DXB: 'דובאי', BKK: 'בנגקוק', NRT: 'טוקיו', YYZ: 'טורונטו' };
  var AIRLINE = { LY: ['אל על', 'El Al'], IZ: ['ארקיע', 'Arkia'], '6H': ['ישראייר', 'Israir'] };
  // Place names from docs/airports.json rows: [code, city, airport, country, rank, hebrew].
  var PLACES = {};
  function setPlaces(rows) { PLACES = {}; (rows || []).forEach(function (r) { PLACES[r[0]] = r; }); }
  function placeName(code, lang) {
    var r = PLACES[code];
    if (lang === 'en') return (r && r[1]) || code;
    return CITY[code] || (r && (r[5] || r[1])) || code;
  }
  function airlineName(code, lang) { var a = AIRLINE[code]; return a ? a[lang === 'en' ? 1 : 0] : code; }
  function dmy(iso) { return Number(iso.slice(8)) + '.' + Number(iso.slice(5, 7)) + '.' + iso.slice(0, 4); }

  // Human-readable summary of the preferences, as lines (bold title marked with <b>). Same text in the bot and the page.
  function describe(p0, lang) {
    var p = withDefaults(p0); var en = (lang || p.lang) === 'en';
    var T = function (he, eng) { return en ? eng : he; };
    var stops = function (n) { return n === 0 ? T('ישיר', 'nonstop') : n === 1 ? T('עד עצירה אחת', 'up to 1 stop') : n >= 3 ? T('כל מספר עצירות', 'any stops') : T('עד ' + n + ' עצירות', 'up to ' + n + ' stops'); };
    var hours = function (a, b) { return a === 0 && b === 24 ? '' : T(' · המראה ', ' · departs ') + a + ':00–' + b + ':00'; };
    // A flexible date arrives as a range around it: show it as "about X (±n days)".
    var when = function (from, to) {
      var days = diff(from, to);
      if (days === 0) return dmy(from);
      if (days % 2 === 0 && days <= 10) {
        var n = days / 2; var mid = dmy(isoOf(dayNum(from) + n));
        return T('בערך ' + mid + ' (±' + n + ' ' + (n === 1 ? 'יום' : 'ימים') + ')', 'about ' + mid + ' (±' + n + ' day' + (n === 1 ? '' : 's') + ')');
      }
      return dmy(from) + '–' + dmy(to);
    };
    var leg = function (icon, name, from, to, al, st, mh, df, dt) {
      return icon + ' ' + name + ': ' + when(from, to) + ' · ' + (al ? airlineName(al, en ? 'en' : 'he') : T('כל חברה', 'any airline')) + ' · ' + stops(st) + (mh ? T(' · עד ' + mh + ' ש׳', ' · up to ' + mh + ' h') : '') + hours(df, dt);
    };
    var pl = function (n, he1, heN, en1) { return n + ' ' + (en ? en1 + (n === 1 ? '' : (en1 === 'child' ? 'ren' : 's')) : (n === 1 ? he1 : heN)); };
    var pax = [pl(p.adults, 'מבוגר', 'מבוגרים', 'adult'), p.children ? pl(p.children, 'ילד', 'ילדים', 'child') : '', p.infants ? pl(p.infants, 'תינוק', 'תינוקות', 'infant') : ''].filter(Boolean).join(', ');
    var cabin = { economy: ['תיירים', 'Economy'], premium: ['פרימיום', 'Premium economy'], business: ['עסקים', 'Business'], first: ['ראשונה', 'First'] }[p.cabin][en ? 1 : 0];
    var bags = [p.carryOn ? T('תיק עלייה', 'carry-on') : '', p.checkedBags ? (p.checkedBags === 1 ? T('מזוודה', '1 checked bag') : p.checkedBags + T(' מזוודות', ' checked bags')) : ''].filter(Boolean).join(' + ') || T('בלי כבודה', 'no bags');
    var L = en ? 'en' : 'he';
    var lines = [
      '✈️ <b>' + placeName(p.origin, L) + ' ' + (p.oneWay ? '→' : '⇄') + ' ' + placeName(p.destination, L) + '</b>',
      '👥 ' + pax + ' · ' + T('מחלקת ' + cabin, cabin),
      leg('🛫', T('הלוך', 'Outbound'), p.outFrom, p.outTo, p.airline, p.outMaxStops, p.outMaxHours, p.outDepFrom, p.outDepTo),
    ];
    if (!p.oneWay) {
      lines.push(leg('🛬', T('חזור', 'Return'), p.retFrom, p.retTo, p.retAirline, p.retMaxStops, p.retMaxHours, p.retDepFrom, p.retDepTo));
      if (p.maxTripDays) lines.push(T('📅 אורך הטיול: עד ' + p.maxTripDays + ' ימים', '📅 Trip length: up to ' + p.maxTripDays + ' days'));
    }
    if (p.maxLayover) lines.push(T('⏱️ עצירת ביניים: עד ' + p.maxLayover + ' ש׳', '⏱️ Layover: up to ' + p.maxLayover + ' h'));
    lines.push('🧳 ' + bags + T(' לנוסע', ' per passenger'));
    if (p.selfTransfer) lines.push(T('🔀 כולל כרטיסים נפרדים בהעברה עצמית (לא מוגן)', '🔀 Includes self-transfer separate tickets (not protected)'));
    var multi = p.adults + p.children + p.infants > 1;
    lines.push(T('🔔 התראה מתחת ל-$' + p.maxPrice.toLocaleString('en-US') + (multi ? ' לנוסע' : ''), '🔔 Alert under $' + p.maxPrice.toLocaleString('en-US') + (multi ? ' per passenger' : '')));
    return lines;
  }

  return {
    setPlaces: setPlaces, placeName: placeName, airlineName: airlineName, describe: describe, CITY: CITY,
    encode: encode, decode: decode, validate: validate, withDefaults: withDefaults, LIMITS: LIMITS, CABINS: CABINS, LANGS: LANGS, VERSION: VERSION,
  };
}));
