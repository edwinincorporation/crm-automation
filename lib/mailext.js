// Replies to mails sent through Mailmeteor (outside the portal). A small Google Apps Script in each mailbox pushes REAL replies here;
// the portal stores them and Mail Meter Check treats them like DC Mail replies. Bounces / auto-replies / system mail are dropped here.
const crypto = require('crypto');
const { db, log } = require('./db');
const AS = require('./assign');
db.exec('CREATE TABLE IF NOT EXISTS ext_replies (msg_id TEXT PRIMARY KEY, mailbox TEXT, email TEXT, name TEXT, subject TEXT, snippet TEXT, at TEXT, added TEXT DEFAULT CURRENT_TIMESTAMP)');

const BAD_FROM = /(mailer-daemon|postmaster|no-?reply|donotreply|do-not-reply|bounce|notifications?@|alert|watchdog|mailchimp|mailmeteor)/i;
const BAD_SUBJECT = /(undeliverable|delivery (status|failure)|failure notice|returned mail|automatic reply|auto[- ]?reply|autoreply|out of office|away from (the )?office|vacation|on leave|\[srv\d+\]|daily watchdog|letter of demand|legal notice)/i;
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function key() {
  let k = AS.getSetting('mm_ingest_key', '');
  if (!k) { k = crypto.randomBytes(24).toString('hex'); AS.setSetting('mm_ingest_key', k); }
  return k;
}
function keyOk(got) {
  const want = key(), g = String(got || '');
  return g.length === want.length && crypto.timingSafeEqual(Buffer.from(g), Buffer.from(want));
}
function ingest(items) {
  const own = /@(edwinepc\.com|edwin\.co\.in|edwinincorp\.com)$/i;
  const ins = db.prepare('INSERT OR IGNORE INTO ext_replies(msg_id,mailbox,email,name,subject,snippet,at) VALUES(?,?,?,?,?,?,?)');
  let added = 0, skipped = 0;
  for (const it of (Array.isArray(items) ? items : []).slice(0, 200)) {
    const email = String(it.from || '').trim().toLowerCase(), id = clean(it.msgId, 120);
    const t = new Date(it.at).getTime();
    if (!id || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !t || BAD_FROM.test(email) || own.test(email) || BAD_SUBJECT.test(String(it.subject || ''))) { skipped++; continue; }
    added += ins.run(id, clean(it.mailbox, 80), email, clean(it.name, 80), clean(it.subject, 200), clean(it.snippet, 700), new Date(t).toISOString()).changes;
  }
  if (added) log('mailext', 'mailext_ingest', `${added} new, ${skipped} skipped`);
  return { ok: true, added, skipped };
}
const recent = (days) => db.prepare("SELECT * FROM ext_replies WHERE at > datetime('now', ?) ORDER BY at DESC LIMIT 300").all('-' + Math.min(60, Math.max(1, +days || 7)) + ' days');

// The script the person pastes into each mailbox's Apps Script project. URL + key are filled in by the portal.
function script(baseUrl) {
  return `// Mailmeteor replies -> CRM Portal. Paste in script.google.com (signed in as the care@ mailbox), run setup() once, allow access.
const URL = '${baseUrl}/api/mailmeter/ext-replies';
const KEY = '${key()}';
function setup() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('push').timeBased().everyMinutes(15).create();
  push();
}
function push() {
  const me = Session.getEffectiveUser().getEmail().toLowerCase(), out = [];
  for (const th of GmailApp.search('in:inbox newer_than:2d', 0, 60)) {
    const ms = th.getMessages();
    if (ms.length < 2 || !/@(edwinepc\\.com|edwin\\.co\\.in|edwinincorp\\.com)/i.test(ms[0].getFrom())) continue; // only threads that started with OUR mail
    for (const m of ms.slice(1)) {
      const from = m.getFrom(), em = (from.match(/<([^>]+)>/) || [0, from])[1];
      if (/@(edwinepc\\.com|edwin\\.co\\.in|edwinincorp\\.com)/i.test(em)) continue;
      const body = m.getPlainBody().split('\\n').filter(l => l.trim() && l.charAt(0) !== '>').join(' ');
      out.push({ mailbox: me, msgId: m.getId(), from: em, name: from.replace(/<.*>/, '').replace(/"/g, '').trim(), subject: m.getSubject(), snippet: body.split(/On .{5,60} wrote:/)[0].slice(0, 600), at: m.getDate().toISOString() });
    }
  }
  if (!out.length) return;
  UrlFetchApp.fetch(URL, { method: 'post', contentType: 'application/json', headers: { 'x-ingest-key': KEY }, payload: JSON.stringify(out), muteHttpExceptions: true });
}
`;
}
module.exports = { ingest, recent, keyOk, key, script };
