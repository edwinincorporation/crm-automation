// Task Closure: reads new customer-enquiry tasks, writes a brand-wise positive email DRAFT (fixed templates, NO AI),
// and - only after a person approves - sends it, closes the Zoho task and schedules follow-ups (every 5 days, 3 times;
// skipped when the customer has already applied = Query field filled on Contact/Lead).
// Safety: only whitelisted brand links can appear in a mail; risky / unknown tasks become "needs reply" (no draft).
const zoho = require('./zoho');
const AS = require('./assign');
const { db, log } = require('./db');
const MODE = require('./mode');
const { send, senderInfo } = require('./senders');

db.exec(`CREATE TABLE IF NOT EXISTS closure_drafts (
  id INTEGER PRIMARY KEY, task_id TEXT, seq INTEGER DEFAULT 0, task_subject TEXT, brand TEXT, intent TEXT,
  contact_id TEXT, to_name TEXT, to_email TEXT, customer_msg TEXT, subject TEXT, body TEXT,
  status TEXT DEFAULT 'draft', reason TEXT, followups_done INTEGER DEFAULT 0, next_followup TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, sent_at TEXT, UNIQUE(task_id, seq));`);

for (const c of ['auto INTEGER DEFAULT 0', 'edited INTEGER DEFAULT 0', 'counted INTEGER DEFAULT 0', 'svc_name TEXT', 'svc_url TEXT']) { try { db.exec('ALTER TABLE closure_drafts ADD COLUMN ' + c); } catch (_) { /* exists */ } }
db.exec(`CREATE TABLE IF NOT EXISTS closure_trust (k TEXT PRIMARY KEY, streak INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, auto_sent INTEGER DEFAULT 0)`);
const NEED = 2, DAILY_CAP = 20; // 2 unedited approvals = trusted; max 20 auto mails per type per day
const tkey = (r) => r.brand + '|' + r.intent;
const trust = (k) => db.prepare('SELECT * FROM closure_trust WHERE k=?').get(k) || { k, streak: 0, enabled: 1, auto_sent: 0 };
const bump = (k, ok) => { const t = trust(k); db.prepare('INSERT INTO closure_trust(k,streak,enabled,auto_sent) VALUES(?,?,?,?) ON CONFLICT(k) DO UPDATE SET streak=excluded.streak').run(k, ok ? t.streak + 1 : 0, t.enabled, t.auto_sent); };
const smtpReady = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const autoToday = (k) => { const [b, i] = k.split('|'); return db.prepare("SELECT COUNT(*) n FROM closure_drafts WHERE auto=1 AND brand=? AND intent=? AND date(sent_at)=date('now')").get(b, i).n; };
const canAuto = (r) => !MODE.isDry() && smtpReady() && r.intent !== 'needs_reply' && autoToday(tkey(r)) < DAILY_CAP;

// ---- approved brand links (the ONLY urls that may appear in a mail). Edit from the portal. ----
const CONF = 'https://www.edwin.co.in/ConferenceApplyNow';
const CATALOG = require('./brand_services');
// ---- service catalogue: defaults from brand_services.js, replaceable per brand from the portal ----
const svcOverride = () => { try { return JSON.parse(AS.getSetting('closure_services', '{}')); } catch (_) { return {}; } };
const catalog = (k) => { const o = svcOverride()[k]; return (Array.isArray(o) ? o : CATALOG[k] || []).filter((x) => x && x.url && !x.off); };
const svcMap = (k) => Object.fromEntries(catalog(k).map((x) => [x.name, x.url]));
function setServices(k, items) {
  if (!CATALOG[k]) throw new Error('Brand nahi mila');
  const clean = (items || []).map((x) => ({ name: String(x.name || '').trim(), url: String(x.url || '').trim(), kw: String(x.kw || '').trim().toLowerCase(), off: x.off ? 1 : 0 })).filter((x) => x.name || x.url);
  for (const x of clean) { if (!x.name) throw new Error('Service ka naam likho'); if (!/^https:\/\/[^\s]+$/.test(x.url)) throw new Error(`${x.name}: URL https:// se shuru hona chahiye`); }
  const o = svcOverride(); o[k] = clean; AS.setSetting('closure_services', JSON.stringify(o)); log('closure', 'services_saved', k + ' ' + clean.length); return clean.length;
}
const servicesView = () => { const o = svcOverride(), out = {}; for (const k of Object.keys(CATALOG)) out[k] = { items: Array.isArray(o[k]) ? o[k] : CATALOG[k], custom: Array.isArray(o[k]) }; return out; };
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// best service for what the customer wrote (longest matching keyword wins); null when nothing matches
function matchService(k, text) {
  const t = ' ' + String(text || '').toLowerCase().replace(/\s+/g, ' ') + ' '; let best = null;
  for (const it of catalog(k)) for (const w of String(it.kw || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const re = new RegExp('(^|[^a-z0-9])' + esc(w) + (w.length <= 3 ? '(s)?($|[^a-z0-9])' : ''));
    if (re.test(t) && (!best || w.length > best.score)) best = { name: it.name, url: it.url, score: w.length };
  }
  return best;
}
const DEFAULT_BRANDS = {
  'edwin conference': { name: 'Edwin Conference', sig: 'Team Edwin Conference', site: 'https://www.edwin.co.in', apply: CONF, conf: CONF, contact: 'WhatsApp/Call: 6262752170' },
  'edwin inc': { name: 'Edwin Incorporation', sig: 'Team Edwin Incorporation', site: 'https://edwin.co.in/', apply: CONF, conf: CONF, contact: 'Call/WhatsApp: +91 6262752168 | care@edwinepc.com' },
  'delhi crest': { name: 'Delhi-Crest Enterprise', sig: 'Team Delhi-Crest Enterprise', site: 'https://www.delhicrestenterprise.com', apply: 'https://www.delhicrestenterprise.com/contact/', conf: 'https://www.delhicrestenterprise.com/contact/', contact: 'WhatsApp/Call: 9243600377 | info@delhicrestenterprise.com' },
  'dya': { name: 'DYA Research Center', sig: 'Team DYA Research Center', site: 'https://www.dyaresearch.com', apply: 'https://www.dyaresearch.com/upcoming-conference', conf: 'https://www.dyaresearch.com/upcoming-conference#conference-registration', contact: '' },
  'sama': { name: 'SAMA', sig: 'Team SAMA', site: 'https://www.samaindia.org', apply: 'https://www.samaindia.org/membership/sama-membership/', conf: 'https://www.samaindia.org/conference-awards/upcoming-international-conferences/', contact: '' },
  'uscse': { name: 'USCSE', sig: 'Team USCSE', site: 'https://www.uscse.com', apply: 'https://www.uscse.com/contact.php', conf: 'https://www.uscse.com/conferences/conference-register.php', contact: '' },
  'jma': { name: 'JMA Jabalpur', sig: 'Team JMA Jabalpur', site: 'https://jmajabalpur.org', apply: 'https://jmajabalpur.org/membership/jma-membership#applyjma', conf: 'https://jmajabalpur.org/conference/upcoming-conference', contact: '' },
};
const brands = () => { try { const o = JSON.parse(AS.getSetting('closure_brands', '{}')); const r = {}; for (const k of Object.keys(DEFAULT_BRANDS)) r[k] = { ...DEFAULT_BRANDS[k], ...(o[k] || {}), services: svcMap(k) }; return r; } catch (_) { return DEFAULT_BRANDS; } };
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
const RISK = /refund|cancel|complain|delay|not received|haven.?t received|didn.?t receive|certificate|invitation|payment|paid|paytm|transaction|receipt|invoice|fraud|fake|scam|legal|police|cheat|money|quotation|quote|price|fee\b|fees|cost|charge|discount|visa|ticket|flight|booking|hotel|status|accepted|acceptance|rejected|reviewer comments|revision|submitted|urgent|complaint|disappoint|angry|worst|bad service|observation|concern|problem|issue|disagree|unhappy|not happy/i;
const ASKS = /conference|registration|register|apply|participat|join|member|details|information|info\b|brochure|schedule|dates?\b|venue|attend|speaker|resource person|interested|send (me |us )?(an )?(email|mail)|need (an )?e-?mail|email (me|us)|by email|via email|on email|how to/i;
function classify(p, subject, bk) {
  const text = (p.msg + ' ' + p.summary + ' ' + (subject || '')).toLowerCase();
  if (RISK.test(text)) return { intent: 'needs_reply', reason: 'Paisa / shikayat / document / booking ya status ka mamla hai - aapka jawab chahiye' };
  const pre = bk ? matchService(bk, p.msg + ' ' + p.summary) : null;
  if (!ASKS.test(text) && !pre) return { intent: 'needs_reply', reason: 'Sawaal template se match nahi hua' };
  let svc = bk ? matchService(bk, p.msg + ' ' + p.summary) : null;
  if (svc && /conference/.test(text) && svc.score < 8) svc = null; // a plain conference enquiry stays a conference mail
  if (svc) return { intent: 'service', svc, reason: '' };
  return { intent: /conference/.test(text) ? 'conference' : 'register', reason: '' };
}

// ---- drafting (fixed templates) ----
const first = (n) => { const x = String(n || '').trim(); return x || 'Sir/Madam'; };
function compose(b, intent, name, seq, svc) {
  const isSvc = intent === 'service' && svc && svc.url;
  const link = isSvc ? svc.url : intent === 'conference' ? b.conf : b.apply;
  const toContact = /\/contact(\.php)?\/?$/i.test(link);
  const what = isSvc ? svc.name.replace(/\s*\(apply\)/i, '') : intent === 'conference' ? (toContact ? 'your conference enquiry' : 'Conference Participation') : 'your request';
  const help = b.contact ? `If you need any help, simply reply to this email or reach us on ${b.contact}.` : 'If you need any help, simply reply to this email and our team will assist you.';
  const subjects = ['Thank you for your interest - ' + b.name, 'Quick follow-up on your enquiry - ' + b.name, 'Happy to help with your enquiry - ' + b.name, 'Final follow-up - ' + b.name];
  const intro = isSvc ? `Greetings from ${b.name}. Thank you for your interest in our ${what} service.` : intent === 'conference' ? `Greetings from ${b.name}. Thank you for your interest in our international conferences for researchers, academicians, professionals and institutions.` : `Greetings from ${b.name}. Thank you for reaching out to us - we appreciate your interest and are glad to assist you.`;
  const contact = toContact;
  const midList = contact ? [
    `${intro}\n\nTo take ${isSvc ? 'it' : what} forward, you can get in touch with us here and our team will assist you personally:\n${link}\n\nOnce we hear from you, your executive will guide you through every step.`,
    `Greetings from ${b.name}. We wanted to check whether you had a chance to look at our earlier email about ${what}.\n\nYou can get in touch with us here whenever convenient:\n${link}\n\nOur team will be happy to guide you after that.`,
    `Greetings from ${b.name}. Our team would be glad to answer any question you may have about ${what}.\n\nWhen you are ready, you can reach us here:\n${link}\n\nYou can also visit ${b.site} to know more about us.`,
    `This is our last note regarding your enquiry. We would be delighted to support you whenever you are ready.\n\nYou can reach us here at any time:\n${link}`,
  ] : [
    `${intro}\n\nTo take ${isSvc ? 'it' : what} forward, ${isSvc ? 'you can see the details and apply online here' : 'please complete the short online application here'} (it takes about 2 minutes):\n${link}\n\nOnce your application is received, your executive will guide you through every step.`,
    `Greetings from ${b.name}. We wanted to check whether you had a chance to look at our earlier email about ${what}.\n\nYou can complete the short online application here whenever convenient:\n${link}\n\nOur team will be happy to guide you after that.`,
    `Greetings from ${b.name}. Our team would be glad to answer any question you may have about ${what}.\n\nWhen you are ready, you can apply online here:\n${link}\n\nYou can also visit ${b.site} to know more about us.`,
    `This is our last note regarding your enquiry. We would be delighted to support you whenever you are ready.\n\nYou can apply online here at any time:\n${link}`,
  ];
  const mid = midList[Math.min(seq, 3)];
  return { subject: subjects[Math.min(seq, 3)], body: `Dear ${first(name)},\n\n${mid}\n\n${help}\n\nWarm regards,\n${b.sig}\n${b.site}` };
}


// ---- learning: when staff edits a first mail and approves it, that final text becomes the template for the same type (brand + intent + service) ----
db.exec(`CREATE TABLE IF NOT EXISTS closure_learned (k TEXT PRIMARY KEY, subject_tpl TEXT, body_tpl TEXT, approvals INTEGER DEFAULT 1, by TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
const lkey = (bk, intent, svcUrl) => [bk, intent, svcUrl || ''].join('|');
const rep = (t, from, to) => (from && String(from).length > 2 ? String(t).split(String(from)).join(to) : String(t));
function toTpl(text, r, link, what) { return rep(rep(rep(text, link, '{LINK}'), what, '{SERVICE}'), r.to_name, '{NAME}'); }
function fillTpl(text, name, link, what) { return String(text).split('{NAME}').join(first(name)).split('{LINK}').join(link).split('{SERVICE}').join(what); }
function linkWhat(b, intent, svc) {
  const m = compose(b, intent, 'X', 0, svc); // reuse compose's own link/what choice
  const isSvc = intent === 'service' && svc && svc.url;
  const link = isSvc ? svc.url : intent === 'conference' ? b.conf : b.apply;
  const toContact = /\/contact(\.php)?\/?$/i.test(link);
  const what = isSvc ? svc.name.replace(/\s*\(apply\)/i, '') : intent === 'conference' ? (toContact ? 'your conference enquiry' : 'Conference Participation') : 'your request';
  return { link, what, def: m };
}
// remember the staff-edited final text of an approved first mail
function learnFrom(r, by) {
  try {
    if (r.seq !== 0 || !r.edited || !r.to_email) return;
    const bks = brands(), b = bks[r.brand]; if (!b) return;
    const svc = r.svc_url ? { name: r.svc_name, url: r.svc_url } : null;
    const lw = linkWhat(b, r.intent, svc);
    const defNow = compose(b, r.intent, r.to_name, 0, svc);
    if (r.body === defNow.body && r.subject === defNow.subject) return; // nothing was changed from the standard text
    const k = lkey(r.brand, r.intent, r.svc_url);
    const sub = toTpl(r.subject, r, lw.link, lw.what), body = toTpl(r.body, r, lw.link, lw.what);
    const old = db.prepare('SELECT * FROM closure_learned WHERE k=?').get(k);
    if (old && old.body_tpl === body && old.subject_tpl === sub) db.prepare('UPDATE closure_learned SET approvals=approvals+1, by=?, updated_at=CURRENT_TIMESTAMP WHERE k=?').run(by, k);
    else db.prepare('INSERT INTO closure_learned(k,subject_tpl,body_tpl,approvals,by) VALUES(?,?,?,1,?) ON CONFLICT(k) DO UPDATE SET subject_tpl=excluded.subject_tpl, body_tpl=excluded.body_tpl, approvals=1, by=excluded.by, updated_at=CURRENT_TIMESTAMP').run(k, sub, body, by);
    log(by, 'closure_learned', k);
  } catch (e) { log('closure', 'learn_error', e.message); }
}
// use the learned text for a new first mail of the same type; falls back to the standard template
function withLearned(m, bk, b, intent, name, svc) {
  try {
    const row = db.prepare('SELECT * FROM closure_learned WHERE k=?').get(lkey(bk, intent, svc && svc.url));
    if (!row) return { ...m, learned: false };
    const lw = linkWhat(b, intent, svc);
    const out = { subject: fillTpl(row.subject_tpl, name, lw.link, lw.what), body: fillTpl(row.body_tpl, name, lw.link, lw.what), learned: true };
    if (badLinks(out.body, b).length) return { ...m, learned: false };
    return out;
  } catch (_) { return { ...m, learned: false }; }
}
function learnedList() { return db.prepare('SELECT k, approvals, by, updated_at FROM closure_learned ORDER BY updated_at DESC').all(); }
function forgetLearned(k) { db.prepare('DELETE FROM closure_learned WHERE k=?').run(k); }

// ---- HTML mail: built from the (editable) plain-text body, so edits in the portal carry over. Plain text goes along as the alternative part. ----
const COLORS = { 'edwin conference': ['#1e40af', '#3b82f6'], 'edwin inc': ['#1e40af', '#3b82f6'], dya: ['#3B1C5A', '#6A3BA0'], 'delhi crest': ['#0f4c5c', '#1b8a9c'], sama: ['#7c2d12', '#c2410c'], uscse: ['#1e3a5f', '#2f6fb0'], jma: ['#14532d', '#16a34a'] };
const hx = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function toHtml(body, b, brandKey) {
  const [c1, c2] = COLORS[brandKey] || ['#1e40af', '#3b82f6'];
  const link = (u) => `<a href="${hx(u)}" style="color:${c1};text-decoration:underline">${hx(u)}</a>`;
  const blocks = String(body || '').replace(/\r/g, '').trim().split(/\n{2,}/);
  const sigAt = blocks.findIndex((x) => /^(warm regards|regards|best regards)/i.test(x.trim()));
  const main = sigAt >= 0 ? blocks.slice(0, sigAt) : blocks, sig = sigAt >= 0 ? blocks[sigAt].trim().split('\n') : [];
  const parts = main.map((blk) => {
    const lines = blk.split('\n').map((x) => x.trim()).filter(Boolean);
    const urlOnly = lines.length && lines[lines.length - 1].match(/^https?:\/\/\S+$/);
    const text = (urlOnly ? lines.slice(0, -1) : lines).map((l) => hx(l).replace(/https?:\/\/[^\s<]+/g, (u) => link(u.replace(/&amp;/g, '&')))).join('<br>');
    const btn = urlOnly ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px 0 6px"><tr><td style="background:${c1};border-radius:8px"><a href="${hx(urlOnly[0])}" style="display:inline-block;padding:13px 30px;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif">${/\/contact(\.php)?\/?$/i.test(urlOnly[0]) ? 'Contact Us' : 'Apply Now'} &rarr;</a></td></tr></table><p style="margin:0 0 14px;font-size:12px;color:#64748b">Button not working? Copy this link: ${link(urlOnly[0])}</p>` : '';
    return (text ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#1f2937">${text}</p>` : '') + btn;
  }).join('');
  const sigHtml = sig.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px"><tr><td style="border-left:4px solid ${c1};padding:6px 14px;background:#f8fafc;font-size:14px;line-height:1.6;color:#334155">${sig.map((l) => hx(l).replace(/https?:\/\/[^\s<]+/g, (u) => link(u))).join('<br>')}</td></tr></table>` : '';
  const site = b && b.site ? b.site : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#eef2f7;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7"><tr><td align="center" style="padding:22px 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden"><tr><td style="background:${c1};background-image:linear-gradient(135deg,${c1},${c2});padding:26px 30px"><div style="font-size:22px;font-weight:bold;color:#ffffff">${hx((b && b.name) || '')}</div>${site ? `<div style="font-size:13px;color:#e2e8f0;margin-top:4px">${hx(site.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</div>` : ''}</td></tr><tr><td style="padding:28px 30px 22px">${parts}${sigHtml}</td></tr><tr><td style="background:#f1f5f9;padding:14px 30px;font-size:12px;color:#64748b;text-align:center">${hx((b && b.name) || '')}${site ? ` &middot; ${link(site)}` : ''}${b && b.contact ? `<br>${hx(b.contact)}` : ''}</td></tr></table></td></tr></table></body></html>`;
}

// every URL in a mail must start with one of the brand's approved links
function badLinks(body, b) {
  const ok = [b.site, b.apply, b.conf, ...Object.values(b.services || {})].filter(Boolean).map((u) => u.replace(/\/+$/, ''));
  return (body.match(/https?:\/\/[^\s)>\]"']+/g) || []).filter((u) => !ok.some((o) => u.replace(/\/+$/, '').toLowerCase() === o.toLowerCase() || u.toLowerCase().startsWith(o.toLowerCase() + '/')));
}

// ---- scan ----
// rebuild a pending first-mail draft from the CURRENT templates (old drafts keep the wording they were created with)
function regen(id, by, keepEdited) {
  const r = db.prepare('SELECT * FROM closure_drafts WHERE id=?').get(id);
  if (!r || r.status !== 'draft' || r.seq !== 0) throw new Error('Draft nahi mila');
  const b = brands()[r.brand]; if (!b) throw new Error('Brand pehchana nahi gaya');
  const svc = r.svc_url ? { name: r.svc_name, url: r.svc_url } : null;
  const intent = r.intent === 'service' && !svc ? 'register' : r.intent;
  const m = withLearned(compose(b, intent, r.to_name, 0, svc), r.brand, b, intent, r.to_name, svc);
  if (badLinks(m.body, b).length) throw new Error('Link approved list me nahi hai');
  if (m.subject === r.subject && m.body === r.body) return false;
  db.prepare('UPDATE closure_drafts SET subject=?, body=?' + (keepEdited ? '' : ', edited=0') + ' WHERE id=?').run(m.subject, m.body, id);
  log(by || 'closure', 'closure_regen', String(id)); return true;
}
function regenFresh() { // untouched drafts only (nobody edited them) - safe to refresh automatically
  let n = 0;
  for (const r of db.prepare("SELECT id FROM closure_drafts WHERE status='draft' AND seq=0 AND edited=0").all()) { try { if (regen(r.id, 'auto', true)) n++; } catch (_) { /* keep as is */ } }
  return n;
}

async function scan() {
  regenFresh();
  const B = brands(), c = cfg(), since = Date.now() - c.days * 86400000;
  const tasks = (await zoho.listTasks()).filter((t) => /inquiry|enquiry/i.test(t.Subject || '') && new Date(t.Created_Time || Date.now()).getTime() >= since);
  const ins = db.prepare(`INSERT OR IGNORE INTO closure_drafts(task_id,seq,task_subject,brand,intent,contact_id,to_name,to_email,customer_msg,subject,body,status,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  let made = 0, needs = 0;
  for (const t of tasks) {
    if (db.prepare('SELECT 1 FROM closure_drafts WHERE task_id=? AND seq=0').get(String(t.id))) continue;
    const p = parse(t), bk = brandKey(p.brandRaw, t.Subject), b = B[bk];
    let k = classify(p, t.Subject, bk);
    if (k.intent !== 'needs_reply') {
      if (!b) k = { intent: 'needs_reply', reason: 'Brand pehchana nahi gaya' };
      else if (!p.email) k = { intent: 'needs_reply', reason: 'Customer ka email nahi mila' };
    }
    if (k.intent === 'needs_reply') { ins.run(String(t.id), 0, t.Subject, bk, 'needs_reply', t.Who_Id?.id || '', p.name, p.email, p.msg, '', '', 'needs_reply', k.reason); needs++; continue; }
    const m = withLearned(compose(b, k.intent, p.name, 0, k.svc), bk, b, k.intent, p.name, k.svc), bad = badLinks(m.body, b);
    if (bad.length) { ins.run(String(t.id), 0, t.Subject, bk, 'needs_reply', t.Who_Id?.id || '', p.name, p.email, p.msg, '', '', 'needs_reply', 'Unapproved link: ' + bad.join(', ')); needs++; continue; }
    ins.run(String(t.id), 0, t.Subject, bk, k.intent, t.Who_Id?.id || '', p.name, p.email, p.msg, m.subject, m.body, 'draft', ''); if (k.svc) db.prepare('UPDATE closure_drafts SET svc_name=?, svc_url=? WHERE task_id=? AND seq=0').run(k.svc.name, k.svc.url, String(t.id)); made++;
  }
  log('closure', 'scan', `${tasks.length} enquiry tasks, ${made} drafts, ${needs} needs-reply`);
  return { scanned: tasks.length, drafts: made, needs_reply: needs };
}

// staff says "this one is safe": build a draft for a needs-reply task (still needs Approve; links still whitelisted)
function force(id, by) {
  const r = db.prepare('SELECT * FROM closure_drafts WHERE id=?').get(id);
  if (!r || r.status !== 'needs_reply') throw new Error('Task nahi mila');
  const b = brands()[r.brand]; if (!b) throw new Error('Brand pehchana nahi gaya - draft nahi ban sakta');
  if (!r.to_email) throw new Error('Customer ka email nahi hai');
  const svc = matchService(r.brand, r.customer_msg);
  const intent = svc ? 'service' : /conference/i.test(r.task_subject + ' ' + r.customer_msg) ? 'conference' : 'register';
  const m = withLearned(compose(b, intent, r.to_name, 0, svc), r.brand, b, intent, r.to_name, svc);
  db.prepare("UPDATE closure_drafts SET intent=?, subject=?, body=?, status='draft', reason='Aapne khud draft banwaya', edited=1, svc_name=?, svc_url=? WHERE id=?").run(intent, m.subject, m.body, svc ? svc.name : null, svc ? svc.url : null, id);
  log(by, 'closure_force', String(id)); return { ok: true };
}

function list() {
  const rows = db.prepare(`SELECT * FROM closure_drafts WHERE status IN ('draft','needs_reply','sent') ORDER BY CASE status WHEN 'draft' THEN 0 WHEN 'needs_reply' THEN 1 ELSE 2 END, id DESC LIMIT 200`).all();
  return { dry: MODE.isDry(), smtp: smtpReady(), need: NEED, cap: DAILY_CAP, trust: trustList(), senders: senderInfo(), learned: learnedList(), cfg: cfg(), brands: brands(), rows };
}

function edit(id, subject, body) {
  const r = db.prepare('SELECT * FROM closure_drafts WHERE id=?').get(id);
  if (!r || r.status !== 'draft') throw new Error('Draft nahi mila');
  const bad = badLinks(String(body || ''), brands()[r.brand] || {});
  if (bad.length) throw new Error('Yeh link approved list me nahi hai: ' + bad.join(', '));
  const ns = String(subject || r.subject).slice(0, 300), nb = String(body || r.body).slice(0, 8000);
  db.prepare('UPDATE closure_drafts SET subject=?, body=?, edited=CASE WHEN subject!=? OR body!=? THEN 1 ELSE edited END WHERE id=?').run(ns, nb, ns, nb, id);
}
function skip(id, by) { const r = db.prepare('SELECT * FROM closure_drafts WHERE id=?').get(id); if (r && r.status === 'draft' && r.seq === 0) bump(tkey(r), false); db.prepare("UPDATE closure_drafts SET status='skipped' WHERE id=? AND status IN ('draft','needs_reply')").run(id); log(by, 'closure_skip', String(id)); }

// Approve & send. In TEST mode nothing is sent, nothing is closed.
// send the draft to the staff member's OWN address to see the real mail and the real sending mailbox (no customer, no status change, no Zoho change)
async function testSend(id, to, by) {
  const r = db.prepare('SELECT * FROM closure_drafts WHERE id=?').get(id);
  if (!r || !r.body) throw new Error('Draft nahi mila');
  const addr = String(to || '').trim();
  if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(addr)) throw new Error('Sahi email likho');
  const b = brands()[r.brand]; if (!b) throw new Error('Brand nahi mila');
  const bad = badLinks(r.body, b); if (bad.length) throw new Error('Unapproved link: ' + bad.join(', '));
  if (MODE.isDry()) return { sent: false, dry: true };
  const si = senderInfo()[r.brand];
  await send({ action_type: 'email', to_email: addr, subject: '[TEST] ' + r.subject, body: r.body, html: toHtml(r.body, b, r.brand), brand: r.brand, from: cfg().from[r.brand] || undefined });
  log(by, 'closure_testsend', `draft ${id} -> ${addr}`);
  return { sent: true, from: si && si.address || process.env.SMTP_USER || '', own: !!(si && si.own) };
}
async function approve(id, by, auto) {
  const r = db.prepare('SELECT * FROM closure_drafts WHERE id=?').get(id);
  if (!r || r.status !== 'draft') throw new Error('Draft nahi mila ya pehle hi ho chuka');
  const b = brands()[r.brand]; if (!b) throw new Error('Brand nahi mila');
  const bad = badLinks(r.body, b); if (bad.length) throw new Error('Unapproved link: ' + bad.join(', '));
  if (!r.to_email) throw new Error('Email nahi hai');
  if (r.seq > 0 && await applied(r.contact_id)) { db.prepare("UPDATE closure_drafts SET status='skipped', reason='Customer ne apply kar diya' WHERE id=?").run(id); throw new Error('Customer ne apply kar diya - follow-up nahi bheja'); }
  if (!auto) learnFrom(r, by);
  if (r.seq === 0 && !auto && !r.counted) { bump(tkey(r), !r.edited); db.prepare('UPDATE closure_drafts SET counted=1 WHERE id=?').run(id); }
  if (MODE.isDry()) { log(by, 'closure_test', `task ${r.task_id} -> ${r.to_email} (TEST: mail gayi nahi)`); return { sent: false, dry: true }; }
  await send({ action_type: 'email', to_email: r.to_email, subject: r.subject, body: r.body, html: toHtml(r.body, brands()[r.brand], r.brand), brand: r.brand, from: cfg().from[r.brand] || undefined });
  const next = r.seq < 3 ? new Date(Date.now() + 5 * 86400000).toISOString() : null;
  db.prepare("UPDATE closure_drafts SET status='sent', sent_at=CURRENT_TIMESTAMP, next_followup=?, auto=? WHERE id=?").run(next, auto ? 1 : 0, id);
  if (auto) db.prepare('UPDATE closure_trust SET auto_sent=auto_sent+1 WHERE k=?').run(tkey(r));
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
    const m = compose(b, root.intent, root.to_name, seq, { name: root.svc_name, url: root.svc_url });
    if (badLinks(m.body, b).length) continue;
    db.prepare(`INSERT OR IGNORE INTO closure_drafts(task_id,seq,task_subject,brand,intent,contact_id,to_name,to_email,customer_msg,subject,body,status,svc_name,svc_url) VALUES(?,?,?,?,?,?,?,?,?,?,?,'draft',?,?)`).run(r.task_id, seq, root.task_subject, root.brand, root.intent, root.contact_id, root.to_name, root.to_email, root.customer_msg, m.subject, m.body, root.svc_name, root.svc_url);
    db.prepare('UPDATE closure_drafts SET next_followup=NULL WHERE id=?').run(r.id); n++;
    // follow-ups of a mail that was already approved go out by themselves (Edwin: no need to ask)
    const fu = db.prepare('SELECT * FROM closure_drafts WHERE task_id=? AND seq=?').get(r.task_id, seq);
    if (fu && fu.status === 'draft' && canAuto(fu)) { try { await approve(fu.id, 'auto', true); } catch (e) { log('closure', 'auto_error', fu.task_id + ' ' + e.message); } }
  }
  return n;
}
async function autoSend() {
  let n = 0;
  for (const r of db.prepare("SELECT * FROM closure_drafts WHERE status='draft' AND seq=0 AND edited=0 ORDER BY id").all()) {
    const t = trust(tkey(r)); if (!t.enabled || t.streak < NEED || !canAuto(r)) continue;
    try { await approve(r.id, 'auto', true); n++; } catch (e) { log('closure', 'auto_error', r.task_id + ' ' + e.message); }
  }
  return n;
}
const autoRun = async () => { if (AS.getSetting('closure_auto', '1') !== '1') return; await scan(); await autoSend(); await tick(); };
function setTrust(k, enabled) { trust(k); db.prepare('UPDATE closure_trust SET enabled=? WHERE k=?').run(enabled ? 1 : 0, k); }
function trustList() { return db.prepare('SELECT * FROM closure_trust ORDER BY k').all().map((t) => ({ ...t, trusted: t.streak >= NEED, today: autoToday(t.k) })); }

const preview = (body, brand) => toHtml(body, brands()[brand], brand);
module.exports = { learnedList, forgetLearned, regen, regenFresh, testSend, preview, servicesView, setServices, matchService, force, setTrust, autoSend, _t: { toHtml, parse, classify, brandKey, compose, badLinks }, scan, list, edit, skip, approve, tick, autoRun, setBrands, setCfg, brands, cfg };
