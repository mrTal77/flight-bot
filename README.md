# flight-watch

A free Telegram bot that watches flight prices for several people. Each person fills in a short form on the
landing page (route, dates, airline, stops, bag, price limit), opens the bot in Telegram, and from then on gets
an alert when a matching trip drops under their limit, plus a daily summary.

Everything runs on free GitHub services: GitHub Actions (searches and the bot) and GitHub Pages (the landing page).

## How it works

- **Landing page** (`docs/`, GitHub Pages): a form with flexible dates (a date ±1/3/5 days, or a range up to 31 days), passengers, cabin, bags, stops, flight time, departure hours, airlines per direction, layover limit and self-transfer. On "confirm" it packs the preferences into a short code
  (`docs/codec.js`) and opens `t.me/<bot>?start=<code>`. Sign-up needs an invite link (`?i=<invite>`).
- **Bot** (`bot.js`, every 5 minutes): reads new Telegram messages, checks the invite, validates the preferences,
  stores the user and starts a first search. Commands: `/status`, `/edit` (link to the user's own form, prefilled; saving it replaces their settings), `/price`, `/dest`, `/out`, `/back` (change one setting in the chat), `/lang`, `/stop` (deletes the user's data), `/help`. One user per Telegram chat: any update replaces that user's settings.
- **Search** (`watch.js`, every 4 hours + a daily summary): one job per user, in parallel. Sources:
  - Kayak in a headless browser, Israel (with Kayak's checked-bag filter) and Australia (prices in AUD, converted;
    its bag filter has no effect, so bags show as unknown), "±3 days" grids: one-way outbound, one-way returns, and round trips.
  - Kiwi.com's public MCP server (`https://mcp.kiwi.com`, free): one-way, returns, round trips, and single tickets
    with the return on any airline (the outbound is pinned to the chosen airline's departure hours).
  - Google Flights, once a day with the summary, for every user: the search link carries the user's filters
    (passengers, cabin, stops and airline per leg); up to `googleMaxSearches` dates or date pairs a day, spread over the range.
  - For the bot owner only: Duffel (optional `DUFFEL_TOKEN`).
  - A failed search is tried once more after a short pause.
  - Skyscanner was tried (13.11.2026) and is not used: it blocks automated browsers at once.
- When a trip is on a low-cost airline, the message adds a link to the airline's own site (Wizz Air and Ryanair with
  the route and dates filled in; other low-cost airlines link to their home page).
- Results are compared as one round-trip ticket vs. two separate tickets. An alert needs a price at or under the
  limit (per passenger). Prices where the bags are known to be missing are dropped; when it is unknown, the price is
  shown and marked with "*".

## Search log (debugging)

- `logs/searches.csv`: one row per search that failed, was blocked, or worked only on the second try
  (time, run, user id, source, site, kind, status, attempts, seconds, error).
- `logs/runs.csv`: one row per user run, with the number of searches per source that worked / failed / were blocked / were skipped.
- No personal data: users are random ids; errors have links and dates removed; no routes, dates, prices or names.
- Read it with `/errors` in the bot (owner only; `/errors 72` for 72 hours) or `node tools/logs.js [hours]`.
  Parallel runs append to the same files; `.gitattributes` merges them line by line.
- A site that blocks automated searches (Kayak shows a "security check" page to GitHub's servers since 13.11.2026)
  is logged as `blocked`; the rest of that site's searches in the run are skipped, and the daily summary gives
  links to check Kayak in a normal browser instead. Blocks are not retried and not worked around.
- Users other than the owner never see search failures in their messages.

## Privacy (the repository is public)

- **No personal data in the code.** Users, their Telegram chat ids, preferences, prices found and alert history are
  stored encrypted (AES-256-GCM) in `data/`. The key is derived from the `TELEGRAM_BOT_TOKEN` secret.
- **Run logs are public**, so they show only counts and timings: no routes, dates, prices or names.
  Users appear only as random ids (e.g. `u3a3b26b74b`).
- Invite codes are stored only as SHA-256 hashes (`config.json`).
- Every search opens a brand-new browser context (no cookies or storage between searches), on a fresh machine each run.

## Setup

0. Roles: the owner (`TELEGRAM_CHAT_ID`) is the admin; everyone else is a user. Test changes on the admin first:
   run the search with `user: admins` (workflow input), and nobody else gets a message.
   Starting the workflows: GitHub's own schedule did not start in this repository, so cron-job.org starts the bot
   every 5 minutes and the search every 4 hours plus the daily summary, through the workflow-dispatch API.
   Steps (Hebrew): `CRON-SETUP.md`. Check the timing with `node tools/check-schedule.js [hours]`.

1. Secrets (Settings → Secrets and variables → Actions):
   - `TELEGRAM_BOT_TOKEN`: from @BotFather.
   - `TELEGRAM_CHAT_ID`: the owner's chat id (gets the extra owner-only searches).
   - `DUFFEL_TOKEN` (optional).
2. Pages: Settings → Pages → Deploy from a branch → `main`, folder `/docs`.
3. Invite link: `https://<user>.github.io/<repo>/?i=<invite>`. To add an invite, put the SHA-256 of a new
   6-character code in `config.json` → `invites`.

## Settings (`config.json`)

| Field | Meaning |
|---|---|
| `botUsername` | the Telegram bot the landing page opens (also set in `docs/index.html`) |
| `maxUsers` | sign-ups are refused above this number |
| `invites` | SHA-256 hashes of valid invite codes |
| `realertDropUsd`, `realertHours` | when to alert again |
| `markets` | Kayak sites; `bagFilter` makes prices include a checked bag |
| `kiwi`, `googleDaily`, `googleMaxSearches`, `duffelEveryHours` | sources on/off, Google searches a day |
| `userExtras` | per user (random id): `preferAirlines` codes get their own nonstop Kiwi searches and are shown first (⭐) |

## Local test

```bash
npm install
npx playwright install chromium
npm test
node watch.js --profile my-profile.json --dry --summary   # plain profile file, prints messages instead of sending
```
