// WhatsApp Check: customers who WROTE to one of our Interakt numbers and have no task yet, grouped brand-wise.
// Source: Zoho module WhatsApp_Conversations. Tasks are created only on a click, and never in DRY_RUN.
const zoho = require('./zoho');
const { db, log } = require('./db');
const AS = require('./assign');

const MODE = require('./mode');
const DRY_DEMO = false;
db.exec('CREATE TABLE IF NOT EXISTS wa_done (key TEXT PRIMARY KEY, by TEXT, how TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP)');
const ACK = /^(ok(ay)?( sir| madam| thanks)?|thanks?( you)?( sir| for information| a lot)?|thank you.*|yes( sir)?|noted|done|got it|sure|\?+|👍|🙏)[\s.!🙏👍]*$/i;
const AUTO_OUT = /DYA Support For ADVT|Thank you for contacting us\. We have received your enquiry/i;

const brands = () => { try { return JSON.parse(AS.getSetting('wa_brands', '{}')); } catch (_) { return {}; } };
const brandOf = (acct) => { const b = brands()[acct] || {}; return { account: acct, label: b.label || acct, dept: b.dept || '' }; };
function setBrands(map) {
  const clean = {}; for (const [k, v] of Object.entries(map || {})) clean[String(k).slice(0, 80)] = { label: String(v.label || '').trim().slice(0, 60), dept: String(v.dept || '').trim().slice(0, 80) };
  AS.setSetting('wa_brands', JSON.stringify(clean)); return clean;
}

async function check(days = 3) {
  const msgs = (await zoho.waMessages(Math.min(30, Math.max(1, +days || 3)))).map((m) => ({ ...m, t: new Date(m.Message_Date_Time || m.Created_Time).getTime(), acct: m.Interakt_Account_Name?.name || 'Unknown number', mob: String(m.Mobile_Number || '') }));
  // conversation = same phone + same brand number, oldest -> newest
  const conv = new Map();
  msgs.sort((a, b) => a.t - b.t).forEach((m) => { const k = `${m.mob}|${m.acct}`; (conv.get(k) || conv.set(k, []).get(k)).push(m); });
  const done = new Set(db.prepare('SELECT key FROM wa_done').all().map((r) => r.key));
  const items = [];
  for (const [ck, list] of conv) {
    const incoming = list.filter((m) => m.Message_Direction === 'Incoming');
    if (!incoming.length) continue;
    const last = incoming[incoming.length - 1];
    const repliedByStaff = list.some((m) => m.Message_Direction === 'Outgoing' && m.t > last.t && !AUTO_OUT.test(m.Message_Text || ''));
    const firstUnanswered = incoming.find((m) => !list.some((o) => o.Message_Direction === 'Outgoing' && o.t > m.t && !AUTO_OUT.test(o.Message_Text || ''))) || last;
    const text = (last.Message_Text || '').trim();
    items.push({ key: `${ck}|${last.id}`, mob: last.mob, acct: last.acct, last, firstAt: firstUnanswered.t, count: incoming.length, text, repliedByStaff, ack: !text ? false : ACK.test(text) });
  }
  // the same message is often mirrored on 2 numbers within seconds -> keep one row per (phone, text, ~1min)
  items.sort((a, b) => b.last.t - a.last.t);
  const seen = []; const uniq = [];
  for (const it of items) { const dup = seen.find((s) => s.mob === it.mob && s.text === it.text && Math.abs(s.last.t - it.last.t) < 60000); if (dup) { dup.also = (dup.also || []).concat(it.acct); continue; } seen.push(it); uniq.push(it); }
  const people = [...new Set(uniq.map((u) => u.last.Contact?.id).filter(Boolean))];
  const tasksBy = new Map(); let i = 0;
  await Promise.all(Array.from({ length: Math.min(5, people.length) }, async () => { while (i < people.length) { const id = people[i++]; tasksBy.set(id, await zoho.tasksOf('Contacts', id)); } }));
  const rows = uniq.map((u) => {
    const c = u.last.Contact, br = brandOf(u.acct);
    let handled = '', problem = c ? '' : 'Zoho me is number ka Contact nahi mila';
    if (done.has(u.key)) handled = 'Pehle hi nipta diya (portal)';
    else if (u.repliedByStaff) handled = 'Staff ne jawab de diya';
    else if (c) {
      const tl = tasksBy.get(c.id);
      if (tl === null || tl === undefined) problem = 'Zoho se tasks padh nahi paaye';
      // office may already have made a task by hand: any open task counts too
      else { const hit = tl.find((t) => (t.Created_Time && new Date(t.Created_Time).getTime() >= u.firstAt - 3600000) || !/^(completed|closed|cancel)/i.test(t.Status || '')); if (hit) handled = 'Task pehle se hai (' + (hit.Status || '') + '): ' + String(hit.Subject).slice(0, 60); }
    }
    return { key: u.key, brand: br.label, account: u.acct, also: u.also || [], mobile: u.mob, at: new Date(u.last.t).toISOString(), messages: u.count, text: u.text || '[photo / file / voice]', ack: u.ack,
      contact: c ? { id: c.id, name: c.name } : null, handled, problem };
  });
  return { dry: (MODE.isDry() || DRY_DEMO), days, rows };
}

const subjectOf = (r) => `WhatsApp (${r.brand}) - ${r.text.replace(/\s+/g, ' ').slice(0, 60)}`;

async function create(keys, user) {
  const cur = await check(30), out = [];
  for (const k of keys) {
    const r = cur.rows.find((x) => x.key === k);
    try {
      if (!r) throw new Error('Ye entry ab list me nahi hai');
      if (r.handled) throw new Error(r.handled);
      if (!r.contact || r.problem) throw new Error(r.problem);
      const due = new Date(Date.now() + 86400000).toISOString().slice(0, 10), br = brandOf(r.account);
      const desc = `WhatsApp: +${r.mobile} (${r.account})\nLast message (${new Date(r.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}): ${r.text}\nMessages from customer: ${r.messages}\n(created by CRM Portal - WhatsApp Check)`;
      if ((MODE.isDry() || DRY_DEMO) && !zoho.DEMO) { out.push({ key: k, ok: true, dry: true, subject: subjectOf(r) }); continue; }
      await zoho.createTask(r.contact.id, subjectOf(r), due, desc, br.dept ? { Dept_Name: br.dept } : undefined);
      db.prepare('INSERT OR REPLACE INTO wa_done(key,by,how) VALUES(?,?,?)').run(k, user, 'task');
      log(user, 'whatsapp_task', `${r.mobile} ${r.brand}`);
      out.push({ key: k, ok: true, subject: subjectOf(r) });
    } catch (e) { out.push({ key: k, ok: false, error: e.message }); }
  }
  return { dry: (MODE.isDry() || DRY_DEMO), results: out };
}
function skip(keys, user) { for (const k of keys) db.prepare('INSERT OR REPLACE INTO wa_done(key,by,how) VALUES(?,?,?)').run(k, user, 'skipped'); log(user, 'whatsapp_skip', `${keys.length}`); return { ok: true }; }

// optional daily auto-run (default OFF): 'list' prepares the list, 'create' also creates missing tasks (never in DRY_RUN)
const istNow = () => new Date(Date.now() + 19800000);
function autoGet() { let last = null; try { last = JSON.parse(AS.getSetting('wa_auto_last', 'null')); } catch (_) { /* none */ } return { mode: AS.getSetting('wa_auto', '0'), hour: +AS.getSetting('wa_auto_hour', '9'), dry: (MODE.isDry() || DRY_DEMO), last }; }
function autoSet(mode, hour) { if (!['0', 'list', 'create'].includes(mode)) throw new Error('Galat option'); AS.setSetting('wa_auto', mode); AS.setSetting('wa_auto_hour', String(Math.min(23, Math.max(0, +hour || 9)))); return autoGet(); }
async function autoRun(force) {
  const s = autoGet(); if (s.mode === '0' && !force) return null;
  const n = istNow(), today = n.toISOString().slice(0, 10);
  if (!force && (n.getUTCHours() !== s.hour || s.last?.date === today)) return null;
  const rec = { date: today, at: new Date().toISOString(), mode: s.mode, dry: (MODE.isDry() || DRY_DEMO) };
  try {
    const r = await check(2), todo = r.rows.filter((x) => !x.handled && x.contact && !x.problem && !x.ack);
    Object.assign(rec, { total: r.rows.length, todo: todo.length, created: 0, failed: 0 });
    if (s.mode === 'create' && !(MODE.isDry() || DRY_DEMO) && todo.length) { const o = await create(todo.slice(0, 50).map((x) => x.key), 'auto'); rec.created = o.results.filter((x) => x.ok).length; rec.failed = o.results.filter((x) => !x.ok).length; }
    log('auto-whatsapp', 'whatsapp_auto', `${s.mode}: ${rec.total} chats, ${rec.todo} need task, created ${rec.created}`);
  } catch (e) { rec.error = e.message; log('auto-whatsapp', 'whatsapp_auto_error', e.message); }
  AS.setSetting('wa_auto_last', JSON.stringify(rec)); return rec;
}

module.exports = { check, create, skip, brands, brandOf, setBrands, autoGet, autoSet, autoRun };
