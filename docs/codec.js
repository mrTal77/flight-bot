// Trip preferences <-> a short code that fits in a Telegram "start" link (max 64 chars, A-Z a-z 0-9 _ -).
// Shared by the landing page (browser) and the bot (Node), so both read and write the same format.
// The code carries only flight preferences, the user's language, currency and time zone, and an invite code:
// no personal details. Texts come from docs/locales (docs/i18n.js); currencies and time zones from docs/regions.js.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./i18n.js'), require('./regions.js'));
  else root.FlightCodec = factory(root.FlightI18n, root.FlightRegions);
}(typeof self !== 'undefined' ? self : this, function (I18n, Regions) {
  'use strict';
  var ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var EPOCH = Date.UTC(2026, 0, 1); // day 0 of the date fields
  var AIRLINE_CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; // index 0 = none
  var CABINS = ['economy', 'premium', 'business', 'first'];
  // Language codes by their number in the code (4 bits). Append only: a language's number never changes.
  // A language here without a file in docs/locales gets the English texts.
  var LANGS = ['he', 'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ar', 'uk', 'pl', 'nl', 'tr', 'ja', 'zh', 'ko'];
  // v4 adds the language (1 bit, he/en). v2 (ranges up to 31 days) and v3 codes are still accepted.
  // v5 is a trip of several one-way flights ("legs").
  // v6 (one route) and v7 (trip) carry the language in 4 bits, plus the currency and the time zone (0 = from the origin).
  var VERSION = 6; var TRIP_VERSION = 7; var OLD_TRIP = 5;
  var MAX_LEGS = 5; var MIN_LEGS = 2; var MAX_LEG_RANGE = 31; // days in one leg's date range
  var TG_MAX = 64; // longest code in a Telegram start link; a longer trip code is pasted to the bot by hand
  var MAX_CODE = 200; // longest code the bot accepts (pasted)
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
      maxLayover: 0, selfTransfer: false, maxTripDays: 0, oneWay: false, lang: 'he', currency: '', tz: '',
    };
    var o = {}; var k;
    for (k in d) o[k] = d[k];
    for (k in p) if (p[k] !== undefined && p[k] !== null && p[k] !== '') o[k] = p[k];
    return o;
  }

  // Validation messages come from the user's language file (docs/locales, section "codec").
  function msg(lang, key, a, b) { return I18n.t(lang, 'codec.' + key, a, b); }

  // Check a preferences object; returns a list of problems in the user's language, empty if OK.
  function validate(p0, todayIso, lang) {
    if (isTrip(p0)) return validateTrip(p0, todayIso, lang);
    return check(p0, todayIso, lang).map(function (x) { return x.text; });
  }
  // Problems as { key, text }, so a trip can tell the shared settings from each flight's own.
  function check(p0, todayIso, lang) {
    var p = withDefaults(p0); var e = []; var L = lang || p.lang;
    var m = function (k, a, b) { e.push({ key: k, text: msg(L, k, a, b) }); };
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
      var name = msg(L, k === 'out' ? 'legOut' : 'legRet');
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
    checkLocal(p, m);
    return e;
  }

  // Language, currency and time zone: empty means automatic.
  function checkLocal(p, m) {
    if (p.lang && LANGS.indexOf(p.lang) < 0) m('lang');
    if (p.currency && !Regions.isCurrency(p.currency)) m('currency');
    if (p.tz && !Regions.isZone(p.tz)) m('zone');
  }
  function putLocal(w, p) {
    w.put(Math.max(0, LANGS.indexOf(p.lang || 'he')), 4);
    w.put(Math.max(0, Regions.CURRENCIES.indexOf(p.currency || '')), 6);
    w.put(Math.max(0, Regions.ZONES.indexOf(p.tz || '')), 8);
  }
  function getLocal(r, p) {
    p.lang = LANGS[r.get(4)] || 'en';
    var c = Regions.CURRENCIES[r.get(6)]; var z = Regions.ZONES[r.get(8)];
    if (c) p.currency = c;
    if (z) p.tz = z;
  }

  // ---------- trips: several one-way flights ----------
  // { trip: true, lang, invite, cabin, checkedBags, carryOn, maxLayover, selfTransfer,
  //   legs: [{ origin, destination, adults, children, infants, outFrom, outTo, airline, outMaxStops,
  //            outMaxHours, outDepFrom, outDepTo, maxPrice }] }
  // Cabin, bags, layover and self-transfer are shared; passengers, dates, filters and the price limit are per flight.
  var SHARED = ['cabin', 'checkedBags', 'carryOn', 'maxLayover', 'selfTransfer'];
  var LEG_KEYS = ['origin', 'destination', 'adults', 'children', 'infants', 'outFrom', 'outTo', 'airline', 'outMaxStops', 'outMaxHours', 'outDepFrom', 'outDepTo', 'maxPrice'];
  function isTrip(p) { return !!(p && p.trip && Array.isArray(p.legs)); }
  // One flight of a trip as ordinary one-way preferences (what the search engine and describe() understand).
  function legPrefs(p, i) {
    var o = { oneWay: true, lang: p.lang || 'he', invite: p.invite, currency: p.currency, tz: p.tz };
    SHARED.forEach(function (k) { if (p[k] !== undefined) o[k] = p[k]; });
    var l = p.legs[i] || {};
    LEG_KEYS.forEach(function (k) { if (l[k] !== undefined) o[k] = l[k]; });
    return withDefaults(o);
  }
  var SHARED_ERR = ['cabin', 'checked', 'carry', 'layover', 'invite', 'lang', 'currency', 'zone'];
  function validateTrip(p, todayIso, lang) {
    var L = lang || p.lang; var e = [];
    var n = (p.legs || []).length;
    if (n < MIN_LEGS || n > MAX_LEGS) return [msg(L, 'legCount', MIN_LEGS, MAX_LEGS)];
    check(legPrefs(p, 0), todayIso, L).forEach(function (x) { if (SHARED_ERR.indexOf(x.key) >= 0) e.push(x.text); });
    for (var i = 0; i < n; i++) {
      var q = legPrefs(p, i); var pre = msg(L, 'legPrefix', i + 1);
      check(q, todayIso, L).forEach(function (x) { if (SHARED_ERR.indexOf(x.key) < 0) e.push(pre + x.text); });
      if (/^\d{4}-\d{2}-\d{2}$/.test(q.outFrom || '') && /^\d{4}-\d{2}-\d{2}$/.test(q.outTo || '') && diff(q.outFrom, q.outTo) > MAX_LEG_RANGE) e.push(pre + msg(L, 'legRange', MAX_LEG_RANGE));
      if (i > 0) { var prev = p.legs[i - 1].outFrom; if (prev && q.outFrom && q.outFrom < prev) e.push(pre + msg(L, 'legOrder')); }
    }
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

  function putIata(w, c) { for (var k = 0; k < 3; k++) w.put(c.charCodeAt(k) - 65, 5); }
  function getIata(r) { var c = ''; for (var k = 0; k < 3; k++) c += String.fromCharCode(65 + r.get(5)); return c; }
  // v5: a flight repeats the previous one's destination as its origin, its passengers and its price limit with
  // one bit each, and stores the airline and the advanced filters only when set: about 55 bits a flight.
  function encodeTrip(p) {
    var w = new Writer(); var s = withDefaults(legPrefs(p, 0));
    w.put(TRIP_VERSION, 4);
    for (var i = 0; i < 6; i++) w.put(ALPHA.indexOf(p.invite[i]), 6);
    putLocal(w, p);
    w.put(p.legs.length - 1, 3);
    w.put(CABINS.indexOf(s.cabin), 2); w.put(s.checkedBags, 2); w.put(s.carryOn, 1); w.put(s.maxLayover, 5); w.put(s.selfTransfer ? 1 : 0, 1);
    var prev = null;
    p.legs.forEach(function (_, i) {
      var l = legPrefs(p, i);
      if (prev && l.origin === prev.destination) w.put(1, 1); else { if (prev) w.put(0, 1); putIata(w, l.origin); }
      putIata(w, l.destination);
      var samePax = prev && l.adults === prev.adults && l.children === prev.children && l.infants === prev.infants;
      if (prev) w.put(samePax ? 1 : 0, 1);
      if (!samePax) { w.put(l.adults, 4); w.put(l.children, 4); w.put(l.infants, 3); }
      w.put(dayNum(l.outFrom), 12); w.put(diff(l.outFrom, l.outTo), 5);
      w.put(l.airline ? 1 : 0, 1); if (l.airline) putAirline(w, l.airline);
      w.put(l.outMaxStops, 2);
      var adv = l.outMaxHours || l.outDepFrom || l.outDepTo !== 24;
      w.put(adv ? 1 : 0, 1); if (adv) { w.put(l.outMaxHours, 6); w.put(l.outDepFrom, 5); w.put(l.outDepTo, 5); }
      var samePrice = prev && l.maxPrice === prev.maxPrice;
      if (prev) w.put(samePrice ? 1 : 0, 1);
      if (!samePrice) w.put(l.maxPrice, 15);
      prev = l;
    });
    return w.toString();
  }
  function decodeTrip(r, ver) {
    var inv = ''; for (var i = 0; i < 6; i++) inv += ALPHA[r.get(6)];
    var p = { trip: true, invite: inv };
    if (ver === OLD_TRIP) p.lang = LANGS[r.get(1)]; else getLocal(r, p);
    var n = r.get(3) + 1;
    p.cabin = CABINS[r.get(2)]; p.checkedBags = r.get(2); p.carryOn = r.get(1); p.maxLayover = r.get(5); p.selfTransfer = r.get(1) === 1;
    p.legs = [];
    var prev = null;
    for (var k = 0; k < n; k++) {
      var l = {};
      l.origin = prev && r.get(1) === 1 ? prev.destination : getIata(r);
      l.destination = getIata(r);
      if (prev && r.get(1) === 1) { l.adults = prev.adults; l.children = prev.children; l.infants = prev.infants; } else { l.adults = r.get(4); l.children = r.get(4); l.infants = r.get(3); }
      var of = r.get(12); l.outFrom = isoOf(of); l.outTo = isoOf(of + r.get(5));
      l.airline = r.get(1) === 1 ? getAirline(r) : '';
      l.outMaxStops = r.get(2);
      if (r.get(1) === 1) { l.outMaxHours = r.get(6); l.outDepFrom = r.get(5); l.outDepTo = r.get(5); } else { l.outMaxHours = 0; l.outDepFrom = 0; l.outDepTo = 24; }
      l.maxPrice = prev && r.get(1) === 1 ? prev.maxPrice : r.get(15);
      p.legs.push(l); prev = l;
    }
    return p;
  }

  function encode(p0) {
    if (isTrip(p0)) return encodeTrip(p0);
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
    putLocal(w, p);
    return w.toString();
  }

  function decode(s) {
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(s || '')) throw new Error('bad code');
    var r = new Reader(s);
    var ver = r.get(4);
    if (ver === TRIP_VERSION || ver === OLD_TRIP) return decodeTrip(r, ver);
    if (s.length > TG_MAX) throw new Error('bad code');
    if (ver < 2 || ver > VERSION) throw new Error('unknown version');
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
    if (ver >= VERSION) getLocal(r, p); else p.lang = ver >= 4 ? LANGS[r.get(1)] : 'he';
    return p;
  }

  // Place names from docs/airports.json rows: [code, city, airport, country, rank, hebrew].
  // A language file may name cities itself ("cities") or point to a column with names in its language ("placeColumn").
  var PLACES = {};
  function setPlaces(rows) { PLACES = {}; (rows || []).forEach(function (r) { PLACES[r[0]] = r; }); }
  function placeName(code, lang) {
    var L = I18n.get(lang || 'he'); var r = PLACES[code];
    return (L.cities && L.cities[code]) || (r && L.placeColumn && r[L.placeColumn]) || (r && r[1]) || code;
  }
  function countryOf(code) { var r = PLACES[code]; return r ? r[3] : ''; }
  function airlineName(code, lang) { var a = I18n.get(lang || 'he').airlines || {}; return a[code] || (I18n.get('en').airlines || {})[code] || code; }
  function dmy(iso, lang) { return I18n.fullDate(lang, iso); }
  // The currency and time zone in use: the user's choice, or the origin airport's country.
  function localOf(p) {
    var origin = isTrip(p) ? (p.legs[0] || {}).origin : p.origin;
    var country = countryOf(origin);
    return { currency: p.currency || Regions.currencyOf(country), tz: p.tz || Regions.zoneOf(country, origin), country: country };
  }

  // Human-readable summary of the preferences, as lines (bold title marked with <b>). Same text in the bot and the page.
  function describe(p0, lang) {
    if (isTrip(p0)) return describeTrip(p0, lang);
    var p = withDefaults(p0); var L = lang || p.lang;
    var T = function (k, a, b) { return I18n.t(L, 'codec.' + k, a, b); };
    var stops = function (n) { return n === 0 ? T('stops0') : n === 1 ? T('stops1') : n >= 3 ? T('stopsAny') : T('stopsN', n); };
    var hours = function (a, b) { return a === 0 && b === 24 ? '' : T('depHours', a, b); };
    // A flexible date arrives as a range around it: show it as "about X (±n days)".
    var when = function (from, to) {
      var days = diff(from, to);
      if (days === 0) return dmy(from, L);
      if (days % 2 === 0 && days <= 10) { var n = days / 2; return T('about', n, dmy(isoOf(dayNum(from) + n), L)); }
      return dmy(from, L) + '–' + dmy(to, L);
    };
    var leg = function (icon, name, from, to, al, st, mh, df, dt) {
      return icon + ' ' + name + ': ' + when(from, to) + ' · ' + (al ? airlineName(al, L) : T('anyAirline')) + ' · ' + stops(st) + (mh ? T('upToHours', mh) : '') + hours(df, dt);
    };
    var pax = [T('adultsN', p.adults), p.children ? T('childrenN', p.children) : '', p.infants ? T('infantsN', p.infants) : ''].filter(Boolean).join(', ');
    var cabin = T('cabins')[p.cabin];
    var bags = [p.carryOn ? T('carryOn') : '', p.checkedBags ? T('checkedN', p.checkedBags) : ''].filter(Boolean).join(' + ') || T('noBags');
    var lines = [
      '✈️ <b>' + placeName(p.origin, L) + ' ' + (p.oneWay ? '→' : '⇄') + ' ' + placeName(p.destination, L) + '</b>',
      '👥 ' + pax + ' · ' + T('cabinLine', cabin),
      leg('🛫', T('outbound'), p.outFrom, p.outTo, p.airline, p.outMaxStops, p.outMaxHours, p.outDepFrom, p.outDepTo),
    ];
    if (!p.oneWay) {
      lines.push(leg('🛬', T('return'), p.retFrom, p.retTo, p.retAirline, p.retMaxStops, p.retMaxHours, p.retDepFrom, p.retDepTo));
      if (p.maxTripDays) lines.push(T('tripDaysLine', p.maxTripDays));
    }
    if (p.maxLayover) lines.push(T('layoverLine', p.maxLayover));
    lines.push('🧳 ' + bags + T('perPax'));
    if (p.selfTransfer) lines.push(T('selfTransfer'));
    var loc = localOf(p);
    lines.push(T('localLine', loc.currency, loc.tz));
    var multi = p.adults + p.children + p.infants > 1;
    lines.push(T('alertUnder', '$' + p.maxPrice.toLocaleString('en-US'), multi ? T('perPax') : ''));
    return lines;
  }

  var NUMS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'];
  // A trip: one short block per flight, then the shared settings.
  function describeTrip(p, lang) {
    var L = lang || p.lang;
    var T = function (k, a) { return I18n.t(L, 'codec.' + k, a); };
    var lines = ['🧳 <b>' + T('tripTitle', p.legs.length) + '</b>'];
    p.legs.forEach(function (_, i) {
      var q = legPrefs(p, i); var one = describe(q, L);
      // one[0] route, one[1] passengers · cabin, one[2] the flight; the last line is the alert.
      lines.push(NUMS[i] + ' <b>' + placeName(q.origin, L) + ' → ' + placeName(q.destination, L) + '</b>');
      var pax = one[1].replace(/^👥 /, '').split(' · ')[0];
      var multi = q.adults + q.children + q.infants > 1;
      lines.push('   ' + one[2].replace(/^🛫 [^:]+: /, '') + ' · ' + pax + ' · 🔔 ' + T('limit') + ' $' + q.maxPrice.toLocaleString('en-US') + (multi ? T('perPax') : ''));
    });
    var s = describe(legPrefs(p, 0), L);
    var cabin = s[1].split(' · ').slice(1).join(' · ');
    lines.push('💺 ' + cabin);
    s.slice(3, -1).forEach(function (x) { lines.push(x); }); // layover, bags, self-transfer, currency and time zone
    return lines;
  }

  return {
    isTrip: isTrip, legPrefs: legPrefs, MAX_LEGS: MAX_LEGS, MIN_LEGS: MIN_LEGS, TG_MAX: TG_MAX, MAX_CODE: MAX_CODE,
    setPlaces: setPlaces, placeName: placeName, airlineName: airlineName, countryOf: countryOf, localOf: localOf, describe: describe,
    encode: encode, decode: decode, validate: validate, withDefaults: withDefaults, LIMITS: LIMITS, CABINS: CABINS, LANGS: LANGS, VERSION: VERSION,
  };
}));
