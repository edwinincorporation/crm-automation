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
const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10);

async function compute(d) {
  const r = (await zoho.searchContactsByPhone(d)).sort((a, b) => String(b.Modified_Time || '').localeCompare(String(a.Modified_Time || '')));
  if (!r.length) return { found: false };
  const top = r.slice(0, 3);
  const lists = await Promise.all(top.map((c) => zoho.tasksOf('Contacts', c.id).then((t) => (t || []).map((x) => ({ ...x, c })))));
  const tasks = lists.flat().sort((a, b) => String(b.Created_Time || '').localeCompare(String(a.Created_Time || '')));
  let c = top[0], summary = '';
  for (const t of tasks.slice(0, 2)) { try { const x = await zoho.taskContext(t.id); if (x && x.Customer_Summary) { summary = x.Customer_Summary; c = t.c; break; } } catch (_) { /* next */ } }
  const name = String(c.Full_Name || '').replace(/\s+/g, ' ').trim();
  return { found: true, name, context: summary ? buildContext(summary, c) : buildContext('', c) + '\nNo task summary yet: treat as an enquiry and take the details.' };
}
async function lookup(phone) {
  const d = digits(phone); if (d.length < 10) return { found: false };
  const hit = cache.get(d); if (hit && Date.now() - hit.at < CACHE_MS) return hit.v;
  const p = compute(d).then((v) => { cache.set(d, { at: Date.now(), v }); return v; });
  p.catch(() => { /* surfaced below */ });
  return p; // keeps running (and fills the cache) even if the dialer gave up waiting
}
module.exports = { lookup, buildContext };
