// Access rule for HeatMatch: anyone with an @alumni.esade.edu email + the shared password.
// NOTE: in the single-file HeatMatch.html this check runs in the browser, so it is a demo gate,
// not real security. The Node server version (server.js) enforces it server-side.
const AUTH = {
  domain: 'alumni.esade.edu',
  password: 'FTESADE',
};

function checkLogin(email, password) {
  const e = String(email || '').trim().toLowerCase();
  const re = new RegExp('^[^\\s@]+@' + AUTH.domain.replace(/\./g, '\\.') + '$');
  if (!re.test(e)) return { ok: false, error: `Use your @${AUTH.domain} email address.` };
  if (String(password || '') !== AUTH.password) return { ok: false, error: 'Incorrect password.' };
  return { ok: true, email: e };
}

if (typeof module !== 'undefined') module.exports = { checkLogin, AUTH };
