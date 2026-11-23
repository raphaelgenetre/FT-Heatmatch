// HeatMatch MVP — zero-dependency Node.js server.
// Run:  node server.js   then open http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const D = require('./lib/data');
const crypto = require('crypto');
const { checkLogin } = require('./lib/auth');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const STATE_FILE = path.join(__dirname, 'data', 'state.json');
const STATUSES = ['Contacted', 'In discussion', 'Feasibility study', 'Contract signed', 'Declined'];
const ACTIVE = new Set(['Contacted', 'In discussion', 'Feasibility study']);

const BASE_SITES = D.generateSites();
const BASE_BY_ID = new Map(BASE_SITES.map(s => [s.id, s]));

// ---------------- state ----------------
let state;
function save() { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1)); }
function site(id) { const b = BASE_BY_ID.get(id); return b ? { ...b, ...(state.siteOverrides[id] || {}) } : null; }
function allSites() { return BASE_SITES.map(s => site(s.id)); }
function userById(siteObj, uid) { return D.heatUsersFor(siteObj).find(u => u.id === uid); }

const DEFAULT_TEMPLATE = {
  subject: 'Low-carbon heat available near {{company}}',
  body: `Dear {{contact_name}},

I am writing on behalf of {{sender}}, the heat-recovery team at FT. {{site_name}} in {{city}}, about {{distance}} km from {{company}}, produces surplus heat of up to {{supply_temp}}°C that is currently released to the atmosphere.

Our initial assessment suggests we could supply roughly {{delivered_mwh}} MWh of heat per year to your site. That could save around €{{savings}} a year and avoid an estimated {{co2}} tonnes of CO₂ annually, with an indicative payback of {{payback}} years.

Would you be open to a 30-minute call to explore whether a heat partnership could work for {{company}}?

Kind regards,
{{sender}}`,
};

function seed() {
  const r = D.rng(42);
  state = { siteOverrides: {}, leads: [], outbox: [], activity: [], template: DEFAULT_TEMPLATE, seq: 1 };
  const now = Date.now();
  const candidates = BASE_SITES.filter(() => r() < 0.2);
  for (const s of candidates) {
    const matches = D.heatUsersFor(s).filter(u => u.distanceKm <= 15)
      .map(u => ({ u, sc: D.scoreUser(s, u) })).sort((a, b) => b.sc.total - a.sc.total);
    const n = D.ibetween(r, 1, 3);
    for (const { u, sc } of matches.slice(0, n)) {
      const q = sc.total / 100;
      const status = D.weighted(r, [['Contract signed', 30 * q * q * 2], ['Feasibility study', 16], ['In discussion', 20], ['Contacted', 20], ['Declined', 22 * (1 - q) * 2]]);
      const created = now - Math.floor(r() * 330 + 10) * 864e5;
      const updated = Math.min(now - 864e5, created + Math.floor(r() * 120) * 864e5);
      state.leads.push(makeLead(s, u, sc, status, created, updated));
    }
  }
  state.activity = state.leads.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 15)
    .map(l => ({ at: l.updatedAt, text: `${l.userName} → ${l.status}`, siteId: l.siteId, siteName: l.siteName }));
  save();
}
function makeLead(s, u, sc, status, createdAt, updatedAt) {
  const id = `L-${String(state.seq++).padStart(5, '0')}`;
  return {
    id, siteId: s.id, siteName: s.name, country: s.country, userId: u.id, userName: u.name, sector: u.sector, sectorLabel: u.sectorLabel,
    distanceKm: u.distanceKm, lat: u.lat, lon: u.lon, contact: u.contact, score: sc.total, deliveredMWh: sc.deliveredMWh,
    co2Tonnes: sc.co2Tonnes, capex: sc.capex, paybackYears: sc.paybackYears, status, createdAt, updatedAt,
    history: [{ at: createdAt, status: 'Contacted', note: 'Outreach email sent' }].concat(status !== 'Contacted' ? [{ at: updatedAt, status, note: '' }] : []),
  };
}
function load() {
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { seed(); }
}
load();

// ---------------- helpers ----------------
function siteStatus(siteId, leadsBySite) {
  const ls = leadsBySite.get(siteId) || [];
  if (ls.some(l => l.status === 'Contract signed')) return 'partnership';
  if (ls.some(l => ACTIVE.has(l.status))) return 'progress';
  return 'none';
}
function groupLeads() { const m = new Map(); for (const l of state.leads) { if (!m.has(l.siteId)) m.set(l.siteId, []); m.get(l.siteId).push(l); } return m; }
function weightsFrom(q) {
  const w = { ...D.DEFAULT_WEIGHTS };
  for (const [k, p] of [['energy', 'we'], ['likelihood', 'wl'], ['feasibility', 'wf']]) if (q.has(p)) w[k] = Math.max(0, +q.get(p) || 0);
  return w;
}
function fill(tpl, vars) { return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m)); }
const fmt = n => Math.round(n).toLocaleString('en-GB');

function stats() {
  const sites = allSites();
  const bySite = groupLeads();
  const signed = state.leads.filter(l => l.status === 'Contract signed');
  const countries = {};
  for (const s of sites) {
    const c = countries[s.country] ||= { code: s.country, name: s.countryName, sites: 0, units: 0, supplyMWh: 0, partnerships: 0, inProgress: 0 };
    c.sites++; c.units += s.units; c.supplyMWh += D.annualSupplyMWh(s);
    const st = siteStatus(s.id, bySite);
    if (st === 'partnership') c.partnerships++; else if (st === 'progress') c.inProgress++;
  }
  const sectors = {};
  for (const [k, v] of Object.entries(D.SECTORS)) sectors[k] = { key: k, label: v.label, leads: 0, signed: 0, declined: 0, mwh: 0, distSum: 0 };
  for (const l of state.leads) {
    const s = sectors[l.sector]; s.leads++;
    if (l.status === 'Contract signed') { s.signed++; s.mwh += l.deliveredMWh; s.distSum += l.distanceKm; }
    if (l.status === 'Declined') s.declined++;
  }
  const sectorList = Object.values(sectors).map(s => ({ ...s, conversion: s.signed + s.declined ? s.signed / (s.signed + s.declined) : null, avgDist: s.signed ? s.distSum / s.signed : null }));
  const bands = [[0, 2], [2, 5], [5, 10], [10, 20], [20, 99]].map(([a, b]) => {
    const ls = state.leads.filter(l => l.distanceKm >= a && l.distanceKm < b);
    const sg = ls.filter(l => l.status === 'Contract signed').length, dc = ls.filter(l => l.status === 'Declined').length;
    return { label: b === 99 ? `${a}+ km` : `${a}–${b} km`, leads: ls.length, signed: sg, conversion: sg + dc ? sg / (sg + dc) : null };
  });
  const pipeline = STATUSES.map(s => ({ status: s, count: state.leads.filter(l => l.status === s).length }));
  const statusCount = { partnership: 0, progress: 0, none: 0 };
  for (const s of sites) statusCount[siteStatus(s.id, bySite)]++;
  return {
    totals: {
      sites: sites.length, units: sites.reduce((a, s) => a + s.units, 0),
      europeUnits: sites.filter(s => s.region === 'Europe').reduce((a, s) => a + s.units, 0),
      countries: Object.keys(countries).length,
      supplyGWh: sites.reduce((a, s) => a + D.annualSupplyMWh(s), 0) / 1000,
      partnerships: signed.length, sitesWithPartnership: statusCount.partnership, sitesInProgress: statusCount.progress,
      deliveredGWh: signed.reduce((a, l) => a + l.deliveredMWh, 0) / 1000,
      co2Tonnes: signed.reduce((a, l) => a + l.co2Tonnes, 0),
      activeLeads: state.leads.filter(l => ACTIVE.has(l.status)).length,
      emailsSent: state.outbox.length,
    },
    countries: Object.values(countries).sort((a, b) => b.units - a.units),
    sectors: sectorList, distanceBands: bands, pipeline, activity: state.activity.slice(0, 12),
  };
}

// ---------------- routing ----------------
function send(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function body(req) { return new Promise((ok, bad) => { let d = ''; req.on('data', c => (d += c)); req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { bad(e); } }); }); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

async function api(req, res, url) {
  const p = url.pathname.replace(/^\/api/, '').split('/').filter(Boolean);
  const m = req.method;
  if (m === 'GET' && p[0] === 'meta') {
    return send(res, 200, { statuses: STATUSES, sectors: Object.fromEntries(Object.entries(D.SECTORS).map(([k, v]) => [k, v.label])), countries: D.COUNTRY, weights: D.DEFAULT_WEIGHTS, econ: D.ECON, template: state.template });
  }
  if (m === 'GET' && p[0] === 'stats') return send(res, 200, stats());
  if (p[0] === 'sites' && !p[1] && m === 'GET') {
    const bySite = groupLeads();
    return send(res, 200, allSites().map(s => {
      const ls = bySite.get(s.id) || [];
      return { id: s.id, name: s.name, city: s.city, country: s.country, countryName: s.countryName, lat: s.lat, lon: s.lon, units: s.units, model: s.model,
        supplyMWh: D.annualSupplyMWh(s), status: siteStatus(s.id, bySite), leads: ls.length, signed: ls.filter(l => l.status === 'Contract signed').length, heatRecoveryInstalled: s.heatRecoveryInstalled };
    }));
  }
  if (p[0] === 'sites' && p[1]) {
    const s = site(p[1]);
    if (!s) return send(res, 404, { error: 'Installation not found' });
    if (!p[2] && m === 'GET') {
      return send(res, 200, { ...s, supplyMWh: D.annualSupplyMWh(s), status: siteStatus(s.id, groupLeads()), leads: state.leads.filter(l => l.siteId === s.id) });
    }
    if (!p[2] && m === 'PUT') {
      const b = await body(req);
      const allowed = { units: [1, 6], cremationsPerYear: [0, 20000], hoursPerDay: [1, 24], daysPerWeek: [1, 7], recoverableKW: [0, 5000], supplyTempC: [30, 120] };
      const o = state.siteOverrides[s.id] || {};
      for (const [k, [lo, hi]] of Object.entries(allowed)) if (b[k] !== undefined && b[k] !== '') {
        const v = Number(b[k]); if (!Number.isFinite(v) || v < lo || v > hi) return send(res, 400, { error: `${k} must be between ${lo} and ${hi}` }); o[k] = v;
      }
      if (typeof b.heatRecoveryInstalled === 'boolean') o.heatRecoveryInstalled = b.heatRecoveryInstalled;
      if (b.contact && typeof b.contact === 'object') o.contact = { ...s.contact, ...b.contact };
      o.dataUpdatedAt = Date.now();
      state.siteOverrides[s.id] = o;
      state.activity.unshift({ at: Date.now(), text: `Operating data updated`, siteId: s.id, siteName: s.name });
      save();
      return send(res, 200, { ...site(s.id), supplyMWh: D.annualSupplyMWh(site(s.id)) });
    }
    if (p[2] === 'matches' && m === 'GET') {
      const radius = Math.min(50, Math.max(0.5, +(url.searchParams.get('radius') || 10)));
      const w = weightsFrom(url.searchParams);
      const leadByUser = new Map(state.leads.filter(l => l.siteId === s.id).map(l => [l.userId, l]));
      const users = D.heatUsersFor(s).filter(u => u.distanceKm <= radius)
        .map(u => { const l = leadByUser.get(u.id); return { ...u, score: D.scoreUser(s, u, w), lead: l ? { id: l.id, status: l.status } : null }; })
        .sort((a, b) => b.score.total - a.score.total)
        .map((u, i) => ({ ...u, rank: i + 1 }));
      return send(res, 200, { site: { ...s, supplyMWh: D.annualSupplyMWh(s) }, radius, weights: w, users });
    }
  }
  if (m === 'POST' && p[0] === 'outreach') {
    const b = await body(req);
    const s = site(b.siteId);
    if (!s) return send(res, 404, { error: 'Installation not found' });
    if (!Array.isArray(b.userIds) || !b.userIds.length) return send(res, 400, { error: 'Select at least one company' });
    const subjectT = String(b.subject || state.template.subject), bodyT = String(b.body || state.template.body);
    if (b.saveTemplate) state.template = { subject: subjectT, body: bodyT };
    const sent = [];
    for (const uid of b.userIds) {
      const u = userById(s, uid); if (!u) continue;
      const sc = D.scoreUser(s, u, b.weights || D.DEFAULT_WEIGHTS);
      const vars = { company: u.name, contact_name: u.contact.name, site_name: s.name, city: s.city, distance: u.distanceKm.toFixed(1), supply_temp: s.supplyTempC,
        delivered_mwh: fmt(sc.deliveredMWh), savings: fmt(sc.annualSavings), co2: fmt(sc.co2Tonnes), payback: sc.paybackYears, sender: b.sender || 'FT Heat Partnerships' };
      const now = Date.now();
      let lead = state.leads.find(l => l.siteId === s.id && l.userId === u.id);
      if (lead) { lead.status = 'Contacted'; lead.updatedAt = now; lead.history.push({ at: now, status: 'Contacted', note: 'Follow-up email sent' }); }
      else { lead = makeLead(s, u, sc, 'Contacted', now, now); state.leads.push(lead); }
      const mail = { id: `M-${String(state.outbox.length + 1).padStart(5, '0')}`, at: now, to: `${u.contact.name} <${u.contact.email}>`, company: u.name,
        siteId: s.id, siteName: s.name, leadId: lead.id, subject: fill(subjectT, vars), body: fill(bodyT, vars) };
      state.outbox.unshift(mail); sent.push(mail);
    }
    state.activity.unshift({ at: Date.now(), text: `${sent.length} outreach email${sent.length === 1 ? '' : 's'} sent`, siteId: s.id, siteName: s.name });
    save();
    return send(res, 200, { sent });
  }
  if (p[0] === 'leads' && !p[1] && m === 'GET') {
    let ls = state.leads;
    if (url.searchParams.get('siteId')) ls = ls.filter(l => l.siteId === url.searchParams.get('siteId'));
    return send(res, 200, ls.slice().sort((a, b) => b.updatedAt - a.updatedAt));
  }
  if (p[0] === 'leads' && p[1] && m === 'PATCH') {
    const l = state.leads.find(x => x.id === p[1]);
    if (!l) return send(res, 404, { error: 'Lead not found' });
    const b = await body(req);
    if (b.status && !STATUSES.includes(b.status)) return send(res, 400, { error: 'Unknown status' });
    const now = Date.now();
    if (b.status && b.status !== l.status) { l.status = b.status; state.activity.unshift({ at: now, text: `${l.userName} → ${b.status}`, siteId: l.siteId, siteName: l.siteName }); }
    l.updatedAt = now;
    l.history.push({ at: now, status: l.status, note: String(b.note || '').slice(0, 500) });
    save();
    return send(res, 200, l);
  }
  if (m === 'GET' && p[0] === 'outbox') return send(res, 200, state.outbox);
  if (m === 'POST' && p[0] === 'reset') { seed(); return send(res, 200, { ok: true }); }
  return send(res, 404, { error: 'Not found' });
}

const SESSIONS = new Map(); // token -> email (in memory; restart = sign in again)
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      // ---- authentication (server-side) ----
      const token = (req.headers.cookie || '').split(/;\s*/).map(c => c.split('=')).find(([k]) => k === 'hm_session')?.[1];
      const email = token && SESSIONS.get(token);
      if (url.pathname === '/api/login' && req.method === 'POST') {
        const b = await body(req);
        const r = checkLogin(b.email, b.password);
        if (!r.ok) return send(res, 401, { error: r.error });
        const t = crypto.randomBytes(24).toString('hex');
        SESSIONS.set(t, r.email);
        res.setHeader('Set-Cookie', `hm_session=${t}; HttpOnly; SameSite=Lax; Path=/`); // session cookie: no expiry date
        return send(res, 200, { email: r.email });
      }
      if (url.pathname === '/api/logout' && req.method === 'POST') {
        if (token) SESSIONS.delete(token);
        res.setHeader('Set-Cookie', 'hm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
        return send(res, 200, { ok: true });
      }
      if (!email) return send(res, 401, { error: 'Please sign in', auth: true });
      if (url.pathname === '/api/session') return send(res, 200, { email });
      return await api(req, res, url);
    }
    let f = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
    if (!f.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    if (url.pathname === '/' || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  } catch (e) {
    console.error(e); send(res, 500, { error: 'Server error' });
  }
}).listen(PORT, () => {
  console.log(`\n  FT HeatMatch is running →  http://localhost:${PORT}\n`);
  console.log(`  ${BASE_SITES.length} installations · ${BASE_SITES.reduce((a, s) => a + s.units, 0)} cremators · ${state.leads.length} partnership leads`);
  console.log('  Press Ctrl+C to stop.\n');
});
