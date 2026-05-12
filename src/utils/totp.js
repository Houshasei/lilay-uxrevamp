export function isValidBase32(str) {
  return /^[A-Z2-7=]+$/.test(str);
}

export function normalizeSecret(secret) {
  return String(secret || '').trim().replace(/\s/g, '').toUpperCase();
}

function base32Decode(encoded) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';

  for (const char of encoded.toUpperCase()) {
    if (char === '=') break;
    const index = alphabet.indexOf(char);
    if (index === -1) throw new Error('Invalid Base32');
    bits += index.toString(2).padStart(5, '0');
  }

  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return new Uint8Array(bytes);
}

async function hmacSha1(key, data) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, data);
  return new Uint8Array(signature);
}

export async function generateTOTP(secret) {
  const cleanSecret = normalizeSecret(secret);
  if (!cleanSecret) throw new Error('Please enter a secret');
  if (!isValidBase32(cleanSecret)) throw new Error('Invalid Base32 secret');

  const key = base32Decode(cleanSecret);
  const time = Math.floor(Date.now() / 1000 / 30);
  const message = new ArrayBuffer(8);
  new DataView(message).setUint32(4, time, false);
  const hmac = await hmacSha1(key, message);
  const offset = hmac[19] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return (code % 1000000).toString().padStart(6, '0');
}

export function getTotpSecondsRemaining() {
  return 30 - (Math.floor(Date.now() / 1000) % 30);
}
