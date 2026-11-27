// Prints the user ids to search as a JSON array (for the GitHub Actions search matrix).
// Ids are random and say nothing about the user.
//   node lib/list-users.js            all users
//   node lib/list-users.js admins     only admin users (the bot owner): for testing changes without messaging anyone else
//   node lib/list-users.js <id>       one user
// Roles: the owner (TELEGRAM_CHAT_ID) is "admin"; everyone else is "user".
// Users in config.json "pausedUsers" are left out (their data stays; remove the id there to turn them back on).
const fs = require('fs');
const path = require('path');
const { loadUsers } = require('./store');
const paused = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')).pausedUsers || []);
const only = (process.argv[2] || '').trim();
const ownerChat = (process.env.TELEGRAM_CHAT_ID || '').trim();
const users = Object.values(loadUsers().users).filter((u) => !paused.has(u.id));
const isAdmin = (u) => !!u.owner || (!!ownerChat && u.chatId === ownerChat);
const pick = only === 'admins' ? users.filter(isAdmin) : only ? users.filter((u) => u.id === only) : users;
process.stdout.write(JSON.stringify(pick.map((u) => u.id)));
