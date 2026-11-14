// Send Letter: pick contacts -> letter goes out via Edwin Letter Manager -> the contact's open letter tasks are closed.
// Mirrors the Zoho "SendLetterToEdwin" button: template = longest Letter Manager template name contained in the newest
// open "letter" task's subject (e.g. "Send letter of 65th International Conference - Thailand").
// A task is closed ONLY after the Letter Manager answered SENT. With DRY_RUN=1 nothing is sent, noted or closed.
const zoho = require('./zoho');
const { db, log } = require('./db');
const AS = require('./assign'); // settings store

const DRY = process.env.DRY_RUN === '1';
const BASE = () => (process.env.LETTER_API_BASE || AS.getSetting('letter_base', 'https://letters.edwin.co.in')).replace(/\/$/, '');
const KEY = () => process.env.LETTER_API_KEY || AS.getSetting('letter_key', '');
// Only real letter-dispatch tasks: "Send letter of <name>", "Send/Sent invitation ...", "... invitation letter ...". Anything else mentioning "letter" is left alone.
const isLetterTask = (t) => /invitation letter|^\s*(send|sent)\s+(invitation|letter)/i.test(t.Subject || '');
const norm = (s) => ' ' + String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';

db.exec('CREATE TABLE IF NOT EXISTS letter_log (id INTEGER PRIMARY KEY, at TEXT DEFAULT CURRENT_TIMESTAMP, user TEXT, contact_id TEXT, contact_name TEXT, email TEXT, result TEXT, closed TEXT)');

function config() { return { base: BASE(), key_set: !!KEY(), from_env: !!process.env.LETTER_API_KEY }; }
function saveConfig({ base, key }) { if (base) AS.setSetting('letter_base', base.trim()); if (key) AS.setSetting('letter_key', key.trim()); }

async function lm(method, path, body) {
  if (!KEY()) throw new Error('Letter Manager key is not set. Add it in Send Letter → Settings.');
  const r = await fetch(BASE() + path, { method, headers: { 'X-Api-Key': KEY(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { j = null; }
  if (!r.ok) throw new Error(`Letter Manager ${r.status}: ${txt.slice(0, 160)}`);
  if (!j) throw new Error('Letter Manager gave no valid reply');
  return j;
}
async function templates() {
  if (zoho.DEMO) return [{ key: 'acc', name: 'Acceptance letter for paper' }, { key: 'th65', name: '65th International Conference Thailand' }];
  const j = await lm('GET', '/api/zoho/templates');
  return Array.isArray(j) ? j : j.templates || [];
}
function pickTemplate(subject, tpls) {
  const sn = norm(subject); let best = null;
  for (const t of tpls) { const n = norm(t.name); if (n.trim() && sn.includes(n) && (!best || n.length > norm(best.name).length)) best = t; }
  return best;
}

async function search(q) { return (await zoho.searchContacts(q)).map((c) => ({ id: c.id, name: c.Full_Name, email: c.Email || '', mobile: c.Mobile || '' })); }

async function plan(ids) {
  const [all, tpls] = await Promise.all([zoho.listTasks({}), templates()]);
  const out = [];
  for (const id of ids) {
    const c = (await zoho.getContactFull(id)) || {};
    const tasks = all.filter((t) => String(t.Who_Id?.id || '') === String(id) && isLetterTask(t))
      .sort((a, b) => String(b.Created_Time || '').localeCompare(String(a.Created_Time || '')));
    const tpl = tasks.length ? pickTemplate(tasks[0].Subject, tpls) : null;
    out.push({ id, c, tasks, tpl });
  }
  return out;
}

async function preview(ids) {
  const p = await plan(ids);
  return { dry: DRY, contacts: p.map((x) => ({ id: x.id, name: x.c.Full_Name || '', email: x.c.Email || '', template: x.tpl?.name || '',
    problem: !x.tasks.length ? 'No open letter task' : !x.tpl ? 'Newest letter task has no template name — task should read “Send letter of <exact letter name>”' : !x.c.Email ? 'Contact has no email' : '',
    tasks: x.tasks.map((t) => ({ id: t.id, subject: t.Subject, due: t.Due_Date || '' })) })) };
}

async function send(ids, user) {
  const p = await plan(ids), results = [];
  for (const x of p) {
    const row = { id: x.id, name: x.c.Full_Name || '', email: x.c.Email || '', template: x.tpl?.name || '', sent: false, closed: [], error: '' };
    try {
      if (!x.tasks.length) throw new Error('No open letter task for this contact — nothing sent');
      if (!x.tpl) throw new Error('Newest letter task has no template name — nothing sent');
      if (!x.c.Email) throw new Error('Contact has no email — nothing sent');
      if (DRY && !zoho.DEMO) { row.dry = true; row.would_close = x.tasks.map((t) => t.Subject); }
      else {
        const c = x.c;
        const contact = { name: c.Full_Name, designation: c.Designation, department: c.Department, institution: c.College_Institute_University_industry_Name,
          addressLine1: c.Address_for_Hardcopy, addressLine2: c.Country, email: c.Email, phone: c.Mobile, awardName: c.Award_Name, selectAward: c.Select_Award, zohoContactId: String(x.id) };
        let status = 'SENT';
        if (!zoho.DEMO) { const j = await lm('POST', '/api/zoho/send', { type: 'letter', templateKey: x.tpl.key, contacts: [contact] }); const r = (j.results || [])[0]; status = r?.status || 'UNKNOWN'; if (status !== 'SENT') throw new Error('Letter Manager status: ' + status + (r?.error ? ' — ' + r.error : '')); }
        row.sent = true;
        try { await zoho.addNote('Contacts', String(x.id), 'Letter sent', `Letter sent: ${x.tpl.name} (via CRM Portal)`); } catch (_) { /* note is secondary */ }
        for (const t of x.tasks) { await zoho.closeTask(t.id, 'Letter sent via CRM Portal'); row.closed.push(t.Subject); }
      }
    } catch (e) { row.error = e.message; }
    db.prepare('INSERT INTO letter_log(user,contact_id,contact_name,email,result,closed) VALUES(?,?,?,?,?,?)').run(user, String(x.id), row.name, row.email, row.error ? 'ERROR: ' + row.error : row.dry ? 'dry run' : 'sent', row.closed.join(' | '));
    log(user, 'send_letter', `${row.name} <${row.email}> ${row.error ? 'ERROR ' + row.error : row.dry ? '(dry run)' : 'sent, closed ' + row.closed.length}`);
    results.push(row);
  }
  return { dry: DRY, results };
}

module.exports = { search, preview, send, config, saveConfig };
