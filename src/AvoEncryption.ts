/* eslint-disable @typescript-eslint/no-explicit-any */
import { p256 } from '@noble/curves/p256'

/**
 * ECIES Encryption module for Avo Inspector (Web / Web Worker / SSR).
 *
 * Uses globalThis.crypto.subtle for AES-256-GCM (async WebCrypto API).
 * Handles three runtime contexts:
 *   - Browser: window.crypto.subtle
 *   - Web Worker: globalThis.crypto.subtle (no window object)
 *   - Node.js 18+ SSR: globalThis.crypto.subtle
 *
 * Node 18+ is a hard requirement for SSR encryption.
 *
 * Copied from js-avo-inspector main branch AvoEncryption.ts and adapted
 * for the web-avo-inspector structure.
 */

/**
 * Converts bytes (Uint8Array) to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Converts hex string to bytes (Uint8Array)
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
  }
  return bytes
}

/**
 * Get crypto API - works in browser, Web Worker, and Node.js 18+ environments.
 *
 * Resolution order:
 *   1. globalThis.crypto.subtle (works in all three contexts)
 *   2. window.crypto.subtle (browser fallback)
 *   3. global.crypto.subtle (Node.js fallback)
 *
 * @throws Error if crypto.subtle is not available
 */
const getCrypto = (): any => {
  // Try globalThis first (works in both Node.js and browsers)
  if (typeof globalThis !== 'undefined' && globalThis.crypto) {
    const crypto = globalThis.crypto as any;
    if (crypto && crypto.subtle) {
      return crypto;
    }
  }
  // Try window (browser)
  if (typeof window !== 'undefined' && window.crypto) {
    const crypto = window.crypto as any;
    if (crypto && crypto.subtle) {
      return crypto;
    }
  }
  // Try global (Node.js)
  if (typeof global !== 'undefined' && global.crypto) {
    const crypto = global.crypto as any;
    if (crypto && crypto.subtle) {
      return crypto;
    }
  }
  // Fallback - should not happen in proper environments
  const debugInfo = {
    hasGlobalThis: typeof globalThis !== 'undefined',
    hasGlobalThisCrypto: typeof globalThis !== 'undefined' && !!globalThis.crypto,
    hasGlobalThisCryptoSubtle: typeof globalThis !== 'undefined' && !!globalThis.crypto && !!(globalThis.crypto as any).subtle,
    hasWindow: typeof window !== 'undefined',
    hasWindowCrypto: typeof window !== 'undefined' && !!window.crypto,
    hasGlobal: typeof global !== 'undefined',
    hasGlobalCrypto: typeof global !== 'undefined' && !!global.crypto,
    hasGlobalCryptoSubtle: typeof global !== 'undefined' && !!global.crypto && !!(global.crypto as any).subtle
  };
  throw new Error('crypto.subtle not available. Debug: ' + JSON.stringify(debugInfo));
};

/**
 * Generates a new ECC key pair for encryption/decryption.
 * Uses P-256 (prime256v1 / NIST P-256) curve.
 *
 * @returns An object containing the private and public keys as hex strings
 */
export function generateKeyPair(): { privateKey: string; publicKey: string } {
  const privateKeyBytes = p256.utils.randomPrivateKey()
  const publicKeyBytes = p256.getPublicKey(privateKeyBytes, false)

  const privateKey = bytesToHex(privateKeyBytes).padStart(64, '0')
  const publicKey = bytesToHex(publicKeyBytes)

  return { privateKey, publicKey }
}

/**
 * Derives a key from shared secret using SHA-256
 */
async function deriveKey(sharedSecret: Uint8Array): Promise<ArrayBuffer> {
  const cryptoAPI = getCrypto();
  return await cryptoAPI.subtle.digest('SHA-256', sharedSecret as any)
}

/**
 * Safely converts Uint8Array to base64 string.
 * Uses Buffer in Node.js for efficiency, or chunked conversion in browsers.
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined' && Buffer.from) {
    return Buffer.from(bytes).toString('base64')
  }

  const CHUNK_SIZE = 8192
  let binaryString = ''

  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.slice(i, i + CHUNK_SIZE)
    binaryString += String.fromCharCode.apply(null, Array.from(chunk))
  }

  return btoa(binaryString)
}

/**
 * Encrypts a value using ECC public key encryption (ECIES).
 *
 * ECIES uses hybrid encryption (ECDH + AES-256-GCM).
 *
 * Wire format:
 *   [Version 0x00 (1B)] [EphemeralPubKey (65B)] [IV (16B)] [AuthTag (16B)] [Ciphertext]
 *
 * @param value - The value to encrypt (any type - will be JSON stringified)
 * @param publicKey - The ECC public key in hex format
 * @returns Promise resolving to base64-encoded encrypted string
 */
export async function encryptValue(value: any, publicKey: string): Promise<string> {
  try {
    const stringValue = value === undefined ? 'null' : JSON.stringify(value)

    const publicKeyStr = typeof publicKey === 'string' ? publicKey : String(publicKey)
    const recipientPublicKeyBytes = hexToBytes(publicKeyStr)

    // Generate ephemeral key pair on P-256
    const ephemeralPrivateKeyBytes = p256.utils.randomPrivateKey()
    const ephemeralPublicKeyBytes = p256.getPublicKey(ephemeralPrivateKeyBytes, false)

    // ECDH shared secret (X-coordinate only)
    const sharedSecretPoint = p256.getSharedSecret(ephemeralPrivateKeyBytes, recipientPublicKeyBytes)
    const sharedSecret = sharedSecretPoint.slice(-32)

    // KDF: SHA-256(sharedSecret)
    const derivedKeyBuffer = await deriveKey(sharedSecret)

    // Import key for AES-GCM
    const cryptoAPI = getCrypto();
    const keyMaterial = await cryptoAPI.subtle.importKey(
      'raw',
      derivedKeyBuffer,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    )

    // Random IV (16 bytes)
    const iv = cryptoAPI.getRandomValues(new Uint8Array(16))

    // AES-256-GCM encrypt
    const plaintext = new TextEncoder().encode(stringValue)
    const encryptedData = await cryptoAPI.subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      keyMaterial,
      plaintext
    )

    // Web Crypto appends auth tag to ciphertext - extract separately
    const encryptedArray = new Uint8Array(encryptedData)
    const authTagLength = 16
    const ciphertextLength = encryptedArray.length - authTagLength
    const ciphertext = encryptedArray.slice(0, ciphertextLength)
    const authTag = encryptedArray.slice(ciphertextLength)

    // Serialize: [Version(1)] + [EphemeralPubKey(65)] + [IV(16)] + [AuthTag(16)] + [Ciphertext]
    const version = new Uint8Array([0x00])
    const resultLength = 1 + ephemeralPublicKeyBytes.length + 16 + 16 + ciphertext.length
    const result = new Uint8Array(resultLength)
    let offset = 0

    result.set(version, offset)
    offset += 1

    result.set(ephemeralPublicKeyBytes, offset)
    offset += ephemeralPublicKeyBytes.length

    result.set(iv, offset)
    offset += 16

    result.set(authTag, offset)
    offset += 16

    result.set(ciphertext, offset)

    return uint8ArrayToBase64(result)
  } catch (error) {
    throw new Error(
      `Failed to encrypt value. Please check that the public key is valid. Error: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

/**
 * Decrypts a value that was encrypted with encryptValue.
 *
 * @param encryptedValue - The base64-encoded encrypted string
 * @param privateKey - The ECC private key in hex format
 * @returns Promise resolving to the original decrypted value (parsed from JSON)
 */
export async function decryptValue(encryptedValue: string, privateKey: string): Promise<any> {
  try {
    const encryptedBuffer =
      typeof Buffer !== 'undefined' && Buffer.from
        ? new Uint8Array(Buffer.from(encryptedValue, 'base64'))
        : (() => {
            const binaryString = atob(encryptedValue)
            const buf = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
              buf[i] = binaryString.charCodeAt(i)
            }
            return buf
          })()

    if (encryptedBuffer.length < 67) {
      throw new Error('Invalid encrypted data: payload too short')
    }

    const privateKeyStr = typeof privateKey === 'string' ? privateKey : String(privateKey)

    let offset = 0
    const version = encryptedBuffer[offset]
    offset += 1

    if (version !== 0x00) {
      throw new Error(`Unsupported encryption version: ${version}`)
    }

    const keyHeader = encryptedBuffer[offset]
    const pubKeySize = keyHeader === 0x02 || keyHeader === 0x03 ? 33 : 65

    const minRequired = 1 + pubKeySize + 16 + 16 + 1
    if (encryptedBuffer.length < minRequired) {
      throw new Error(`Invalid encrypted data: expected at least ${minRequired} bytes, got ${encryptedBuffer.length}`)
    }

    const ephemeralPublicKey = encryptedBuffer.slice(offset, offset + pubKeySize)
    offset += pubKeySize

    const iv = encryptedBuffer.slice(offset, offset + 16)
    offset += 16

    const authTag = encryptedBuffer.slice(offset, offset + 16)
    offset += 16

    const ciphertext = encryptedBuffer.slice(offset)

    const recipientPrivateKeyBytes = hexToBytes(privateKeyStr)

    // ECDH shared secret
    const sharedSecretPoint = p256.getSharedSecret(recipientPrivateKeyBytes, ephemeralPublicKey)
    const sharedSecret = sharedSecretPoint.slice(-32)

    // KDF
    const derivedKeyBuffer = await deriveKey(sharedSecret)

    // Import key for AES-GCM decrypt
    const cryptoAPI = getCrypto();
    const keyMaterial = await cryptoAPI.subtle.importKey(
      'raw',
      derivedKeyBuffer,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    )

    // Web Crypto expects ciphertext + authTag concatenated
    const combinedLength = ciphertext.length + authTag.length
    const data = new Uint8Array(combinedLength)
    data.set(ciphertext, 0)
    data.set(authTag, ciphertext.length)

    const decryptedBuffer = await cryptoAPI.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      keyMaterial,
      data
    )

    const decoder = new TextDecoder()
    const stringValue = decoder.decode(decryptedBuffer)
    return JSON.parse(stringValue)
  } catch (error) {
    throw new Error(
      `Failed to decrypt value. Please check that the private key is valid and matches the public key used for encryption. Error: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}
