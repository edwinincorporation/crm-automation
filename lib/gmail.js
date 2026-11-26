// Connects the care@ Gmail mailboxes to the portal (read-only). After the owner presses "Connect" and allows access in Google,
// the portal reads each mailbox's inbox every few minutes and hands REAL replies to mailext.ingest (same store the Apps Script used),
// so Mail Meter Check sees them. Scope is gmail.readonly: the portal can never send, delete or change mail.
const crypto = require('crypto');
const { db, log } = require('./db');
const AS = require('./assign');
const EXT = require('./mailext');

const SLOTS = ['care@edwinepc.com', 'care@edwincorp.com', 'care@edwin.co.in']; // as given by the owner; the real address is whatever Google reports
const ALLOWED = /^care@(edwinepc\.com|edwin\.co\.in|edwincorp\.com|edwinincorp\.com)$/i;
const OWN = /@(edwinepc\.com|edwin\.co\.in|edwincorp\.com|edwinincorp\.com)/i;
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const cid = () => process.env.GOOGLE_CLIENT_ID || '', csec = () => process.env.GOOGLE_CLIENT_SECRET || '';
const redirect = () => process.env.GMAIL_REDIRECT || 'https://crmautomation.delhicrest.in/api/gmail/callback';
const configured = () => !!(cid() && csec());

function encKey() {
  let salt = AS.getSetting('gm_salt', '');
  if (!salt) { salt = crypto.randomBytes(16).toString('hex'); AS.setSetting('gm_salt', salt); }
  return crypto.createHash('sha256').update('gm|' + csec() + '|' + salt).digest();
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
const tokKey = (m) => 'gm_tok_' + m.toLowerCase();
const metaKey = (m) => 'gm_meta_' + m.toLowerCase();
const getMeta = (m) => { try { return JSON.parse(AS.getSetting(metaKey(m), '{}')) || {}; } catch (_) { return {}; } };
const setMeta = (m, patch) => AS.setSetting(metaKey(m), JSON.stringify({ ...getMeta(m), ...patch }));
function connectedList() { // every mailbox that has a stored token (the 3 slots first, any other care@ that was connected after)
  const all = new Set(SLOTS.map((s) => s.toLowerCase()));
  for (const r of db.prepare("SELECT key FROM settings WHERE key LIKE 'gm_tok_%' AND value<>''").all()) all.add(r.key.slice(7));
  return [...all].filter((m) => !!AS.getSetting(tokKey(m), ''));
}

// ---- OAuth connect ----
const states = new Map(); // state -> { mailbox, at }
function connectUrl(mailbox) {
  if (!configured()) throw new Error('Google Client ID/Secret abhi portal me nahi hai (setgmail.sh chalao)');
  const state = crypto.randomBytes(18).toString('hex');
  for (const [k, v] of states) if (Date.now() - v.at > 600000) states.delete(k);
  states.set(state, { mailbox: String(mailbox || '').toLowerCase(), at: Date.now() });
  const q = new URLSearchParams({ client_id: cid(), redirect_uri: redirect(), response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent select_account', state });
  if (mailbox) q.set('login_hint', mailbox);
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + q;
}
async function tokenCall(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: cid(), client_secret: csec(), ...params }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || 'Google token error ' + r.status);
  return j;
}
async function callback(code, state, user) {
  const st = states.get(state); states.delete(state);
  if (!st || Date.now() - st.at > 600000) throw new Error('Connect ka link purana ho gaya - Gmail tab se dobara Connect dabao');
  const t = await tokenCall({ code, redirect_uri: redirect(), grant_type: 'authorization_code' });
  if (!t.refresh_token) throw new Error('Google ne permanent access nahi diya - portal ke Connect se dobara try karo (pehle myaccount.google.com/permissions se purani permission hata do)');
  const p = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: 'Bearer ' + t.access_token } });
  const pj = await p.json().catch(() => ({}));
  const email = String(pj.emailAddress || '').toLowerCase();
  if (!p.ok || !email) throw new Error('Gmail ka address padh nahi paaye');
  if (!ALLOWED.test(email)) throw new Error(`${email} care@ mailbox nahi hai - sirf care@ wale mailbox jud sakte hain`);
  AS.setSetting(tokKey(email), enc(t.refresh_token));
  setMeta(email, { since: new Date().toISOString(), error: '' });
  cache.delete(email);
  log(user, 'gmail_connect', email);
  return email;
}
async function disconnect(mailbox, user) {
  const m = String(mailbox || '').toLowerCase();
  try { const rt = dec(AS.getSetting(tokKey(m), '')); await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(rt), { method: 'POST' }); } catch (_) { /* best effort */ }
  AS.setSetting(tokKey(m), ''); AS.setSetting(metaKey(m), '{}'); cache.delete(m);
  log(user, 'gmail_disconnect', m);
}

// ---- reading ----
const cache = new Map(); // mailbox -> { token, exp }
async function accessToken(m) {
  const c = cache.get(m);
  if (c && c.exp > Date.now() + 60000) return c.token;
  const stored = AS.getSetting(tokKey(m), '');
  if (!stored) throw new Error('Connected nahi hai');
  const t = await tokenCall({ refresh_token: dec(stored), grant_type: 'refresh_token' });
  cache.set(m, { token: t.access_token, exp: Date.now() + (t.expires_in || 3000) * 1000 });
  return t.access_token;
}
async function g(m, path) {
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/' + path, { headers: { Authorization: 'Bearer ' + await accessToken(m) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || 'Gmail error ' + r.status);
  return j;
}
const hdr = (msg, n) => ((msg.payload && msg.payload.headers) || []).find((h) => h.name.toLowerCase() === n.toLowerCase())?.value || '';
function textOf(part) { // first text/plain body in the message, decoded
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body && part.body.data) return Buffer.from(part.body.data, 'base64url').toString('utf8');
  for (const p of part.parts || []) { const t = textOf(p); if (t) return t; }
  return '';
}
const snippetOf = (msg) => {
  const body = textOf(msg.payload).split('\n').filter((l) => l.trim() && l.trim()[0] !== '>').join(' ');
  return (body.split(/On .{5,80} wrote:/)[0] || msg.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 600);
};
const seen = new Map(); // threadId -> historyId already handled (saves Gmail calls between polls)

async function pollOne(m) {
  const list = await g(m, 'threads?' + new URLSearchParams({ q: 'in:inbox newer_than:2d', maxResults: '60' }));
  const out = [];
  for (const th of list.threads || []) {
    const sk = m + '|' + th.id;
    if (seen.get(sk) === th.historyId) continue;
    const full = await g(m, 'threads/' + th.id + '?format=full');
    const msgs = full.messages || [];
    seen.set(sk, th.historyId);
    if (msgs.length < 2 || !OWN.test(hdr(msgs[0], 'From'))) continue; // only threads that started with OUR mail
    for (const x of msgs.slice(1)) {
      const from = hdr(x, 'From'), em = ((from.match(/<([^>]+)>/) || [0, from])[1] || '').trim();
      if (OWN.test(em)) continue;
      out.push({ mailbox: m, msgId: m + ':' + x.id, from: em, name: from.replace(/<.*>/, '').replace(/"/g, '').trim(), subject: hdr(x, 'Subject'), snippet: snippetOf(x), at: new Date(+x.internalDate || Date.now()).toISOString() });
    }
  }
  const r = out.length ? EXT.ingest(out) : { added: 0, skipped: 0 };
  setMeta(m, { last: new Date().toISOString(), error: '', added: (getMeta(m).added || 0) + r.added });
  return r;
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
      catch (e) { setMeta(m, { error: String(e.message || e).slice(0, 200) }); results.push({ mailbox: m, error: String(e.message || e).slice(0, 200) }); }
    }
  } finally { busy = false; }
  return { ok: true, results };
}
function status() {
  const on = new Set(connectedList());
  const boxes = [...new Set([...SLOTS, ...on])].map((m) => { const x = getMeta(m); return { mailbox: m, connected: on.has(m), since: x.since || '', last: x.last || '', error: x.error || '', added: x.added || 0 }; });
  return { configured: configured(), redirect: redirect(), mailboxes: boxes };
}
module.exports = { configured, connectUrl, callback, disconnect, poll, status, SLOTS };
