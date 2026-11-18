// AI Caller for CALLING tasks: a person approves, then the Edwin Dialer AI caller phones the customer using the task's
// Customer Summary + Calling Script as context; the result is written back to the Zoho task (note) and the task is closed
// only when the customer actually answered. OFF until DIALER_URL / DIALER_API_KEY / DIALER_AI_PROFILE_ID are set.
// Safety: calling hours 09:00-21:00 IST, daily cap, never for money/complaint/certificate tasks, blocked by staff notes (paid, not interested...).
const zoho = require('./zoho');
const AS = require('./assign');
const { db, log } = require('./db');
const MODE = require('./mode');
const CL = require('./closure');

db.exec(`CREATE TABLE IF NOT EXISTS aicall_queue (
  id INTEGER PRIMARY KEY, task_id TEXT UNIQUE, subject TEXT, contact_id TEXT, to_name TEXT, to_phone TEXT, brand TEXT,
  context TEXT, story TEXT, status TEXT DEFAULT 'draft', reason TEXT, dialer_id TEXT, outcome TEXT, summary TEXT,
  approved_by TEXT, phone_src TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, called_at TEXT, done_at TEXT);`);

try { db.exec('ALTER TABLE aicall_queue ADD COLUMN phone_src TEXT'); } catch (_) { /* already there */ }
const DEFAULT_KEYWORDS = 'call, calling, follow up, followup, follow-up, ask for fee, ask fee, missed call, callback, thanks call, thank you call, thankyou call';
const ACTIVE = ['queued', 'dialing', 'ringing', 'in_progress'];
const CLOSE_OUTCOMES = ['interested', 'not_interested', 'wrong_number', 'do_not_call', 'question_answered'];
const OUTCOME_LABEL = { interested: 'Interested', callback: 'Call back later', not_interested: 'Not interested', wrong_number: 'Wrong number', do_not_call: 'Do not call', transferred: 'Transferred to agent', no_decision: 'No decision', question_answered: 'Question answered', message_taken: 'Message taken', spam: 'Spam' };

const cfg = () => {
  const url = String(process.env.DIALER_URL || '').replace(/\/+$/, ''), key = String(process.env.DIALER_API_KEY || ''), profile = Number(process.env.DIALER_AI_PROFILE_ID || 0);
  return {
    url, ready: !!(url && key && profile), profile,
    keywords: AS.getSetting('aicall_keywords', DEFAULT_KEYWORDS), days: Math.max(1, +AS.getSetting('aicall_days', '3') || 3),
    cap: Math.max(1, +AS.getSetting('aicall_cap', '30') || 30), auto: AS.getSetting('aicall_auto', '0') === '1', need: 5
  };
};
function setCfg(c) {
  if (typeof c.keywords === 'string') AS.setSetting('aicall_keywords', c.keywords.slice(0, 400));
  if (c.days) AS.setSetting('aicall_days', String(Math.min(30, Math.max(1, +c.days))));
  if (c.cap) AS.setSetting('aicall_cap', String(Math.min(200, Math.max(1, +c.cap))));
  if (c.auto !== undefined) AS.setSetting('aicall_auto', c.auto ? '1' : '0');
  return cfg();
}
const kwRe = () => { const w = cfg().keywords.split(',').map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]*')); return w.length ? new RegExp('\\b(' + w.join('|') + ')', 'i') : null; };
// "certificate verification" calls are allowed (we already sent the certificate; the call only confirms it reached them and the details are right) even though certificate tasks are otherwise staff-only
const CERT_VERIFY = /certificate[\s-]*verif|verif\w*[\s-]*(of[\s-]*)?certificate/i;
const isCallTask = (t) => { const s = t.Subject || '', re = kwRe(); return !!re && (re.test(s) || CERT_VERIFY.test(s)) && (!CL._t.RISK.test(s) || CERT_VERIFY.test(s)) && !/inquiry|enquiry/i.test(s) && !/^(whatsapp\b|interakt lead for)/i.test(s) && t.Status !== 'Completed'; };


// All phone numbers of a Contact/Lead record (Mobile first, then Phone, then any other *phone*/*mobile* field), then the "Phone:" line of the task description.
function pickNumbers(record, description) {
  const out = [], seen = new Set();
  const add = (src, v) => { const e = toE164(v); const k = e.slice(-10); if (e && /^\+\d{11,15}$/.test(e) && !seen.has(k)) { seen.add(k); out.push({ src, phone: e }); } };
  const r = record || {};
  add('Mobile', r.Mobile); add('Phone', r.Phone);
  for (const k of Object.keys(r)) if (/phone|mobile/i.test(k) && !['Mobile', 'Phone'].includes(k) && typeof r[k] === 'string') add(k, r[k]);
  for (const m of String(description || '').matchAll(/(?:phone|mobile|contact|whatsapp)[^\d+\n]{0,12}(\+?[\d][\d\s-]{8,16}\d)/gi)) add('task description', m[1]);
  return out;
}

const istHour = () => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date()); return p; };
const inHours = () => { const h = istHour(); return h >= '09:00' && h < '21:00'; };
const toE164 = (m) => { const d = String(m || '').replace(/\D/g, ''); if (d.length === 10) return '+91' + d; if (d.length === 11 && d[0] === '0') return '+91' + d.slice(1); return d.length >= 11 ? '+' + d : ''; };

// the calling script boxes -> plain steps for the AI (fee block is dropped: the AI must never quote a fee)
function scriptDigest(sc) {
  const clean = String(sc || '').replace(/[╔╗╚╝║╠╣═─•]/g, ' ').replace(/https?:\/\/\S+/g, '').replace(/[ \t]+/g, ' ');
  const out = [];
  for (const m of clean.matchAll(/(\d)\)\s*([A-Z]+)\s*-\s*([^\n]*)\n([\s\S]*?)(?=\n\s*\d\)\s*[A-Z]+\s*-|\s*$)/g)) {
    if (m[2] === 'FEE') continue;
    out.push(`${m[2]}: ${m[4].replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim()}`);
  }
  return out.join('\n').slice(0, 800);
}
// "Certificate verification" calls: the certificate was ALREADY emailed. The call only informs the candidate; it never resends, never quotes anything.
const CERT_FLOW = (name) => [
  'CALL FLOW (follow in order):',
  `1) First ask only: are you speaking with ${name || 'the candidate'}? Continue only after a clear yes. If someone else answers, share nothing: ask when ${name || 'the candidate'} will be free, note it, say thanks and end the call. If it is a wrong number, record wrong_number and end.`,
  '2) Say in one sentence why you are calling: we have already sent your certificate to your registered email address.',
  '3) Ask them to please check their email inbox, and also the spam / junk folder, for that email.',
  '4) Ask them to reply on the same email to confirm they received it and that their name and details on the certificate are correct, or to tell us what needs to be corrected.',
  '5) If they say they cannot find it, or want it resent or changed, say the team will look into it and email them; record it. Do not promise a time. You are an AI assistant and cannot send emails or links yourself.',
  '6) Never discuss fees, payment, refunds or complaints (say the team will call back). Thank them and end the call politely.'
].join('\n');
function buildContext(summary, script, subject, name, desc) {
  if (CERT_VERIFY.test(String(subject || ''))) return [CERT_FLOW(name), subject ? 'TASK SUBJECT: ' + String(subject).slice(0, 200) : ''].filter(Boolean).join('\n\n').slice(0, 1990);
  const head = [
    'CALL FLOW (follow in order):',
    `1) First ask only: are you speaking with ${name || 'the customer'}? Continue only after a clear yes. If someone else answers, do not share anything: ask when ${name || 'the customer'} will be free, note it, say thanks and end the call. If it is a wrong number, record wrong_number and end.`,
    '2) Say in one sentence why you are calling, from the TASK SUBJECT below (e.g. "you had asked about our conference").',
    '3) Talk using the CALL SCRIPT and the facts below; answer their questions only from these. Do not read facts out like a list.',
    '4) If they ask something not covered (or about fees/payment/complaints), say the team will confirm and will call back; record it. Never quote a fee. You are an AI assistant and cannot send messages or links yourself - say the team will send details.'
  ].join('\n');
  const story = CL._t.storyOf(summary).split('\n').filter((l) => !/^4\./.test(l)).join('\n').slice(0, 800); // point 4 = fees/payment: never given to the AI
  const sd = scriptDigest(script);
  const em = /CUSTOMER'S EMAIL:\s*([^\n]+)/.exec(String(desc || '')), mail = em && !/^\(reply ka text/.test(em[1]) ? em[1].slice(0, 600) : '';
  const mailNote = mail ? 'THE CUSTOMER REPLIED TO OUR CONFERENCE EMAIL. Their email said: ' + mail + '\nThis call is to resolve exactly that query: answer it only from the facts below; anything else (fees, payment, complaints) the team will call back.' : '';
  return [head, subject ? 'TASK SUBJECT: ' + String(subject).slice(0, 200) : '', mailNote, story, sd ? 'CALL SCRIPT:\n' + sd : ''].filter(Boolean).join('\n\n').slice(0, 1990);
}

async function scan() {
  // rows that were parked only for a missing number are rebuilt (numbers are now also read from Leads and every phone field)
  db.prepare("DELETE FROM aicall_queue WHERE status IN ('needs_reply','nophone') AND (reason LIKE '%number nahi mila%' OR reason LIKE '%summary padh nahi%')").run();
  const tasks = (await zoho.listTasks()).filter((t) => isCallTask(t)
    && !db.prepare('SELECT 1 FROM aicall_queue WHERE task_id=?').get(String(t.id)) && !db.prepare('SELECT 1 FROM closure_drafts WHERE task_id=?').get(String(t.id)));
  const ins = db.prepare('INSERT OR IGNORE INTO aicall_queue(task_id,subject,contact_id,to_name,to_phone,brand,context,story,status,reason,phone_src) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  let made = 0, needs = 0, nophone = 0;
  for (const t of tasks.slice(0, 60)) {
    const cid = t.Who_Id?.id || '', bk = CL._t.brandKey(t.Dept_Name || '', t.Subject);
    let name = t.Who_Id?.name || '', nums = [], ctx = null, lookupErr = '';
    try { const p = await zoho.getPersonPhones(cid); if (p) { name = name || p.name; nums = pickNumbers(p.record, ''); } } catch (e) { lookupErr = String((e && e.message) || e).slice(0, 80); }
    if (!nums.length) nums = pickNumbers({}, t.Description);
    try { ctx = await zoho.taskContext(t.id); } catch (_) { /* below */ }
    const sum = ctx?.Customer_Summary || '', script = ctx?.Calling_Script_English || '', story = CL._t.storyOf(sum), flags = CL._t.ctxFlags(sum);
    const first = nums[0] || { phone: '', src: '' };
    if (flags.block.length) { ins.run(String(t.id), t.Subject, cid, name, first.phone, bk, '', story, 'needs_reply', flags.block.join('; ') + ' - staff khud call kare', first.src); needs++; continue; }
    const warn = [...flags.warn, ...(ctx ? [] : ['Task ki summary padh nahi payi - AI ko sirf task ka subject milega']), ...(nums.length > 1 ? ['Aur numbers bhi mile: ' + nums.slice(1).map((n) => n.phone).join(', ')] : [])].join(' | ');
    const context = buildContext(sum, script, t.Subject, name, ctx?.Description || t.Description);
    if (!first.phone) { ins.run(String(t.id), t.Subject, cid, name, '', bk, context, story, 'nophone', 'Customer ka number nahi mila' + (lookupErr ? ' (' + lookupErr + ')' : '') + ' - neeche number daalo', ''); nophone++; continue; }
    ins.run(String(t.id), t.Subject, cid, name, first.phone, bk, context, story, 'draft', warn, first.src); made++;
  }
  log('aicall', 'scan', `${tasks.length} calling tasks, ${made} ready, ${nophone} need a number, ${needs} staff`);
  return { calling_tasks: tasks.length, ready: made, nophone, staff: needs };
}
// staff types the number for a task that had none
function setPhone(id, phone, by) {
  const e = toE164(phone); if (!/^\+\d{11,15}$/.test(e)) throw new Error('Number sahi nahi hai (10 digit mobile ya +country code)');
  const r = db.prepare('SELECT * FROM aicall_queue WHERE id=?').get(id);
  if (!r || !['nophone', 'draft'].includes(r.status)) throw new Error('Is task ka number ab badla nahi ja sakta');
  db.prepare("UPDATE aicall_queue SET to_phone=?, phone_src='staff ne daala', status='draft', reason='' WHERE id=?").run(e, id);
  log(by, 'aicall_phone', `task ${r.task_id} -> ${e}`);
  return { phone: e };
}

async function dialer(method, path, body) {
  const c = cfg(); if (!c.ready) throw new Error('Dialer ka connection set nahi hai (DIALER_URL / DIALER_API_KEY / DIALER_AI_PROFILE_ID)');
  const r = await fetch(c.url + path, { method, headers: { Authorization: 'Bearer ' + process.env.DIALER_API_KEY, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Dialer ' + r.status + ': ' + String(j.error || '').slice(0, 160));
  return j;
}
const callsToday = () => db.prepare("SELECT COUNT(*) n FROM aicall_queue WHERE called_at >= ?").get(new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace('T', ' ')).n;

async function approve(id, by) {
  const r = db.prepare('SELECT * FROM aicall_queue WHERE id=?').get(id);
  if (!r || r.status !== 'draft') throw new Error('Ye call ab approve nahi ho sakti');
  const c = cfg();
  if (!c.ready) throw new Error('Dialer ka connection set nahi hai - pehle setdialer.sh chalao');
  if (MODE.isDry()) { log(by, 'aicall_test', `task ${r.task_id} -> ${r.to_phone} (TEST: call lagi nahi)`); return { called: false, dry: true }; }
  if (!inHours()) throw new Error('AI call sirf subah 9 se raat 9 baje ke beech lagti hai (abhi ' + istHour() + ' IST)');
  if (callsToday() >= c.cap) throw new Error('Aaj ki limit (' + c.cap + ' call) poori ho gayi');
  const j = await dialer('POST', '/api/v1/ai-calls', { profileId: c.profile, to: r.to_phone, name: r.to_name, context: r.context, crm: { module: 'Contacts', recordId: r.contact_id } });
  db.prepare("UPDATE aicall_queue SET status='calling', dialer_id=?, approved_by=?, called_at=CURRENT_TIMESTAMP WHERE id=?").run(j.data?.id || '', by, id);
  log(by, 'aicall_start', `task ${r.task_id} -> ${r.to_phone}`);
  return { called: true, dialer_id: j.data?.id };
}

async function finish(r, call) {
  const out = call.outcome || '', label = OUTCOME_LABEL[out] || (call.status === 'completed' ? 'Baat hui' : call.status);
  const text = `AI call (${call.status}${out ? ', ' + label : ''}).\n${call.summary ? 'Summary: ' + call.summary : ''}${call.callbackAt ? '\nCallback: ' + call.callbackAt : ''}`.trim();
  let closed = false;
  try { await zoho.addNote('Tasks', r.task_id, 'AI call result', text); } catch (_) { /* note is best-effort; the result stays in the portal */ }
  if (call.status === 'completed' && CLOSE_OUTCOMES.includes(out)) { try { await zoho.closeTask(r.task_id, 'AI call: ' + label + (call.summary ? ' - ' + call.summary : '')); closed = true; } catch (_) { /* staff will close */ } }
  db.prepare("UPDATE aicall_queue SET status=?, outcome=?, summary=?, done_at=CURRENT_TIMESTAMP, reason=? WHERE id=?")
    .run(closed ? 'closed' : 'done', out, String(call.summary || '').slice(0, 1500), closed ? '' : (call.status === 'completed' ? 'Task khula hai - staff dekhe (' + label + ')' : 'Customer tak baat nahi pahunchi (' + call.status + ') - staff dekhe'), r.id);
  log('aicall', 'finish', `task ${r.task_id}: ${call.status} ${out}`);
}
async function poll() {
  let n = 0;
  for (const r of db.prepare("SELECT * FROM aicall_queue WHERE status='calling' AND dialer_id<>'' LIMIT 30").all()) {
    let j; try { j = (await dialer('GET', '/api/v1/ai-calls/' + encodeURIComponent(r.dialer_id))).data; } catch (_) { continue; }
    if (!j || ACTIVE.includes(j.status)) continue;
    await finish(r, j); n++;
  }
  return n;
}
function skip(id, by) { db.prepare("UPDATE aicall_queue SET status='skipped' WHERE id=? AND status IN ('draft','needs_reply','nophone')").run(id); log(by, 'aicall_skip', String(id)); }
function list() {
  const rows = db.prepare("SELECT * FROM aicall_queue WHERE status IN ('draft','nophone','needs_reply','calling','done','closed') ORDER BY CASE status WHEN 'draft' THEN 0 WHEN 'nophone' THEN 1 WHEN 'calling' THEN 2 WHEN 'needs_reply' THEN 3 ELSE 3 END, id DESC LIMIT 400").all();
  return { dry: MODE.isDry(), cfg: cfg(), today: callsToday(), hours: inHours(), rows };
}
module.exports = { scan, approve, poll, skip, setPhone, list, setCfg, cfg, _t: { pickNumbers, CERT_VERIFY, isCallTask, buildContext, scriptDigest, toE164 } };
