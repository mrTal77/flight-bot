// Trip preferences <-> a short code that fits in a Telegram "start" link (max 64 chars, A-Z a-z 0-9 _ -).
// Shared by the landing page (browser) and the bot (Node), so both read and write the same format.
// The code carries only flight preferences and an invite code: no personal details.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlightCodec = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var EPOCH = Date.UTC(2026, 0, 1); // day 0 of the date fields
  var AIRLINE_CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; // index 0 = none
  var CABINS = ['economy', 'premium', 'business', 'first'];
  var VERSION = 3; // v2 codes (range up to 31 days) are still accepted
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
      maxLayover: 0, selfTransfer: false, maxTripDays: 0, oneWay: false,
    };
    var o = {}; var k;
    for (k in d) o[k] = d[k];
    for (k in p) if (p[k] !== undefined && p[k] !== null && p[k] !== '') o[k] = p[k];
    return o;
  }

  // Check a preferences object; returns a list of problems (in Hebrew, for the user), empty if OK.
  function validate(p0, todayIso) {
    var p = withDefaults(p0); var e = [];
    var iata = /^[A-Z]{3}$/; var al = /^[A-Z0-9]{2}$/; var d = /^\d{4}-\d{2}-\d{2}$/;
    if (!iata.test(p.origin || '')) e.push('צריך לבחור מוצא מהרשימה');
    if (!iata.test(p.destination || '')) e.push('צריך לבחור יעד מהרשימה');
    if (p.origin && p.origin === p.destination) e.push('המוצא והיעד זהים');
    if (p.airline && !al.test(p.airline)) e.push('קוד חברת התעופה בהלוך לא תקין (2 תווים, למשל LY)');
    if (p.retAirline && !al.test(p.retAirline)) e.push('קוד חברת התעופה בחזור לא תקין (2 תווים)');
    if (!inRange(p.adults, 1, LIMITS.maxAdults)) e.push('מבוגרים: 1 עד ' + LIMITS.maxAdults);
    if (!inRange(p.children, 0, LIMITS.maxChildren)) e.push('ילדים: 0 עד ' + LIMITS.maxChildren);
    if (!inRange(p.infants, 0, LIMITS.maxInfants) || p.infants > p.adults) e.push('תינוקות: עד תינוק אחד לכל מבוגר');
    if (p.adults + p.children + p.infants > LIMITS.maxPassengers) e.push('עד ' + LIMITS.maxPassengers + ' נוסעים בסך הכול');
    if (CABINS.indexOf(p.cabin) < 0) e.push('מחלקה לא תקינה');
    if (!inRange(p.checkedBags, 0, LIMITS.maxCheckedPerPax)) e.push('מזוודות לנוסע: 0 עד ' + LIMITS.maxCheckedPerPax);
    if (!inRange(p.carryOn, 0, 1)) e.push('תיק עלייה לנוסע: 0 או 1');
    var legs = [['out', 'ההלוך']].concat(p.oneWay ? [] : [['ret', 'החזור']]);
    legs.forEach(function (l) {
      var k = l[0]; var name = l[1];
      if (!inRange(p[k + 'MaxStops'], 0, LIMITS.maxStops)) e.push('עצירות ב' + name.slice(1) + ': 0 עד ' + LIMITS.maxStops);
      if (!inRange(p[k + 'MaxHours'], 0, LIMITS.maxHours)) e.push('משך ' + name + ': 0 עד ' + LIMITS.maxHours + ' שעות');
      if (!inRange(p[k + 'DepFrom'], 0, 23) || !inRange(p[k + 'DepTo'], 1, 24) || p[k + 'DepTo'] <= p[k + 'DepFrom']) e.push('שעות ההמראה של ' + name + ' לא תקינות');
    });
    if (!inRange(p.maxLayover, 0, LIMITS.maxLayover)) e.push('עצירת ביניים מקסימלית: 0 עד ' + LIMITS.maxLayover + ' שעות');
    if (!d.test(p.outFrom || '') || !d.test(p.outTo || '')) e.push('חסרים תאריכי הלוך');
    else {
      if (p.outTo < p.outFrom) e.push('תאריך הסיום של ההלוך לפני תאריך ההתחלה');
      if (todayIso && p.outFrom < todayIso) e.push('תאריך ההלוך כבר עבר');
      if (dayNum(p.outFrom) < 0 || dayNum(p.outTo) > 4095) e.push('תאריך הלוך מחוץ לטווח הנתמך');
    }
    if (!p.oneWay) {
      if (!d.test(p.retFrom || '') || !d.test(p.retTo || '')) e.push('חסרים תאריכי חזור');
      else {
        if (p.retTo < p.retFrom) e.push('תאריך הסיום של החזור לפני תאריך ההתחלה');
        if (p.outFrom && p.retFrom < p.outFrom) e.push('החזור מתחיל לפני ההלוך');
        if (dayNum(p.retFrom) < 0 || dayNum(p.retTo) > 4095) e.push('תאריך חזור מחוץ לטווח הנתמך');
      }
      if (!inRange(p.maxTripDays, 0, LIMITS.maxTripDays)) e.push('אורך טיול מקסימלי: 0 עד ' + LIMITS.maxTripDays + ' ימים');
      // With a trip-length limit, at least one outbound/return pair must fit: latest outbound + limit >= earliest return.
      else if (p.maxTripDays && d.test(p.outTo || '') && d.test(p.retFrom || '') && diff(p.outTo, p.retFrom) > p.maxTripDays) {
        e.push('אורך הטיול המקסימלי (' + p.maxTripDays + ' ימים) קצר מדי לתאריכים שבחרת: בין ההלוך האחרון לחזור הראשון יש ' + diff(p.outTo, p.retFrom) + ' ימים. אפשר להגדיל את אורך הטיול או לשים 0');
      }
    }
    if (!inRange(p.maxPrice, LIMITS.minPrice, LIMITS.maxPrice)) e.push('מחיר מקסימלי לנוסע: ' + LIMITS.minPrice + ' עד ' + LIMITS.maxPrice + ' דולר');
    if (!/^[A-Za-z0-9_-]{6}$/.test(p.invite || '')) e.push('קוד ההזמנה חסר או לא תקין');
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
    return w.toString();
  }

  function decode(s) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(s || '')) throw new Error('bad code');
    var r = new Reader(s);
    var ver = r.get(4); if (ver !== VERSION && ver !== 2) throw new Error('unknown version');
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
    return p;
  }


  var CITY = { TLV: 'תל אביב', MIA: 'מיאמי', JFK: 'ניו יורק', EWR: 'ניו יורק', LAX: 'לוס אנג׳לס', LHR: 'לונדון', CDG: 'פריז',
    FCO: 'רומא', ATH: 'אתונה', BCN: 'ברצלונה', MAD: 'מדריד', BER: 'ברלין', AMS: 'אמסטרדם', PRG: 'פראג', BUD: 'בודפשט',
    VIE: 'וינה', LCA: 'לרנקה', DXB: 'דובאי', BKK: 'בנגקוק', NRT: 'טוקיו', YYZ: 'טורונטו' };
  var AIRLINE = { LY: 'אל על', IZ: 'ארקיע', '6H': 'ישראייר' };
  // Place names from docs/airports.json rows: [code, city, airport, country, rank, hebrew].
  var PLACES = {};
  function setPlaces(rows) { PLACES = {}; (rows || []).forEach(function (r) { PLACES[r[0]] = r; }); }
  function placeName(code) { var r = PLACES[code]; return CITY[code] || (r && (r[5] || r[1])) || code; }
  function dmy(iso) { return Number(iso.slice(8)) + '.' + Number(iso.slice(5, 7)) + '.' + iso.slice(0, 4); }
  // Human-readable summary of the preferences, as lines (bold title marked with <b>). Same text in the bot and the page.
  function describe(p0) {
    var p = withDefaults(p0);
    var stops = function (n) { return n === 0 ? 'ישיר' : n === 1 ? 'עד עצירה אחת' : n >= 3 ? 'כל מספר עצירות' : 'עד ' + n + ' עצירות'; };
    var hours = function (a, b) { return a === 0 && b === 24 ? '' : ' · המראה ' + a + ':00–' + b + ':00'; };
    // A flexible date arrives as a range around it: show it as "about X (±n days)".
    var when = function (from, to) {
      var days = diff(from, to);
      if (days === 0) return dmy(from);
      if (days % 2 === 0 && days <= 10) return 'בערך ' + dmy(isoOf(dayNum(from) + days / 2)) + ' (±' + days / 2 + ' ' + (days / 2 === 1 ? 'יום' : 'ימים') + ')';
      return dmy(from) + '–' + dmy(to);
    };
    var leg = function (icon, name, from, to, al, st, mh, df, dt) {
      return icon + ' ' + name + ': ' + when(from, to) + ' · ' + (al ? AIRLINE[al] || al : 'כל חברה') + ' · ' + stops(st) + (mh ? ' · עד ' + mh + ' ש׳' : '') + hours(df, dt);
    };
    var pax = [p.adults + ' ' + (p.adults === 1 ? 'מבוגר' : 'מבוגרים'), p.children ? p.children + ' ' + (p.children === 1 ? 'ילד' : 'ילדים') : '',
      p.infants ? p.infants + ' ' + (p.infants === 1 ? 'תינוק' : 'תינוקות') : ''].filter(Boolean).join(', ');
    var cabin = { economy: 'תיירים', premium: 'פרימיום', business: 'עסקים', first: 'ראשונה' }[p.cabin];
    var bags = [p.carryOn ? 'תיק עלייה' : '', p.checkedBags ? (p.checkedBags === 1 ? 'מזוודה' : p.checkedBags + ' מזוודות') : ''].filter(Boolean).join(' + ') || 'בלי כבודה';
    var lines = [
      '✈️ <b>' + placeName(p.origin) + ' ' + (p.oneWay ? '→' : '⇄') + ' ' + placeName(p.destination) + '</b>',
      '👥 ' + pax + ' · מחלקת ' + cabin,
      leg('🛫', 'הלוך', p.outFrom, p.outTo, p.airline, p.outMaxStops, p.outMaxHours, p.outDepFrom, p.outDepTo),
    ];
    if (!p.oneWay) {
      lines.push(leg('🛬', 'חזור', p.retFrom, p.retTo, p.retAirline, p.retMaxStops, p.retMaxHours, p.retDepFrom, p.retDepTo));
      if (p.maxTripDays) lines.push('📅 אורך הטיול: עד ' + p.maxTripDays + ' ימים');
    }
    if (p.maxLayover) lines.push('⏱️ עצירת ביניים: עד ' + p.maxLayover + ' ש׳');
    lines.push('🧳 ' + bags + ' לנוסע');
    if (p.selfTransfer) lines.push('🔀 כולל כרטיסים נפרדים בהעברה עצמית (לא מוגן)');
    lines.push('🔔 התראה מתחת ל-$' + p.maxPrice.toLocaleString('en-US') + (p.adults + p.children + p.infants > 1 ? ' לנוסע' : ''));
    return lines;
  }

  return { setPlaces: setPlaces, placeName: placeName, describe: describe, CITY: CITY, AIRLINE: AIRLINE, encode: encode, decode: decode, validate: validate, withDefaults: withDefaults, LIMITS: LIMITS, CABINS: CABINS, VERSION: VERSION };
}));
