# Languages, currencies and time zones

## How it works

- **Texts.** Every text the bot, the search messages and the landing page show is in `docs/locales/<code>.js`
  (sections `form`, `codec`, `bot`, `owner`, `menu`, `commands`, `search`). The same files are used by Node and
  by the browser. `docs/i18n.js` picks a text by language; a text missing from a language falls back to English.
- **Language of a user.** From the form (the page language), or Telegram's language when a new chat writes first.
  `/lang` lists the languages and changes it.
- **Currency.** Prices are searched and the limit is kept in US dollars. Messages show the price in dollars and in
  the user's currency (`$1,000 (₪3,200)`). The currency is chosen in the form or with `/currency EUR`;
  "automatic" uses the origin airport's country (`docs/regions.js`).
- **Time zone.** The daily summary goes out at 21:00 (`config.json` `summaryHour`) on the user's own clock. The form
  fills in the browser's time zone; `/tz Berlin`, `/tz Europe/Berlin` or `/tz TLV` change it; "automatic" uses the
  origin airport. The summary run starts every hour and searches only the users whose 21:00 has come
  (`lib/list-users.js --summary-due`).
- **Markets.** Google Flights searches with the origin's country (`gl`). Kayak sites come from `config.json`
  `kayakByCountry` (Israel: Israel + Australia; US: kayak.com; other countries: UK + Australia).
- The form code (v6, v7 for trips) carries the language, currency and time zone by number. Older codes still work.

## Adding a language

1. Copy `docs/locales/en.js` to `docs/locales/<code>.js` (for example `es.js`) and set `code`, `name` (the language's
   own name), `dir` (`rtl` for right-to-left) and `intl` (for dates, e.g. `es-ES`).
2. Translate the texts. Keep the keys, the `{a}` `{b}` markers, the HTML tags (`<b>`, `<i>`, `<code>`, `<a>`) and the
   command names (`/price`). `{ one, other }` are the singular and plural forms (add `two`, `few`, `many` where the
   language has them).
3. Add the code to `AVAILABLE` in `docs/i18n.js`, and a `<script src="locales/<code>.js"></script>` line in
   `docs/index.html`. The code must be in `LANGS` in `docs/codec.js` (16 common codes are already there; add new ones
   at the end only).
4. `npm test` checks that the file is listed, loaded by the page, and has every text.

The bot's "/" menu is set again in every language when `MENU_VERSION` in `bot.js` changes; raise it after adding one.

## Adding a currency or time zone

Add it at the **end** of `CURRENCIES` or `ZONES` in `docs/regions.js` (the form code stores the position, so never
reorder or remove an entry). Country defaults are in `CURRENCY_BY_COUNTRY`, `ZONE_BY_COUNTRY` and `ZONE_BY_AIRPORT`.
