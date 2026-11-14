// Zoho CRM client. Set DEMO=1 to run on built-in sample data (no Zoho calls).
const DEMO = process.env.DEMO === '1';
const ACCOUNTS = process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.in';
const API = process.env.ZOHO_API_URL || 'https://www.zohoapis.in';

let token = null, tokenExp = 0;

async function accessToken() {
  if (token && Date.now() < tokenExp) return token;
  const p = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const r = await fetch(`${ACCOUNTS}/oauth/v2/token`, { method: 'POST', body: p });
  const j = await r.json();
  if (!j.access_token) throw new Error('Zoho auth failed: ' + JSON.stringify(j));
  token = j.access_token; tokenExp = Date.now() + (j.expires_in - 120) * 1000;
  return token;
}

async function z(method, path, body) {
  const t = await accessToken();
  const r = await fetch(`${API}/crm/v8${path}`, {
    method,
    headers: { Authorization: `Zoho-oauthtoken ${t}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  if (!txt) return {};
  const j = JSON.parse(txt);
  if (!r.ok) throw new Error(`Zoho ${r.status}: ${txt.slice(0, 300)}`);
  return j;
}

// ---------- demo data ----------
const demoUsers = [{ id: 'u1', full_name: 'Anil Kumar' }, { id: 'u2', full_name: 'Priya Sharma' }, { id: 'u3', full_name: 'Rahul Verma' }];
const demoTasks = [
  { id: 't1', Subject: 'Mailmeteor (edwinincorp.com) - International Conference speaking invitation, expresses interest', Status: 'Not Started', Due_Date: '2026-11-09', Dept_Name: 'All Conferences', Assign_to: 'Raqib Khan', Owner: { name: 'Edwin Incorporation' }, Who_Id: { id: 'c1', name: 'Dr. Shabir Ahmad Parah' }, Description: 'Email: shabireltr@gmail.com\nPhone: +919596529991' },
  { id: 't2', Subject: 'Editorial Board Membership application received', Status: 'In Progress', Due_Date: '2026-11-08', Dept_Name: 'Editorial Board Membership', Owner: { name: 'Edwin Incorporation' }, Who_Id: { id: 'c2', name: 'Melanie Malone' }, Description: 'Email: melanie@example.com\nPhone: +14155550101' },
  { id: 't3', Subject: 'Send letter of Acceptance letter for paper', Status: 'Not Started', Due_Date: '2026-11-07', Dept_Name: 'Journals Publication', Owner: { name: 'Edwin Incorporation' }, Who_Id: { id: 'c3', name: 'Subin Scaria' }, Description: 'Email: subin@example.com\nPhone: +919876543210' },
];
const demoWorkflows = [
  { id: 'w1', name: 'Task Router', module: { api_name: 'Tasks' }, status: { active: true }, execute_when: { type: 'create' }, last_executed_time: '2026-11-08T06:14:00+05:30', actions: [{ type: 'function' }] },
  { id: 'w2', name: 'Lead auto ack', module: { api_name: 'Leads' }, status: { active: true }, execute_when: { type: 'create' }, last_executed_time: '2026-11-08T05:01:00+05:30', actions: [{ type: 'email_notifications' }] },
  { id: 'w3', name: 'Old reminder', module: { api_name: 'Leads' }, status: { active: false }, execute_when: { type: 'create' }, last_executed_time: null, actions: [] },
  { id: 'w4', name: 'Lead auto ack copy', module: { api_name: 'Leads' }, status: { active: true }, execute_when: { type: 'create' }, last_executed_time: null, actions: [{ type: 'email_notifications' }] },
];

// ---------- API ----------
async function listTasks({ status, dept, q } = {}) {
  let rows;
  if (DEMO) rows = demoTasks.map((t) => ({ ...t }));
  else {
    rows = [];
    for (let page = 1; page <= 10; page++) {
      const j = await z('GET', `/Tasks?fields=Subject,Status,Due_Date,Owner,Dept_Name,Priority,Who_Id,What_Id,Description,Assign_to,Followed_By,Created_Time&per_page=200&page=${page}&sort_by=Modified_Time&sort_order=desc`);
      rows.push(...(j.data || []));
      if (!j.info || !j.info.more_records) break;
    }
  }
  rows = rows.filter((t) => t.Status !== 'Completed');
  if (status) rows = rows.filter((t) => t.Status === status);
  if (dept) rows = rows.filter((t) => (t.Dept_Name || '') === dept);
  if (q) rows = rows.filter((t) => ((t.Subject || '') + (t.Who_Id?.name || '')).toLowerCase().includes(q.toLowerCase()));
  return rows;
}

async function getContact(id) {
  if (!id) return null;
  if (DEMO) return { Email: 'demo@example.com', Mobile: '+910000000000', Full_Name: 'Demo' };
  const j = await z('GET', `/Contacts/${id}?fields=Full_Name,Email,Mobile,Phone`);
  return (j.data || [])[0] || null;
}

async function searchContacts(q) {
  q = String(q || '').trim();
  if (DEMO) {
    const all = [{ id: 'c1', Full_Name: 'Dr. Shabir Ahmad Parah', Email: 'shabireltr@gmail.com' }, { id: 'c2', Full_Name: 'Melanie Malone', Email: 'melanie@example.com' }, { id: 'c3', Full_Name: 'Subin Scaria', Email: 'subin@example.com' }];
    return all.filter((c) => !q || (c.Full_Name + c.Email).toLowerCase().includes(q.toLowerCase()));
  }
  const f = 'Full_Name,Email,Mobile';
  const j = q.length >= 2 ? await z('GET', `/Contacts/search?word=${encodeURIComponent(q)}&fields=${f}&per_page=25`)
    : await z('GET', `/Contacts?fields=${f}&per_page=25&sort_by=Modified_Time&sort_order=desc`);
  return j.data || [];
}

async function getContactFull(id) {
  if (DEMO) return { id, Full_Name: ({ c1: 'Dr. Shabir Ahmad Parah', c2: 'Melanie Malone', c3: 'Subin Scaria' })[id] || 'Demo', Email: id + '@example.com', Mobile: '+910000000000', Designation: 'Professor', Country: 'India' };
  const f = 'Full_Name,Email,Mobile,Designation,Department,College_Institute_University_industry_Name,Address_for_Hardcopy,Country,Award_Name,Select_Award';
  const j = await z('GET', `/Contacts/${id}?fields=${f}`);
  return (j.data || [])[0] || null;
}

async function closeTask(id, note) {
  if (DEMO) { const t = demoTasks.find((x) => x.id === id); if (t) t.Status = 'Completed'; return { ok: true }; }
  const cur = await z('GET', `/Tasks/${id}?fields=Description`);
  const old = (cur.data?.[0]?.Description) || '';
  const stamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const desc = `${old}\n\n[Closed via CRM Portal ${stamp}] ${note || ''}`.trim();
  return z('PUT', '/Tasks', { data: [{ id, Status: 'Completed', Description: desc }], trigger: [] });
}

async function addNote(module, id, title, content) {
  if (DEMO) return { ok: true };
  return z('POST', '/Notes', { data: [{ Note_Title: title, Note_Content: content, Parent_Id: { module: { api_name: module }, id } }] });
}

async function findByEmail(email) {
  if (DEMO) return { module: 'Contacts', id: 'c1', name: 'Demo Contact' };
  for (const m of ['Contacts', 'Leads']) {
    try {
      const j = await z('GET', `/${m}/search?email=${encodeURIComponent(email)}&fields=Full_Name,Email`);
      if (j.data?.[0]) return { module: m, id: j.data[0].id, name: j.data[0].Full_Name };
    } catch (_) { /* 204 / no result */ }
  }
  return null;
}

async function updateRecord(module, id, fields) {
  if (DEMO) { if (module === 'Tasks') { const t = demoTasks.find((x) => x.id === id); if (t) { Object.assign(t, fields); if (fields.Owner?.id) { const u = demoUsers.find((x) => x.id === fields.Owner.id); if (u) t.Owner = { id: u.id, name: u.full_name }; } } } return { ok: true }; }
  return z('PUT', `/${module}`, { data: [{ id, ...fields }] });
}

async function createTask(whoModuleId, subject, due, description) {
  if (DEMO) { demoTasks.push({ id: 't' + (demoTasks.length + 1), Subject: subject, Status: 'Not Started', Due_Date: due, Description: description, Dept_Name: '' }); return { ok: true }; }
  return z('POST', '/Tasks', { data: [{ Subject: subject, Due_Date: due, Description: description, Status: 'Not Started', Who_Id: whoModuleId ? { id: whoModuleId } : undefined }] });
}

async function listUsers() {
  if (DEMO) return demoUsers;
  const j = await z('GET', '/users?type=ActiveUsers');
  return (j.users || []).map((u) => ({ id: u.id, full_name: u.full_name }));
}

async function listWorkflows() {
  if (DEMO) return demoWorkflows;
  const j = await z('GET', '/settings/automation/workflow_rules');
  return j.workflow_rules || j.data || [];
}

module.exports = { DEMO, getContactFull, searchContacts, listTasks, getContact, closeTask, addNote, findByEmail, updateRecord, createTask, listWorkflows, listUsers };
