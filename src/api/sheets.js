import { USER_CONFIG } from '../config.js';

export function getSheetUrl(user) {
  return `https://script.google.com/macros/s/${USER_CONFIG[user].id}/exec`;
}

const REQUEST_TIMEOUT = 15000;
const MAX_RETRIES = 2;

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    return await fetch(url, { signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timeout);
  }
}

// Apps Script can answer with an HTML error page (a bad header cell, a hit quota,
// or an auth redirect) instead of JSON. Parse defensively so a bad body never throws.
async function parseJsonSafe(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// A sheet payload is meant to be an array of row objects. Anything else — an
// { error } object, null, a string — is treated as an empty sheet so one bad
// tab can never blow up the whole refresh.
function asRows(value) {
  return Array.isArray(value) ? value : [];
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fetch + parse with a short backoff, to ride out Apps Script's rate limiting and
// the transient redirects Google sometimes returns instead of the JSON payload.
async function requestJson(url) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url);
      const data = await parseJsonSafe(response);
      if (response.ok && data !== null) return data;
      lastError = new Error(`Bad response (${response.status})`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < MAX_RETRIES) await delay(600 * (attempt + 1));
  }
  throw lastError || new Error('Request failed');
}

export async function fetchSheet(sheetUrl, sheetName, cache) {
  if (cache[sheetName]) return cache[sheetName];
  const data = await requestJson(`${sheetUrl}?sheet=${encodeURIComponent(sheetName)}`);
  const rows = asRows(data);
  cache[sheetName] = rows;
  return rows;
}

export async function preloadSheets(sheetUrl, sheetNames) {
  const cache = {};

  // Preferred path: one batched request for every sheet keeps us well under
  // Apps Script's per-minute quota. Needs the updated Apps Script (?sheets=a,b,c).
  try {
    const query = sheetNames.map((name) => encodeURIComponent(name)).join(',');
    const data = await requestJson(`${sheetUrl}?sheets=${query}`);
    if (data && typeof data === 'object' && !Array.isArray(data) && sheetNames.some((name) => name in data)) {
      for (const name of sheetNames) cache[name] = asRows(data[name]);
      return cache;
    }
  } catch {
    // Fall through to per-sheet fetching (older Apps Script, or a batch failure).
  }

  // Fallback: fetch sequentially, tolerating individual sheet failures so the
  // sheets that do load still make it through.
  for (const sheetName of sheetNames) {
    try {
      await fetchSheet(sheetUrl, sheetName, cache);
    } catch {
      cache[sheetName] = [];
    }
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
