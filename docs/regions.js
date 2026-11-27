// Countries, currencies and time zones, shared by the landing page (browser) and the bot (Node).
// A user's currency and time zone default to their origin airport's country; both can be changed in the form
// or in the chat (/currency, /tz). The lists CURRENCIES and ZONES are written into the form code by index, so
// they are append-only: add new entries at the end, never reorder or remove one.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlightRegions = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Index 0 = automatic (from the origin country). Append only.
  var CURRENCIES = ['', 'USD', 'EUR', 'GBP', 'ILS', 'AUD', 'CAD', 'CHF', 'JPY', 'CNY', 'INR', 'BRL', 'MXN', 'ZAR', 'SEK', 'NOK',
    'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'TRY', 'AED', 'SAR', 'SGD', 'HKD', 'NZD', 'KRW', 'THB', 'PHP', 'IDR', 'MYR', 'VND', 'TWD',
    'ARS', 'CLP', 'COP', 'PEN', 'EGP', 'MAD', 'UAH', 'BGN', 'ISK', 'KES', 'NGN', 'QAR', 'KWD', 'JOD', 'GEL', 'RSD', 'BHD', 'OMR'];

  var EUR = 'AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK MC SM VA AD ME XK GF GP MQ RE YT BL MF PM'.split(' ');
  var CURRENCY_BY_COUNTRY = {
    US: 'USD', PR: 'USD', GU: 'USD', VI: 'USD', AS: 'USD', MP: 'USD', UM: 'USD', EC: 'USD', SV: 'USD', PA: 'USD', TL: 'USD', FM: 'USD', MH: 'USD', PW: 'USD', BQ: 'USD', TC: 'USD', VG: 'USD',
    GB: 'GBP', IM: 'GBP', JE: 'GBP', GG: 'GBP', IL: 'ILS', AU: 'AUD', CX: 'AUD', CC: 'AUD', NF: 'AUD', KI: 'AUD', NR: 'AUD', TV: 'AUD',
    CA: 'CAD', CH: 'CHF', LI: 'CHF', JP: 'JPY', CN: 'CNY', IN: 'INR', BR: 'BRL', MX: 'MXN', ZA: 'ZAR', SE: 'SEK', NO: 'NOK',
    DK: 'DKK', FO: 'DKK', GL: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', TR: 'TRY', AE: 'AED', SA: 'SAR', SG: 'SGD',
    HK: 'HKD', NZ: 'NZD', CK: 'NZD', NU: 'NZD', KR: 'KRW', TH: 'THB', PH: 'PHP', ID: 'IDR', MY: 'MYR', VN: 'VND', TW: 'TWD',
    AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN', EG: 'EGP', MA: 'MAD', EH: 'MAD', UA: 'UAH', BG: 'BGN', IS: 'ISK', KE: 'KES',
    NG: 'NGN', QA: 'QAR', KW: 'KWD', JO: 'JOD', GE: 'GEL', RS: 'RSD', BH: 'BHD', OM: 'OMR',
  };
  EUR.forEach(function (c) { CURRENCY_BY_COUNTRY[c] = 'EUR'; });

  // Index 0 = automatic (from the origin airport). Append only.
  var ZONES = ['',
    'UTC', 'Asia/Jerusalem', 'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Madrid', 'Europe/Paris', 'Europe/Brussels',
    'Europe/Amsterdam', 'Europe/Luxembourg', 'Europe/Berlin', 'Europe/Zurich', 'Europe/Vienna', 'Europe/Rome', 'Europe/Malta',
    'Europe/Prague', 'Europe/Bratislava', 'Europe/Warsaw', 'Europe/Budapest', 'Europe/Ljubljana', 'Europe/Zagreb', 'Europe/Belgrade',
    'Europe/Sarajevo', 'Europe/Podgorica', 'Europe/Skopje', 'Europe/Tirane', 'Europe/Copenhagen', 'Europe/Oslo', 'Europe/Stockholm',
    'Europe/Helsinki', 'Europe/Tallinn', 'Europe/Riga', 'Europe/Vilnius', 'Europe/Athens', 'Europe/Sofia', 'Europe/Bucharest',
    'Europe/Chisinau', 'Europe/Kyiv', 'Europe/Minsk', 'Europe/Moscow', 'Europe/Istanbul', 'Asia/Nicosia', 'Atlantic/Reykjavik',
    'Atlantic/Faroe', 'Atlantic/Canary', 'Atlantic/Azores', 'Asia/Tbilisi', 'Asia/Yerevan', 'Asia/Baku', 'Asia/Beirut', 'Asia/Amman',
    'Asia/Damascus', 'Asia/Baghdad', 'Asia/Kuwait', 'Asia/Riyadh', 'Asia/Bahrain', 'Asia/Qatar', 'Asia/Dubai', 'Asia/Muscat',
    'Asia/Tehran', 'Asia/Kabul', 'Asia/Karachi', 'Asia/Tashkent', 'Asia/Almaty', 'Asia/Bishkek', 'Asia/Dushanbe', 'Asia/Ashgabat',
    'Asia/Kolkata', 'Asia/Colombo', 'Asia/Kathmandu', 'Asia/Dhaka', 'Asia/Thimphu', 'Indian/Maldives', 'Asia/Yangon', 'Asia/Bangkok',
    'Asia/Ho_Chi_Minh', 'Asia/Phnom_Penh', 'Asia/Vientiane', 'Asia/Kuala_Lumpur', 'Asia/Singapore', 'Asia/Jakarta', 'Asia/Makassar',
    'Asia/Manila', 'Asia/Brunei', 'Asia/Dili', 'Asia/Hong_Kong', 'Asia/Macau', 'Asia/Shanghai', 'Asia/Taipei', 'Asia/Seoul',
    'Asia/Pyongyang', 'Asia/Tokyo', 'Asia/Ulaanbaatar', 'Asia/Yekaterinburg', 'Asia/Novosibirsk', 'Asia/Vladivostok',
    'Australia/Perth', 'Australia/Darwin', 'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Sydney', 'Australia/Melbourne',
    'Pacific/Auckland', 'Pacific/Fiji', 'Pacific/Port_Moresby', 'Pacific/Guam', 'Pacific/Noumea', 'Pacific/Tahiti', 'Pacific/Honolulu',
    'Pacific/Apia', 'Pacific/Tongatapu', 'Pacific/Efate', 'Pacific/Guadalcanal', 'Pacific/Tarawa', 'Pacific/Rarotonga',
    'America/Anchorage', 'America/Los_Angeles', 'America/Phoenix', 'America/Denver', 'America/Chicago', 'America/New_York',
    'America/Vancouver', 'America/Edmonton', 'America/Winnipeg', 'America/Toronto', 'America/Halifax', 'America/St_Johns',
    'America/Mexico_City', 'America/Cancun', 'America/Tijuana', 'America/Guatemala', 'America/Belize', 'America/El_Salvador',
    'America/Tegucigalpa', 'America/Managua', 'America/Costa_Rica', 'America/Panama', 'America/Havana', 'America/Jamaica',
    'America/Port-au-Prince', 'America/Santo_Domingo', 'America/Puerto_Rico', 'America/Nassau', 'America/Barbados',
    'America/Port_of_Spain', 'America/Curacao', 'America/Aruba', 'America/Martinique', 'America/Guadeloupe', 'America/Bogota',
    'America/Caracas', 'America/Guyana', 'America/Paramaribo', 'America/Cayenne', 'America/Lima', 'America/Guayaquil',
    'America/La_Paz', 'America/Santiago', 'America/Argentina/Buenos_Aires', 'America/Montevideo', 'America/Asuncion',
    'America/Sao_Paulo', 'America/Manaus', 'America/Fortaleza', 'Atlantic/Cape_Verde', 'Africa/Casablanca', 'Africa/Algiers',
    'Africa/Tunis', 'Africa/Tripoli', 'Africa/Cairo', 'Africa/Khartoum', 'Africa/Juba', 'Africa/Addis_Ababa', 'Africa/Asmara',
    'Africa/Djibouti', 'Africa/Mogadishu', 'Africa/Nairobi', 'Africa/Kampala', 'Africa/Kigali', 'Africa/Bujumbura',
    'Africa/Dar_es_Salaam', 'Africa/Lusaka', 'Africa/Harare', 'Africa/Maputo', 'Africa/Blantyre', 'Africa/Johannesburg',
    'Africa/Maseru', 'Africa/Mbabane', 'Africa/Gaborone', 'Africa/Windhoek', 'Africa/Luanda', 'Africa/Kinshasa', 'Africa/Lubumbashi',
    'Africa/Brazzaville', 'Africa/Libreville', 'Africa/Malabo', 'Africa/Douala', 'Africa/Bangui', 'Africa/Ndjamena', 'Africa/Lagos',
    'Africa/Niamey', 'Africa/Porto-Novo', 'Africa/Lome', 'Africa/Accra', 'Africa/Abidjan', 'Africa/Ouagadougou', 'Africa/Bamako',
    'Africa/Dakar', 'Africa/Banjul', 'Africa/Bissau', 'Africa/Conakry', 'Africa/Freetown', 'Africa/Monrovia', 'Africa/Nouakchott',
    'Africa/Sao_Tome', 'Indian/Antananarivo', 'Indian/Mauritius', 'Indian/Reunion', 'Indian/Mahe', 'Indian/Comoro', 'Indian/Mayotte',
    'Atlantic/St_Helena', 'Atlantic/Stanley', 'Atlantic/Bermuda', 'America/Nuuk', 'Europe/Gibraltar', 'Europe/Andorra', 'Europe/Monaco',
    'Asia/Kamchatka', 'Asia/Irkutsk', 'Asia/Krasnoyarsk', 'Asia/Omsk', 'Asia/Magadan', 'Europe/Samara', 'Europe/Kaliningrad'];

  // The main time zone of each country (a user picks another one in the form or with /tz).
  var ZONE_BY_COUNTRY = {
    IL: 'Asia/Jerusalem', GB: 'Europe/London', IM: 'Europe/London', JE: 'Europe/London', GG: 'Europe/London', IE: 'Europe/Dublin',
    PT: 'Europe/Lisbon', ES: 'Europe/Madrid', FR: 'Europe/Paris', BE: 'Europe/Brussels', NL: 'Europe/Amsterdam', LU: 'Europe/Luxembourg',
    DE: 'Europe/Berlin', CH: 'Europe/Zurich', LI: 'Europe/Zurich', AT: 'Europe/Vienna', IT: 'Europe/Rome', SM: 'Europe/Rome',
    VA: 'Europe/Rome', MT: 'Europe/Malta', CZ: 'Europe/Prague', SK: 'Europe/Bratislava', PL: 'Europe/Warsaw', HU: 'Europe/Budapest',
    SI: 'Europe/Ljubljana', HR: 'Europe/Zagreb', RS: 'Europe/Belgrade', XK: 'Europe/Belgrade', BA: 'Europe/Sarajevo', ME: 'Europe/Podgorica',
    MK: 'Europe/Skopje', AL: 'Europe/Tirane', DK: 'Europe/Copenhagen', NO: 'Europe/Oslo', SE: 'Europe/Stockholm', FI: 'Europe/Helsinki',
    EE: 'Europe/Tallinn', LV: 'Europe/Riga', LT: 'Europe/Vilnius', GR: 'Europe/Athens', BG: 'Europe/Sofia', RO: 'Europe/Bucharest',
    MD: 'Europe/Chisinau', UA: 'Europe/Kyiv', BY: 'Europe/Minsk', RU: 'Europe/Moscow', TR: 'Europe/Istanbul', CY: 'Asia/Nicosia',
    IS: 'Atlantic/Reykjavik', FO: 'Atlantic/Faroe', GE: 'Asia/Tbilisi', AM: 'Asia/Yerevan', AZ: 'Asia/Baku', LB: 'Asia/Beirut',
    JO: 'Asia/Amman', SY: 'Asia/Damascus', IQ: 'Asia/Baghdad', KW: 'Asia/Kuwait', SA: 'Asia/Riyadh', YE: 'Asia/Riyadh', BH: 'Asia/Bahrain',
    QA: 'Asia/Qatar', AE: 'Asia/Dubai', OM: 'Asia/Muscat', IR: 'Asia/Tehran', AF: 'Asia/Kabul', PK: 'Asia/Karachi', UZ: 'Asia/Tashkent',
    KZ: 'Asia/Almaty', KG: 'Asia/Bishkek', TJ: 'Asia/Dushanbe', TM: 'Asia/Ashgabat', IN: 'Asia/Kolkata', LK: 'Asia/Colombo',
    NP: 'Asia/Kathmandu', BD: 'Asia/Dhaka', BT: 'Asia/Thimphu', MV: 'Indian/Maldives', MM: 'Asia/Yangon', TH: 'Asia/Bangkok',
    VN: 'Asia/Ho_Chi_Minh', KH: 'Asia/Phnom_Penh', LA: 'Asia/Vientiane', MY: 'Asia/Kuala_Lumpur', SG: 'Asia/Singapore', ID: 'Asia/Jakarta',
    PH: 'Asia/Manila', BN: 'Asia/Brunei', TL: 'Asia/Dili', HK: 'Asia/Hong_Kong', MO: 'Asia/Macau', CN: 'Asia/Shanghai', TW: 'Asia/Taipei',
    KR: 'Asia/Seoul', KP: 'Asia/Pyongyang', JP: 'Asia/Tokyo', MN: 'Asia/Ulaanbaatar', AU: 'Australia/Sydney', CX: 'Asia/Bangkok',
    CC: 'Asia/Yangon', NZ: 'Pacific/Auckland', FJ: 'Pacific/Fiji', PG: 'Pacific/Port_Moresby', GU: 'Pacific/Guam', MP: 'Pacific/Guam',
    NC: 'Pacific/Noumea', PF: 'Pacific/Tahiti', WS: 'Pacific/Apia', AS: 'Pacific/Apia', TO: 'Pacific/Tongatapu', VU: 'Pacific/Efate',
    SB: 'Pacific/Guadalcanal', KI: 'Pacific/Tarawa', CK: 'Pacific/Rarotonga', NU: 'Pacific/Rarotonga', NF: 'Pacific/Auckland',
    FM: 'Pacific/Guam', MH: 'Pacific/Tarawa', PW: 'Asia/Tokyo', NR: 'Pacific/Tarawa', TV: 'Pacific/Tarawa', WF: 'Pacific/Fiji',
    US: 'America/New_York', UM: 'Pacific/Honolulu', CA: 'America/Toronto', MX: 'America/Mexico_City', GT: 'America/Guatemala',
    BZ: 'America/Belize', SV: 'America/El_Salvador', HN: 'America/Tegucigalpa', NI: 'America/Managua', CR: 'America/Costa_Rica',
    PA: 'America/Panama', CU: 'America/Havana', JM: 'America/Jamaica', KY: 'America/Jamaica', HT: 'America/Port-au-Prince',
    DO: 'America/Santo_Domingo', PR: 'America/Puerto_Rico', VI: 'America/Puerto_Rico', VG: 'America/Puerto_Rico', AI: 'America/Puerto_Rico',
    AG: 'America/Puerto_Rico', KN: 'America/Puerto_Rico', MS: 'America/Puerto_Rico', DM: 'America/Puerto_Rico', LC: 'America/Puerto_Rico',
    VC: 'America/Puerto_Rico', GD: 'America/Puerto_Rico', BL: 'America/Puerto_Rico', MF: 'America/Puerto_Rico', SX: 'America/Puerto_Rico',
    BQ: 'America/Curacao', BS: 'America/Nassau', TC: 'America/Nassau', BB: 'America/Barbados', TT: 'America/Port_of_Spain',
    CW: 'America/Curacao', AW: 'America/Aruba', MQ: 'America/Martinique', GP: 'America/Guadeloupe', CO: 'America/Bogota',
    VE: 'America/Caracas', GY: 'America/Guyana', SR: 'America/Paramaribo', GF: 'America/Cayenne', PE: 'America/Lima',
    EC: 'America/Guayaquil', BO: 'America/La_Paz', CL: 'America/Santiago', AR: 'America/Argentina/Buenos_Aires', UY: 'America/Montevideo',
    PY: 'America/Asuncion', BR: 'America/Sao_Paulo', CV: 'Atlantic/Cape_Verde', MA: 'Africa/Casablanca', EH: 'Africa/Casablanca',
    DZ: 'Africa/Algiers', TN: 'Africa/Tunis', LY: 'Africa/Tripoli', EG: 'Africa/Cairo', SD: 'Africa/Khartoum', SS: 'Africa/Juba',
    ET: 'Africa/Addis_Ababa', ER: 'Africa/Asmara', DJ: 'Africa/Djibouti', SO: 'Africa/Mogadishu', KE: 'Africa/Nairobi', UG: 'Africa/Kampala',
    RW: 'Africa/Kigali', BI: 'Africa/Bujumbura', TZ: 'Africa/Dar_es_Salaam', ZM: 'Africa/Lusaka', ZW: 'Africa/Harare', MZ: 'Africa/Maputo',
    MW: 'Africa/Blantyre', ZA: 'Africa/Johannesburg', LS: 'Africa/Maseru', SZ: 'Africa/Mbabane', BW: 'Africa/Gaborone', NA: 'Africa/Windhoek',
    AO: 'Africa/Luanda', CD: 'Africa/Kinshasa', CG: 'Africa/Brazzaville', GA: 'Africa/Libreville', GQ: 'Africa/Malabo', CM: 'Africa/Douala',
    CF: 'Africa/Bangui', TD: 'Africa/Ndjamena', NG: 'Africa/Lagos', NE: 'Africa/Niamey', BJ: 'Africa/Porto-Novo', TG: 'Africa/Lome',
    GH: 'Africa/Accra', CI: 'Africa/Abidjan', BF: 'Africa/Ouagadougou', ML: 'Africa/Bamako', SN: 'Africa/Dakar', GM: 'Africa/Banjul',
    GW: 'Africa/Bissau', GN: 'Africa/Conakry', SL: 'Africa/Freetown', LR: 'Africa/Monrovia', MR: 'Africa/Nouakchott', ST: 'Africa/Sao_Tome',
    MG: 'Indian/Antananarivo', MU: 'Indian/Mauritius', RE: 'Indian/Reunion', SC: 'Indian/Mahe', KM: 'Indian/Comoro', YT: 'Indian/Mayotte',
    SH: 'Atlantic/St_Helena', FK: 'Atlantic/Stanley', BM: 'Atlantic/Bermuda', GL: 'America/Nuuk', GI: 'Europe/Gibraltar',
    AD: 'Europe/Andorra', MC: 'Europe/Monaco', PM: 'America/Halifax',
  };
  // Airports in countries with several time zones whose zone is not the country's main one.
  var ZONE_BY_AIRPORT = {
    LAX: 'America/Los_Angeles', SFO: 'America/Los_Angeles', SJC: 'America/Los_Angeles', OAK: 'America/Los_Angeles', SAN: 'America/Los_Angeles',
    SEA: 'America/Los_Angeles', PDX: 'America/Los_Angeles', LAS: 'America/Los_Angeles', SMF: 'America/Los_Angeles', BUR: 'America/Los_Angeles',
    SNA: 'America/Los_Angeles', ONT: 'America/Los_Angeles', LGB: 'America/Los_Angeles', RNO: 'America/Los_Angeles', PHX: 'America/Phoenix',
    TUS: 'America/Phoenix', DEN: 'America/Denver', SLC: 'America/Denver', ABQ: 'America/Denver', BOI: 'America/Denver', ORD: 'America/Chicago',
    MDW: 'America/Chicago', DFW: 'America/Chicago', DAL: 'America/Chicago', IAH: 'America/Chicago', HOU: 'America/Chicago', AUS: 'America/Chicago',
    SAT: 'America/Chicago', MSP: 'America/Chicago', STL: 'America/Chicago', MCI: 'America/Chicago', MSY: 'America/Chicago', BNA: 'America/Chicago',
    MEM: 'America/Chicago', MKE: 'America/Chicago', OKC: 'America/Chicago', OMA: 'America/Chicago', HNL: 'Pacific/Honolulu',
    OGG: 'Pacific/Honolulu', KOA: 'Pacific/Honolulu', LIH: 'Pacific/Honolulu', ANC: 'America/Anchorage', FAI: 'America/Anchorage',
    YVR: 'America/Vancouver', YYJ: 'America/Vancouver', YYC: 'America/Edmonton', YEG: 'America/Edmonton', YWG: 'America/Winnipeg',
    YHZ: 'America/Halifax', YYT: 'America/St_Johns', CUN: 'America/Cancun', TIJ: 'America/Tijuana', PER: 'Australia/Perth',
    DRW: 'Australia/Darwin', ADL: 'Australia/Adelaide', BNE: 'Australia/Brisbane', OOL: 'Australia/Brisbane', CNS: 'Australia/Brisbane',
    MEL: 'Australia/Melbourne', MAO: 'America/Manaus', FOR: 'America/Fortaleza', REC: 'America/Fortaleza', SVX: 'Asia/Yekaterinburg',
    OVB: 'Asia/Novosibirsk', VVO: 'Asia/Vladivostok', KJA: 'Asia/Krasnoyarsk', IKT: 'Asia/Irkutsk', OMS: 'Asia/Omsk', KGD: 'Europe/Kaliningrad',
    KUF: 'Europe/Samara', PKC: 'Asia/Kamchatka', GYD: 'Asia/Baku', ALA: 'Asia/Almaty', NQZ: 'Asia/Almaty', DPS: 'Asia/Makassar',
    UPG: 'Asia/Makassar', TFS: 'Atlantic/Canary', TFN: 'Atlantic/Canary', LPA: 'Atlantic/Canary', ACE: 'Atlantic/Canary', FUE: 'Atlantic/Canary',
    PDL: 'Atlantic/Azores',
  };

  var currencyOf = function (country) { return CURRENCY_BY_COUNTRY[country] || 'USD'; };
  var zoneOf = function (country, airport) { return ZONE_BY_AIRPORT[airport] || ZONE_BY_COUNTRY[country] || 'UTC'; };
  var isZone = function (z) { return ZONES.indexOf(z) > 0; };
  var isCurrency = function (c) { return CURRENCIES.indexOf(c) > 0; };
  // "europe/berlin" -> "Europe/Berlin"; "berlin" -> "Europe/Berlin" (the city part of a zone name).
  function findZone(q) {
    var s = String(q || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (!s) return '';
    for (var i = 1; i < ZONES.length; i++) if (ZONES[i].toLowerCase() === s) return ZONES[i];
    for (var j = 1; j < ZONES.length; j++) if (ZONES[j].toLowerCase().split('/').pop() === s) return ZONES[j];
    return '';
  }
  // Local date and minutes since midnight in a time zone (summer time handled by the time zone database).
  function clock(d, zone) {
    var parts = {};
    new Intl.DateTimeFormat('en-CA', { timeZone: zone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d).forEach(function (x) { parts[x.type] = x.value; });
    return { day: parts.year + '-' + parts.month + '-' + parts.day, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
  }

  return { CURRENCIES: CURRENCIES, ZONES: ZONES, currencyOf: currencyOf, zoneOf: zoneOf, isZone: isZone, isCurrency: isCurrency, findZone: findZone, clock: clock, CURRENCY_BY_COUNTRY: CURRENCY_BY_COUNTRY, ZONE_BY_COUNTRY: ZONE_BY_COUNTRY };
}));
