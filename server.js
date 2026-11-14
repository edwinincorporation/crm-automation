const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { db, hash, verify, log } = require('./lib/db');
const zoho = require('./lib/zoho');
const { send } = require('./lib/senders');
const A = require('./lib/analyze');
const E = require('./lib/engine');
const AS = require('./lib/assign');
const LT = require('./lib/letters');
const MM = require('./lib/mailmeter');

const app = express();
app.use(express.json({ limit: '2mb' }));

// ---------- sessions ----------
const sessions = new Map();
const cookie = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((x) => x[0]));
function auth(roles) {
  return (req, res, next) => {
    const s = sessions.get(cookie(req).sid);
    if (!s) return res.status(401).json({ error: 'Login required' });
    if (roles && !roles.includes(s.role)) return res.status(403).json({ error: 'Not allowed for your role' });
    req.user = s; next();
  };
}
const ANY = auth();
const MGR = auth(['admin', 'manager']);
const ADM = auth(['admin']);

const attempts = new Map();
app.post('/api/login', (req, res) => {
  const ip = req.ip, a = attempts.get(ip) || { n: 0, t: Date.now() };
  if (a.n >= 8 && Date.now() - a.t < 600000) return res.status(429).json({ error: 'Too many attempts, wait 10 minutes' });
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(String(req.body.username || ''));
  if (!u || !verify(String(req.body.password || ''), u.pass_hash)) {
    attempts.set(ip, { n: a.n + 1, t: a.t }); return res.status(401).json({ error: 'Wrong username or password' });
  }
  attempts.delete(ip);
  const sid = crypto.randomBytes(24).toString('hex');
  sessions.set(sid, { username: u.username, role: u.role });
  res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`);
  log(u.username, 'login', '');
  res.json({ username: u.username, role: u.role, demo: zoho.DEMO });
});
app.post('/api/logout', (req, res) => { sessions.delete(cookie(req).sid); res.json({ ok: true }); });
app.get('/api/me', ANY, (req, res) => res.json({ ...req.user, demo: zoho.DEMO }));

// ---------- users (admin) ----------
app.get('/api/users', ADM, (req, res) => res.json(db.prepare('SELECT id,username,role,created_at FROM users').all()));
app.post('/api/users', ADM, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || password.length < 8) return res.status(400).json({ error: 'Username and password (min 8 chars) required' });
  if (!['admin', 'manager', 'executive'].includes(role)) return res.status(400).json({ error: 'Bad role' });
  try { db.prepare('INSERT INTO users(username,pass_hash,role) VALUES(?,?,?)').run(username, hash(password), role); }
  catch { return res.status(400).json({ error: 'Username exists' }); }
  log(req.user.username, 'user_create', `${username} (${role})`);
  res.json({ ok: true });
});
app.delete('/api/users/:id', ADM, (req, res) => {
  const u = db.prepare('SELECT username FROM users WHERE id=?').get(req.params.id);
  if (!u || u.username === req.user.username) return res.status(400).json({ error: 'Cannot delete this user' });
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  log(req.user.username, 'user_delete', u.username); res.json({ ok: true });
});

// ---------- action rules ----------
app.get('/api/rules', ANY, (req, res) => res.json(db.prepare('SELECT * FROM action_rules ORDER BY id').all()));
app.post('/api/rules', MGR, (req, res) => {
  const r = req.body;
  if (!r.name || !r.match_value || !['email', 'letter', 'whatsapp'].includes(r.action_type) || !r.body) return res.status(400).json({ error: 'name, match text, action type and message are required' });
  if (r.id) {
    db.prepare('UPDATE action_rules SET name=?,match_field=?,match_value=?,action_type=?,subject=?,body=?,require_approval=?,active=? WHERE id=?')
      .run(r.name, r.match_field || 'Subject', r.match_value, r.action_type, r.subject || '', r.body, r.require_approval ? 1 : 0, r.active === false ? 0 : 1, r.id);
  } else {
    db.prepare('INSERT INTO action_rules(name,match_field,match_value,action_type,subject,body,require_approval) VALUES(?,?,?,?,?,?,?)')
      .run(r.name, r.match_field || 'Subject', r.match_value, r.action_type, r.subject || '', r.body, r.require_approval === false ? 0 : 1);
  }
  log(req.user.username, 'rule_save', r.name); res.json({ ok: true });
});
app.delete('/api/rules/:id', MGR, (req, res) => { db.prepare('DELETE FROM action_rules WHERE id=?').run(req.params.id); log(req.user.username, 'rule_delete', req.params.id); res.json({ ok: true }); });

// ---------- Task Closer ----------
app.get('/api/tasks', ANY, async (req, res) => {
  try {
    const tasks = await zoho.listTasks({ status: req.query.status, dept: req.query.dept, q: req.query.q });
    const rules = db.prepare('SELECT * FROM action_rules WHERE active=1').all();
    res.json(tasks.map((t) => ({ ...t, rules: matchRules(t, rules).map((r) => ({ id: r.id, name: r.name, action_type: r.action_type })) })));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

function matchRules(task, rules) {
  return rules.filter((r) => {
    const hay = r.match_field === 'Dept_Name' ? task.Dept_Name || '' : task.Subject || '';
    return hay.toLowerCase().includes(r.match_value.toLowerCase());
  });
}
const fill = (tpl, v) => String(tpl || '').replace(/\{\{(\w+)\}\}/g, (_, k) => v[k] ?? '');
function contactFromDescription(d) {
  return { email: (String(d || '').match(/Email:\s*([^\s]+@[^\s]+)/i) || [])[1], phone: (String(d || '').match(/Phone:\s*([+\d][\d\s-]{8,})/i) || [])[1] };
}

// Close selected tasks. Builds actions from rules; those needing approval go to the Outbox.
app.post('/api/tasks/close', MGR, async (req, res) => {
  const { ids = [], note = '', skipActions = false } = req.body;
  if (!ids.length) return res.status(400).json({ error: 'No tasks selected' });
  const rules = db.prepare('SELECT * FROM action_rules WHERE active=1').all();
  const all = await zoho.listTasks({}).catch((e) => { res.status(502).json({ error: e.message }); return null; });
  if (!all) return;
  const results = [];
  for (const id of ids) {
    const t = all.find((x) => String(x.id) === String(id));
    if (!t) { results.push({ id, error: 'Task not found or already closed' }); continue; }
    const out = { id, subject: t.Subject, queued: 0, sent: 0, errors: [] };
    try {
      if (!skipActions) {
        const c = contactFromDescription(t.Description);
        let contact = null;
        try { contact = await zoho.getContact(t.Who_Id?.id); } catch (_) {}
        const vars = {
          name: t.Who_Id?.name || contact?.Full_Name || '', subject: t.Subject || '', dept: t.Dept_Name || '',
          email: contact?.Email || c.email || '', phone: contact?.Mobile || contact?.Phone || c.phone || '', note,
        };
        for (const r of matchRules(t, rules)) {
          const info = db.prepare('INSERT INTO outbox(task_id,task_subject,rule_id,action_type,to_name,to_email,to_phone,subject,body,status,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
            .run(String(t.id), t.Subject, r.id, r.action_type, vars.name, vars.email, vars.phone, fill(r.subject, vars), fill(r.body, vars), 'pending', req.user.username);
          if (r.require_approval) { out.queued++; continue; }
          const ok = await dispatch(info.lastInsertRowid, req.user.username);
          ok ? out.sent++ : out.errors.push('send failed (see Outbox)');
        }
      }
      await zoho.closeTask(t.id, note);
      db.prepare('INSERT INTO manual_actions(user,task_subject,dept,kind) VALUES(?,?,?,?)').run(req.user.username, t.Subject, t.Dept_Name || '', 'close');
      log(req.user.username, 'task_close', `${t.id} ${t.Subject}`);
    } catch (e) { out.errors.push(e.message); }
    results.push(out);
  }
  res.json({ results });
});

async function dispatch(outboxId, user) {
  const item = db.prepare('SELECT * FROM outbox WHERE id=?').get(outboxId);
  try {
    const r = await send(item);
    db.prepare("UPDATE outbox SET status=?, sent_at=CURRENT_TIMESTAMP, error=NULL WHERE id=?").run(r.dry ? 'sent (dry run)' : 'sent', outboxId);
    log(user, 'send_' + item.action_type, `${item.to_name} ${item.to_email || item.to_phone}`);
    return true;
  } catch (e) {
    db.prepare("UPDATE outbox SET status='failed', error=? WHERE id=?").run(e.message, outboxId);
    return false;
  }
}

// ---------- Outbox ----------
app.get('/api/outbox', ANY, (req, res) => res.json(db.prepare('SELECT * FROM outbox ORDER BY id DESC LIMIT 300').all()));
app.post('/api/outbox/:id/approve', MGR, async (req, res) => {
  const it = db.prepare('SELECT * FROM outbox WHERE id=?').get(req.params.id);
  if (!it || !['pending', 'failed'].includes(it.status)) return res.status(400).json({ error: 'Not pending' });
  if (req.body.body !== undefined) db.prepare('UPDATE outbox SET body=?, subject=? WHERE id=?').run(String(req.body.body), String(req.body.subject ?? it.subject), it.id);
  const ok = await dispatch(it.id, req.user.username);
  res.json({ ok, item: db.prepare('SELECT * FROM outbox WHERE id=?').get(it.id) });
});
app.post('/api/outbox/:id/reject', MGR, (req, res) => {
  db.prepare("UPDATE outbox SET status='rejected' WHERE id=? AND status IN ('pending','failed')").run(req.params.id);
  log(req.user.username, 'outbox_reject', req.params.id); res.json({ ok: true });
});

// ---------- Workflow Analysis ----------
app.get('/api/workflows', MGR, async (req, res) => {
  try { res.json(A.analyzeWorkflows(await zoho.listWorkflows())); } catch (e) { res.status(502).json({ error: e.message }); }
});

// ---------- Email Analysis ----------
// Ingest an email (paste in UI, or POST from Gmail Apps Script / n8n using the INGEST_KEY header).
function ingest(m) {
  const body = String(m.body || '').slice(0, 20000), subject = String(m.subject || '');
  const cat = A.classify(subject, body), ex = A.extract(subject, body);
  const props = A.propose(cat, m.from_email, subject, ex);
  const info = db.prepare('INSERT INTO email_queue(from_email,from_name,subject,body,category,extracted,proposals) VALUES(?,?,?,?,?,?,?)')
    .run(m.from_email || '', m.from_name || '', subject, body, cat, JSON.stringify(ex), JSON.stringify(props));
  return info.lastInsertRowid;
}
app.post('/api/emails/ingest', (req, res, next) => {
  if (process.env.INGEST_KEY && req.headers['x-ingest-key'] === process.env.INGEST_KEY) { req.user = { username: 'ingest' }; return next(); }
  ANY(req, res, next);
}, (req, res) => {
  if (!req.body.from_email || !req.body.body) return res.status(400).json({ error: 'from_email and body required' });
  const id = ingest(req.body); log(req.user.username, 'email_ingest', req.body.subject || ''); res.json({ id });
});
app.get('/api/emails', ANY, (req, res) => res.json(db.prepare('SELECT * FROM email_queue ORDER BY id DESC LIMIT 200').all().map((r) => ({ ...r, extracted: JSON.parse(r.extracted), proposals: JSON.parse(r.proposals) }))));
app.post('/api/emails/:id/apply', MGR, async (req, res) => {
  const row = db.prepare('SELECT * FROM email_queue WHERE id=?').get(req.params.id);
  if (!row || row.status !== 'pending') return res.status(400).json({ error: 'Not pending' });
  const props = JSON.parse(row.proposals);
  const chosen = (req.body.indexes || props.map((_, i) => i)).map((i) => props[i]).filter(Boolean);
  try {
    const rec = await zoho.findByEmail(row.from_email);
    if (!rec) return res.status(404).json({ error: 'No Contact/Lead found for ' + row.from_email });
    const done = [];
    for (const p of chosen) {
      if (p.type === 'note') await zoho.addNote(rec.module, rec.id, p.title, `${p.content}\n\n${row.body.slice(0, 1500)}`);
      if (p.type === 'field') await zoho.updateRecord(rec.module, rec.id, { [p.field]: p.value });
      if (p.type === 'task') await zoho.createTask(rec.module === 'Contacts' ? rec.id : null, p.subject, new Date(Date.now() + 86400000).toISOString().slice(0, 10), `From email: ${row.subject}\n${row.from_email}`);
      done.push(p.label || p.type);
    }
    db.prepare("UPDATE email_queue SET status='applied' WHERE id=?").run(row.id);
    log(req.user.username, 'email_apply', `${row.from_email}: ${done.join(', ')}`);
    res.json({ ok: true, record: rec, done });
  } catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/api/emails/:id/dismiss', MGR, (req, res) => { db.prepare("UPDATE email_queue SET status='dismissed' WHERE id=?").run(req.params.id); res.json({ ok: true }); });


// ---------- Macros ----------
const STEP_TYPES = ['update_fields', 'assign', 'note', 'create_task', 'message', 'close'];
function cleanSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) throw new Error('Add at least one step');
  return steps.map((s) => {
    if (!STEP_TYPES.includes(s.type)) throw new Error('Unknown step ' + s.type);
    if (s.type === 'update_fields') {
      const f = {};
      for (const [k, v] of Object.entries(s.fields || {})) { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error('Bad field name: ' + k); f[k] = v; }
      if (!Object.keys(f).length) throw new Error('Field update has no fields');
      return { type: s.type, fields: f };
    }
    if (s.type === 'assign') { if (!s.owner) throw new Error('Assign needs a person'); return { type: s.type, owner: String(s.owner) }; }
    if (s.type === 'note') return { type: s.type, text: String(s.text || '') };
    if (s.type === 'create_task') { if (!s.subject) throw new Error('Follow-up task needs a subject'); return { type: s.type, subject: String(s.subject), days: Math.max(0, +s.days || 1) }; }
    if (s.type === 'message') {
      if (!['email', 'letter', 'whatsapp'].includes(s.channel) || !s.body) throw new Error('Message needs channel and text');
      return { type: s.type, channel: s.channel, subject: String(s.subject || ''), body: String(s.body), approval: s.approval !== false };
    }
    return { type: 'close', note: String(s.note || '') };
  });
}
app.get('/api/macros', ANY, (req, res) => res.json(db.prepare('SELECT * FROM macros ORDER BY name').all().map((m) => ({ ...m, steps: JSON.parse(m.steps), summary: E.describe(JSON.parse(m.steps)) }))));
app.post('/api/macros', MGR, (req, res) => {
  try {
    const { id, name } = req.body; if (!name) throw new Error('Macro name required');
    const steps = JSON.stringify(cleanSteps(req.body.steps));
    if (id) db.prepare('UPDATE macros SET name=?, steps=? WHERE id=?').run(name, steps, id);
    else db.prepare('INSERT INTO macros(name,steps) VALUES(?,?)').run(name, steps);
    log(req.user.username, 'macro_save', name); res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: /UNIQUE/.test(e.message) ? 'A macro with this name exists' : e.message }); }
});
app.delete('/api/macros/:id', MGR, (req, res) => {
  if (db.prepare('SELECT 1 FROM automations WHERE macro_id=?').get(req.params.id)) return res.status(400).json({ error: 'An automation uses this macro. Remove it first.' });
  db.prepare('DELETE FROM macros WHERE id=?').run(req.params.id); log(req.user.username, 'macro_delete', req.params.id); res.json({ ok: true });
});
app.get('/api/zoho-users', ANY, async (req, res) => { try { res.json(await zoho.listUsers()); } catch (e) { res.status(502).json({ error: e.message }); } });

// Run a macro by hand on selected tasks (also recorded so the portal can later suggest rules).
app.post('/api/tasks/run-macro', MGR, async (req, res) => {
  const macro = db.prepare('SELECT * FROM macros WHERE id=?').get(req.body.macro_id);
  const ids = req.body.ids || [];
  if (!macro || !ids.length) return res.status(400).json({ error: 'Choose a macro and tasks' });
  try {
    const all = await zoho.listTasks({}); const results = [];
    for (const id of ids) {
      const t = all.find((x) => String(x.id) === String(id));
      if (!t) { results.push({ id, error: 'Task not found or already closed' }); continue; }
      const steps = await E.applyMacro(t, macro, req.user.username, { dry: !!req.body.dry });
      if (!req.body.dry) db.prepare('INSERT INTO manual_actions(user,task_subject,dept,kind,macro_id) VALUES(?,?,?,?,?)').run(req.user.username, t.Subject, t.Dept_Name || '', 'macro', macro.id);
      results.push({ id, subject: t.Subject, steps });
    }
    res.json({ results });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ---------- Automations + Scheduler ----------
app.get('/api/automations', ANY, (req, res) => res.json(db.prepare('SELECT a.*, m.name macro_name FROM automations a LEFT JOIN macros m ON m.id=a.macro_id ORDER BY a.id').all()));
app.post('/api/starter/missed-call', MGR, (req, res) => {
  let m = db.prepare("SELECT id FROM macros WHERE name='Missed call - done'").get();
  if (!m) { db.prepare('INSERT INTO macros(name,steps) VALUES(?,?)').run('Missed call - done', JSON.stringify(cleanSteps([{ type: 'note', text: 'Missed call checked' }, { type: 'close' }]))); m = db.prepare("SELECT id FROM macros WHERE name='Missed call - done'").get(); }
  if (!db.prepare("SELECT 1 FROM automations WHERE name='Missed call tasks'").get())
    db.prepare('INSERT INTO automations(name,match_field,match_value,status_filter,min_overdue_days,macro_id,schedule,mode,max_per_run,last_run) VALUES(?,?,?,?,?,?,?,?,?,?)').run('Missed call tasks', 'Subject', 'missed call', '', 0, m.id, JSON.stringify({ type: 'manual' }), 'preview', 50, new Date().toISOString());
  log(req.user.username, 'starter', 'missed-call macro + preview automation'); res.json({ ok: true });
});
app.post('/api/automations', MGR, (req, res) => {
  const a = req.body;
  if (!a.name || !db.prepare('SELECT 1 FROM macros WHERE id=?').get(a.macro_id)) return res.status(400).json({ error: 'Name and a valid macro are required' });
  if (!a.match_value && !a.status_filter && !(+a.min_overdue_days > 0)) return res.status(400).json({ error: 'Add at least one condition (match text, status or overdue days) so it does not touch every task' });
  const sch = a.schedule || { type: 'manual' };
  if (sch.type === 'times' && !(sch.times || []).every((t) => /^\d\d:\d\d$/.test(t))) return res.status(400).json({ error: 'Times must look like 09:30' });
  const mode = ['preview', 'approve', 'auto'].includes(a.mode) ? a.mode : 'preview';
  const args = [a.name, a.match_field === 'Dept_Name' ? 'Dept_Name' : 'Subject', a.match_value || '', a.status_filter || '', +a.min_overdue_days || 0, a.macro_id, JSON.stringify(sch), mode, Math.min(200, +a.max_per_run || 25)];
  if (a.id) db.prepare('UPDATE automations SET name=?,match_field=?,match_value=?,status_filter=?,min_overdue_days=?,macro_id=?,schedule=?,mode=?,max_per_run=? WHERE id=?').run(...args, a.id);
  else db.prepare('INSERT INTO automations(name,match_field,match_value,status_filter,min_overdue_days,macro_id,schedule,mode,max_per_run,last_run) VALUES(?,?,?,?,?,?,?,?,?,?)').run(...args, new Date().toISOString()); // first scheduled run waits for the next slot
  log(req.user.username, 'automation_save', `${a.name} [${mode}]`); res.json({ ok: true });
});
app.post('/api/automations/:id/toggle', MGR, (req, res) => { db.prepare('UPDATE automations SET active=1-active WHERE id=?').run(req.params.id); res.json({ ok: true }); });
app.delete('/api/automations/:id', MGR, (req, res) => { db.prepare('DELETE FROM automations WHERE id=?').run(req.params.id); db.prepare('DELETE FROM auto_seen WHERE automation_id=?').run(req.params.id); res.json({ ok: true }); });
app.post('/api/automations/:id/run', MGR, async (req, res) => {
  const a = db.prepare('SELECT * FROM automations WHERE id=?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  try { res.json(await E.runAutomation(a, req.user.username)); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/api/automations/:id/reset', MGR, (req, res) => { db.prepare('DELETE FROM auto_seen WHERE automation_id=?').run(req.params.id); res.json({ ok: true }); });

app.get('/api/pending', ANY, (req, res) => res.json(db.prepare("SELECT p.*, m.name macro_name, a.name automation_name FROM pending_actions p LEFT JOIN macros m ON m.id=p.macro_id LEFT JOIN automations a ON a.id=p.automation_id WHERE p.status='pending' ORDER BY p.id DESC LIMIT 300").all()));
app.post('/api/pending/:id/approve', MGR, async (req, res) => {
  const p = db.prepare("SELECT * FROM pending_actions WHERE id=? AND status='pending'").get(req.params.id);
  if (!p) return res.status(400).json({ error: 'Not pending' });
  try {
    const macro = db.prepare('SELECT * FROM macros WHERE id=?').get(p.macro_id);
    const t = (await zoho.listTasks({})).find((x) => String(x.id) === p.task_id);
    if (!t) { db.prepare("UPDATE pending_actions SET status='gone' WHERE id=?").run(p.id); return res.status(400).json({ error: 'Task no longer open' }); }
    const out = await E.applyMacro(t, macro, req.user.username);
    db.prepare("UPDATE pending_actions SET status='done', result=? WHERE id=?").run(out.join('; '), p.id);
    res.json({ ok: true, out });
  } catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/api/pending/:id/reject', MGR, (req, res) => { db.prepare("UPDATE pending_actions SET status='rejected' WHERE id=? AND status='pending'").run(req.params.id); res.json({ ok: true }); });

// ---------- Mail Meter Check ----------
app.get('/api/mailmeter/check', ANY, async (req, res) => { try { res.json(await MM.check(req.query.days)); } catch (e) { res.status(502).json({ error: e.message }); } });
app.post('/api/mailmeter/create', MGR, async (req, res) => { try { res.json(await MM.create((req.body.keys || []).slice(0, 100), req.user.username)); } catch (e) { res.status(502).json({ error: e.message }); } });
app.post('/api/mailmeter/skip', MGR, (req, res) => res.json(MM.skip((req.body.keys || []).slice(0, 300), req.user.username)));
app.get('/api/mailmeter/auto', ANY, (req, res) => res.json(MM.autoGet()));
app.post('/api/mailmeter/auto', MGR, (req, res) => { try { res.json(MM.autoSet(String(req.body.mode), req.body.hour)); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/mailmeter/auto-now', MGR, async (req, res) => { try { res.json(await MM.autoRun(true) || {}); } catch (e) { res.status(502).json({ error: e.message }); } });
app.post('/api/mailmeter/prefix', MGR, (req, res) => { MM.setPrefix(req.body.prefix); res.json({ ok: true }); });

// ---------- Send Letter ----------
app.get('/api/letters/contacts', ANY, async (req, res) => { try { res.json(await LT.search(req.query.q)); } catch (e) { res.status(502).json({ error: e.message }); } });
app.get('/api/letters/queue', ANY, async (req, res) => { try { res.json(await LT.queue()); } catch (e) { res.status(502).json({ error: e.message }); } });
app.get('/api/letters/templates', ANY, async (req, res) => { try { res.json((await LT.templates()).map((t) => ({ key: t.key, name: t.name }))); } catch (e) { res.status(502).json({ error: e.message }); } });
app.post('/api/letters/preview', MGR, async (req, res) => { try { res.json(await LT.preview((req.body.items || req.body.ids || []).slice(0, 50))); } catch (e) { res.status(502).json({ error: e.message }); } });
app.post('/api/letters/send', MGR, async (req, res) => {
  const ids = (req.body.items || req.body.ids || []).slice(0, 50); if (!ids.length) return res.status(400).json({ error: 'Kam se kam ek contact chuno' });
  try { res.json(await LT.send(ids, req.user.username)); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/letters/map', ANY, (req, res) => res.json(LT.getMap()));
app.post('/api/letters/map', MGR, (req, res) => { const m = LT.saveMap(req.body.map); log(req.user.username, 'letter_map', `${m.length} mapping(s)`); res.json(m); });
app.get('/api/letters/config', MGR, (req, res) => res.json(LT.config()));
app.post('/api/letters/config', auth(['admin']), (req, res) => { LT.saveConfig(req.body || {}); log(req.user.username, 'letter_config', 'updated'); res.json(LT.config()); });
app.get('/api/letters/log', ANY, (req, res) => res.json(db.prepare('SELECT * FROM letter_log ORDER BY id DESC LIMIT 100').all()));

// ---------- Employees, assignment rules, learning ----------
app.get('/api/employees', ANY, (req, res) => res.json(db.prepare('SELECT * FROM employees ORDER BY active DESC, name').all()));
app.post('/api/employees', MGR, (req, res) => {
  if (!req.body.name) return res.status(400).json({ error: 'Name required' });
  try { db.prepare('INSERT INTO employees(name,zoho_user_id) VALUES(?,?)').run(req.body.name.trim(), req.body.zoho_user_id || null); } catch { return res.status(400).json({ error: 'Already in roster' }); }
  res.json({ ok: true });
});
app.get('/api/employees/from-tasks', MGR, async (req, res) => { try { res.json(await AS.namesFromTasks()); } catch (e) { res.status(502).json({ error: e.message }); } });
app.post('/api/employees/import', MGR, (req, res) => { const n = AS.importNames(req.body.names || []); log(req.user.username, 'employees_import', `${n} added`); res.json({ added: n }); });
app.put('/api/employees/:id/aliases', MGR, (req, res) => { db.prepare('UPDATE employees SET aliases=? WHERE id=?').run(String(req.body.aliases || '').slice(0, 300), req.params.id); res.json({ ok: true }); });
app.post('/api/employees/sync', MGR, async (req, res) => { try { res.json(await AS.syncEmployees()); } catch (e) { res.status(502).json({ error: e.message }); } });
app.post('/api/employees/:id/toggle', MGR, (req, res) => {
  db.prepare('UPDATE employees SET active=1-active WHERE id=?').run(req.params.id);
  const e = db.prepare('SELECT name,active FROM employees WHERE id=?').get(req.params.id);
  log(req.user.username, 'employee_toggle', `${e?.name} → ${e?.active ? 'Active' : 'Inactive'}`); res.json({ ok: true });
});
app.delete('/api/employees/:id', MGR, (req, res) => { db.prepare('DELETE FROM employees WHERE id=?').run(req.params.id); res.json({ ok: true }); });

app.get('/api/assign/settings', ANY, (req, res) => res.json({ default_owner: AS.getSetting('default_owner'), assign_auto: ['1', 'preview'].includes(AS.getSetting('assign_auto')) ? AS.getSetting('assign_auto') : '0', assign_minutes: +AS.getSetting('assign_minutes', '30') }));
app.post('/api/assign/settings', MGR, (req, res) => {
  const b = req.body;
  AS.setSetting('default_owner', String(b.default_owner || '').trim()); AS.setSetting('assign_auto', ['1', 'preview'].includes(String(b.assign_auto)) ? String(b.assign_auto) : '0'); AS.setSetting('assign_minutes', Math.max(5, +b.assign_minutes || 30));
  log(req.user.username, 'assign_settings', JSON.stringify(b)); res.json({ ok: true });
});
app.get('/api/assign/name-fixes', MGR, async (req, res) => { try { res.json(await AS.nameFixes()); } catch (e) { res.status(502).json({ error: e.message }); } });
app.post('/api/assign/name-fixes', MGR, async (req, res) => { try { res.json({ results: await AS.applyNameFixes((req.body.items || []).slice(0, 200), req.user.username) }); } catch (e) { res.status(502).json({ error: e.message }); } });
app.get('/api/assign/rules', ANY, (req, res) => res.json(db.prepare('SELECT * FROM assign_rules ORDER BY id').all().map((r) => ({ ...r, employee_ids: JSON.parse(r.employee_ids || '[]') }))));
app.post('/api/assign/rules', MGR, (req, res) => {
  const r = req.body;
  if (!r.name || !r.match_value || !Array.isArray(r.employee_ids) || !r.employee_ids.length) return res.status(400).json({ error: 'Name, match text and at least one employee are required' });
  db.prepare('INSERT INTO assign_rules(name,match_field,match_value,employee_ids) VALUES(?,?,?,?)').run(r.name, r.match_field === 'Dept_Name' ? 'Dept_Name' : 'Subject', r.match_value, JSON.stringify(r.employee_ids.map(Number)));
  log(req.user.username, 'assign_rule_save', r.name); res.json({ ok: true });
});
app.delete('/api/assign/rules/:id', MGR, (req, res) => { db.prepare('DELETE FROM assign_rules WHERE id=?').run(req.params.id); res.json({ ok: true }); });
app.get('/api/assign/plan', MGR, async (req, res) => { try { res.json(await AS.plan()); } catch (e) { res.status(502).json({ error: e.message }); } });
app.post('/api/assign/apply', MGR, async (req, res) => {
  const out = [];
  for (const it of req.body.items || []) {
    try {
      const e = await AS.applyOne(it.task_id, it.employee_id, req.user.username, { manual: !!it.manual, subject: it.subject, dept: it.dept });
      if (it.make_rule_text) db.prepare('INSERT INTO assign_rules(name,match_field,match_value,employee_ids) VALUES(?,?,?,?)').run(`${it.make_rule_text} → ${e.name}`, it.make_rule_field === 'Dept_Name' ? 'Dept_Name' : 'Subject', it.make_rule_text, JSON.stringify([e.id]));
      out.push({ task_id: it.task_id, ok: true, employee: e.name });
    } catch (e) { out.push({ task_id: it.task_id, ok: false, error: e.message }); }
  }
  res.json({ results: out });
});
app.get('/api/suggestions', ANY, (req, res) => res.json(AS.suggestions()));
app.post('/api/suggestions/accept', MGR, (req, res) => { try { res.json(AS.acceptSuggestion(req.body.key, req.user.username)); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/suggestions/dismiss', MGR, (req, res) => { db.prepare('INSERT OR IGNORE INTO dismissed_suggestions(key) VALUES(?)').run(req.body.key); res.json({ ok: true }); });

// ---------- Dashboard + log ----------
app.get('/api/dashboard', ANY, async (req, res) => {
  try {
    const tasks = await zoho.listTasks({});
    const byDept = {}; tasks.forEach((t) => { const d = t.Dept_Name || 'Unsorted'; byDept[d] = (byDept[d] || 0) + 1; });
    const today = new Date().toISOString().slice(0, 10);
    res.json({
      open: tasks.length, overdue: tasks.filter((t) => t.Due_Date && t.Due_Date < today).length, byDept,
      letters: new Set(tasks.filter(LT.isLetterTask).map((t) => t.Who_Id?.id).filter(Boolean)).size,
      unassigned: tasks.filter((t) => !String(t.Assign_to || '').trim()).length,
      dry: process.env.DRY_RUN === '1',
      pendingOutbox: db.prepare("SELECT COUNT(*) n FROM outbox WHERE status='pending'").get().n,
      pendingActions: db.prepare("SELECT COUNT(*) n FROM pending_actions WHERE status='pending'").get().n,
      pendingEmails: db.prepare("SELECT COUNT(*) n FROM email_queue WHERE status='pending'").get().n,
    });
  } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/summary', ANY, (req, res) => {
  const cnt = (like) => db.prepare("SELECT COUNT(*) n FROM activity WHERE at >= datetime('now','-1 day') AND action LIKE ?").get(like).n;
  let chk = null; try { chk = JSON.parse(AS.getSetting('assign_check', 'null')); } catch (_) { /* none */ }
  const errs = db.prepare("SELECT at, action, detail FROM activity WHERE at >= datetime('now','-1 day') AND (action LIKE '%error%' OR detail LIKE 'ERROR%' OR detail LIKE '%ERROR %') ORDER BY id DESC LIMIT 8").all();
  const auto = db.prepare('SELECT name, last_run, last_result FROM automations WHERE last_run IS NOT NULL ORDER BY last_run DESC LIMIT 6').all().map((a) => { let r = {}; try { r = JSON.parse(a.last_result || '{}'); } catch (_) { /* ignore */ } return { name: a.name, last_run: a.last_run, matched: r.matched, handled: r.handled, error: r.error || '' }; });
  res.json({ letters: cnt('send_letter'), assigned: cnt('assign%') - cnt('assign_check') - cnt('assign_settings') - cnt('assign_error'), assign_mode: AS.getSetting('assign_auto') || '0', assign_check: chk, errors: errs, automations: auto });
});
app.get('/api/activity', MGR, (req, res) => res.json(db.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT 300').all()));

app.use(express.static(path.join(__dirname, 'public')));
const port = process.env.PORT || 3000;
app.listen(port, () => { console.log(`CRM Management portal on :${port} ${zoho.DEMO ? '(DEMO mode)' : ''}`); if (process.env.SCHEDULER !== '0') E.startScheduler(); setInterval(() => MM.autoRun().catch(() => {}), 60000); setInterval(() => AS.autoAssign().catch((e) => log('auto-assign', 'assign_error', e.message)), 60000); });
