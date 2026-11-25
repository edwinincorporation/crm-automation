// Mail Meter Check: people who REPLIED to or CLICKED a Delhi Crest Mail campaign, and whether Zoho already has a task for them.
// Reads the mail app's database through a READ-ONLY login (MAIL_DB_URL). Tasks are created only on a click, and never in DRY_RUN.
const zoho = require('./zoho');
const { db, log } = require('./db');
const AS = require('./assign'); // settings store

const MODE = require('./mode');
const DRY_DEMO = false;
db.exec('CREATE TABLE IF NOT EXISTS mm_done (key TEXT PRIMARY KEY, by TEXT, how TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP)');
const prefix = () => AS.getSetting('mm_prefix', 'Mailmeteor (edwinincorp.com)');
let pool = null;
function getPool() {
  if (!process.env.MAIL_DB_URL) return null;
  if (!pool) { const { Pool } = require('pg'); pool = new Pool({ connectionString: process.env.MAIL_DB_URL, max: 2, statement_timeout: 15000 }); }
  return pool;
}

async function events(days) {
  if (zoho.DEMO) {
    const now = new Date().toISOString();
    return [{ email: 'melanie@example.com', campaign_id: 1, campaign: 'Invitation to Speak - Maldives', replied_at: now, clicked_at: null, click_count: 0 },
      { email: 'subin@example.com', campaign_id: 1, campaign: 'Invitation to Speak - Maldives', replied_at: null, clicked_at: now, click_count: 2 }];
  }
  const p = getPool(); if (!p) throw new Error('Mail Meter database is not connected yet (MAIL_DB_URL is not set on the server).');
  const r = await p.query(`SELECT r.email, r.campaign_id, to_jsonb(c) AS c, to_jsonb(r) AS rj, r.replied_at, r.clicked_at, r.click_count
    FROM recipients r JOIN campaigns c ON c.id = r.campaign_id
    WHERE (r.replied_at IS NOT NULL OR r.clicked_at IS NOT NULL) AND GREATEST(r.replied_at, r.clicked_at) > now() - ($1 || ' days')::interval
    ORDER BY GREATEST(r.replied_at, r.clicked_at) DESC LIMIT 300`, [String(days)]);
  const ext = require('./mailext').recent(days).map((x) => ({ email: x.email, campaign_id: 'ext', key: 'ext|' + x.msg_id, campaign: x.subject || 'Mailmeteor reply', replied_at: x.at, clicked_at: null, click_count: 0, reply_text: x.snippet, source: 'Mailmeteor (' + x.mailbox + ')' }));
  const dc = r.rows.map((x) => ({ email: String(x.email || '').trim().toLowerCase(), campaign_id: x.campaign_id, campaign: x.c?.name || x.c?.subject || ('Campaign ' + x.campaign_id), replied_at: x.replied_at, clicked_at: x.clicked_at, click_count: x.click_count, reply_text: replyTextOf(x.rj) }));
  return [...dc, ...ext].sort((a, b) => new Date(b.replied_at || b.clicked_at) - new Date(a.replied_at || a.clicked_at));
}
// The reply's own text, if the mail app stores it (any column like reply_text / reply_body / reply_snippet). Empty when it does not.
function replyTextOf(rj) {
  if (!rj) return '';
  const k = Object.keys(rj).find((n) => /^reply(_?(text|body|snippet|message|content))?$|^(response|replied)_(text|body|snippet|message)$/i.test(n) && typeof rj[n] === 'string' && rj[n].trim());
  return k ? String(rj[k]).replace(/\s+/g, ' ').trim().slice(0, 700) : '';
}

async function pmap(items, n, fn) { // small concurrency pool so the page does not hang on 300 sequential Zoho calls
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

async function check(days = 7) {
  const ev = await events(Math.min(60, Math.max(1, +days || 7)));
  const done = new Set(db.prepare('SELECT key FROM mm_done').all().map((r) => r.key));
  const emails = [...new Set(ev.map((e) => e.email))];
  const contacts = new Map();
  await pmap(emails, 5, async (em) => contacts.set(em, await zoho.findByEmail(em).catch(() => null)));
  const tasksBy = new Map(); // contact id -> ALL tasks (open + closed); null = could not read
  const people = [...new Map([...contacts.values()].filter(Boolean).map((c) => [c.id, c])).values()];
  await pmap(people, 5, async (c) => tasksBy.set(c.id, await zoho.tasksOf(c.module, c.id)));
  const rows = [];
  for (const e of ev) {
    const key = e.key || `${e.campaign_id}|${e.email}`, kind = e.replied_at ? 'Replied' : 'Clicked', at = e.replied_at || e.clicked_at;
    const c = contacts.get(e.email);
    let handled = '', problem = c ? '' : 'Zoho me ye email nahi mila', callNeeded = false;
    if (done.has(key)) handled = 'Pehle hi nipta diya (portal)';
    else if (c) {
      const list = tasksBy.get(c.id), t0 = new Date(at).getTime();
      if (list === null || list === undefined) problem = 'Zoho se tasks padh nahi paaye - isliye task nahi banayenge';
      else {
        // ANY task (open or closed, any subject - CRM's own incoming-mail tasks count too) created after the reply/click, or naming this campaign
        // already has a task = no new one: any task made after the reply/click (open or closed), the campaign's own task, or ANY still-open task (office may have made it by hand)
        const hit = list.find((t) => (t.Created_Time && new Date(t.Created_Time).getTime() >= t0 - 3600000) || String(t.Subject || '').toLowerCase().includes(String(e.campaign).toLowerCase()) || !/^(completed|closed|cancel)/i.test(t.Status || ''));
        if (hit) handled = 'Task pehle se hai (' + (hit.Status || '') + '): ' + String(hit.Subject).slice(0, 60);
      }
    }
    if (kind === 'Replied' && c && wantsCall({ kind })) { // call task is independent of any other open task; only a call task of ours (or one already made here) stops it
      const list = tasksBy.get(c.id), t0 = new Date(at).getTime();
      callNeeded = Array.isArray(list) && !done.has('call|' + key) && !list.some((t) => String(t.Subject || '').startsWith(CALL_SUBJECT) && t.Created_Time && new Date(t.Created_Time).getTime() >= t0 - 3600000);
    }
    rows.push({ key, callNeeded, source: e.source || 'Delhi Crest Mail', reply_text: e.reply_text || '', campaign_id: e.campaign_id, email: e.email, campaign: e.campaign, kind, at, clicks: e.click_count || 0, replied: !!e.replied_at,
      contact: c ? { id: c.id, module: c.module, name: c.name } : null, handled, problem });
  }
  return { dry: (MODE.isDry() || DRY_DEMO), days, prefix: prefix(), rows };
}

// ---- AI call task: every conference REPLY (not click) also gets a separate calling task; the AI Caller tab then phones the customer ----
// Subject deliberately has no campaign name: words like "invitation" would make the AI Caller treat the task as staff-only.
const CALL_SUBJECT = 'Call customer - replied to conference mail, resolve query';
const callTo = () => AS.getSetting('mm_call_to', 'Priyanka Mahobiya'); // real employee: Zoho Assign_to text
const callOn = () => AS.getSetting('mm_call', '1') === '1';
const callWords = () => AS.getSetting('mm_call_words', 'conference, invitation, speak, speaker, symposium, summit').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const wantsCall = (r) => r.kind === 'Replied' && callOn(); // EVERY reply gets a call task (no campaign-word filter)
const callDesc = (r) => `Customer ne conference mail ka REPLY kiya hai. Call karke unki query resolve karni hai.\nEmail: ${r.email}\nCampaign: ${r.campaign}\nReply time: ${new Date(r.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n` +
  (r.reply_text ? `CUSTOMER'S EMAIL: ${r.reply_text}\n` : 'CUSTOMER\'S EMAIL: (reply ka text mail app se nahi mila - Customer Summary dekhein)\n') + '(created by CRM Portal - Mail Meter Check)';

const subjectOf = (r) => `${prefix()} - ${r.campaign}, ${r.kind === 'Replied' ? 'Replied to email' : 'Clicked link in email'}`;

async function makeCall(r, user) {
  const due = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await zoho.createTask(r.contact.id, CALL_SUBJECT, due, callDesc(r), { Assign_to: callTo() });
  db.prepare('INSERT OR REPLACE INTO mm_done(key,by,how) VALUES(?,?,?)').run('call|' + r.key, user, 'call');
  log(user, 'mailmeter_calltask', `${r.email} -> ${callTo()}`);
}
// Call tasks only (for replies whose letter-task already exists or is not wanted)
async function createCalls(keys, user) {
  const cur = await check(60), out = [];
  for (const k of keys) {
    const r = cur.rows.find((x) => x.key === k);
    try {
      if (!r || !r.callNeeded) throw new Error('Call task ki zarurat nahi / pehle se hai');
      if ((MODE.isDry() || DRY_DEMO) && !zoho.DEMO) { out.push({ key: k, ok: true, dry: true, subject: CALL_SUBJECT + ' -> ' + callTo() }); continue; }
      await makeCall(r, user); out.push({ key: k, ok: true, subject: CALL_SUBJECT + ' -> ' + callTo() });
    } catch (e) { out.push({ key: k, ok: false, error: e.message }); }
  }
  return { dry: (MODE.isDry() || DRY_DEMO), results: out };
}

async function create(keys, user) {
  const cur = await check(60), out = [];
  for (const k of keys) {
    const r = cur.rows.find((x) => x.key === k);
    try {
      if (!r) throw new Error('Ye entry ab list me nahi hai');
      if (r.handled) throw new Error(r.handled);
      if (!r.contact || r.problem) throw new Error(r.problem);
      const due = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const desc = `Email: ${r.email}\n${r.kind} on ${new Date(r.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}${r.clicks ? ' · clicks: ' + r.clicks : ''}\nCampaign: ${r.campaign}\n(created by CRM Portal - Mail Meter Check)`;
      if ((MODE.isDry() || DRY_DEMO) && !zoho.DEMO) { out.push({ key: k, ok: true, dry: true, subject: subjectOf(r), call: r.callNeeded ? CALL_SUBJECT : '' }); continue; }
      await zoho.createTask(r.contact.id, subjectOf(r), due, desc);
      db.prepare('INSERT OR REPLACE INTO mm_done(key,by,how) VALUES(?,?,?)').run(k, user, 'task');
      let callMade = false;
      if (r.callNeeded) { try { await makeCall(r, user); callMade = true; } catch (e) { log(user, 'mailmeter_calltask_error', `${r.email}: ${String(e.message || e).slice(0, 120)}`); } }
      log(user, 'mailmeter_task', `${r.email} ${r.kind} ${r.campaign}`);
      out.push({ key: k, ok: true, subject: subjectOf(r), call: callMade ? CALL_SUBJECT : '' });
    } catch (e) { out.push({ key: k, ok: false, error: e.message }); }
  }
  return { dry: (MODE.isDry() || DRY_DEMO), results: out };
}
function skip(keys, user) { for (const k of keys) db.prepare('INSERT OR REPLACE INTO mm_done(key,by,how) VALUES(?,?,?)').run(k, user, 'skipped'); log(user, 'mailmeter_skip', `${keys.length}`); return { ok: true }; }

// ---- optional daily auto-run (default OFF). Modes: '0' off, 'list' only prepare the list, 'create' also create the missing tasks (never in DRY_RUN) ----
const istNow = () => new Date(Date.now() + 19800000); // IST = UTC+5:30
function autoGet() {
  let last = null; try { last = JSON.parse(AS.getSetting('mm_auto_last', 'null')); } catch (_) { /* none */ }
  return { mode: AS.getSetting('mm_auto', '0'), hour: +AS.getSetting('mm_auto_hour', '9'), dry: (MODE.isDry() || DRY_DEMO), last };
}
function autoSet(mode, hour) {
  if (!['0', 'list', 'create'].includes(mode)) throw new Error('Galat option');
  AS.setSetting('mm_auto', mode); AS.setSetting('mm_auto_hour', String(Math.min(23, Math.max(0, +hour || 9))));
  return autoGet();
}
async function autoRun(force) {
  const s = autoGet(); if (s.mode === '0' && !force) return null;
  const n = istNow(), today = n.toISOString().slice(0, 10);
  if (!force && (n.getUTCHours() !== s.hour || s.last?.date === today)) return null;
  const rec = { date: today, at: new Date().toISOString(), mode: s.mode, dry: (MODE.isDry() || DRY_DEMO) };
  try {
    const r = await check(3), todo = r.rows.filter((x) => !x.handled && x.contact && !x.problem);
    Object.assign(rec, { total: r.rows.length, todo: todo.length, created: 0, failed: 0 });
    if (s.mode === 'create' && !(MODE.isDry() || DRY_DEMO)) {
      const calls = r.rows.filter((x) => x.callNeeded && x.contact && !x.problem && !todo.includes(x));
      if (calls.length) { const o = await createCalls(calls.slice(0, 50).map((x) => x.key), 'auto'); rec.calls = o.results.filter((x) => x.ok).length; }
    }
    if (s.mode === 'create' && !(MODE.isDry() || DRY_DEMO) && todo.length) {
      const out = await create(todo.slice(0, 50).map((x) => x.key), 'auto');
      rec.created = out.results.filter((x) => x.ok).length; rec.failed = out.results.filter((x) => !x.ok).length;
    }
    log('auto-mailmeter', 'mailmeter_auto', `${s.mode}: ${rec.total} entries, ${rec.todo} need task, created ${rec.created}`);
  } catch (e) { rec.error = e.message; log('auto-mailmeter', 'mailmeter_auto_error', e.message); }
  AS.setSetting('mm_auto_last', JSON.stringify(rec));
  return rec;
}

// Read-only peek at the Mail app's `recipients` table: column names/types, and how many of the last 30 days' replies have a non-empty value in each text column.
// Returns no customer data - only names and counts - so we can find where the reply text lives.
async function schemaPeek() {
  const p = getPool(); if (!p) throw new Error('Mail Meter database is not connected yet (MAIL_DB_URL is not set on the server).');
  const cols = (await p.query("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('recipients','campaigns','replies','messages','emails','reply_logs') ORDER BY table_name, ordinal_position")).rows;
  const tables = (await p.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1")).rows.map((r) => r.table_name);
  const filled = {};
  for (const c of cols.filter((x) => x.table_name === 'recipients' && /char|text|json/i.test(x.data_type))) {
    try {
      const q = await p.query(`SELECT count(*)::int AS n FROM recipients WHERE replied_at > now() - interval '30 days' AND "${c.column_name.replace(/"/g, '')}" IS NOT NULL AND btrim("${c.column_name.replace(/"/g, '')}"::text) <> ''`);
      filled[c.column_name] = q.rows[0].n;
    } catch (_) { /* skip */ }
  }
  return { tables, columns: cols, repliedFilled: filled };
}

function callGet() { return { on: callOn(), words: callWords().join(', ') }; }
function callSet(on, words) { AS.setSetting('mm_call', on ? '1' : '0'); if (typeof words === 'string' && words.trim()) AS.setSetting('mm_call_words', words.slice(0, 300)); return callGet(); }

module.exports = { createCalls, schemaPeek, callGet, callSet, _t: { wantsCall, callDesc, replyTextOf, CALL_SUBJECT }, autoGet, autoSet, autoRun, check, create, skip, prefix, setPrefix: (v) => AS.setSetting('mm_prefix', String(v || '').trim() || 'Mailmeteor (edwinincorp.com)') };
