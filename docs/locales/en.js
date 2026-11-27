// English, and the fallback for any text a language does not have. To add a language, copy this file to
// docs/locales/<code>.js, translate the texts (keep the keys, the {a} {b} markers and the HTML tags), and add the
// code to AVAILABLE in docs/i18n.js. See LANGUAGES.md.
// {a} {b} ... are filled in, in order. { one, other } picks the form by the number in {a}.
(function (root, factory) {
  var L = factory();
  if (typeof module === 'object' && module.exports) module.exports = L;
  else root.FlightI18n.register(L);
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {
    code: 'en', name: 'English', dir: 'ltr', intl: 'en-GB', aliases: ['english', 'אנגלית'],
    // placeColumn: a column of docs/airports.json with city names in this language (column 1, the English name, by default)
    // dates: { day, full, short, range } functions, to replace the Intl date formats
    cities: {}, // city names that differ from docs/airports.json, by airport code
    airlines: { LY: 'El Al', IZ: 'Arkia', '6H': 'Israir' },

    // ---------- landing page (docs/index.html) ----------
    form: {
      title: '✈️ Flight price bot', lead: 'Tell us which flight you are looking for. The Telegram bot checks prices every few hours and alerts you when the price drops below your limit.',
      noInviteTitle: '🔒 Invite link needed', noInviteText: 'Sign-up is by invite link only. Ask the person who shared the bot with you for the link.',
      testBar: '🧪 Test mode: after "Confirm" you only see a summary; nothing is sent to the bot.',
      editBar: '✏️ Update settings: the form is filled with your current settings. Change what you want and save; the new settings replace the old ones.',
      multiTrip: 'Multi-city', multiHint: 'Each flight of the trip is searched on its own, with its own passengers, dates and price limit. Cabin and bags are shared by the whole trip.',
      flight: 'Flight', addLeg: '＋ Add a flight', samePax: 'Same passengers as the previous flight', legPrice: 'Price limit', legPricePax: 'Price limit per passenger',
      advLeg: 'Advanced filters', up: 'Up', down: 'Down', del: 'Remove this flight', maxLegs: 'Up to {a} flights in a trip',
      tripPriceHint: 'In a trip, every flight has its own price limit (on the flight\'s card). Only the shared filters are here.',
      longCode: 'The trip code is too long for a Telegram link. Open the bot and send it the message in step 2.',
      secRoute: 'Route and passengers', roundTrip: 'Round trip', oneWay: 'One way', origin: 'From', destination: 'To', swap: 'Swap from and to', placePh: 'City, airport or code',
      placeHint: 'Search in English or Hebrew: city, airport, country or code (e.g. London, Zanzibar, Greece, BKK). Over 4,000 airports worldwide.',
      adults: 'Adults', children: 'Children (2–11)', infants: 'Infants', cabin: 'Cabin', checkedBags: 'Checked bags per passenger', carryOn: 'Carry-on per passenger',
      bagsHint: 'The bot alerts on prices that include these bags (a price where it is unknown is marked with *).',
      secOut: 'Outbound', secRet: 'Return', flexDate: 'Flexible date', dateRange: 'Date range', aboutDate: 'Around', flexibility: 'Flexibility',
      fromDate: 'From', toDate: 'To', stops: 'Stops', advOut: 'Advanced filters (outbound)', advRet: 'Advanced filters (return)',
      airline: 'Airline', airlineCode: 'Airline code (2 characters)', maxHours: 'Flight time, up to (hours)', retMaxHours: 'Return flight time, up to (hours)',
      maxTripDays: 'Trip length, up to (days)', zeroNoLimit: '0 = no limit.', depFrom: 'Departs from', depTo: 'Until',
      secPrice: 'Price and alerts', priceLabel: 'Alert me when the price drops below', priceLabelPax: 'Alert me when the price per passenger drops below',
      localHint: 'About {a}{b} at a rough rate', perPax: ' per passenger', advPrice: 'Advanced filters: layovers and separate tickets',
      maxLayover: 'Longest layover (hours)', selfTransfer: 'Allow separate tickets with self-transfer (cheaper, but not protected if a flight is late)',
      submit: 'Confirm and continue in Telegram', submitEdit: 'Save changes in Telegram', fix: 'Please fix:',
      privacy: 'Your details go only to the Telegram bot and are stored encrypted. The person who shared the bot with you can see your search (route, dates and price limit). You can stop any time with /stop in the bot.',
      previewTitle: '🧪 Test mode: this is what the bot would receive', previewNote: 'Nothing was sent to the bot, and the existing sign-up did not change.', code: 'Code:', backToForm: 'Back to the form',
      almostDone: 'Almost done', openBot: 'Open the bot in Telegram', step1: 'In Telegram, tap <b>Start</b> at the bottom.',
      step2: 'No Start button? Copy this message and send it to the bot:', copy: 'Copy', copied: 'Copied ✓',
      step3: 'Within a few minutes the bot confirms and shows your settings.', step4: 'The first search sends results within about 10–20 minutes.', wantChange: 'Want to change something?',
      opts: {
        cabins: [['economy', 'Economy'], ['premium', 'Premium economy'], ['business', 'Business'], ['first', 'First']],
        bags: [['0', 'No checked bag'], ['1', '1 checked bag'], ['2', '2 checked bags']], yesNo: [['1', 'Yes'], ['0', 'Not needed']],
        flex: [['0', 'Exactly this date'], ['1', '±1 day'], ['3', '±3 days'], ['5', '±5 days']],
        stops: [['0', 'Nonstop only'], ['1', 'Up to 1 stop'], ['2', 'Up to 2 stops'], ['3', 'Any']],
        airlines: [['', 'Any airline'], ['LY', 'El Al'], ['6H', 'Israir'], ['IZ', 'Arkia'], ['UA', 'United'], ['AA', 'American'], ['DL', 'Delta'], ['B6', 'JetBlue'], ['other', 'Other (code)...']],
      },
      secLocal: 'Language, currency and time', language: 'Language', currency: 'Currency for prices', currencyAuto: 'Automatic', tz: 'Time zone', tzAuto: 'Automatic',
      localNote: 'Automatic = by the origin. The daily summary comes at 21:00 in this time zone. The price limit is kept in US dollars; messages show prices in your currency too.',
    },

    // ---------- form code: validation and the settings summary (docs/codec.js) ----------
    codec: {
      origin: 'Choose an origin from the list', destination: 'Choose a destination from the list', same: 'Origin and destination are the same',
      airlineOut: 'Outbound airline code is not valid (2 characters, e.g. LY)', airlineRet: 'Return airline code is not valid (2 characters)',
      adults: 'Adults: 1 to {a}', children: 'Children: 0 to {a}', infants: 'Infants: at most one per adult', pax: 'At most {a} passengers in total',
      cabin: 'Cabin is not valid', checked: 'Checked bags per passenger: 0 to {a}', carry: 'Carry-on per passenger: 0 or 1',
      stops: 'Stops on the {a}: 0 to {b}', hours: '{a} flight time: 0 to {b} hours', dep: 'Departure hours of the {a} are not valid',
      layover: 'Longest layover: 0 to {a} hours', outDates: 'Outbound dates are missing', outOrder: 'Outbound end date is before the start date',
      outPast: 'The outbound date has already passed', outRange: 'Outbound date is out of the supported range', retDates: 'Return dates are missing',
      retOrder: 'Return end date is before the start date', retBefore: 'The return starts before the outbound', retRange: 'Return date is out of the supported range',
      tripDays: 'Longest trip: 0 to {a} days',
      tripShort: 'The longest trip ({a} days) is too short for these dates: there are {b} days between the latest outbound and the earliest return. Make it longer, or set 0',
      price: 'Price limit per passenger: ${a} to ${b}', invite: 'The invite code is missing or not valid',
      currency: 'Unknown currency', zone: 'Unknown time zone', lang: 'Unknown language',
      legCount: 'A trip has {a} to {b} flights', legOrder: 'This flight starts before the previous one', legRange: 'The date range is longer than {a} days', legPrefix: 'Flight {a}: ',
      legOut: 'outbound', legRet: 'return',
      // describe()
      stops0: 'nonstop', stops1: 'up to 1 stop', stopsAny: 'any stops', stopsN: 'up to {a} stops',
      depHours: ' · departs {a}:00–{b}:00', about: { one: 'about {b} (±{a} day)', other: 'about {b} (±{a} days)' },
      anyAirline: 'any airline', upToHours: ' · up to {a} h',
      adultsN: { one: '{a} adult', other: '{a} adults' }, childrenN: { one: '{a} child', other: '{a} children' }, infantsN: { one: '{a} infant', other: '{a} infants' },
      cabins: { economy: 'Economy', premium: 'Premium economy', business: 'Business', first: 'First' }, cabinLine: '{a}',
      carryOn: 'carry-on', checkedN: { one: '1 checked bag', other: '{a} checked bags' }, noBags: 'no bags', perPax: ' per passenger',
      outbound: 'Outbound', return: 'Return', tripDaysLine: '📅 Trip length: up to {a} days', layoverLine: '⏱️ Layover: up to {a} h',
      selfTransfer: '🔀 Includes self-transfer separate tickets (not protected)', alertUnder: '🔔 Alert under {a}{b}',
      tripTitle: 'Trip: {a} flights', limit: 'limit', localLine: '🌍 Currency {a} · time zone {b}',
    },

    // ---------- bot replies (bot.js) ----------
    bot: {
      help: [
        'The bot searches flights for you every few hours, alerts you when the price drops below your limit, and sends a daily summary.',
        '',
        '<b>Change settings in the chat:</b>',
        '/price 900 · new price limit (USD, per passenger)',
        '/dest Athens · new destination (name or code)',
        '/out 21.12 3 · outbound date (day.month), optionally ± days (or a range: 20.12-30.12)',
        '/back 10.1 3 · return date, the same way',
        '/edit · link to the form with all your settings, to change anything else',
        '',
        '/status · your settings and the best price found',
        '/lang · choose a language',
        '/currency EUR · the currency prices are shown in',
        '/tz Berlin · your time zone, by city or zone name (the daily summary comes at 21:00 your time)',
        '/stop · stop searching and delete your details',
      ].join('\n'),
      ownerHelp: '/users · list of users (only you)\n/errors · log of failed searches (only you; /errors 72 for 72 hours)',
      notRegistered: '👋 To sign up, open the sign-up link you received, fill in your flight and tap "Confirm".',
      alreadyIn: '👋 You are already signed up.',
      badCode: '⚠️ The code in the link is not valid. Please fill in the form again.',
      badInvite: '⚠️ The invite code is not valid. Ask for a new sign-up link.',
      problems: '⚠️ There is a problem with the details:', fillAgain: 'Please fill in the form again.', full: '😕 The bot is full right now. Please try again later.',
      registered: '✅ <b>You are signed up!</b>', updated: '✅ <b>Settings updated!</b> (the previous settings were replaced)',
      firstSearch: 'The search starts now; results arrive here in about 10 minutes. After that I check every few hours and send a daily summary at {a} ({b}).',
      stopped: '🛑 Search stopped and your details were deleted. You can sign up again any time with the sign-up link.',
      best: '💰 Best price in the last check: {a}', noRunYet: '⏳ No check has finished yet.',
      editLink: '✏️ <b>Update settings</b>\nThe link opens the form with all your current settings. Change what you want, tap "Save changes", and the new settings replace the old ones.\n\n<a href="{a}">Open my form</a>',
      priceUsage: 'To change the price: <code>/price 900</code> (USD, per passenger)',
      destUsage: 'To change the destination: <code>/dest Athens</code> or <code>/dest ATH</code>',
      dateUsage: 'To change a date: <code>/{a} 21.12 3</code> (around 21 December, ±3 days), <code>/{a} 21.12</code> (exact), or a range <code>/{a} 20.12-30.12</code>',
      noReturn: 'Your search is one way. To add a return, open the form with /edit.',
      notFound: 'I could not find a destination called "{a}". Try another name or a 3-letter code.',
      choose: 'I found several options. Send the command of the one you want:\n{a}',
      langSet: '✅ Language set to English.',
      langList: 'Languages you can choose:\n{a}',
      currencySet: '✅ Prices will now also be shown in {a}.',
      currencyUsage: 'To choose a currency: <code>/currency EUR</code> (a 3-letter code). You can choose: {a}\nCurrent currency: {b}',
      tzSet: '✅ Time zone set: {a}. The daily summary comes at {b} on this clock.',
      tzUsage: 'To choose a time zone: <code>/tz Europe/Berlin</code> or <code>/tz Berlin</code>. Current time zone: {a}',
      unknown: 'I did not understand. Here is what you can do:',
      tripHelp: '<b>In a trip:</b> <code>/price 2 400</code> · new limit for flight 2 (<code>/price 400</code> changes every flight). Change dates and places with /edit.',
      tripEdit: 'In a trip, change dates and places in the form: /edit',
      tripPriceUsage: 'To change a price in a trip: <code>/price 2 400</code> (flight 2, USD per passenger), or <code>/price 400</code> for every flight.',
      noLeg: 'There is no flight number {a} in your trip.',
      bestLeg: '💰 Best prices in the last check:',
      paused: '⏸️ Your search is paused right now: no alerts or summaries. Your settings are saved.',
      tripRoute: 'Trip: {a}',
    },
    // The "/" menu in Telegram
    menu: [['status', 'My settings and the best price'], ['edit', 'Edit my settings in the form'], ['price', 'New price limit, e.g. /price 900'], ['dest', 'New destination, e.g. /dest Athens'],
      ['out', 'Outbound date, e.g. /out 21.12 3'], ['back', 'Return date, e.g. /back 10.1 3'], ['currency', 'Currency, e.g. /currency EUR'], ['tz', 'Time zone, e.g. /tz Berlin'],
      ['lang', 'Language'], ['help', 'Help'], ['stop', 'Stop and delete my details']],
    // Commands may also be typed in this language, without "/"
    commands: { destination: ['destination'], back: ['return'], lang: ['language'], currency: ['cur'], tz: ['timezone', 'time'] },

    // ---------- messages to the bot owner (bot.js) ----------
    owner: {
      updated: '✏️ <b>A user updated their settings</b>: {a}\n{b}', signup: '👤 <b>New user</b>: {a}{b}\n{c}\nUsers in total: {d}',
      signupUpdate: '👤 <b>A user updated their settings</b>: {a}{b}\n{c}\nUsers in total: {d}',
      pausedNote: ' (paused: to turn them back on, remove them from pausedUsers in config.json)',
      stopped: '👋 A user stopped: {a} ({b}). {c} users left.', noName: 'no name',
      noUsers: 'No users are signed up right now.', usersHead: '👥 <b>{a} users</b> (at most {b})',
      userRow: '{a}. <b>{b}</b>{c}{d} · joined {e}\n{f}', userRow2: '💰 Best: {a} · last check: {b}', you: ' (you)', pausedMark: ' ⏸️ paused',
      wholeTrip: ' (whole trip)', none: 'none yet', logLinks: 'Full tables: <a href="{a}">failed searches</a> · <a href="{b}">runs</a>',
      lineTrip: '🧳 {a} · {b} flights · {c}–{d} · limits {e}', lineOne: '✈️ {a} · {b}{c} · limit {d}', paxN: ' · {a} passengers', local: ' · {a}',
    },

    // ---------- search messages (watch.js) ----------
    search: {
      dur: '{a}:{b} h', stops0: 'nonstop', stops1: '1 stop', stopsN: '{a} stops',
      noBags: '🧳 No bags', carryOn: 'carry-on', checkedN: { one: 'checked bag', other: '{a} checked bags' },
      bagsIncluded: '🧳 {a} included{b}', perPaxParen: ' (per passenger)', bagsUnknown: '🧳 * Not known whether {a} are included; check when booking',
      twoTickets: 'Two tickets', ow: 'One way', owNonstop: 'One way, nonstop', rt: 'Round trip', nonstop: 'nonstop', withStop: 'with a stop',
      rtGoogle: '{a}, outbound {b}', nonstopBoth: '{a} nonstop both ways', sameRt: '{a} round trip', retNonstopOther: 'Nonstop return on another airline',
      retStopSame: '{a}, return with a stop', retStopOther: 'Return with a stop on another airline',
      also: '📅 Same price also: {a}{b}', andMore: ' and {a} more', alsoAirline: '🔗 Also on the airline\'s site: {a}',
      prefHead: '⭐ <b>Nonstop flights on {a}:</b>', moreOptions: '<b>More options:</b>',
      bookAt: 'Book on {a}', book: 'Book', out: 'Out', back: 'Back', twoSeparate: '2 separate tickets', perPax: ' per passenger',
      paxN: { one: '{a} passenger', other: '{a} passengers' }, limit: ' · limit {a}', noPrice: 'No matching price found', detailsInLink: 'details in the link',
      bagsPerPax: '{a} per passenger', cabins: { premium: 'Premium economy', business: 'Business', first: 'First' },
      failStreak: '⚠️ The flight bot could not read prices 6 times in a row. I keep trying.',
      testMark: '🧪 <i>Test, not the daily summary</i>', testAlert: '🧪 <i>Test message, the limit was raised for now</i>',
      firstWord: 'First search', dailyWord: 'Daily summary', noPrices: 'I could not read prices. I will try again on the next run.',
      tripTitle: '🧳 Your trip ({a} flights)', tripAlertHead: '🔔 <b>Price under your limit</b> · {a}',
      unknownNote: '<i>* Not known whether the bags are included in the price</i>', tip: '💡 Open it in a private window, check that the bag is included, and book fast.',
      total: 'Trip total{a}: <b>{b}</b> · all passengers', totalMissing: ' (without flight {a})', totalNone: 'Trip total: no price yet',
      firstHead: '🔎 <b>First results</b> · {a}', dailyHead: '🌙 <b>Daily summary</b> · {a}', rate: '💱 Today\'s rate: $1 = {a}',
      ownerErrors: '⚠️ {a} searches failed (only you see this · /errors)', footer: '<i>/status settings · /stop stop</i>',
      onAirline: 'on {a}', outPrefix: ' · outbound {a}', upTo0: 'nonstop', upTo1: 'up to 1 stop', upToN: 'up to {a} stops',
      paxPrices: ' · {a} passengers, prices per passenger', rulesOut: 'Out {a}–{b} ({c})', rulesRet: 'back {a}–{b} ({c}{d})', retHours: ', up to {a} h',
      maxDays: ' · up to {a} days', rulesOw: 'One way · {a}–{b} ({c})',
      alertHead: '🔔 <b>Price under {a}!</b>', best: 'Cheapest{a}: {b} · limit: {c}', noMatch: 'No matching price · limit: {a}',
      rtBySource: '📊 Round trip by site: {a}', mixedFrom: '🔀 Two separate tickets: from {a}', kayakSelf: '🔎 Also check Kayak yourself (±3 days): {a}',
    },
  };
}));
