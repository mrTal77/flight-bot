# flight-watch

A free Telegram bot that watches flight prices for several people. Each person fills in a short form on the
landing page (route, dates, airline, stops, bag, price limit), opens the bot in Telegram, and from then on gets
an alert when a matching trip drops under their limit, plus a daily summary.

Everything runs on free GitHub services: GitHub Actions (searches and the bot) and GitHub Pages (the landing page).

## How it works

- **Landing page** (`docs/`, GitHub Pages): a form with flexible dates (a date ±1/3/5 days, or a range up to 31 days), passengers, cabin, bags, stops, flight time, departure hours, airlines per direction, layover limit and self-transfer. On "confirm" it packs the preferences into a short code
  (`docs/codec.js`) and opens `t.me/<bot>?start=<code>`. With open sign-up (`signup.mode: open`) anyone can use it; in invite mode it needs an invite link (`?i=<invite>`). The page also explains the bot to strangers (how it works, questions).
- **Bot** (`bot.js`, every 5 minutes): reads new Telegram messages, lets people in (or onto the waitlist, see below), validates the preferences,
  stores the user and starts a first search. Commands: `/status`, `/edit` (link to the user's own form, prefilled; saving it replaces their settings), `/price`, `/dest`, `/out`, `/back` (change one setting in the chat), `/lang`, `/stop` (deletes the user's data), `/help`. One user per Telegram chat: any update replaces that user's settings.
- **Trips** ("כמה טיסות" in the form): 2 to 5 one-way flights in one sign-up. Each flight has its own route, dates,
  passengers, stops, airline and price limit; cabin and bags are shared. Each flight is searched on its own (the day's
  Google and Kayak budgets are split between the flights, so a trip makes about as many searches as one round trip),
  alerts come per flight when that flight is under its own limit, and the daily summary has two lines per flight plus
  the trip total for all passengers. Code v5 (`docs/codec.js`): about 44 characters for 3 flights; a code over 64
  characters (many flights with many filters) does not fit in a Telegram link, so the page asks to paste `/start CODE`
  to the bot (up to 200 characters). In the chat: `/price 2 400` (flight 2) or `/price 400` (every flight); dates and
  places change through `/edit`. One ticket for the whole trip (multi-city) is planned for a later phase.
- **Search** (`watch.js`, every 4 hours + one daily summary at 21:00 Israel time; a summary run outside 20:45–24:00 or a second one the same day runs as a plain check; a new user's first results come right away): one job per user, in parallel. Sources:
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

## Open sign-up, limits and the waitlist

Set in `config.json` → `signup`:

| Field | Meaning |
|---|---|
| `mode` | `open` = anyone; `invite` = only with an invite code; `closed` = new people only join the waitlist |
| `maxUsers` | users besides the owner; above it, new people join the waitlist |
| `maxNewPerDay` | new users a day (UTC); above it, the waitlist (0 = no limit) |
| `maxWaitlist` | the waitlist's length; above it, people are told to try again later |
| `maxChangesPerDay` | settings changes a user may make a day (each one starts a search) |
| `maxMessagesPerRun` | messages from one chat handled per bot run; the rest are skipped |

- `/start` without a code (someone who found the bot in Telegram) gets a welcome with a button to the form.
- The waitlist is kept in order, encrypted with the users. At every bot run people get in from it while there is
  room, get a message, and their first search starts. If their dates passed while waiting, they get the form again.
- Invite codes still work in open mode; their `label` shows where a user came from (in `/users` and `/dashboard`).
- Owner commands: `/dashboard` (users, sign-ups today, waitlist, blocked, by language and source), `/users`,
  `/waitlist`, `/admit N` (let the first N in, even above the limits), `/block N` (deletes user N of `/users` and
  ignores their chat from then on), `/blocked`, `/unblock N`.
- `docs/dashboard.html` (on GitHub Pages): charts from the public logs only: active users, sign-ups, waitlist joins,
  alerts, search runs and clicks per day, and success per source.
- The bot's name, descriptions and command menu come from `lib/profile.js` (English by default, Hebrew for Hebrew
  Telegram apps). The username and picture are set in BotFather: `BOTFATHER.md`.

## Search log (debugging)

- `logs/searches.csv`: one row per search that failed, was blocked, or worked only on the second try
  (time, run, user id, source, site, kind, status, attempts, seconds, error).
- `logs/runs.csv`: one row per user run, with the number of searches per source that worked / failed / were blocked / were skipped.
- `logs/messages.csv`: one row per Telegram message sent (time, run, user id, bot or search, kind: summary / alert /
  signup / a command / admin-notice, sent or failed, length). No message text and no chat ids.
- `logs/clicks.csv`: link clicks per day, user id, site (kayak / kiwi / google / airline / other) and message type.
  Links in search messages go through a small Cloudflare Worker (`cloudflare/worker.js`) that counts the click and
  redirects at once; the bot reads the counts every run. Off until `CLICK_URL` and `CLICK_SECRET` are set: see `CLICKS-SETUP.md`.
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
3. Sign-up link: `https://<user>.github.io/<repo>/` (open mode). Invite link: `https://<user>.github.io/<repo>/?i=<invite>`.
   To add an invite, put the SHA-256 of a new 6-character code and a label in `config.json` → `invites`.

## Settings (`config.json`)

| Field | Meaning |
|---|---|
| `botUsername` | the Telegram bot the landing page opens (also set in `docs/index.html`; `test.js` checks they match) |
| `signup` | open sign-up and its limits (see above) |
| `invites` | SHA-256 hashes of invite codes, with a `label` |
| `realertDropUsd`, `realertHours` | when to alert again |
| `markets` | Kayak sites; `bagFilter` makes prices include a checked bag |
| `kiwi`, `googleDaily`, `googleMaxSearches`, `duffelEveryHours` | sources on/off, Google searches a day |
| `pausedUsers` | user ids that are paused: no searches and no messages; their settings and state stay (remove the id to turn them back on) |
| `userExtras` | per user (random id): `preferAirlines` codes get their own nonstop Kiwi searches and are shown first (⭐) |

## Local test

```bash
npm install
npx playwright install chromium
npm test
node watch.js --profile my-profile.json --dry --summary   # plain profile file, prints messages instead of sending
```
