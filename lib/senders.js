// Email (SMTP), Letter (PDF attached to email) and WhatsApp (Interakt API) senders.
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

async function send(item) {
  if ((MODE.isDry() || DRY_DEMO)) return { dry: true };
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  if (item.action_type === 'email') {
    if (!item.to_email) throw new Error('No email address on the contact');
    await mailer().sendMail({ from, to: item.to_email, subject: item.subject, text: item.body });
  } else if (item.action_type === 'letter') {
    if (!item.to_email) throw new Error('No email address on the contact');
    const pdf = await letterPdf(item.subject, item.body);
    await mailer().sendMail({ from, to: item.to_email, subject: item.subject, text: 'Please find the attached letter.', attachments: [{ filename: 'letter.pdf', content: pdf }] });
  } else if (item.action_type === 'whatsapp') {
    const ph = normPhone(item.to_phone);
    if (!ph) throw new Error('No phone number on the contact');
    // Interakt: session message API. Adjust to your Interakt plan/template setup.
    const r = await fetch('https://api.interakt.ai/v1/public/message/', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + process.env.INTERAKT_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ countryCode: '+' + ph.slice(0, ph.length - 10), phoneNumber: ph.slice(-10), type: 'Text', data: { message: item.body } }),
    });
    if (!r.ok) throw new Error('Interakt ' + r.status + ': ' + (await r.text()).slice(0, 200));
  } else throw new Error('Unknown action ' + item.action_type);
  return { ok: true };
}

module.exports = { send };
