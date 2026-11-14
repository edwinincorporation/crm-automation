// Mail Meter Check: people who REPLIED to or CLICKED a Delhi Crest Mail campaign, and whether Zoho already has a task for them.
// Reads the mail app's database through a READ-ONLY login (MAIL_DB_URL). Tasks are created only on a click, and never in DRY_RUN.
const zoho = require('./zoho');
const { db, log } = require('./db');
const AS = require('./assign'); // settings store

const DRY = process.env.DRY_RUN === '1';
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
  const r = await p.query(`SELECT r.email, r.campaign_id, to_jsonb(c) AS c, r.replied_at, r.clicked_at, r.click_count
    FROM recipients r JOIN campaigns c ON c.id = r.campaign_id
    WHERE (r.replied_at IS NOT NULL OR r.clicked_at IS NOT NULL) AND GREATEST(r.replied_at, r.clicked_at) > now() - ($1 || ' days')::interval
    ORDER BY GREATEST(r.replied_at, r.clicked_at) DESC LIMIT 300`, [String(days)]);
  return r.rows.map((x) => ({ email: String(x.email || '').trim().toLowerCase(), campaign_id: x.campaign_id, campaign: x.c?.name || x.c?.subject || ('Campaign ' + x.campaign_id), replied_at: x.replied_at, clicked_at: x.clicked_at, click_count: x.click_count }));
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
    const key = `${e.campaign_id}|${e.email}`, kind = e.replied_at ? 'Replied' : 'Clicked', at = e.replied_at || e.clicked_at;
    const c = contacts.get(e.email);
    let handled = '', problem = c ? '' : 'Zoho me ye email nahi mila';
    if (done.has(key)) handled = 'Pehle hi nipta diya (portal)';
    else if (c) {
      const list = tasksBy.get(c.id), t0 = new Date(at).getTime();
      if (list === null || list === undefined) problem = 'Zoho se tasks padh nahi paaye - isliye task nahi banayenge';
      else {
        // ANY task (open or closed, any subject - CRM's own incoming-mail tasks count too) created after the reply/click, or naming this campaign
        const hit = list.find((t) => (t.Created_Time && new Date(t.Created_Time).getTime() >= t0 - 3600000) || String(t.Subject || '').toLowerCase().includes(String(e.campaign).toLowerCase()));
        if (hit) handled = 'Task pehle se hai (' + (hit.Status || '') + '): ' + String(hit.Subject).slice(0, 60);
      }
    }
    rows.push({ key, campaign_id: e.campaign_id, email: e.email, campaign: e.campaign, kind, at, clicks: e.click_count || 0, replied: !!e.replied_at,
      contact: c ? { id: c.id, module: c.module, name: c.name } : null, handled, problem });
  }
  return { dry: DRY, days, prefix: prefix(), rows };
}

const subjectOf = (r) => `${prefix()} - ${r.campaign}, ${r.kind === 'Replied' ? 'Replied to email' : 'Clicked link in email'}`;

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
      if (DRY && !zoho.DEMO) { out.push({ key: k, ok: true, dry: true, subject: subjectOf(r) }); continue; }
      await zoho.createTask(r.contact.id, subjectOf(r), due, desc);
      db.prepare('INSERT OR REPLACE INTO mm_done(key,by,how) VALUES(?,?,?)').run(k, user, 'task');
      log(user, 'mailmeter_task', `${r.email} ${r.kind} ${r.campaign}`);
      out.push({ key: k, ok: true, subject: subjectOf(r) });
    } catch (e) { out.push({ key: k, ok: false, error: e.message }); }
  }
  return { dry: DRY, results: out };
}
function skip(keys, user) { for (const k of keys) db.prepare('INSERT OR REPLACE INTO mm_done(key,by,how) VALUES(?,?,?)').run(k, user, 'skipped'); log(user, 'mailmeter_skip', `${keys.length}`); return { ok: true }; }

// ---- optional daily auto-run (default OFF). Modes: '0' off, 'list' only prepare the list, 'create' also create the missing tasks (never in DRY_RUN) ----
const istNow = () => new Date(Date.now() + 19800000); // IST = UTC+5:30
function autoGet() {
  let last = null; try { last = JSON.parse(AS.getSetting('mm_auto_last', 'null')); } catch (_) { /* none */ }
  return { mode: AS.getSetting('mm_auto', '0'), hour: +AS.getSetting('mm_auto_hour', '9'), dry: DRY, last };
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
  const rec = { date: today, at: new Date().toISOString(), mode: s.mode, dry: DRY };
  try {
    const r = await check(3), todo = r.rows.filter((x) => !x.handled && x.contact && !x.problem);
    Object.assign(rec, { total: r.rows.length, todo: todo.length, created: 0, failed: 0 });
    if (s.mode === 'create' && !DRY && todo.length) {
      const out = await create(todo.slice(0, 50).map((x) => x.key), 'auto');
      rec.created = out.results.filter((x) => x.ok).length; rec.failed = out.results.filter((x) => !x.ok).length;
    }
    log('auto-mailmeter', 'mailmeter_auto', `${s.mode}: ${rec.total} entries, ${rec.todo} need task, created ${rec.created}`);
  } catch (e) { rec.error = e.message; log('auto-mailmeter', 'mailmeter_auto_error', e.message); }
  AS.setSetting('mm_auto_last', JSON.stringify(rec));
  return rec;
}

module.exports = { autoGet, autoSet, autoRun, check, create, skip, prefix, setPrefix: (v) => AS.setSetting('mm_prefix', String(v || '').trim() || 'Mailmeteor (edwinincorp.com)') };
