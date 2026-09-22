// TextVerified API v2. Its API blocks browser CORS, so every call goes through a
// same-origin proxy at /api/textverified -> https://www.textverified.com/api/pub/v2
// (the Node server in production, the Vite dev proxy in development).
const BASE = '/api/textverified';
const SERVICE_NAME = 'instagram'; // USA Instagram verification service
const CAPABILITY = 'sms';

// Auth returns a bearer token that expires; cache it per credential set and refresh
// ~30s before expiry so we are not re-authenticating on every call.
let tokenCache = null; // { token, expiresAtMs, credKey }

async function getToken(apiKey, username) {
  const credKey = `${username}::${apiKey}`;
  if (tokenCache && tokenCache.credKey === credKey && tokenCache.expiresAtMs - Date.now() > 30000) {
    return tokenCache.token;
  }
  const response = await fetch(`${BASE}/auth`, {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'X-API-USERNAME': username },
  });
  if (!response.ok) {
    throw new Error(response.status === 401 ? 'Invalid TextVerified API key or username' : `Auth failed (${response.status})`);
  }
  const data = await response.json();
  if (!data.token) throw new Error('TextVerified did not return a token');
  const expiresAtMs = data.expiresAt
    ? new Date(data.expiresAt).getTime()
    : Date.now() + (Number(data.expiresIn) || 3600) * 1000;
  tokenCache = { token: data.token, expiresAtMs, credKey };
  return data.token;
}

async function authedFetch(apiKey, username, path, options = {}) {
  const token = await getToken(apiKey, username);
  return fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
}

export async function getBalance(apiKey, username) {
  const response = await authedFetch(apiKey, username, '/account/me');
  if (!response.ok) throw new Error(`Balance error (${response.status})`);
  const data = await response.json();
  return { success: true, balance: data.currentBalance };
}

export async function getVerification(apiKey, username, id) {
  const response = await authedFetch(apiKey, username, `/verifications/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`Verification lookup failed (${response.status})`);
  return response.json();
}

export async function orderSMS(apiKey, username, serviceName = SERVICE_NAME) {
  const response = await authedFetch(apiKey, username, '/verifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceName, capability: CAPABILITY }),
  });
  if (!response.ok) {
    let message = `Failed to create verification (${response.status})`;
    try {
      const err = await response.json();
      message = err?.errorDescription || err?.message || err?.error || message;
    } catch {
    }
    return { success: false, message };
  }

  // A 201 returns the verification URL in the Location header (id is the last segment).
  const location = response.headers.get('location');
  let id = location ? location.split('/').filter(Boolean).pop() : null;
  if (!id) {
    try {
      const body = await response.json();
      id = String(body.href || body.id || '').split('/').filter(Boolean).pop() || null;
    } catch {
    }
  }
  if (!id) return { success: false, message: 'No verification id returned' };

  let phonenumber = '';
  try {
    const details = await getVerification(apiKey, username, id);
    phonenumber = details.number || '';
  } catch {
  }
  return { success: true, order_id: id, phonenumber };
}

export async function checkSMS(apiKey, username, id) {
  // Prefer the SMS list (has the parsed code); fall back to the verification state.
  try {
    const response = await authedFetch(apiKey, username, `/sms?reservationId=${encodeURIComponent(id)}&reservationType=verification`);
    if (response.ok) {
      const data = await response.json();
      const message = (data.data || []).find((item) => item.parsedCode || item.smsContent);
      if (message) return { success: true, status: 'OK', sms: message.parsedCode || message.smsContent };
    }
  } catch {
  }

  try {
    const verification = await getVerification(apiKey, username, id);
    if (verification.state === 'verificationCanceled') return { success: false, status: 'CANCEL' };
    if (verification.state === 'verificationTimedOut') return { success: false, status: 'TIMEOUT' };
  } catch {
  }
  return { success: true, status: 'WAIT' };
}

export async function cancelSMS(apiKey, username, id) {
  const response = await authedFetch(apiKey, username, `/verifications/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  return { success: response.ok, message: response.ok ? '' : `Cancel failed (${response.status})` };
}
