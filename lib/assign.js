// Task assignment: employee roster, assignment rules, plan/apply, and rule-learning suggestions.
const { db, log } = require('./db');
const zoho = require('./zoho');

db.exec(`
CREATE TABLE IF NOT EXISTS employees (id INTEGER PRIMARY KEY, name TEXT UNIQUE, zoho_user_id TEXT, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS assign_rules (id INTEGER PRIMARY KEY, name TEXT, match_field TEXT DEFAULT 'Subject', match_value TEXT, employee_ids TEXT, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS assigned (task_id TEXT PRIMARY KEY, employee TEXT, by TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS dismissed_suggestions (key TEXT PRIMARY KEY);
`);
try { db.exec('ALTER TABLE manual_actions ADD COLUMN target TEXT'); } catch (_) { /* already there */ }
try { db.exec('ALTER TABLE employees ADD COLUMN aliases TEXT DEFAULT ""'); } catch (_) { /* already there */ }

const getSetting = (k, d = '') => (db.prepare('SELECT value FROM settings WHERE key=?').get(k) || {}).value ?? d;
const setSetting = (k, v) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
const norm = (s) => String(s || '').trim().toLowerCase();
// The real assignment field is the free-text Assign_to. A task is "unassigned" when it is empty.
const assignText = (t) => norm(t.Assign_to);
// Staff are typed in many spellings ("raqib", "Raqib Khan"): match full name, first name, or any alias.
const empMatches = (e, text) => {
  const t = norm(text); if (!t) return false;
  const n = norm(e.name);
  return t === n || t === n.split(/\s+/)[0] || String(e.aliases || '').split(',').map(norm).filter(Boolean).includes(t);
};
const empOf = (emps, text) => emps.find((e) => empMatches(e, text));

async function syncEmployees() {
  const users = await zoho.listUsers(); let added = 0;
  for (const u of users) {
    const ex = db.prepare('SELECT id FROM employees WHERE name=?').get(u.full_name);
    if (ex) db.prepare('UPDATE employees SET zoho_user_id=? WHERE id=?').run(u.id, ex.id);
    else { db.prepare('INSERT INTO employees(name,zoho_user_id,active) VALUES(?,?,1)').run(u.full_name, u.id); added++; }
  }
  return { total: users.length, added };
}

function matchRule(task, rules) {
  return rules.find((r) => {
    const hay = r.match_field === 'Dept_Name' ? task.Dept_Name || '' : task.Subject || '';
    return hay.toLowerCase().includes(r.match_value.toLowerCase());
  });
}

// Build a plan. Only tasks whose Assign_to is EMPTY are touched. A task that already has anyone's name in
// Assign_to (typed by hand, by an old workflow, or by this portal) is never changed — except tasks held by an
// INACTIVE employee, which are only offered for reassignment (and applied only with your click).
async function plan() {
  const tasks = (await zoho.listTasks({})).filter((t) => !/^(completed|closed)/i.test(t.Status || ''));
  const emps = db.prepare('SELECT * FROM employees').all();
  const active = emps.filter((e) => e.active);
  const rules = db.prepare('SELECT * FROM assign_rules WHERE active=1 ORDER BY id').all().map((r) => ({ ...r, ids: JSON.parse(r.employee_ids || '[]') }));
  const done = new Set(db.prepare('SELECT task_id FROM assigned').all().map((r) => r.task_id));
  const load = {}; active.forEach((e) => { load[e.id] = tasks.filter((t) => empMatches(e, t.Assign_to)).length; });
  const pick = (rule) => {
    const cands = active.filter((e) => rule.ids.includes(e.id));
    if (!cands.length) return null;
    cands.sort((a, b) => load[a.id] - load[b.id]);
    load[cands[0].id]++; return cands[0];
  };
  const out = { proposals: [], undecided: [], reassign: [], manual_untouched: 0, configured: true, rostered: emps.length };
  for (const t of tasks) {
    const has = assignText(t);
    const holder = has ? empOf(emps, t.Assign_to) : null;
    const stranded = !!holder && !holder.active && !empOf(active, t.Assign_to);
    const free = !has && !done.has(String(t.id));
    if (!free && !stranded) { out.manual_untouched++; continue; }
    const rule = matchRule(t, rules);
    const emp = rule ? pick(rule) : null;
    const brief = { id: t.id, subject: t.Subject, dept: t.Dept_Name || '', owner: t.Assign_to || '', due: t.Due_Date || '' };
    if (stranded) out.reassign.push({ ...brief, rule: rule?.name || null, employee: emp ? { id: emp.id, name: emp.name } : null, reason: rule && !emp ? 'No active employee in rule' : '' });
    else if (emp) out.proposals.push({ ...brief, rule: rule.name, employee: { id: emp.id, name: emp.name } });
    else out.undecided.push({ ...brief, reason: rule ? 'Everyone in rule “' + rule.name + '” is inactive' : 'No rule matches' });
  }
  return out;
}

// Staff names currently typed in Assign_to across open tasks, merged by first name → ready to add to the roster.
async function namesFromTasks() {
  const tasks = await zoho.listTasks({});
  const emps = db.prepare('SELECT * FROM employees').all();
  const groups = {};
  for (const t of tasks) {
    const raw = String(t.Assign_to || '').trim(); if (!raw) continue;
    const g = (groups[norm(raw).split(/\s+/)[0]] ||= { variants: {}, count: 0 });
    g.variants[raw] = (g.variants[raw] || 0) + 1; g.count++;
  }
  return Object.values(groups).map((g) => {
    const vs = Object.keys(g.variants).sort((a, b) => b.length - a.length || g.variants[b] - g.variants[a]);
    const name = vs[0].replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\s+/g, ' ');
    return { name, aliases: vs.filter((v) => norm(v) !== norm(name)), count: g.count, known: emps.some((e) => empMatches(e, vs[0])) };
  }).sort((a, b) => b.count - a.count);
}
function importNames(list) {
  let added = 0;
  for (const n of list) {
    if (db.prepare('SELECT id FROM employees WHERE name=?').get(n.name)) continue;
    db.prepare('INSERT INTO employees(name,aliases,active) VALUES(?,?,1)').run(n.name, (n.aliases || []).join(', ')); added++;
  }
  return added;
}

async function applyOne(taskId, employeeId, by, { manual = false, subject = '', dept = '' } = {}) {
  const e = db.prepare('SELECT * FROM employees WHERE id=? AND active=1').get(employeeId);
  if (!e) throw new Error('Employee not found or inactive');
  await zoho.updateRecord('Tasks', String(taskId), { Assign_to: e.name }); // Dept_Name (group) is left as it is
  db.prepare('INSERT OR REPLACE INTO assigned(task_id,employee,by) VALUES(?,?,?)').run(String(taskId), e.name, by);
  if (manual) db.prepare('INSERT INTO manual_actions(user,task_subject,dept,kind,target) VALUES(?,?,?,?,?)').run(by, subject, dept, 'assign', String(e.id));
  log(by, 'task_assign', `${taskId} → ${e.name}${manual ? ' (manual)' : ''}`);
  return e;
}

async function autoAssign() {
  const mode = getSetting('assign_auto'); // '0' off | 'preview' only check and report | '1' assign automatically
  if (mode !== '1' && mode !== 'preview') return;
  const mins = Math.max(5, +getSetting('assign_minutes', '30') || 30), last = +getSetting('assign_last', '0');
  if (Date.now() - last < mins * 60000) return;
  setSetting('assign_last', Date.now());
  const p = await plan(); // reassignments of inactive staff are never automatic
  let applied = 0;
  if (mode === '1') for (const x of p.proposals) { try { await applyOne(x.id, x.employee.id, 'auto-assign'); applied++; } catch (e) { log('auto-assign', 'assign_error', `${x.id}: ${e.message}`); } }
  setSetting('assign_check', JSON.stringify({ at: new Date().toISOString(), mode, ready: p.proposals.length, undecided: p.undecided.length, applied }));
  if (p.proposals.length || p.undecided.length) log('auto-assign', 'assign_check', `${mode}: ready ${p.proposals.length}, undecided ${p.undecided.length}, assigned ${applied}`);
}
// Same person typed in different spellings ("raqib" / "Raqib Khan"): propose the roster's full name. Only single-name values
// that match exactly ONE roster person are proposed; "A, B" style values and unknown names are left alone.
async function nameFixes() {
  const emps = db.prepare('SELECT * FROM employees').all();
  if (!emps.length) return { rostered: 0, fixes: [] };
  const tasks = (await zoho.listTasks({})).filter((t) => String(t.Assign_to || '').trim() && !/[,;&/]|\band\b/i.test(t.Assign_to));
  const fixes = [];
  for (const t of tasks) {
    const m = emps.filter((e) => empMatches(e, t.Assign_to));
    if (m.length === 1 && String(t.Assign_to).trim() !== m[0].name) fixes.push({ id: t.id, subject: t.Subject, from: String(t.Assign_to), to: m[0].name });
  }
  return { rostered: emps.length, fixes };
}
async function applyNameFixes(items, user) {
  const names = new Set(db.prepare('SELECT name FROM employees').all().map((e) => e.name)), out = [];
  for (const it of items || []) {
    try { if (!names.has(it.name)) throw new Error('Not a roster name'); await zoho.updateRecord('Tasks', it.task_id, { Assign_to: it.name }); out.push({ ok: true }); log(user, 'name_fix', `${it.task_id} -> ${it.name}`); }
    catch (e) { out.push({ ok: false, error: e.message }); }
  }
  return out;
}
function suggestions() {
  const rows = db.prepare('SELECT * FROM manual_actions ORDER BY id DESC LIMIT 2000').all();
  const dismissed = new Set(db.prepare('SELECT key FROM dismissed_suggestions').all().map((r) => r.key));
  const groups = {};
  for (const r of rows) {
    if (r.kind === 'close') continue;
    const k = `${r.kind}|${r.kind === 'macro' ? r.macro_id : r.target}|${keyOf(r)}`;
    (groups[k] ||= { key: k, kind: r.kind, macro_id: r.macro_id, target: r.target, match: keyOf(r), count: 0, example: r.task_subject }).count++;
  }
  const macros = Object.fromEntries(db.prepare('SELECT id,name FROM macros').all().map((m) => [m.id, m.name]));
  const emps = Object.fromEntries(db.prepare('SELECT id,name FROM employees').all().map((m) => [String(m.id), m.name]));
  return Object.values(groups).filter((g) => g.count >= 3 && !dismissed.has(g.key)).map((g) => {
    const field = g.match.startsWith('dept:') ? 'Dept_Name' : 'Subject';
    const text = g.match.replace(/^(dept|subj):/, '');
    return { ...g, field, text, macro_name: macros[g.macro_id], employee_name: emps[g.target],
      sentence: g.kind === 'macro' ? `When ${field === 'Dept_Name' ? 'group' : 'subject'} contains “${text}” you ran macro “${macros[g.macro_id]}” ${g.count} times.`
        : `When ${field === 'Dept_Name' ? 'group' : 'subject'} contains “${text}” you assigned to ${emps[g.target]} ${g.count} times.` };
  }).sort((a, b) => b.count - a.count);
}
function acceptSuggestion(key, user) {
  const s = suggestions().find((x) => x.key === key);
  if (!s) throw new Error('Suggestion not found');
  if (s.kind === 'macro') {
    db.prepare("INSERT INTO automations(name,match_field,match_value,macro_id,schedule,mode,last_run) VALUES(?,?,?,?,?,'preview',?)")
      .run(`Learned: ${s.text} → ${s.macro_name}`, s.field, s.text, s.macro_id, JSON.stringify({ type: 'manual' }), new Date().toISOString());
  } else {
    db.prepare('INSERT INTO assign_rules(name,match_field,match_value,employee_ids) VALUES(?,?,?,?)').run(`Learned: ${s.text} → ${s.employee_name}`, s.field, s.text, JSON.stringify([+s.target]));
  }
  db.prepare('INSERT OR IGNORE INTO dismissed_suggestions(key) VALUES(?)').run(key); // do not suggest again
  log(user, 'suggestion_accept', s.sentence);
  return s;
}

module.exports = { getSetting, setSetting, syncEmployees, namesFromTasks, importNames, empMatches, plan, applyOne, autoAssign, nameFixes, applyNameFixes, suggestions, acceptSuggestion };
