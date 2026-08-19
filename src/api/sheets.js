import { USER_CONFIG } from '../config.js';

export function getSheetUrl(user) {
  return `https://script.google.com/macros/s/${USER_CONFIG[user].id}/exec`;
}

export async function fetchSheet(sheetUrl, sheetName, cache) {
  if (cache[sheetName]) return cache[sheetName];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${sheetUrl}?sheet=${encodeURIComponent(sheetName)}`, {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Failed to fetch ${sheetName}`);
    const data = await response.json();
    cache[sheetName] = data;
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export async function preloadSheets(sheetUrl, sheetNames) {
  const cache = {};
  for (const sheetName of sheetNames) {
    await fetchSheet(sheetUrl, sheetName, cache);
  }
  return cache;
}

export async function updateSecretInSheet(sheetUrl, container, secret) {
  const formData = new FormData();
  formData.append('action', 'updateSecret');
  formData.append('container', container);
  formData.append('secret', secret);

  const response = await fetch(sheetUrl, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) throw new Error('Writing error');
  return response.json();
}
