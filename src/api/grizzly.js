// Grizzly SMS uses the SMS-Activate-compatible handler_api.php protocol.
// Docs: https://grizzlysms.com/docs  ·  Country/service tables: https://grizzlysms.com/docs/tables
// Override the base URL with VITE_GRIZZLY_API_URL if you need to route through a CORS proxy.
const GRIZZLY_API_URL = import.meta.env.VITE_GRIZZLY_API_URL || 'https://api.grizzlysms.com/stubs/handler_api.php';

// USA = 187, Instagram (incl. Threads) = "ig" per the Grizzly country/service tables.
const USA_COUNTRY = '187';
const INSTAGRAM_SERVICE = 'ig';

// Human-readable messages for the documented plain-text error responses.
const ERROR_MESSAGES = {
  BAD_KEY: 'Invalid API key',
  NO_BALANCE: 'Insufficient balance',
  NO_NUMBERS: 'No numbers available right now',
  WRONG_SERVICE: 'Unsupported service',
  BAD_SERVICE: 'Unsupported service',
  BANNED: 'Account is banned',
  NO_ACTIVATION: 'Activation not found',
  ERROR_SQL: 'Provider server error, try again',
};

function describeError(text) {
  return ERROR_MESSAGES[text] || text || 'Grizzly request failed';
}

function formatNumber(number) {
  const digits = String(number ?? '').trim();
  return digits && !digits.startsWith('+') ? `+${digits}` : digits;
}

async function callGrizzly(params) {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`${GRIZZLY_API_URL}?${query}`, { method: 'GET' });
  if (!response.ok) throw new Error(`Grizzly API error (${response.status})`);
  return (await response.text()).trim();
}

function setStatus(apiKey, orderId, status) {
  // 1 = ready, 3 = request another code, 6 = complete, 8 = cancel
  return callGrizzly({ api_key: apiKey, action: 'setStatus', status, id: orderId });
}

export async function getBalance(apiKey) {
  const text = await callGrizzly({ api_key: apiKey, action: 'getBalance' });
  if (text.startsWith('ACCESS_BALANCE:')) {
    return { success: true, balance: text.slice('ACCESS_BALANCE:'.length) };
  }
  return { success: false, message: describeError(text) };
}

export async function getStock(apiKey) {
  const text = await callGrizzly({ api_key: apiKey, action: 'getNumbersStatus', country: USA_COUNTRY });
  try {
    const data = JSON.parse(text);
    // Keys look like "ig_0", "ig_1" (service_operator); sum every Instagram operator.
    const amount = Object.entries(data)
      .filter(([key]) => key === INSTAGRAM_SERVICE || key.startsWith(`${INSTAGRAM_SERVICE}_`))
      .reduce((sum, [, value]) => sum + (Number.parseInt(value, 10) || 0), 0);
    return { success: true, amount };
  } catch {
    return { success: false, message: describeError(text) };
  }
}

export async function orderSMS(apiKey, maxPrice) {
  const params = { api_key: apiKey, action: 'getNumber', service: INSTAGRAM_SERVICE, country: USA_COUNTRY };
  if (maxPrice) params.maxPrice = maxPrice;
  const text = await callGrizzly(params);
  if (text.startsWith('ACCESS_NUMBER:')) {
    const [, id, number] = text.split(':');
    return { success: true, order_id: id, phonenumber: formatNumber(number) };
  }
  return { success: false, message: describeError(text) };
}

export async function checkSMS(apiKey, orderId) {
  const text = await callGrizzly({ api_key: apiKey, action: 'getStatus', id: orderId });
  if (text.startsWith('STATUS_OK:')) {
    return { success: true, status: 'OK', sms: text.slice('STATUS_OK:'.length) };
  }
  if (text === 'STATUS_CANCEL') return { success: false, status: 'CANCEL' };
  if (text === 'STATUS_WAIT_RESEND') return { success: true, status: 'WAIT_RESEND' };
  if (text === 'STATUS_WAIT_CODE') return { success: true, status: 'WAIT_CODE' };
  // STATUS_WAIT_RETRY:lastcode — a code arrived but the service wants another; keep waiting.
  if (text.startsWith('STATUS_WAIT_RETRY')) return { success: true, status: 'WAIT_RETRY' };
  return { success: false, message: describeError(text) };
}

export async function cancelSMS(apiKey, orderId) {
  const text = await setStatus(apiKey, orderId, 8);
  return { success: text === 'ACCESS_CANCEL', message: describeError(text) };
}

export async function finishSMS(apiKey, orderId) {
  const text = await setStatus(apiKey, orderId, 6);
  return { success: text === 'ACCESS_ACTIVATION', message: describeError(text) };
}
