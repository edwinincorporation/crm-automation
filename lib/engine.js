// Macros (named action sets), Automations and the Scheduler.
const { db, log } = require('./db');
const zoho = require('./zoho');
const { send } = require('./senders');

const fill = (tpl, v) => String(tpl || '').replace(/\{\{(\w+)\}\}/g, (_, k) => v[k] ?? '');
const contactFromDescription = (d) => ({
  email: (String(d || '').match(/Email:\s*([^\s]+@[^\s]+)/i) || [])[1],
  phone: (String(d || '').match(/Phone:\s*([+\d][\d\s-]{8,})/i) || [])[1],
});
const istNow = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const dow = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday];
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour === '24' ? '00' : p.hour}:${p.minute}`, dow };
};

// Steps: update_fields{fields}, assign{owner}, note{text}, create_task{subject,days}, message{channel,subject,body,approval}, close{note}
function describe(steps) {
  return steps.map((s) => ({
    update_fields: () => 'Update ' + Object.entries(s.fields).map(([k, v]) => `${k}=${v}`).join(', '),
    assign: () => 'Assign to ' + s.owner, note: () => 'Add note', create_task: () => `Follow-up task “${s.subject}” in ${s.days || 1}d`,
    message: () => `${s.channel}${s.approval ? ' (needs approval)' : ''}`, close: () => 'Close task',
  }[s.type] || (() => s.type))());
}

async function resolveOwner(name) {
  const users = await zoho.listUsers();
  const n = String(name).trim().toLowerCase();
  const u = users.find((x) => x.id === name || x.full_name.toLowerCase() === n) || users.find((x) => x.full_name.toLowerCase().includes(n));
  if (!u) throw new Error(`No active Zoho user matches "${name}"`);
  return u;
}

// Apply a macro to one task. dry=true only reports what would happen.
async function applyMacro(task, macro, user, { dry = false } = {}) {
  const steps = JSON.parse(macro.steps);
  const out = [];
  let contact = null;
  const c = contactFromDescription(task.Description);
  try { contact = await zoho.getContact(task.Who_Id?.id); } catch (_) {}
  const vars = {
    name: task.Who_Id?.name || contact?.Full_Name || '', subject: task.Subject || '', dept: task.Dept_Name || '',
    email: contact?.Email || c.email || '', phone: contact?.Mobile || contact?.Phone || c.phone || '', note: '',
  };
  for (const s of steps) {
    try {
      if (dry) { out.push('would: ' + describe([s])[0]); continue; }
      if (s.type === 'update_fields') { await zoho.updateRecord('Tasks', task.id, s.fields); out.push('fields updated'); }
      else if (s.type === 'assign') { await zoho.updateRecord('Tasks', task.id, { Assign_to: String(s.owner) }); out.push('assigned to ' + s.owner); }
      else if (s.type === 'note') { await zoho.addNote('Tasks', task.id, 'CRM Portal', fill(s.text, vars)); out.push('note added'); }
      else if (s.type === 'create_task') {
        const due = new Date(Date.now() + (s.days || 1) * 86400000).toISOString().slice(0, 10);
        await zoho.createTask(task.Who_Id?.id, fill(s.subject, vars), due, `Follow-up of: ${task.Subject}`); out.push('follow-up task created');
      } else if (s.type === 'message') {
        const info = db.prepare('INSERT INTO outbox(task_id,task_subject,rule_id,action_type,to_name,to_email,to_phone,subject,body,status,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
          .run(String(task.id), task.Subject, null, s.channel, vars.name, vars.email, vars.phone, fill(s.subject, vars), fill(s.body, vars), 'pending', user);
        if (s.approval) out.push(s.channel + ' queued for approval');
        else {
          const item = db.prepare('SELECT * FROM outbox WHERE id=?').get(info.lastInsertRowid);
          try { const r = await send(item); db.prepare('UPDATE outbox SET status=?, sent_at=CURRENT_TIMESTAMP WHERE id=?').run(r.dry ? 'sent (dry run)' : 'sent', item.id); out.push(s.channel + ' sent'); }
          catch (e) { db.prepare("UPDATE outbox SET status='failed', error=? WHERE id=?").run(e.message, item.id); out.push(s.channel + ' FAILED: ' + e.message); }
        }
      } else if (s.type === 'close') { await zoho.closeTask(task.id, fill(s.note || `Macro: ${macro.name}`, vars)); out.push('task closed'); }
    } catch (e) { out.push(`${s.type} FAILED: ${e.message}`); break; }
  }
  if (!dry) log(user, 'macro_run', `${macro.name} on ${task.id} ${task.Subject}: ${out.join('; ')}`);
  return out;
}

function matches(task, a) {
  if (a.match_value) {
    const hay = a.match_field === 'Dept_Name' ? task.Dept_Name || '' : task.Subject || '';
    if (!hay.toLowerCase().includes(a.match_value.toLowerCase())) return false;
  }
  if (a.status_filter && task.Status !== a.status_filter) return false;
  if (a.min_overdue_days > 0) {
    if (!task.Due_Date) return false;
    if ((Date.now() - new Date(task.Due_Date).getTime()) / 86400000 < a.min_overdue_days) return false;
  }
  return true;
}

let running = false;
async function runAutomation(a, user = 'scheduler') {
  const macro = db.prepare('SELECT * FROM macros WHERE id=?').get(a.macro_id);
  if (!macro) throw new Error('Macro missing');
  const tasks = await zoho.listTasks({});
  const seen = new Set(db.prepare('SELECT task_id FROM auto_seen WHERE automation_id=?').all(a.id).map((r) => r.task_id));
  const todo = tasks.filter((t) => matches(t, a) && !seen.has(String(t.id)));
  const batch = todo.slice(0, a.max_per_run || 25);
  const res = { matched: todo.length, handled: batch.length, mode: a.mode, notes: [] };
  for (const t of batch) {
    if (a.mode === 'preview') { res.notes.push(`${t.Subject}: ${(await applyMacro(t, macro, user, { dry: true })).join(' → ')}`); continue; }
    db.prepare('INSERT OR IGNORE INTO auto_seen(automation_id,task_id) VALUES(?,?)').run(a.id, String(t.id));
    if (a.mode === 'approve') { db.prepare('INSERT INTO pending_actions(automation_id,macro_id,task_id,task_subject) VALUES(?,?,?,?)').run(a.id, macro.id, String(t.id), t.Subject); continue; }
    res.notes.push(`${t.Subject}: ${(await applyMacro(t, macro, user)).join('; ')}`);
  }
  db.prepare('UPDATE automations SET last_run=?, last_result=? WHERE id=?').run(new Date().toISOString(), JSON.stringify(res), a.id);
  log(user, 'automation_run', `${a.name} [${a.mode}] matched ${res.matched}, handled ${res.handled}`);
  return res;
}

// schedule: {type:'times', times:['09:00'], days:[1..7]} | {type:'every', minutes:30} | {type:'manual'}
function isDue(a, now) {
  let s; try { s = JSON.parse(a.schedule || '{}'); } catch { return false; }
  if (s.type === 'every') return !a.last_run || Date.now() - new Date(a.last_run).getTime() >= Math.max(5, s.minutes || 60) * 60000;
  if (s.type === 'times') {
    if (s.days?.length && !s.days.includes(now.dow)) return false;
    const key = (a.last_run && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(a.last_run))) || '';
    const lastHm = a.last_run ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit', minute: '2-digit' }).format(new Date(a.last_run)) : '';
    return (s.times || []).some((t) => now.hm >= t && !(key === now.date && lastHm >= t));
  }
  return false;
}

function startScheduler() {
  setInterval(async () => {
    if (running) return; running = true;
    try {
      const now = istNow();
      for (const a of db.prepare('SELECT * FROM automations WHERE active=1').all()) {
        if (isDue(a, now)) { try { await runAutomation(a); } catch (e) { db.prepare('UPDATE automations SET last_run=?, last_result=? WHERE id=?').run(new Date().toISOString(), JSON.stringify({ error: e.message }), a.id); log('scheduler', 'automation_error', `${a.name}: ${e.message}`); } }
      }
    } finally { running = false; }
  }, 30000);
}

module.exports = { applyMacro, runAutomation, startScheduler, describe, matches };
