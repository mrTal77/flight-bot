// Languages of the bot, the search messages and the landing page. Each language is one file in docs/locales/
// (shared by the browser and Node). To add a language: copy docs/locales/en.js to docs/locales/<code>.js,
// translate the texts, and add the code to AVAILABLE below (the page loads the files in this list). A text
// missing from a language falls back to English. See LANGUAGES.md.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlightI18n = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var AVAILABLE = ['he', 'en'];
  var FALLBACK = 'en';
  var LOCALES = {};

  function register(L) { if (L && L.code) LOCALES[L.code] = L; return L; }
  function has(code) { return !!LOCALES[code]; }
  function get(code) { return LOCALES[code] || LOCALES[FALLBACK]; }
  // Languages to offer: [{ code, name, dir }], in the order of AVAILABLE.
  function list() { return AVAILABLE.filter(has).map(function (c) { return { code: c, name: LOCALES[c].name, dir: LOCALES[c].dir || 'ltr' }; }); }
  // A Telegram or browser language tag ("pt-BR", "iw") -> a language we have, else English.
  function resolve(tag) {
    var s = String(tag || '').toLowerCase().replace('_', '-');
    if (s === 'iw' || s.indexOf('iw-') === 0) s = 'he';
    if (has(s)) return s;
    var base = s.split('-')[0];
    return has(base) ? base : FALLBACK;
  }
  // A language given by code or by its own name ("en", "English", "עברית") -> code, or '' if unknown.
  function find(q) {
    var s = String(q || '').trim().toLowerCase();
    if (!s) return '';
    for (var c in LOCALES) {
      var L = LOCALES[c];
      if (c === s || String(L.name).toLowerCase() === s || (L.aliases || []).indexOf(s) >= 0) return c;
    }
    return '';
  }
  function lookup(L, path) {
    var v = L; var parts = path.split('.');
    for (var i = 0; i < parts.length; i++) { if (v == null) return undefined; v = v[parts[i]]; }
    return v;
  }
  function pluralForm(lang, n, forms) {
    var cat = 'other';
    try { cat = new Intl.PluralRules(lang).select(Number(n)); } catch (e) {}
    if (cat === 'one' && Number(n) !== 1 && forms.one && forms.one.indexOf('{a}') < 0) cat = 'other';
    return forms[cat] != null ? forms[cat] : forms.other;
  }
  function fill(s, args) {
    return String(s).replace(/\{([a-f])\}/g, function (m, k) { var v = args['abcdef'.indexOf(k)]; return v == null ? '' : String(v); });
  }
  // t(lang, 'bot.help'), t(lang, 'search.limit', '$400'). {a} {b} ... are the arguments in order.
  // A text may be { one, two, other } (chosen by the first argument, a number) or a function of the arguments.
  function t(lang, key) {
    var args = Array.prototype.slice.call(arguments, 2);
    var v = lookup(get(lang), key);
    var used = lang;
    if (v === undefined && lang !== FALLBACK) { v = lookup(get(FALLBACK), key); used = FALLBACK; }
    if (v === undefined) return '';
    if (typeof v === 'function') return v.apply(null, args);
    if (v && typeof v === 'object' && !Array.isArray(v) && (v.other != null)) v = pluralForm(used, args[0], v);
    if (typeof v !== 'string') return v;
    return fill(v, args);
  }
  function intlTag(lang) { return (get(lang).intl) || lang; }

  // ---------- dates and money ----------
  // A language may give its own date formats (locale.dates); otherwise they come from Intl.
  var MONTH = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  function utc(iso) { return new Date(iso + 'T00:00:00Z'); }
  // "Sun 20 Dec"
  function dayDate(lang, iso) {
    var L = get(lang);
    if (L.dates && L.dates.day) return L.dates.day(iso);
    return new Intl.DateTimeFormat(intlTag(lang), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(utc(iso));
  }
  // "20 Dec 2026"
  function fullDate(lang, iso) {
    var L = get(lang);
    if (L.dates && L.dates.full) return L.dates.full(iso);
    return new Intl.DateTimeFormat(intlTag(lang), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(utc(iso));
  }
  // "20 Dec" (no year)
  function shortDate(lang, iso) {
    var L = get(lang);
    if (L.dates && L.dates.short) return L.dates.short(iso);
    return new Intl.DateTimeFormat(intlTag(lang), MONTH).format(utc(iso));
  }
  // "10–16 Jan", "28 Jan – 3 Feb", "12 Jan"
  function dateRange(lang, a, b) {
    var L = get(lang);
    if (L.dates && L.dates.range) return L.dates.range(a, b);
    if (a === b) return shortDate(lang, a);
    try { return new Intl.DateTimeFormat(intlTag(lang), MONTH).formatRange(utc(a), utc(b)); } catch (e) { return shortDate(lang, a) + '–' + shortDate(lang, b); }
  }
  // "$1,000", "€920", "₪3,200", "CHF 870": symbol first, whole units, the same digits everywhere.
  function money(amount, currency) {
    var cur = currency || 'USD'; var sym = cur;
    try {
      var parts = new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).formatToParts(0);
      for (var i = 0; i < parts.length; i++) if (parts[i].type === 'currency') sym = parts[i].value;
    } catch (e) {}
    if (cur === 'AUD') sym = 'A$';
    return sym + (/[A-Za-z]$/.test(sym) ? ' ' : '') + Math.round(amount).toLocaleString('en-US');
  }
  // "Germany" in the user's language
  function regionName(lang, country) {
    try { return new Intl.DisplayNames([intlTag(lang)], { type: 'region' }).of(country) || country; } catch (e) { return country; }
  }

  var api = { AVAILABLE: AVAILABLE, FALLBACK: FALLBACK, register: register, has: has, get: get, list: list, resolve: resolve, find: find, t: t,
    dayDate: dayDate, fullDate: fullDate, shortDate: shortDate, dateRange: dateRange, money: money, regionName: regionName, intlTag: intlTag };
  // Node: load every language in the list. The browser loads them with <script> tags (docs/index.html).
  if (typeof module === 'object' && module.exports && typeof require === 'function') {
    AVAILABLE.forEach(function (c) { register(require('./locales/' + c + '.js')); });
  }
  return api;
}));
