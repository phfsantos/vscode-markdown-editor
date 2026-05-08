const crypto = require('node:crypto');
const { webcrypto } = crypto;

if (typeof crypto.getRandomValues !== 'function' && webcrypto?.getRandomValues) {
  crypto.getRandomValues = webcrypto.getRandomValues.bind(webcrypto);
}

if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
  globalThis.crypto = webcrypto;
}