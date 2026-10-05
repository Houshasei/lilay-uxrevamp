// SMSPool added a bot challenge that blocks direct browser calls (CORS), so every
// request goes through the same-origin proxy at /api/smspool -> https://api.smspool.net
// (the Node server in production, the Vite dev proxy in development). SMSPool accepts
// GET for every endpoint, so we use query-string GETs (easy to proxy, no body handling).
const BASE = '/api/smspool';

async function getJson(path, params) {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`${BASE}${path}?${query}`, { method: 'GET' });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { balance: text.trim() };
  }
}

export function orderSMS(apiKey) {
  return getJson('/purchase/sms', {
    key: apiKey,
    country: 'US',
    service: '457',
    pricing_option: '0',
    quantity: '1',
  });
}

export function checkSMS(apiKey, orderId) {
  return getJson('/sms/check', { key: apiKey, orderid: orderId });
}

export function cancelSMS(apiKey, orderId) {
  return getJson('/sms/cancel', { key: apiKey, orderid: orderId });
}

export function getStock(apiKey) {
  return getJson('/sms/stock', { key: apiKey, service: '457', country: '1' });
}

export function getBalance(apiKey) {
  return getJson('/request/balance', { key: apiKey });
}

export async function getHistory(apiKey) {
  const response = await getJson('/request/history', {
    key: apiKey,
    start: '0',
    length: '1000',
    search: '',
  });

  if (Array.isArray(response)) return response;
  if (response?.order_code || response?.orderid) return [response];
  throw new Error('Failed to fetch history');
}

export function checkResend(apiKey, orderId) {
  return getJson('/sms/check_resend', { key: apiKey, orderid: orderId });
}

export function resendSMS(apiKey, orderId) {
  return getJson('/sms/resend', { key: apiKey, orderid: orderId });
}
