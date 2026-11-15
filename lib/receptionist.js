// Caller lookup for the Edwin Dialer AI receptionist (incoming calls): phone -> who is this customer + a short, safe summary from Zoho.
// Dialer calls GET /api/ai-receptionist/customer?phone=+91...  (header x-ai-receptionist-secret) and must get an answer in ~2 s.
const zoho = require('./zoho');
const CACHE_MS = 10 * 60000; const cache = new Map();

// the Zoho Customer Summary points the AI may use; fee / payment lines and raw mail lists are left out on purpose (caller-ID alone does not prove who is calling)
function buildContext(summary, c = {}) {
  const keep = String(summary || '').split('\n').map((l) => l.trim()).filter((l) => /^(Quick view|[1235-7]b?\.\s)/.test(l) && !/^4\./.test(l));
  const lines = keep.map((l) => l.replace(/\s*Customer ka last message \([^)]*\):.*$/i, '').slice(0, 330));
  const head = ['CRM record of this phone number (caller ID only - confirm the name before using it; never state fees, payment or personal details, offer a team callback for those).'];
  if (c.Designation) head.push('Designation: ' + c.Designation);
  return head.concat(lines).join('\n').slice(0, 1900);
}
// no fee / payment / money lines go to the AI
const MONEY = /(\bfees?\b|payment|paid|invoice|₹|\brs\.?\s*\d|\binr\b|\bamount\b|\bprice\b)/i;
// email history lines from the Customer Summary (section heading contains "email history") + the task Description: what the customer asked and when
function extras(summary, desc) {
  const lines = String(summary || '').split('\n').map((l) => l.trim());
  const i = lines.findIndex((l) => /email history/i.test(l));
  const mails = i < 0 ? [] : lines.slice(i + 1).filter(Boolean).filter((l) => !/^(timeline|notes?|tasks?|details)\b/i.test(l)).slice(0, 8).map((l) => l.slice(0, 220)).filter((l) => !MONEY.test(l));
  const d = String(desc || '').split('\n').map((l) => l.trim()).filter((l) => l && !MONEY.test(l)).slice(0, 8).map((l) => l.slice(0, 220));
  const out = [];
  if (d.length) out.push('LATEST TASK DESCRIPTION (what the customer asked / how they came):\n' + d.join('\n'));
  if (mails.length) out.push('EMAIL HISTORY (newest first, short):\n' + mails.join('\n'));
  return out.join('\n');
}
const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10);

async function compute(d) {
  // the same number is often on several contacts, one of them our own company contact: never greet the caller as that
  const all = await zoho.searchContactsByPhone(d);
  const ours = (c) => /(edwin|delhi\s*crest)/i.test((c.Account_Name && c.Account_Name.name) || '') || /@(edwinincorp|edwinepc|edwin\.co|delhicrest)/i.test(c.Email || '') || /^(edwin|delhi\s*crest)\b/i.test(c.Full_Name || '');
  const r = all.slice().sort((a, b) => (ours(a) - ours(b)) || String(b.Modified_Time || '').localeCompare(String(a.Modified_Time || '')));
  if (!r.length) return { found: false };
  const top = r.slice(0, 5);
  const lists = await Promise.all(top.map((c) => zoho.tasksOf('Contacts', c.id).then((t) => (t || []).map((x) => ({ ...x, c })))));
  const tasks = lists.flat().sort((a, b) => String(b.Created_Time || '').localeCompare(String(a.Created_Time || '')));
  let c = top[0], summary = '', desc = '', subj = '';
  for (const t of tasks.slice(0, 2)) { try { const x = await zoho.taskContext(t.id); if (x && x.Customer_Summary) { summary = x.Customer_Summary; desc = x.Description || ''; subj = x.Subject || ''; c = t.c; break; } } catch (_) { /* next */ } }
  const name = String(c.Full_Name || '').replace(/\s+/g, ' ').trim();
  const base = summary ? buildContext(summary, c) : buildContext('', c) + '\nNo task summary yet: treat as an enquiry and take the details.';
  const more = extras(summary, desc);
  return { found: true, name, context: (base + (subj ? '\nLatest task: ' + String(subj).slice(0, 160) : '') + (more ? '\n' + more : '')).slice(0, 3800) };
}
async function lookup(phone) {
  const d = digits(phone); if (d.length < 10) return { found: false };
  const hit = cache.get(d); if (hit && Date.now() - hit.at < CACHE_MS) return hit.v;
  const p = compute(d).then((v) => { cache.set(d, { at: Date.now(), v }); return v; });
  p.catch(() => { /* surfaced below */ });
  return p; // keeps running (and fills the cache) even if the dialer gave up waiting
}

// the AI took a message on a call: make a Zoho task for the team (not in TEST mode; no duplicates; daily cap)
const recent = new Map(); let dayKey = '', dayCount = 0;
async function createTaskFromCall(b) {
  const clean = (v, n) => String(v || '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, n);
  const d = digits(b.number), name = clean(b.customer_name, 80), what = clean(b.subject, 140), details = clean(b.details, 900);
  if (!what) return { ok: false, error: 'subject is needed' };
  const today = new Date().toISOString().slice(0, 10); if (dayKey !== today) { dayKey = today; dayCount = 0; }
  if (dayCount >= 60) return { ok: false, error: 'daily limit reached; a team member will call back' };
  const key = d + '|' + what.toLowerCase(); const t0 = recent.get(key);
  if (t0 && Date.now() - t0 < 15 * 60000) return { ok: true, duplicate: true };
  if (require('./mode').isDry()) return { ok: true, dry: true };
  let who = null;
  if (d.length >= 10) { const r = await zoho.searchContactsByPhone(d); r.sort((a, b2) => String(b2.Modified_Time || '').localeCompare(String(a.Modified_Time || ''))); who = r[0] || null; }
  const due = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const desc = ['Platform: Phone (incoming call answered by AI receptionist)', 'Caller: ' + (name || (who && who.Full_Name) || 'unknown') + (d ? ' / ' + d : ''), clean(b.callback_time, 60) ? 'Callback wanted: ' + clean(b.callback_time, 60) : '', 'What they said: ' + (details || what), 'Why a task: customer called; team should reply or call back.'].filter(Boolean).join('\n');
  await zoho.createTask(who ? who.id : null, 'Incoming call (AI) - ' + what, due, desc);
  recent.set(key, Date.now()); dayCount++;
  return { ok: true, linked: !!who };
}
module.exports = { lookup, buildContext, createTaskFromCall, _extras: extras };
