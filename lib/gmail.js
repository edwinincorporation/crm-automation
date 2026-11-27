// Reads the care@ Gmail mailboxes over IMAP (app password) and hands REAL replies to mailext.ingest (same store the Apps Script used),
// so Mail Meter Check sees them. The portal only READS (mailbox is opened read-only; nothing is sent, moved, flagged or deleted).
// App passwords are stored AES-256-GCM encrypted in the settings table; the key lives in .env (IMAP_KEY), so the DB file alone is not enough.
const crypto = require('crypto');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { db, log } = require('./db');
const AS = require('./assign');
const EXT = require('./mailext');

const SLOTS = ['care@edwinepc.com', 'care@edwincorp.com', 'care@edwin.co.in']; // as given by the owner
const ALLOWED = /^care@(edwinepc\.com|edwin\.co\.in|edwincorp\.com|edwinincorp\.com)$/i;
const OWN = /@(edwinepc\.com|edwin\.co\.in|edwincorp\.com|edwinincorp\.com)/i;
const HOST = () => process.env.IMAP_HOST || 'imap.gmail.com';
const PORT = () => +process.env.IMAP_PORT || 993;
const configured = () => !!process.env.IMAP_KEY;

function encKey() {
  let salt = AS.getSetting('im_salt', '');
  if (!salt) { salt = crypto.randomBytes(16).toString('hex'); AS.setSetting('im_salt', salt); }
  return crypto.createHash('sha256').update('im|' + (process.env.IMAP_KEY || '') + '|' + salt).digest();
}
function enc(s) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const ct = Buffer.concat([c.update(s, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function dec(s) {
  const b = Buffer.from(s, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', encKey(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
const pwKey = (m) => 'im_pw_' + m.toLowerCase();
const metaKey = (m) => 'im_meta_' + m.toLowerCase();
const getMeta = (m) => { try { return JSON.parse(AS.getSetting(metaKey(m), '{}')) || {}; } catch (_) { return {}; } };
const setMeta = (m, patch) => AS.setSetting(metaKey(m), JSON.stringify({ ...getMeta(m), ...patch }));
function connectedList() {
  const all = new Set(SLOTS.map((s) => s.toLowerCase()));
  for (const r of db.prepare("SELECT key FROM settings WHERE key LIKE 'im_pw_%' AND value<>''").all()) all.add(r.key.slice(6));
  return [...all].filter((m) => !!AS.getSetting(pwKey(m), ''));
}

// Called by setimap.sh (password comes from a hidden prompt, never from chat). Verifies the login before saving.
async function savePassword(mailbox, password, user, host) {
  const m = String(mailbox || '').trim().toLowerCase();
  const pw = String(password || '').replace(/\s+/g, ''); // Google shows app passwords in groups of 4 - spaces are not part of it
  if (!ALLOWED.test(m)) throw new Error(m + ' care@ mailbox nahi hai');
  if (!configured()) throw new Error('IMAP_KEY .env me nahi hai (setimap.sh se banta hai)');
  if (pw.length < 12) throw new Error('App password chhota lagta hai');
  const hst = String(host || '').trim().toLowerCase();
  if (hst && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(hst)) throw new Error('IMAP server ka naam galat hai: ' + hst);
  const c = client(m, pw, hst);
  try { await c.connect(); } catch (e) { throw new Error(explain(e, hst)); } finally { try { await c.logout(); } catch (_) { /* ignore */ } }
  AS.setSetting(pwKey(m), enc(pw));
  setMeta(m, { since: new Date().toISOString(), error: '', host: hst });
  log(user || 'setimap', 'imap_connect', m);
  return m;
}
async function disconnect(mailbox, user) {
  const m = String(mailbox || '').toLowerCase();
  AS.setSetting(pwKey(m), ''); AS.setSetting(metaKey(m), '{}');
  log(user, 'imap_disconnect', m);
}

function client(m, pw, host) {
  const c = new ImapFlow({ host: host || HOST(), port: PORT(), secure: true, auth: { user: m, pass: pw }, logger: false, socketTimeout: 90000 });
  c.on('error', () => { /* surfaced through the awaited call */ });
  return c;
}
function explain(e, host) {
  const own = host && host !== 'imap.gmail.com';
  const t = String((e && (e.responseText || e.message)) || e);
  if (own && (/AUTHENTICATIONFAILED|Invalid credentials|authentication failed|LOGIN failed/i.test(t) || e.authenticationFailed)) return 'Login nahi hua (' + host + '): mail password galat hai, ya is mailbox me IMAP band hai';
  if (/AUTHENTICATIONFAILED|Invalid credentials|authentication failed/i.test(t) || e.authenticationFailed) return 'Login nahi hua: app password galat hai, ya 2-Step Verification / IMAP band hai (Gmail Settings > Forwarding and POP/IMAP > IMAP enable)';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(t)) return 'Mail server tak pahunch nahi paaye' + (own ? ' (' + host + ')' : '') + ': ' + t.slice(0, 80);
  return t.slice(0, 200);
}

const mid = (s) => String(s || '').replace(/[<>\s]/g, '').toLowerCase();
const idsOf = (v) => (Array.isArray(v) ? v : String(v || '').split(/\s+/)).map(mid).filter(Boolean);
const snippetOf = (text) => {
  const body = String(text || '').split('\n').filter((l) => l.trim() && l.trim()[0] !== '>').join(' ');
  return (body.split(/On .{5,80} wrote:/)[0] || body).replace(/\s+/g, ' ').trim().slice(0, 600);
};
const seen = new Set(); // mailbox|uid already handled in this run of the process (INSERT OR IGNORE covers restarts)

async function pollOne(m) {
  const pw = dec(AS.getSetting(pwKey(m), ''));
  const c = client(m, pw, getMeta(m).host);
  const out = [];
  let skipped = 0;
  try {
    await c.connect();
    // 1) Message-IDs of what WE sent in the last 14 days (Sent Mail), so only real replies to our mail are taken
    const sentIds = new Set();
    try {
      const boxes = await c.list();
      const sent = boxes.find((b) => b.specialUse === '\\Sent') || boxes.find((b) => /^(INBOX[./])?sent( items| mail| messages)?$/i.test(b.path));
      if (sent) {
        const lk = await c.getMailboxLock(sent.path, { readOnly: true });
        try {
          const since = new Date(Date.now() - 14 * 864e5);
          for await (const msg of c.fetch({ since }, { envelope: true })) if (msg.envelope && msg.envelope.messageId) sentIds.add(mid(msg.envelope.messageId));
        } finally { lk.release(); }
      }
    } catch (_) { /* no Sent folder access: fall back to In-Reply-To check only */ }
    // 2) Inbox of the last 2 days
    const lock = await c.getMailboxLock('INBOX', { readOnly: true });
    try {
      const since = new Date(Date.now() - 2 * 864e5);
      const uids = (await c.search({ since }, { uid: true })) || [];
      for (const uid of uids.slice(-120)) {
        const sk = m + '|' + uid;
        if (seen.has(sk)) continue;
        const msg = await c.fetchOne(String(uid), { source: true, envelope: true, internalDate: true }, { uid: true });
        seen.add(sk);
        if (!msg || !msg.source) continue;
        const p = await simpleParser(msg.source);
        const fromA = (p.from && p.from.value && p.from.value[0]) || {};
        const em = String(fromA.address || '').trim().toLowerCase();
        if (!em || OWN.test(em)) { skipped++; continue; }
        const refs = new Set([...idsOf(p.inReplyTo), ...idsOf(p.references)]);
        if (!refs.size) { skipped++; continue; } // not a reply to anything
        if (sentIds.size && ![...refs].some((r) => sentIds.has(r))) { skipped++; continue; } // reply to something we did not send
        out.push({ mailbox: m, msgId: m + ':' + (p.messageId ? mid(p.messageId) : uid), from: em, name: fromA.name || '', subject: p.subject || '', snippet: snippetOf(p.text), at: new Date(p.date || msg.internalDate || Date.now()).toISOString() });
      }
    } finally { lock.release(); }
  } finally { try { await c.logout(); } catch (_) { /* ignore */ } }
  const r = out.length ? EXT.ingest(out) : { added: 0, skipped: 0 };
  setMeta(m, { last: new Date().toISOString(), error: '', added: (getMeta(m).added || 0) + r.added });
  return { added: r.added, skipped: r.skipped + skipped };
}

let busy = false, lastAt = 0;
async function poll(force) {
  if (busy || !configured()) return { ok: false, results: [] };
  if (!force && Date.now() - lastAt < 290000) return { ok: true, results: [] }; // ~5 min between automatic polls
  busy = true; lastAt = Date.now();
  const results = [];
  try {
    for (const m of connectedList()) {
      try { results.push({ mailbox: m, ...(await pollOne(m)) }); }
      catch (e) { const msg = explain(e, getMeta(m).host); setMeta(m, { error: msg }); results.push({ mailbox: m, error: msg }); }
    }
  } finally { busy = false; }
  return { ok: true, results };
}
function status() {
  const on = new Set(connectedList());
  const boxes = [...new Set([...SLOTS, ...on])].map((m) => { const x = getMeta(m); return { mailbox: m, connected: on.has(m), since: x.since || '', last: x.last || '', error: x.error || '', added: x.added || 0 }; });
  return { configured: configured(), mailboxes: boxes };
}
module.exports = { configured, savePassword, disconnect, poll, status, SLOTS };
