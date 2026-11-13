// Send Letter: pick contacts -> letter goes out via Edwin Letter Manager -> the contact's open "letter" tasks are closed.
// A task is closed ONLY after the letter was sent successfully. With DRY_RUN=1 nothing is sent and nothing is closed.
const zoho = require('./zoho');
const { db, log } = require('./db');

const DRY = process.env.DRY_RUN === '1';
const isLetterTask = (t) => /letter/i.test(t.Subject || '');

db.exec('CREATE TABLE IF NOT EXISTS letter_log (id INTEGER PRIMARY KEY, at TEXT DEFAULT CURRENT_TIMESTAMP, user TEXT, contact_id TEXT, contact_name TEXT, email TEXT, result TEXT, closed TEXT)');

async function search(q) {
  return (await zoho.searchContacts(q)).map((c) => ({ id: c.id, name: c.Full_Name, email: c.Email || '', mobile: c.Mobile || '' }));
}

async function openLetterTasks(ids) {
  const all = await zoho.listTasks({});
  const by = {}; ids.forEach((i) => { by[String(i)] = []; });
  for (const t of all) { const k = String(t.Who_Id?.id || ''); if (by[k] && isLetterTask(t)) by[k].push({ id: t.id, subject: t.Subject, due: t.Due_Date || '' }); }
  return by;
}

async function preview(ids) {
  const by = await openLetterTasks(ids), out = [];
  for (const id of ids) {
    const c = (await zoho.getContact(id)) || {};
    out.push({ id, name: c.Full_Name || '', email: c.Email || '', tasks: by[String(id)] || [] });
  }
  return { dry: DRY, contacts: out };
}

// The actual letter dispatch. Edwin Letter Manager (letters.edwin.co.in) picks the matching conference template.
// LETTER_API_URL = full URL of its "send" endpoint, LETTER_API_KEY = its X-Api-Key. Body: { recIds: "id1|||id2" } (same as the Zoho button).
async function dispatch(contactId) {
  if (zoho.DEMO) return { ok: true, note: 'demo' };
  if (DRY) return { ok: true, dry: true };
  const url = process.env.LETTER_API_URL, key = process.env.LETTER_API_KEY;
  if (!url || !key) throw new Error('Letter Manager is not configured (LETTER_API_URL / LETTER_API_KEY missing in .env)');
  const r = await fetch(url, { method: 'POST', headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ recIds: String(contactId) }) });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Letter Manager ${r.status}: ${txt.slice(0, 200)}`);
  return { ok: true, note: txt.slice(0, 200) };
}

async function send(ids, user) {
  const by = await openLetterTasks(ids), results = [];
  for (const id of ids) {
    const c = (await zoho.getContact(id)) || {};
    const row = { id, name: c.Full_Name || '', email: c.Email || '', sent: false, closed: [], error: '' };
    try {
      const r = await dispatch(id);
      row.sent = true; row.dry = !!r.dry;
      if (!r.dry) for (const t of by[String(id)] || []) { await zoho.closeTask(t.id, 'Letter sent via CRM Portal'); row.closed.push(t.subject); }
      else row.would_close = (by[String(id)] || []).map((t) => t.subject);
    } catch (e) { row.error = e.message; }
    db.prepare('INSERT INTO letter_log(user,contact_id,contact_name,email,result,closed) VALUES(?,?,?,?,?,?)').run(user, String(id), row.name, row.email, row.error ? 'ERROR: ' + row.error : row.dry ? 'dry run' : 'sent', row.closed.join(' | '));
    log(user, 'send_letter', `${row.name} <${row.email}> ${row.error ? 'ERROR ' + row.error : row.dry ? '(dry run)' : 'sent, closed ' + row.closed.length}`);
    results.push(row);
  }
  return { dry: DRY, results };
}

module.exports = { search, preview, send };
