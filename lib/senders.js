// Email (SMTP), Letter (PDF attached to email) and WhatsApp (connect.delhicrestenterprise.com API) senders.
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');

const MODE = require('./mode');
const DRY_DEMO = process.env.DEMO === '1';

let transporter;
function mailer() {
  if (!transporter) transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: +(process.env.SMTP_PORT || 465),
    secure: (process.env.SMTP_SECURE || '1') === '1',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

function letterPdf(subject, body) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 60 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks)));
    doc.fontSize(16).text(process.env.LETTER_HEADER || 'Edwin Incorporation', { align: 'center' });
    doc.moveDown().fontSize(10).text(new Date().toLocaleDateString('en-IN'), { align: 'right' });
    doc.moveDown().fontSize(12).text(subject, { underline: true });
    doc.moveDown().fontSize(11).text(body, { lineGap: 3 });
    doc.end();
  });
}

function normPhone(p) {
  const d = String(p || '').replace(/[^\d]/g, '');
  if (!d) return null;
  return d.length === 10 ? '91' + d : d;
}

// Brand-wise mailboxes (the same mailboxes that are connected in DCE Express). The provider keeps a copy in Sent, so DCE Express shows it too.
// env: SMTP_<P>_USER / SMTP_<P>_PASS [/ _HOST / _PORT]; a brand without its own mailbox falls back to the default SMTP_* account.
const PREFIX = { 'edwin conference': 'EDWINCO', 'edwin inc': 'EDWININC', 'delhi crest': 'DELHICREST' };
const NAMES = { 'edwin conference': 'Edwin Conference', 'edwin inc': 'Edwin Incorporation', 'delhi crest': 'Delhi-Crest Enterprise' };
const bt = {};
function brandMailbox(brand) {
  const p = PREFIX[brand]; if (!p) return null;
  const user = process.env['SMTP_' + p + '_USER'], pass = process.env['SMTP_' + p + '_PASS'];
  if (!user || !pass) return null;
  const host = process.env['SMTP_' + p + '_HOST'] || (/delhicrestenterprise\.com$/i.test(user) ? 'smtp.zoho.in' : 'smtp.gmail.com');
  return { prefix: p, user, pass, host, port: +(process.env['SMTP_' + p + '_PORT'] || 465) };
}
function transportFor(brand) {
  const m = brandMailbox(brand);
  if (!m) { // no own mailbox: default address, but the brand name as display name
    const addr = process.env.SMTP_USER || ''; const nm = NAMES[brand] || (brand ? String(brand).replace(/\b\w/g, (c) => c.toUpperCase()) : '');
    return { t: mailer(), from: nm && addr ? `${nm} <${addr}>` : null };
  }
  if (!bt[m.prefix + m.user]) bt[m.prefix + m.user] = nodemailer.createTransport({ host: m.host, port: m.port, secure: m.port === 465, auth: { user: m.user, pass: m.pass } });
  return { t: bt[m.prefix + m.user], from: `${NAMES[brand]} <${m.user}>` };
}
const senderInfo = () => Object.fromEntries(Object.keys(PREFIX).map((b) => { const m = brandMailbox(b); return [b, { prefix: PREFIX[b], address: m ? m.user : (process.env.SMTP_USER || ''), own: !!m }]; }));


// WhatsApp goes through connect.delhicrestenterprise.com (Meta Cloud API). One API key (CONNECT_API_KEY in .env), one "account code" per brand number.
// brand key -> connect account code. Override from the portal setting wa_connect_accounts, e.g. {"sama":"sama"}.
const CONNECT_URL = () => (process.env.CONNECT_API_URL || 'https://connect.delhicrestenterprise.com').replace(/\/$/, '');
const WA_ACCOUNTS = { 'delhi crest': 'delhi-crest-enterprises-0377', dya: 'dya-research-center-2167', 'edwin inc': 'dya', 'edwin conference': 'dya-research-center-2170', sama: 'sama' };
function waAccountFor(brand) {
  let over = {}; try { over = JSON.parse(require('./assign').getSetting('wa_connect_accounts', '{}')); } catch (_) { /* default */ }
  return over[brand] || WA_ACCOUNTS[brand] || '';
}
async function connectApi(method, path, body) {
  const key = process.env.CONNECT_API_KEY;
  if (!key) throw new Error('CONNECT_API_KEY .env me nahi hai (connect admin > API > New API key)');
  const r = await fetch(CONNECT_URL() + '/api/v1' + path, { method, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (_) { /* not json */ }
  if (!r.ok) {
    const why = (j && (j.error || j.message)) || txt.slice(0, 200);
    throw new Error(r.status === 409 ? 'Customer ne WhatsApp band (opt-out) kiya hai: ' + why : 'connect ' + r.status + ': ' + why);
  }
  return j;
}
let acctCache = null;
async function connectAccounts() {
  if (acctCache && Date.now() - acctCache.at < 300000) return acctCache.rows;
  const j = await connectApi('GET', '/accounts');
  const list = Array.isArray(j) ? j : (j && (j.accounts || j.data)) || [];
  const rows = list.map((a) => ({ code: String(a.code || a.slug || a.account || a.id || ''), number: a.number || a.phone || a.display_phone_number || '', status: String(a.status || '') }));
  acctCache = { at: Date.now(), rows }; return rows;
}
// which brands can send WhatsApp right now (no secrets): used for the portal card and auto-send
async function waBrands() {
  const out = {}; let rows = null, err = '';
  try { rows = await connectAccounts(); } catch (e) { err = String(e.message).slice(0, 120); }
  for (const b of Object.keys(WA_ACCOUNTS)) {
    const code = waAccountFor(b);
    if (err) { out[b] = { ok: false, error: err }; continue; }
    const hit = rows.find((r) => r.code === code);
    out[b] = hit && !/disconnect|attention|error/i.test(hit.status) ? { ok: true, account: code, number: hit.number } : { ok: false };
  }
  return out;
}

async function send(item) {
  if ((MODE.isDry() || DRY_DEMO)) return { dry: true };
  const from = item.from || process.env.MAIL_FROM || process.env.SMTP_USER;
  if (item.action_type === 'email') {
    if (!item.to_email) throw new Error('No email address on the contact');
    const tf = transportFor(item.brand);
    await tf.t.sendMail({ from: item.from || tf.from || from, to: item.to_email, subject: item.subject, text: item.body, ...(item.html ? { html: item.html } : {}) });
  } else if (item.action_type === 'letter') {
    if (!item.to_email) throw new Error('No email address on the contact');
    const pdf = await letterPdf(item.subject, item.body);
    await mailer().sendMail({ from, to: item.to_email, subject: item.subject, text: 'Please find the attached letter.', attachments: [{ filename: 'letter.pdf', content: pdf }] });
  } else if (item.action_type === 'whatsapp') {
    const ph = normPhone(item.to_phone);
    if (!ph) throw new Error('No phone number on the contact');
    const account = item.brand ? waAccountFor(item.brand) : (process.env.CONNECT_DEFAULT_ACCOUNT || '');
    if (!account) throw new Error('Is brand ka connect WhatsApp account set nahi hai (portal setting wa_connect_accounts ya CONNECT_DEFAULT_ACCOUNT)');
    // free text works only inside WhatsApp's 24-hour window (customer wrote in the last 24h); otherwise connect refuses and the error is shown
    await connectApi('POST', '/messages/text', { account, phone: ph, text: item.body });
  } else throw new Error('Unknown action ' + item.action_type);
  return { ok: true };
}

module.exports = { senderInfo, send, waBrands, waAccountFor, connectApi };
