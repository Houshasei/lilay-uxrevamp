async function postForm(url, fields) {
  const formData = new FormData();
  Object.entries(fields).forEach(([key, value]) => formData.append(key, value));

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return { balance: text.trim() };
  }
}

export function orderSMS(apiKey) {
  return postForm('https://api.smspool.net/purchase/sms', {
    key: apiKey,
    country: 'US',
    service: '457',
    pricing_option: '0',
    quantity: '1',
  });
}

export function checkSMS(apiKey, orderId) {
  return postForm('https://api.smspool.net/sms/check', { key: apiKey, orderid: orderId });
}

export function cancelSMS(apiKey, orderId) {
  return postForm('https://api.smspool.net/sms/cancel', { key: apiKey, orderid: orderId });
}

export function getStock(apiKey) {
  return postForm('https://api.smspool.net/sms/stock', { key: apiKey, service: '457', country: '1' });
}

export function getBalance(apiKey) {
  return postForm('https://api.smspool.net/request/balance', { key: apiKey });
}

export async function getHistory(apiKey) {
  const response = await postForm('https://api.smspool.net/request/history', {
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
  return postForm('https://api.smspool.net/sms/check_resend', { key: apiKey, orderid: orderId });
}

export function resendSMS(apiKey, orderId) {
  return postForm('https://api.smspool.net/sms/resend', { key: apiKey, orderid: orderId });
}
