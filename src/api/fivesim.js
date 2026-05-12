function joinProxyUrl(proxyUrl, path) {
  return `${proxyUrl.replace(/\/$/, '')}${path}`;
}

async function getJson(proxyUrl, path, apiKey) {
  const headers = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(joinProxyUrl(proxyUrl, path), {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`5SIM API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

export function buyInstagramNumber(proxyUrl, apiKey) {
  return getJson(proxyUrl, '/api/user/buy/activation/usa/any/instagram', apiKey);
}

export function checkOrder(proxyUrl, apiKey, orderId) {
  return getJson(proxyUrl, `/api/user/check/${orderId}`, apiKey);
}

export function cancelOrder(proxyUrl, apiKey, orderId) {
  return getJson(proxyUrl, `/api/user/cancel/${orderId}`, apiKey);
}

export function finishOrder(proxyUrl, apiKey, orderId) {
  return getJson(proxyUrl, `/api/user/finish/${orderId}`, apiKey);
}

export function getProfile(proxyUrl, apiKey) {
  return getJson(proxyUrl, '/api/user/profile', apiKey);
}

export function getPrices(proxyUrl) {
  return getJson(proxyUrl, '/api/guest/prices?country=usa&product=instagram');
}
