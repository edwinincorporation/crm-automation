// Task Closure: reads new customer-enquiry tasks, writes a brand-wise positive email DRAFT (fixed templates, NO AI),
// and - only after a person approves - sends it, closes the Zoho task and schedules follow-ups (every 5 days, 3 times;
// skipped when the customer has already applied = Query field filled on Contact/Lead).
// Safety: only whitelisted brand links can appear in a mail; risky / unknown tasks become "needs reply" (no draft).
const zoho = require('./zoho');
const AS = require('./assign');
const { db, log } = require('./db');
const MODE = require('./mode');
const { send } = require('./senders');

db.exec(`CREATE TABLE IF NOT EXISTS closure_drafts (
  id INTEGER PRIMARY KEY, task_id TEXT, seq INTEGER DEFAULT 0, task_subject TEXT, brand TEXT, intent TEXT,
  contact_id TEXT, to_name TEXT, to_email TEXT, customer_msg TEXT, subject TEXT, body TEXT,
  status TEXT DEFAULT 'draft', reason TEXT, followups_done INTEGER DEFAULT 0, next_followup TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, sent_at TEXT, UNIQUE(task_id, seq));`);

// ---- approved brand links (the ONLY urls that may appear in a mail). Edit from the portal. ----
const CONF = 'https://www.edwin.co.in/ConferenceApplyNow';
const DEFAULT_BRANDS = {
  'edwin conference': { name: 'Edwin Conference', sig: 'Team Edwin Conference', site: 'https://www.edwin.co.in', apply: CONF, conf: CONF, contact: 'WhatsApp/Call: 6262752170' },
  'edwin inc': { name: 'Edwin Incorporation', sig: 'Team Edwin Incorporation', site: 'https://edwin.co.in/', apply: CONF, conf: CONF, contact: 'Call/WhatsApp: +91 6262752168 | care@edwinepc.com' },
  'delhi crest': { name: 'Delhi-Crest Enterprise', sig: 'Team Delhi-Crest Enterprise', site: 'https://delhicrestenterprise.com', apply: 'https://delhicrestenterprise.com/contact', conf: CONF, contact: 'WhatsApp/Call: 9243600377 | info@delhicrestenterprise.com' },
  'dya': { name: 'DYA Research Center', sig: 'Team DYA Research Center', site: 'https://www.dyaresearch.com', apply: 'https://www.dyaresearch.com/upcoming-conference', conf: CONF, contact: '' },
  'sama': { name: 'SAMA', sig: 'Team SAMA', site: 'https://www.samaindia.org', apply: 'https://www.samaindia.org/Members', conf: 'https://www.samaindia.org/Members', contact: '' },
  'uscse': { name: 'USCSE', sig: 'Team USCSE', site: 'https://www.uscse.com', apply: 'https://www.uscse.com/registered-member', conf: 'https://www.uscse.com/registered-member', contact: '' },
  'jma': { name: 'JMA Jabalpur', sig: 'Team JMA Jabalpur', site: 'https://www.jmajabalpur.org', apply: 'https://www.jmajabalpur.org', conf: 'https://www.jmajabalpur.org', contact: '' },
};
const brands = () => { try { const o = JSON.parse(AS.getSetting('closure_brands', '{}')); const r = {}; for (const k of Object.keys(DEFAULT_BRANDS)) r[k] = { ...DEFAULT_BRANDS[k], ...(o[k] || {}) }; return r; } catch (_) { return DEFAULT_BRANDS; } };
function setBrands(o) {
  const cur = brands(), out = {};
  for (const k of Object.keys(cur)) { const n = (o || {})[k] || {}; out[k] = {}; for (const f of ['site', 'apply', 'conf', 'contact', 'sig']) if (typeof n[f] === 'string' && n[f] !== cur[k][f]) { if (/^(site|apply|conf)$/.test(f) && n[f] && !/^https:\/\/[^\s]+$/.test(n[f])) throw new Error(`${k}: ${f} https:// se shuru hona chahiye`); out[k][f] = n[f].trim(); } }
  AS.setSetting('closure_brands', JSON.stringify(out)); return brands();
}
const fromMap = () => { try { return JSON.parse(AS.getSetting('closure_from', '{}')); } catch (_) { return {}; } };
const cfg = () => ({ days: Math.max(1, +AS.getSetting('closure_days', '3') || 3), from: fromMap() });
function setCfg(c) { if (c.days) AS.setSetting('closure_days', String(Math.min(30, Math.max(1, +c.days)))); if (c.from && typeof c.from === 'object') AS.setSetting('closure_from', JSON.stringify(c.from)); return cfg(); }

// ---- reading a task ----
const grab = (d, label) => { const m = new RegExp('^' + label + ':[ \\t]*(.*)$', 'mi').exec(d || ''); return m ? m[1].trim() : ''; };
function parse(t) {
  const d = t.Description || '';
  const msg = (/Their message:\s*([\s\S]*?)(?:\n\s*Summary:|\n\s*Why a task:|$)/i.exec(d) || [])[1] || '';
  return { email: (grab(d, 'Email').match(/[^\s<>,;]+@[^\s<>,;]+\.[^\s<>,;]+/) || [''])[0], name: grab(d, 'Name') || (t.Who_Id && t.Who_Id.name) || '', brandRaw: grab(d, 'Brand'), summary: grab(d, 'Summary'), msg: msg.trim().slice(0, 1500) };
}
function brandKey(raw, subject) {
  const s = (raw + ' ' + ((/\(([^)]+)\)/.exec(subject || '') || [])[1] || '')).toLowerCase();
  if (/delhi/.test(s)) return 'delhi crest'; if (/dya/.test(s)) return 'dya'; if (/sama/.test(s)) return 'sama'; if (/uscse/.test(s)) return 'uscse'; if (/jma|jabalpur/.test(s)) return 'jma';
  if (/conference/.test(s)) return 'edwin conference'; if (/edwin|epc/.test(s)) return 'edwin inc';
  return '';
}
// anything touching money, complaints, documents, bookings or status needs a human answer - never a template
const RISK = /refund|cancel|complain|delay|not received|haven.?t received|didn.?t receive|certificate|invitation|payment|paid|paytm|transaction|receipt|invoice|fraud|fake|scam|legal|police|cheat|money|quotation|quote|price|fee\b|fees|cost|charge|discount|visa|ticket|flight|booking|hotel|abstract|manuscript|paper|status|accepted|acceptance|urgent|scopus|doi\b|issn|indexed|complaint|disappoint|angry|worst|bad service|observation|concern|problem|issue|disagree|unhappy|not happy/i;
const ASKS = /conference|registration|register|apply|participat|join|member|details|information|info\b|brochure|schedule|dates?\b|venue|attend|speaker|resource person|interested|send (me |us )?(an )?(email|mail)|need (an )?e-?mail|email (me|us)|by email|via email|on email|how to/i;
function classify(p, subject) {
  const text = (p.msg + ' ' + p.summary + ' ' + (subject || '')).toLowerCase();
  if (RISK.test(text)) return { intent: 'needs_reply', reason: 'Paisa / shikayat / document / booking ya status ka mamla hai - aapka jawab chahiye' };
  if (!ASKS.test(text)) return { intent: 'needs_reply', reason: 'Sawaal template se match nahi hua' };
  return { intent: /conference/.test(text) ? 'conference' : 'register', reason: '' };
}

// ---- drafting (fixed templates) ----
const first = (n) => { const x = String(n || '').trim(); return x || 'Sir/Madam'; };
function compose(b, intent, name, seq) {
  const link = intent === 'conference' ? b.conf : b.apply;
  const what = intent === 'conference' ? 'Conference Participation' : 'your request';
  const help = b.contact ? `If you need any help, simply reply to this email or reach us on ${b.contact}.` : 'If you need any help, simply reply to this email and our team will assist you.';
  const subjects = ['Thank you for your interest - ' + b.name, 'Quick follow-up on your enquiry - ' + b.name, 'Happy to help with your enquiry - ' + b.name, 'Final follow-up - ' + b.name];
  const mid = [
    `Thank you for reaching out to ${b.name}. We appreciate your interest and are glad to assist you.\n\nTo take ${what} forward, please complete the short online application here (it takes about 2 minutes):\n${link}\n\nOnce your application is received, your executive will guide you through every step.`,
    `We wanted to check whether you had a chance to look at our earlier email about ${what}.\n\nYou can complete the short online application here whenever convenient:\n${link}\n\nOur team will be happy to guide you after that.`,
    `Our team would be glad to answer any question you may have about ${what}.\n\nWhen you are ready, you can apply online here:\n${link}\n\nYou can also visit ${b.site} to know more about us.`,
    `This is our last note regarding your enquiry. We would be delighted to support you whenever you are ready.\n\nYou can apply online here at any time:\n${link}`,
  ][Math.min(seq, 3)];
  return { subject: subjects[Math.min(seq, 3)], body: `Dear ${first(name)},\n\n${mid}\n\n${help}\n\nWarm regards,\n${b.sig}\n${b.site}` };
}
// every URL in a mail must start with one of the brand's approved links
function badLinks(body, b) {
  const ok = [b.site, b.apply, b.conf].filter(Boolean).map((u) => u.replace(/\/+$/, ''));
  return (body.match(/https?:\/\/[^\s)>\]"']+/g) || []).filter((u) => !ok.some((o) => u.replace(/\/+$/, '').toLowerCase() === o.toLowerCase() || u.toLowerCase().startsWith(o.toLowerCase() + '/')));
}

// ---- scan ----
async function scan() {
  const B = brands(), c = cfg(), since = Date.now() - c.days * 86400000;
  const tasks = (await zoho.listTasks()).filter((t) => /inquiry|enquiry/i.test(t.Subject || '') && new Date(t.Created_Time || Date.now()).getTime() >= since);
  const ins = db.prepare(`INSERT OR IGNORE INTO closure_drafts(task_id,seq,task_subject,brand,intent,contact_id,to_name,to_email,customer_msg,subject,body,status,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  let made = 0, needs = 0;
  for (const t of tasks) {
    if (db.prepare('SELECT 1 FROM closure_drafts WHERE task_id=? AND seq=0').get(String(t.id))) continue;
    const p = parse(t), bk = brandKey(p.brandRaw, t.Subject), b = B[bk];
    let k = classify(p, t.Subject);
    if (k.intent !== 'needs_reply') {
      if (!b) k = { intent: 'needs_reply', reason: 'Brand pehchana nahi gaya' };
      else if (!p.email) k = { intent: 'needs_reply', reason: 'Customer ka email nahi mila' };
    }
    if (k.intent === 'needs_reply') { ins.run(String(t.id), 0, t.Subject, bk, 'needs_reply', t.Who_Id?.id || '', p.name, p.email, p.msg, '', '', 'needs_reply', k.reason); needs++; continue; }
    const m = compose(b, k.intent, p.name, 0), bad = badLinks(m.body, b);
    if (bad.length) { ins.run(String(t.id), 0, t.Subject, bk, 'needs_reply', t.Who_Id?.id || '', p.name, p.email, p.msg, '', '', 'needs_reply', 'Unapproved link: ' + bad.join(', ')); needs++; continue; }
    ins.run(String(t.id), 0, t.Subject, bk, k.intent, t.Who_Id?.id || '', p.name, p.email, p.msg, m.subject, m.body, 'draft', ''); made++;
  }
  log('closure', 'scan', `${tasks.length} enquiry tasks, ${made} drafts, ${needs} needs-reply`);
  return { scanned: tasks.length, drafts: made, needs_reply: needs };
}

function list() {
  const rows = db.prepare(`SELECT * FROM closure_drafts WHERE status IN ('draft','needs_reply','sent') ORDER BY CASE status WHEN 'draft' THEN 0 WHEN 'needs_reply' THEN 1 ELSE 2 END, id DESC LIMIT 200`).all();
  return { dry: MODE.isDry(), cfg: cfg(), brands: brands(), rows };
}

function edit(id, subject, body) {
  const r = db.prepare('SELECT * FROM closure_drafts WHERE id=?').get(id);
  if (!r || r.status !== 'draft') throw new Error('Draft nahi mila');
  const bad = badLinks(String(body || ''), brands()[r.brand] || {});
  if (bad.length) throw new Error('Yeh link approved list me nahi hai: ' + bad.join(', '));
  db.prepare('UPDATE closure_drafts SET subject=?, body=? WHERE id=?').run(String(subject || r.subject).slice(0, 300), String(body || r.body).slice(0, 8000), id);
}
function skip(id, by) { db.prepare("UPDATE closure_drafts SET status='skipped' WHERE id=? AND status IN ('draft','needs_reply')").run(id); log(by, 'closure_skip', String(id)); }

// Approve & send. In TEST mode nothing is sent, nothing is closed.
async function approve(id, by) {
  const r = db.prepare('SELECT * FROM closure_drafts WHERE id=?').get(id);
  if (!r || r.status !== 'draft') throw new Error('Draft nahi mila ya pehle hi ho chuka');
  const b = brands()[r.brand]; if (!b) throw new Error('Brand nahi mila');
  const bad = badLinks(r.body, b); if (bad.length) throw new Error('Unapproved link: ' + bad.join(', '));
  if (!r.to_email) throw new Error('Email nahi hai');
  if (r.seq > 0 && await applied(r.contact_id)) { db.prepare("UPDATE closure_drafts SET status='skipped', reason='Customer ne apply kar diya' WHERE id=?").run(id); throw new Error('Customer ne apply kar diya - follow-up nahi bheja'); }
  if (MODE.isDry()) { log(by, 'closure_test', `task ${r.task_id} -> ${r.to_email} (TEST: mail gayi nahi)`); return { sent: false, dry: true }; }
  await send({ action_type: 'email', to_email: r.to_email, subject: r.subject, body: r.body, from: cfg().from[r.brand] || undefined });
  const next = r.seq < 3 ? new Date(Date.now() + 5 * 86400000).toISOString() : null;
  db.prepare("UPDATE closure_drafts SET status='sent', sent_at=CURRENT_TIMESTAMP, next_followup=? WHERE id=?").run(next, id);
  if (r.seq === 0) {
    try { await zoho.closeTask(r.task_id, `Customer ko ${b.name} ka email bheja (${r.to_email}) by ${by}.`); } catch (e) { log('closure', 'close_error', r.task_id + ' ' + e.message); }
  }
  log(by, 'closure_sent', `task ${r.task_id} seq ${r.seq} -> ${r.to_email}`);
  return { sent: true };
}

// has the customer already applied?  = "Query" filled on the Contact or Lead
async function applied(contactId) {
  if (!contactId) return false;
  if (zoho.DEMO) return false;
  for (const m of ['Contacts', 'Leads']) {
    try { const j = await zoho.rawGet(`/${m}/${contactId}?fields=Query`); const q = j.data?.[0]?.Query; if (j.data?.[0]) return !!String(q || '').trim(); } catch (_) { /* try next module */ }
  }
  return false;
}

// every few minutes: for sent mails whose 5 days are over, write the next follow-up DRAFT (never auto-send)
async function tick() {
  const B = brands(), due = db.prepare("SELECT * FROM closure_drafts WHERE status='sent' AND next_followup IS NOT NULL AND next_followup<=? ORDER BY id").all(new Date().toISOString());
  let n = 0;
  for (const r of due) {
    const root = db.prepare('SELECT * FROM closure_drafts WHERE task_id=? AND seq=0').get(r.task_id);
    if (await applied(root.contact_id)) { db.prepare("UPDATE closure_drafts SET next_followup=NULL, reason='Customer ne apply kar diya - follow-up band' WHERE id=?").run(r.id); log('closure', 'followup_stop_applied', r.task_id); continue; }
    const seq = r.seq + 1, b = B[r.brand];
    if (!b || seq > 3) { db.prepare('UPDATE closure_drafts SET next_followup=NULL WHERE id=?').run(r.id); continue; }
    const m = compose(b, root.intent, root.to_name, seq);
    if (badLinks(m.body, b).length) continue;
    db.prepare(`INSERT OR IGNORE INTO closure_drafts(task_id,seq,task_subject,brand,intent,contact_id,to_name,to_email,customer_msg,subject,body,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,'draft')`).run(r.task_id, seq, root.task_subject, root.brand, root.intent, root.contact_id, root.to_name, root.to_email, root.customer_msg, m.subject, m.body);
    db.prepare('UPDATE closure_drafts SET next_followup=NULL WHERE id=?').run(r.id); n++;
  }
  return n;
}
const autoRun = async () => { if (AS.getSetting('closure_auto', '1') !== '1') return; await scan(); await tick(); };

module.exports = { _t: { parse, classify, brandKey, compose, badLinks }, scan, list, edit, skip, approve, tick, autoRun, setBrands, setCfg, brands, cfg };
