// Encrypted storage for users and their search state. The repository is public, so everything
// personal (Telegram chat ids, names, trip preferences, prices found, alert history) is kept
// encrypted with AES-256-GCM. The key is derived from the TELEGRAM_BOT_TOKEN secret, so no extra
// secret is needed; if the bot token is ever replaced, the stored data can no longer be read
// (users would register again).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.enc');

function key() {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set (needed to read the encrypted data)');
  return Buffer.from(crypto.hkdfSync('sha256', token, 'flight-watch', 'data-key-v1', 32));
}

function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), body]).toString('base64') + '\n';
}
function decrypt(text) {
  const raw = Buffer.from(text.trim().replace(/^v1:/, ''), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'));
}

function readEnc(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return decrypt(fs.readFileSync(file, 'utf8'));
}
function writeEnc(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encrypt(obj));
}

// users.enc: { users: { [id]: { id, chatId, name, prefs, owner, createdAt } }, botOffset }
function loadUsers() { return readEnc(USERS_FILE, { users: {}, botOffset: 0 }); }
function saveUsers(db) { writeEnc(USERS_FILE, db); }

// Opaque, random user ids: the only thing about a user that shows up in public run logs.
function newUserId() { return 'u' + crypto.randomBytes(5).toString('hex'); }
const safeId = (id) => { if (!/^u[0-9a-f]{10}$/.test(id)) throw new Error('bad user id'); return id; };

const stateFile = (id) => path.join(DATA_DIR, 'state', `${safeId(id)}.enc`);
function loadState(id) { return readEnc(stateFile(id), {}); }
function saveState(id, s) { writeEnc(stateFile(id), s); }
function deleteState(id) { try { fs.unlinkSync(stateFile(id)); } catch {} }

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

module.exports = { encrypt, decrypt, loadUsers, saveUsers, newUserId, loadState, saveState, deleteState, stateFile, sha256, DATA_DIR };
