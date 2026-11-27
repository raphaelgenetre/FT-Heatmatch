// Automated backend tests. Run with:  npm test   (uses Node's built-in test runner, nothing to install)
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'heatmatch-test-'));
const STATE = path.join(DIR, 'state.json');
let server, cookie;

async function call(p, { method = 'GET', body, auth = true, raw } = {}) {
  const res = await fetch(BASE + p, {
    method, headers: { 'Content-Type': 'application/json', ...(auth && cookie ? { Cookie: cookie } : {}) },
    body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch (_) {}
  return { status: res.status, data, headers: res.headers };
}

before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, HM_STATE_FILE: STATE }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await call('/api/health')).status === 200) return; } catch (_) {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error('server did not start');
});
after(() => { server.kill(); fs.rmSync(DIR, { recursive: true, force: true }); });

test('health check works without signing in', async () => {
  const r = await call('/api/health', { auth: false });
  assert.equal(r.status, 200); assert.equal(r.data.ok, true);
});

test('data is blocked until you sign in', async () => {
  assert.equal((await call('/api/sites', { auth: false })).status, 401);
});

test('sign-in rules: domain, look-alike domain, password', async () => {
  const bad = [['a@gmail.com', 'FTESADE'], ['a@alumni.esade.edu.evil.com', 'FTESADE'], ['a@alumni.esade.edu', 'ftesade']];
  for (const [email, password] of bad) assert.equal((await call('/api/login', { method: 'POST', body: { email, password }, auth: false })).status, 401, email);
  const ok = await call('/api/login', { method: 'POST', body: { email: ' Jane@Alumni.ESADE.edu ', password: 'FTESADE' }, auth: false });
  assert.equal(ok.status, 200); assert.equal(ok.data.email, 'jane@alumni.esade.edu');
  const set = ok.headers.get('set-cookie');
  assert.match(set, /HttpOnly/); assert.match(set, /SameSite=Strict/); assert.doesNotMatch(set, /Max-Age/); // ends when the browser closes
  cookie = set.split(';')[0];
});

test('security headers are sent', async () => {
  const r = await call('/api/sites');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
});

test('search radius: 500 m by default, never more than 1 km', async () => {
  const def = await call('/api/sites/CR-0050/matches');
  assert.equal(def.data.radius, 0.5);
  assert.ok(def.data.users.every(u => u.distanceKm <= 0.5));
  const big = await call('/api/sites/CR-0050/matches?radius=50');
  assert.equal(big.data.radius, 1);
  assert.ok(big.data.users.length > def.data.users.length && big.data.users.every(u => u.distanceKm <= 1));
});

test('outreach records who sent it (audit trail)', async () => {
  const m = await call('/api/sites/CR-0050/matches?radius=1');
  const r = await call('/api/outreach', { method: 'POST', body: { siteId: 'CR-0050', userIds: [m.data.users[0].id] } });
  assert.equal(r.status, 200); assert.equal(r.data.sent[0].by, 'jane@alumni.esade.edu');
  const leads = (await call('/api/leads?siteId=CR-0050')).data;
  const l = leads.find(x => x.userId === m.data.users[0].id);
  const upd = await call('/api/leads/' + l.id, { method: 'PATCH', body: { status: 'In discussion', note: 'Call booked' } });
  assert.equal(upd.data.history.at(-1).by, 'jane@alumni.esade.edu');
});

test('input limits: too many recipients, oversized request, bad site data', async () => {
  const many = Array.from({ length: 51 }, (_, i) => 'x' + i);
  assert.equal((await call('/api/outreach', { method: 'POST', body: { siteId: 'CR-0050', userIds: many } })).status, 400);
  assert.equal((await call('/api/outreach', { method: 'POST', raw: JSON.stringify({ siteId: 'CR-0050', body: 'x'.repeat(200 * 1024) }) })).status, 413);
  assert.equal((await call('/api/sites/CR-0050', { method: 'PUT', body: { hoursPerDay: 99 } })).status, 400);
});

test('data is saved safely to disk', async () => {
  const saved = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  assert.equal(saved.version, 2);
  assert.ok(!fs.existsSync(STATE + '.tmp'));
});

test('sign out ends the session', async () => {
  await call('/api/logout', { method: 'POST' });
  assert.equal((await call('/api/sites')).status, 401);
});

test('brute force: 5 wrong passwords lock sign-in for 15 minutes', async () => {
  for (let i = 0; i < 5; i++) await call('/api/login', { method: 'POST', body: { email: 'x@alumni.esade.edu', password: 'guess' + i }, auth: false });
  const r = await call('/api/login', { method: 'POST', body: { email: 'x@alumni.esade.edu', password: 'FTESADE' }, auth: false });
  assert.equal(r.status, 429); assert.match(r.data.error, /Too many attempts/);
});
