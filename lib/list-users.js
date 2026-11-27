// Prints the users to search as a JSON array of batches (for the GitHub Actions search matrix). Each batch is a
// string of user ids separated by spaces, and one job searches its batch one user after the other.
// Users with the same route are put in the same batch, so their searches share the job's cache (lib/runcache.js):
// the second user with the same query costs no call. config.json "usersPerJob" (default 4) is the batch size.
// Ids are random and say nothing about the user.
//   node lib/list-users.js            all users
//   node lib/list-users.js admins     only admin users (the bot owner): for testing changes without messaging anyone else
//   node lib/list-users.js <id>       one user
// Roles: the owner (TELEGRAM_CHAT_ID) is "admin"; everyone else is "user".
// Users in config.json "pausedUsers" are left out (their data stays; remove the id there to turn them back on).
const fs = require('fs');
const path = require('path');
const codec = require('../docs/codec.js');

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
const isAdmin = (u, ownerChat) => !!u.owner || (!!ownerChat && u.chatId === ownerChat);
// The route a user's searches are about (a trip: its first flight); users with the same key go together.
function routeKey(u) {
  const p = u.prefs || {};
  const q = codec.isTrip(p) ? codec.legPrefs(p, 0) : p;
  return [q.origin, q.destination, p.oneWay ? 'ow' : 'rt'].join('|');
}
function batches(users, size) {
  const sorted = [...users].sort((a, b) => routeKey(a).localeCompare(routeKey(b)) || a.id.localeCompare(b.id));
  const out = [];
  for (let i = 0; i < sorted.length; i += size) out.push(sorted.slice(i, i + size).map((u) => u.id).join(' '));
  return out;
}
function pick(all, only, ownerChat, paused) {
  const users = all.filter((u) => !paused.has(u.id));
  return only === 'admins' ? users.filter((u) => isAdmin(u, ownerChat)) : only ? users.filter((u) => u.id === only) : users;
}

if (require.main === module) {
  const { loadUsers } = require('./store');
  const chosen = pick(Object.values(loadUsers().users), (process.argv[2] || '').trim(), (process.env.TELEGRAM_CHAT_ID || '').trim(), new Set(CONFIG.pausedUsers || []));
  process.stdout.write(JSON.stringify(batches(chosen, Math.max(1, CONFIG.usersPerJob || 4))));
}
module.exports = { batches, routeKey, pick };
