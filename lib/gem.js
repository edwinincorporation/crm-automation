// GeM Tender helper: lists tenders from Zoho, builds up to 5 rate options, saves the chosen rate to Zoho (Our_Rate).
// It NEVER submits a bid on GeM. The GeM form is filled separately in the browser and stops before Submit.
const zoho = require('./zoho');
const AS = require('./assign');
const { log } = require('./db');
const DRY = process.env.DRY_RUN === '1';
const r2 = (n) => Math.round(n * 100) / 100;

const cfg = () => { try { return { gst: 18, dispatch: 120, cost: {}, ...JSON.parse(AS.getSetting('gem_cfg', '{}')) }; } catch (_) { return { gst: 18, dispatch: 120, cost: {} }; } };
function setCfg(c) {
  const o = cfg(), n = { gst: Math.min(28, Math.max(0, +c.gst || o.gst)), dispatch: Math.max(0, +c.dispatch >= 0 ? +c.dispatch : o.dispatch), cost: { ...o.cost, ...(c.cost || {}) } };
  AS.setSetting('gem_cfg', JSON.stringify(n)); return n;
}

// base = competitor unit rate (before GST); dispatch is ONE fixed charge for the whole order.
// total = (base*qty) * (1+gst) + dispatch ; never below cost*qty*(1+gst)+dispatch.
function options(qty, bases, cost) {
  const c = cfg(), q = Math.max(1, +qty || 1), floor = cost > 0 ? cost : 0;
  const seen = new Set(), out = [];
  for (const b of bases) {
    const base = Math.max(+b.rate, floor); // never quote below own cost
    const key = r2(base); if (!(base > 0) || seen.has(key)) continue; seen.add(key);
    const total = r2(base * q * (1 + c.gst / 100) + c.dispatch);
    out.push({ from: b.from, competitor_rate: +b.rate, unit_ex_gst: key, total_with_gst_dispatch: total, per_unit_all_in: r2(total / q), raised_to_cost: base > +b.rate });
  }
  return out.sort((a, b) => a.unit_ex_gst - b.unit_ex_gst).slice(0, 5);
}

async function list() {
  const c = cfg(), t = await zoho.gemTenders();
  const now = Date.now();
  const keep = (x) => x.Bid_Status === 'New' && (!x.Bid_End_Date || new Date(x.Bid_End_Date).getTime() > now) && !/not eligible/i.test(x.Eligibility || '');
  const open = t.filter(keep);
  return { cfg: c, dry: DRY, total: t.length, hidden: t.length - open.length, tenders: open.map((x) => ({ id: x.id, bid: x.Bid_Number, items: x.Items, qty: x.Quantity, buyer: x.Buyer_Department, ends: x.Bid_End_Date, emd: x.EMD_Amount, score: x.Bid_Score, status: x.Bid_Status, eligible: x.Eligibility, our_rate: x.Our_Rate, doc: x.Bid_Document_Link, cost: c.cost[x.id] || '' })) };
}

function build(qty, rates, costPerUnit) { return options(qty, (rates || []).map((r) => ({ from: r.from || 'competitor', rate: +r.rate })).filter((r) => r.rate > 0), +costPerUnit || 0); }

async function choose(id, unitRate, qty, by) {
  const c = cfg(), q = Math.max(1, +qty || 1), u = +unitRate;
  if (!(u > 0)) throw new Error('Rate galat hai');
  const cost = +c.cost[id] || 0;
  if (cost && u < cost) throw new Error('Yeh rate aapke cost price se kam hai (loss).');
  const total = r2(u * q * (1 + c.gst / 100) + c.dispatch);
  log('gem', 'rate_chosen', `${id} unit ${u} qty ${q} total ${total} by ${by}${DRY ? ' (DRY_RUN: Zoho me save nahi hua)' : ''}`);
  if (!DRY) await zoho.updateRecord('GeM_Tenders', id, { Our_Rate: total });
  return { saved: !DRY, unit_ex_gst: u, total };
}

module.exports = { cfg, setCfg, list, build, choose };
