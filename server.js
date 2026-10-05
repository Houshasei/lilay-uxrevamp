// Production server for the VPS. Serves the built frontend (dist/) and proxies
// TextVerified so the browser talks to it same-origin (it blocks cross-origin CORS).
// Run: npm run build && npm start   (defaults to port 8080; put Caddy/Nginx in front for HTTPS).
const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 8080;
const DIST = path.join(__dirname, 'dist');
const TV_BASE = 'https://www.textverified.com/api/pub/v2';
const SMSPOOL_BASE = 'https://api.smspool.net';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

app.use(express.json());

// Transparent TextVerified proxy. Mounted at /api/textverified, so req.url is the
// sub-path (e.g. /auth, /account/me, /verifications/{id}, /sms?reservationId=...).
app.use('/api/textverified', async (req, res) => {
  const url = `${TV_BASE}${req.url}`;
  const headers = {};
  for (const header of ['x-api-key', 'x-api-username', 'authorization', 'idempotency-key']) {
    if (req.headers[header]) headers[header] = req.headers[header];
  }
  const init = { method: req.method, headers };
  if (!['GET', 'HEAD'].includes(req.method) && req.body && Object.keys(req.body).length) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(req.body);
  }

  try {
    const upstream = await fetch(url, init);
    const location = upstream.headers.get('location');
    if (location) res.set('location', location); // create-verification returns 201 + Location
    res.set('content-type', upstream.headers.get('content-type') || 'application/json');
    res.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    res.status(502).json({ error: `TextVerified proxy error: ${error.message}` });
  }
});

// SMSPool proxy. SMSPool added a bot challenge that blocks browser (CORS) calls and
// flagged clients, so we call it server-side with browser-like headers. Every SMSPool
// endpoint accepts GET, so this is a simple query-string passthrough (req.url keeps the query).
app.use('/api/smspool', async (req, res) => {
  const url = `${SMSPOOL_BASE}${req.url}`;
  const headers = {
    'User-Agent': req.headers['user-agent'] || BROWSER_UA,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
    Referer: 'https://www.smspool.net/',
  };
  try {
    const upstream = await fetch(url, { method: 'GET', headers });
    res.set('content-type', upstream.headers.get('content-type') || 'application/json');
    res.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    res.status(502).json({ error: `SMSPool proxy error: ${error.message}` });
  }
});

// Static frontend + SPA fallback.
app.use(express.static(DIST));
app.use((req, res) => res.sendFile(path.join(DIST, 'index.html')));

// Bind to localhost only; Caddy (or another reverse proxy) terminates TLS and forwards here.
app.listen(PORT, '127.0.0.1', () => console.log(`Lilay server listening on http://127.0.0.1:${PORT}`));
