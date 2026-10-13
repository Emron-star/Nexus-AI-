// Vercel serverless function: Deriv OAuth2 (PKCE) token exchange + WebSocket OTP URL.
// Env vars: DERIV_APP_ID (required), ALLOWED_ORIGIN (optional, e.g. https://yoursite.vercel.app)
const TOKEN_URL = 'https://auth.deriv.com/oauth2/token';
const ACCOUNTS = 'https://api.derivws.com/trading/v1/options/accounts';

module.exports = async (req, res) => {
  const out = (c, b) => res.status(c).json(b);
  if (req.method !== 'POST') return out(405, { error: 'POST only' });
  const allowed = process.env.ALLOWED_ORIGIN;
  if (allowed && req.headers.origin !== allowed) return out(403, { error: 'Origin not allowed' });
  const cid = process.env.DERIV_APP_ID;
  if (!cid) return out(500, { error: 'DERIV_APP_ID is not set on the server' });
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { return out(400, { error: 'Bad JSON' }); } }
  b = b || {};
  try {
    if (b.action === 'config') return out(200, { client_id: cid });

    if (b.action === 'exchange') {
      if (!b.code || !b.verifier || !b.redirect_uri) return out(400, { error: 'Missing code, verifier or redirect_uri' });
      const r = await fetch(TOKEN_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: cid, code: b.code, redirect_uri: b.redirect_uri, code_verifier: b.verifier })
      });
      const j = await r.json();
      if (!r.ok || !j.access_token) return out(400, { error: j.error_description || j.error || 'Token exchange failed' });
      return out(200, { access_token: j.access_token, expires_in: j.expires_in }); // refresh_token never sent to browser
    }

    if (b.action === 'otp') {
      if (!b.access_token) return out(400, { error: 'Missing access_token' });
      const H = { Authorization: 'Bearer ' + b.access_token, 'Content-Type': 'application/json' };
      let r = await fetch(ACCOUNTS, { headers: H }); let j = await r.json();
      if (!r.ok) return out(400, { error: 'Accounts: ' + JSON.stringify(j).slice(0, 200) });
      const list = j.data || [], isDemo = (a) => /demo|virtual/i.test(JSON.stringify(a));
      const pick = list.find((a) => (b.type === 'real' ? !isDemo(a) : isDemo(a)));
      if (!pick) return out(404, { error: 'No ' + (b.type === 'real' ? 'real' : 'demo') + ' Options account found. Found ' + list.length + ' account(s).' });
      const id = pick.account_id || pick.id || pick.loginid;
      r = await fetch(ACCOUNTS + '/' + id + '/otp', { method: 'POST', headers: H }); j = await r.json();
      if (!r.ok || !j.data || !j.data.url) return out(400, { error: 'OTP: ' + JSON.stringify(j).slice(0, 200) });
      return out(200, { url: j.data.url, id, currency: pick.currency || 'USD', virtual: /\/demo/.test(j.data.url) });
    }
    return out(400, { error: 'Unknown action' });
  } catch (err) { return out(500, { error: err.message }); }
};
