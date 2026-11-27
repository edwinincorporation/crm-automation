// Send Letter: pick contacts -> letter goes out via Edwin Letter Manager -> the contact's open letter tasks are closed.
// Mirrors the Zoho "SendLetterToEdwin" button: template = longest Letter Manager template name contained in the newest
// open "letter" task's subject (e.g. "Send letter of 65th International Conference - Thailand").
// A task is closed ONLY after the Letter Manager answered SENT. With DRY_RUN=1 nothing is sent, noted or closed.
const zoho = require('./zoho');
const { db, log } = require('./db');
const AS = require('./assign'); // settings store

const MODE = require('./mode');
const DRY_DEMO = false;
const BASE = () => (process.env.LETTER_API_BASE || AS.getSetting('letter_base', 'https://letters.edwin.co.in')).replace(/\/$/, '');
const KEY = () => process.env.LETTER_API_KEY || AS.getSetting('letter_key', '');
// Only real letter-dispatch tasks: "Send letter of <name>", "Send/Sent invitation ...", "... invitation letter ...". Anything else mentioning "letter" is left alone.
// Mailmeteor tasks of a conference invitation mail ("Mailmeteor (edwinincorp.com) - Invitation to speak at 52nd International Conference - phillippines, Replied to email / Clicked link in email")
// also need the letter, whether the customer replied or only clicked.
const isMailmeteorConf = (s) => /^\s*mailmeteor\b/i.test(s) && /(invitation|conference)/i.test(s) && !/clicked/i.test(s); // click-only tasks stay out of Send Letter
const isLetterTask = (t) => /invitation letter|^\s*(send|sent)\s+(invitation|letter)/i.test(t.Subject || '') || isMailmeteorConf(t.Subject || '');
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
// ---- sender mailbox choice ("Send From"). Letter Manager identifies a sender as "account:<id>" or "alias:<id>".
const SENDER_PATHS = ['/api/zoho/senders', '/api/zoho/email-accounts', '/api/zoho/sender-emails', '/api/zoho/accounts', '/api/email-accounts', '/api/sender-emails'];
const flatSenders = (j) => {
  const accts = Array.isArray(j) ? j : (j && (j.accounts || j.senders || j.data)) || [];
  const out = [];
  for (const a of accts) {
    if (a && a.id && (a.loginEmail || a.email)) out.push({ value: a.value || ('account:' + a.id), label: a.label || a.name || a.loginEmail || a.email, email: a.loginEmail || a.email });
    for (const r of (a && a.aliases) || []) if (r && r.id) out.push({ value: 'alias:' + r.id, label: r.label || a.label || r.fromEmail, email: r.fromEmail });
    if (a && !a.id && a.value && a.email) out.push({ value: a.value, label: a.label || a.name || a.email, email: a.email });
  }
  return out;
};
const savedSenders = () => { try { const a = JSON.parse(AS.getSetting('letter_senders', '[]')); return Array.isArray(a) ? a.filter((x) => x && x.value && x.email) : []; } catch (_) { return []; } };
function saveSenders(text) {
  let a; try { a = JSON.parse(String(text || '').trim()); } catch (_) { throw new Error('Ye sahi list nahi hai. Letter Manager wale page se copy ki hui list paste karo.'); }
  if (!Array.isArray(a)) throw new Error('Ye sahi list nahi hai.');
  const clean = a.filter((x) => x && /^(account|alias):[\w-]{6,80}$/.test(String(x.value || '')) && /@/.test(String(x.email || ''))).map((x) => ({ value: String(x.value), label: String(x.label || x.email).slice(0, 80), email: String(x.email).slice(0, 120) }));
  if (!clean.length) throw new Error('List me koi sahi mailbox nahi mili.');
  AS.setSetting('letter_senders', JSON.stringify(clean)); return clean;
}
async function senders() {
  if (zoho.DEMO) return { list: [{ value: 'account:demo', label: 'Edwin', email: 'care@edwinincorp.com' }], defaultValue: 'account:demo', source: 'demo' };
  const saved = savedSenders();
  if (saved.length) { const d = saved.find((x) => /@edwinincorp\.com$/i.test(x.email)); return { list: saved, defaultValue: d ? d.value : '', source: 'saved' }; }
  const tried = [];
  for (const path of SENDER_PATHS) {
    try { const list = flatSenders(await lm('GET', path)); if (list.length) { const d = list.find((x) => /@edwinincorp\.com$/i.test(x.email)); return { list, defaultValue: d ? d.value : '', source: path, tried }; } tried.push(path + ' (khali)'); }
    catch (e) { tried.push(path + ' (' + String(e.message).slice(0, 40) + ')'); }
  }
  return { list: [], defaultValue: '', source: '', tried, error: 'Letter Manager se sender list nahi mili' };
}
const senderLabel = async (value) => { if (!value) return ''; try { const s = await senders(); const f = s.list.find((x) => x.value === value); return f ? `${f.label} <${f.email}>` : value; } catch (_) { return value; } };

async function templates() {
  if (zoho.DEMO) return [{ key: 'acc', name: 'Acceptance letter for paper' }, { key: 'th65', name: '65th International Conference Thailand' }];
  const j = await lm('GET', '/api/zoho/templates');
  return Array.isArray(j) ? j : j.templates || [];
}
// Your own word -> template table (e.g. "phillippines" -> a template), checked before the automatic name match.
const getMap = () => { try { return JSON.parse(AS.getSetting('letter_map', '[]')); } catch (_) { return []; } };
function saveMap(list) {
  const clean = (list || []).map((m) => ({ word: String(m.word || '').trim(), key: String(m.key || '') })).filter((m) => m.word && m.key);
  AS.setSetting('letter_map', JSON.stringify(clean)); return clean;
}
function pickTemplate(subject, tpls) {
  const sn = norm(subject); let best = null;
  let mapped = null;
  for (const m of getMap()) { const w = norm(m.word); if (w.trim() && sn.includes(w) && (!mapped || w.length > norm(mapped.word).length)) mapped = m; }
  if (mapped) { const t = tpls.find((x) => String(x.key) === String(mapped.key)); if (t) return t; }
  for (const t of tpls) { const n = norm(t.name); if (n.trim() && sn.includes(n) && (!best || n.length > norm(best.name).length)) best = t; }
  return best || pickByConference(subject, tpls);
}
// Fallback for conference subjects: match the conference number (52nd) and, if several, the country (spelling mistakes like "phillippines" allowed).
const COUNTRY = [['philippines', /phil+i?p+i?n+e?s/], ['maldives', /maldiv/], ['malaysia', /malays/], ['thailand', /thai/], ['bhutan', /bhutan/], ['vietnam', /vietnam/], ['singapore', /singap/], ['indonesia', /indones|bali/], ['london', /london|\buk\b|united kingdom/], ['uae', /\buae\b|dubai|emirates/], ['oman', /oman/]];
const ordOf = (s) => (/\b(\d{1,3})\s*(st|nd|rd|th)\b/i.exec(String(s || '')) || [])[1] || '';
const countryOf = (s) => { const t = String(s || '').toLowerCase(); const c = COUNTRY.find(([, re]) => re.test(t)); return c ? c[0] : ''; };
function pickByConference(subject, tpls) {
  const ord = ordOf(subject), cty = countryOf(subject);
  if (!ord && !cty) return null;
  const hit = (t) => { const n = String(t.name || ''); return { ord: ord && ordOf(n) === ord, cty: cty && countryOf(n) === cty, inv: /invit/i.test(n) }; };
  const scored = tpls.map((t) => ({ t, h: hit(t) })).filter((x) => (ord ? x.h.ord : x.h.cty) && (!ord || !cty || x.h.cty || !countryOf(x.t.name)));
  scored.sort((a, b) => (b.h.cty - a.h.cty) || (b.h.inv - a.h.inv));
  return scored.length ? scored[0].t : null;
}

async function search(q) { return (await zoho.searchContacts(q)).map((c) => ({ id: c.id, name: c.Full_Name, email: c.Email || '', mobile: c.Mobile || '' })); }

const toItems = (x) => (x || []).map((i) => (typeof i === 'object' ? { id: String(i.id), templateKey: i.templateKey || '' } : { id: String(i), templateKey: '' }));
const letterTasksOf = (all, id) => all.filter((t) => String(t.Who_Id?.id || '') === String(id) && isLetterTask(t))
  .sort((a, b) => String(b.Created_Time || '').localeCompare(String(a.Created_Time || '')));

// Everything the "Send Letter" tab needs on opening: contacts that have an open letter task, with the template guessed from the task.
async function queue() {
  const [all, tpls] = await Promise.all([zoho.listTasks({}), templates()]);
  const byC = new Map();
  for (const t of all.filter(isLetterTask)) { const id = String(t.Who_Id?.id || ''); if (!id) continue; if (!byC.has(id)) byC.set(id, t.Who_Id.name || ''); }
  const ids = [...byC.keys()].slice(0, 60), rows = [];
  for (let i = 0; i < ids.length; i += 10) {
    rows.push(...await Promise.all(ids.slice(i, i + 10).map(async (id) => {
      const tasks = letterTasksOf(all, id), tpl = pickTemplate(tasks[0].Subject, tpls);
      let email = ''; try { email = (await zoho.getContactFull(id))?.Email || ''; } catch (_) { /* shown as no email */ }
      return { id, name: byC.get(id), email, templateKey: tpl?.key || '', tasks: tasks.map((t) => ({ id: t.id, subject: t.Subject, due: t.Due_Date || '' })) };
    })));
  }
  return { dry: (MODE.isDry() || DRY_DEMO), templates: tpls.map((t) => ({ key: t.key, name: t.name })), rows };
}

async function plan(items) {
  const [all, tpls] = await Promise.all([zoho.listTasks({}), templates()]);
  const out = [];
  for (const it of toItems(items)) {
    const id = it.id;
    const c = (await zoho.getContactFull(id)) || {};
    const tasks = letterTasksOf(all, id);
    const tpl = it.templateKey ? tpls.find((t) => String(t.key) === String(it.templateKey)) || null : (tasks.length ? pickTemplate(tasks[0].Subject, tpls) : null);
    out.push({ id, c, tasks, tpl, chosen: !!it.templateKey });
  }
  return out;
}
const problemOf = (x) => !x.tpl ? 'Template nahi mila — list se template chuno' : !x.c.Email ? 'Is contact ka email nahi hai' : '';

async function preview(items, sender) {
  const p = await plan(items);
  return { sender: await senderLabel(sender), dry: (MODE.isDry() || DRY_DEMO), contacts: p.map((x) => ({ id: x.id, name: x.c.Full_Name || '', email: x.c.Email || '', template: x.tpl?.name || '', problem: problemOf(x),
    tasks: x.tasks.map((t) => ({ id: t.id, subject: t.Subject, due: t.Due_Date || '' })) })) };
}

async function send(items, user, sender) {
  const p = await plan(items), results = [], via = await senderLabel(sender);
  for (const x of p) {
    const row = { id: x.id, name: x.c.Full_Name || '', email: x.c.Email || '', template: x.tpl?.name || '', sent: false, closed: [], error: '' };
    try {
      const pr = problemOf(x); if (pr) throw new Error(pr + ' — kuch nahi bheja');
      if ((MODE.isDry() || DRY_DEMO) && !zoho.DEMO) { row.dry = true; row.would_close = x.tasks.map((t) => t.Subject); }
      else {
        const c = x.c;
        const contact = { name: c.Full_Name, designation: c.Designation, department: c.Department, institution: c.College_Institute_University_industry_Name,
          addressLine1: c.Address_for_Hardcopy, addressLine2: c.Country, email: c.Email, phone: c.Mobile, awardName: c.Award_Name, selectAward: c.Select_Award, zohoContactId: String(x.id) };
        let status = 'SENT';
        if (!zoho.DEMO) { const j = await lm('POST', '/api/zoho/send', { type: 'letter', templateKey: x.tpl.key, contacts: [contact], ...(sender ? { senderIdentity: sender } : {}) }); const r = (j.results || [])[0]; status = r?.status || 'UNKNOWN'; if (status !== 'SENT') throw new Error('Letter Manager status: ' + status + (r?.error ? ' — ' + r.error : '')); }
        row.sent = true;
        try { await zoho.addNote('Contacts', String(x.id), 'Letter sent', `Letter sent: ${x.tpl.name} (via CRM Portal)`); } catch (_) { /* note is secondary */ }
        for (const t of x.tasks) { await zoho.closeTask(t.id, 'Letter sent via CRM Portal'); row.closed.push(t.Subject); }
      }
    } catch (e) { row.error = e.message; }
    db.prepare('INSERT INTO letter_log(user,contact_id,contact_name,email,result,closed) VALUES(?,?,?,?,?,?)').run(user, String(x.id), row.name, row.email, row.error ? 'ERROR: ' + row.error : (row.dry ? 'dry run' : 'sent') + (via ? ' via ' + via : ''), row.closed.join(' | '));
    log(user, 'send_letter', `${row.name} <${row.email}> ${row.error ? 'ERROR ' + row.error : row.dry ? '(dry run)' : 'sent' + (via ? ' via ' + via : '') + ', closed ' + row.closed.length}`);
    results.push(row);
  }
  return { dry: (MODE.isDry() || DRY_DEMO), via, results };
}

module.exports = { _t: { pickByConference, isMailmeteorConf }, getMap, saveMap, search, queue, templates, senders, saveSenders, preview, send, config, saveConfig, isLetterTask };
