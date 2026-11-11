// Rule-based (no-AI) email analysis and workflow analysis.

const CATS = [
  ['not_interested', /not interested|unsubscribe|stop (sending|mailing)|remove me|do not (email|contact)/i],
  ['payment_done', /(payment|paid|transferred|transaction|utr|receipt).{0,40}(done|made|completed|sent|attached)|i have paid|amount (has been )?(paid|transferred)/i],
  ['paper_submitted', /(paper|manuscript|abstract|full text|article).{0,40}(attached|submit|submitted|sending|enclosed)/i],
  ['interested', /\binterested\b|share (the )?details|more details|please (send|share)|kindly (send|share)|want to (attend|participate|join)/i],
  ['query', /\?|how (much|to)|what is|when (is|will)|can you|could you/i],
];

function classify(subject, body) {
  const text = `${subject}\n${body}`;
  for (const [cat, re] of CATS) if (re.test(text)) return cat;
  return 'other';
}

function extract(subject, body) {
  const text = `${subject}\n${body}`;
  const phone = (text.match(/(?:\+?\d{1,3}[\s-]?)?(?:\d[\s-]?){10,12}/) || [])[0];
  const amount = (text.match(/(?:rs\.?|inr|₹|usd|\$)\s?([\d,]+(?:\.\d+)?)/i) || [])[1];
  const date = (text.match(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/) || [])[0];
  const utr = (text.match(/\b(?:utr|ref(?:erence)?(?: no\.?)?)[:\s#-]*([A-Z0-9]{8,22})/i) || [])[1];
  return { phone: phone && phone.replace(/[^\d+]/g, ''), amount, date, utr };
}

// Proposed CRM updates per category. Each proposal is applied only after approval.
function propose(cat, from, subject, ex) {
  const p = [{ type: 'note', title: `Email: ${subject}`.slice(0, 120), content: `Category: ${cat}\nFrom: ${from}` }];
  if (ex.phone) p.push({ type: 'field', field: 'Mobile', value: ex.phone, label: 'Update mobile number' });
  if (cat === 'interested') p.push({ type: 'field', field: 'Lead_Status', value: 'Contacted', label: 'Lead status → Contacted' }, { type: 'task', subject: 'Share details with interested contact', label: 'Create follow-up task' });
  if (cat === 'payment_done') p.push({ type: 'task', subject: `Verify payment${ex.amount ? ' ' + ex.amount : ''}${ex.utr ? ' UTR ' + ex.utr : ''}`, label: 'Create payment verification task' });
  if (cat === 'paper_submitted') p.push({ type: 'task', subject: 'Review submitted paper', label: 'Create paper review task' });
  if (cat === 'not_interested') p.push({ type: 'field', field: 'Email_Opt_Out', value: true, label: 'Mark email opt-out' });
  if (cat === 'query') p.push({ type: 'task', subject: 'Reply to customer query', label: 'Create reply task' });
  return p;
}

function analyzeWorkflows(list) {
  const rows = list.map((w) => ({
    id: w.id, name: w.name, module: w.module?.api_name || w.module || '',
    active: !!(w.status?.active ?? w.active),
    trigger: w.execute_when?.type || '',
    last: w.last_executed_time || w.execution_time || null,
    actions: (w.actions || []).length || (w.actions_count ?? 0),
  }));
  const issues = [];
  const key = (r) => `${r.module}|${r.trigger}`;
  const groups = {};
  rows.forEach((r) => { if (r.active) (groups[key(r)] = groups[key(r)] || []).push(r); });
  for (const r of rows) {
    r.flags = [];
    if (!r.active) r.flags.push('Inactive');
    if (r.active && !r.actions) r.flags.push('No actions');
    if (r.active && !r.last) r.flags.push('Never executed');
    if (r.active && groups[key(r)].length > 1) r.flags.push(`Overlaps with ${groups[key(r)].length - 1} other rule(s) on ${r.module}/${r.trigger}`);
  }
  rows.forEach((r) => r.flags.forEach((f) => issues.push({ workflow: r.name, issue: f })));
  return { total: rows.length, active: rows.filter((r) => r.active).length, rows, issues };
}

module.exports = { classify, extract, propose, analyzeWorkflows };
