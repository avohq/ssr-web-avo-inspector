// Polyfill TextEncoder/TextDecoder for jsdom environment
const { TextEncoder, TextDecoder } = require('util');
if (!globalThis.TextEncoder) {
  globalThis.TextEncoder = TextEncoder;
}
if (!globalThis.TextDecoder) {
  globalThis.TextDecoder = TextDecoder;
}

// Polyfill crypto.subtle for jsdom test environment
const { webcrypto } = require('crypto');
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}
