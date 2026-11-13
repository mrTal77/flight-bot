// Prints the registered user ids as a JSON array (for the GitHub Actions search matrix).
// Ids are random and say nothing about the user.
const { loadUsers } = require('./store');
const only = (process.argv[2] || '').trim();
const ids = Object.keys(loadUsers().users);
process.stdout.write(JSON.stringify(only ? ids.filter((i) => i === only) : ids));
