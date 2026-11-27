// Prints the user ids to search as a JSON array (for the GitHub Actions search matrix).
// Ids are random and say nothing about the user.
//   node lib/list-users.js                  all users
//   node lib/list-users.js admins           only admin users (the bot owner): for testing changes without messaging anyone else
//   node lib/list-users.js <id>             one user
//   node lib/list-users.js "" --summary-due only users whose daily summary is due now: it is 20:45–24:00 on their own clock
//                                           (their time zone, or their origin airport's) and today's summary was not sent yet.
//                                           The summary run starts every hour, so each user gets it at 21:00 their time.
// Roles: the owner (TELEGRAM_CHAT_ID) is "admin"; everyone else is "user".
// Users in config.json "pausedUsers" are left out (their data stays; remove the id there to turn them back on).
const fs = require('fs');
const path = require('path');
const { loadUsers, loadState } = require('./store');
const codec = require('../docs/codec.js');
const Regions = require('../docs/regions.js');

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
codec.setPlaces(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'airports.json'), 'utf8')));

// Is this user's daily summary due at `now`? (the same rule watch.js applies before it sends one)
function summaryDue(user, state, now) {
  const c = Regions.clock(now, codec.localOf(user.prefs).tz);
  const from = CONFIG.summaryFromMinute ?? (CONFIG.summaryHour ?? 21) * 60 - 15;
  return c.minutes >= from && (state || {}).lastSummaryDay !== c.day;
}

function pickUsers(only, dueOnly, now = new Date()) {
  const paused = new Set(CONFIG.pausedUsers || []);
  const ownerChat = (process.env.TELEGRAM_CHAT_ID || '').trim();
  const users = Object.values(loadUsers().users).filter((u) => !paused.has(u.id));
  const isAdmin = (u) => !!u.owner || (!!ownerChat && u.chatId === ownerChat);
  let pick = only === 'admins' ? users.filter(isAdmin) : only ? users.filter((u) => u.id === only) : users;
  if (dueOnly && !only) pick = pick.filter((u) => summaryDue(u, loadState(u.id), now));
  return pick.map((u) => u.id);
}

if (require.main === module) {
  const only = (process.argv[2] || '').trim();
  process.stdout.write(JSON.stringify(pickUsers(only, process.argv.includes('--summary-due'))));
}
module.exports = { summaryDue, pickUsers };
