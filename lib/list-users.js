// Prints the user ids to search as a JSON array (for the GitHub Actions search matrix).
// Ids are random and say nothing about the user.
//   node lib/list-users.js            all users
//   node lib/list-users.js admins     only admin users (the bot owner): for testing changes without messaging anyone else
//   node lib/list-users.js <id>       one user
// Roles: the owner (TELEGRAM_CHAT_ID) is "admin"; everyone else is "user".
const { loadUsers } = require('./store');
const only = (process.argv[2] || '').trim();
const ownerChat = (process.env.TELEGRAM_CHAT_ID || '').trim();
const users = Object.values(loadUsers().users);
const isAdmin = (u) => !!u.owner || (!!ownerChat && u.chatId === ownerChat);
const pick = only === 'admins' ? users.filter(isAdmin) : only ? users.filter((u) => u.id === only) : users;
process.stdout.write(JSON.stringify(pick.map((u) => u.id)));
