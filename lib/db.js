const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const db = new Database(process.env.DB_FILE || path.join(__dirname, '..', 'portal.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE, pass_hash TEXT, role TEXT DEFAULT 'executive', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS action_rules (
  id INTEGER PRIMARY KEY, name TEXT, match_field TEXT DEFAULT 'Subject', match_value TEXT,
  action_type TEXT, subject TEXT, body TEXT, require_approval INTEGER DEFAULT 1, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY, task_id TEXT, task_subject TEXT, rule_id INTEGER, action_type TEXT,
  to_name TEXT, to_email TEXT, to_phone TEXT, subject TEXT, body TEXT,
  status TEXT DEFAULT 'pending', error TEXT, created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, sent_at TEXT
);
CREATE TABLE IF NOT EXISTS email_queue (
  id INTEGER PRIMARY KEY, from_email TEXT, from_name TEXT, subject TEXT, body TEXT,
  category TEXT, extracted TEXT, proposals TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS macros (
  id INTEGER PRIMARY KEY, name TEXT UNIQUE, steps TEXT, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS automations (
  id INTEGER PRIMARY KEY, name TEXT, match_field TEXT DEFAULT 'Subject', match_value TEXT DEFAULT '',
  status_filter TEXT DEFAULT '', min_overdue_days INTEGER DEFAULT 0, macro_id INTEGER, schedule TEXT,
  mode TEXT DEFAULT 'preview', max_per_run INTEGER DEFAULT 25, active INTEGER DEFAULT 1, last_run TEXT, last_result TEXT
);
CREATE TABLE IF NOT EXISTS auto_seen (automation_id INTEGER, task_id TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(automation_id, task_id));
CREATE TABLE IF NOT EXISTS pending_actions (
  id INTEGER PRIMARY KEY, automation_id INTEGER, macro_id INTEGER, task_id TEXT, task_subject TEXT,
  status TEXT DEFAULT 'pending', result TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS manual_actions (
  id INTEGER PRIMARY KEY, at TEXT DEFAULT CURRENT_TIMESTAMP, user TEXT, task_subject TEXT, dept TEXT, kind TEXT, macro_id INTEGER
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY, at TEXT DEFAULT CURRENT_TIMESTAMP, user TEXT, action TEXT, detail TEXT
);
`);

function hash(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
}
function verify(pw, stored) {
  const [salt, h] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(test, 'hex'));
}
function log(user, action, detail) {
  db.prepare('INSERT INTO activity(user,action,detail) VALUES(?,?,?)').run(user || 'system', action, typeof detail === 'string' ? detail : JSON.stringify(detail));
}

// bootstrap admin
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('hex');
  db.prepare('INSERT INTO users(username,pass_hash,role) VALUES(?,?,?)').run(process.env.ADMIN_USER || 'admin', hash(pw), 'admin');
  console.log(`\n>>> First admin created. username: ${process.env.ADMIN_USER || 'admin'}  password: ${pw}\n`);
}

module.exports = { db, hash, verify, log };
