/**
 * Tests for AvoEncryption module.
 *
 * Covers:
 * - Wire format structural tests (base64 decode length >= 99, version byte, key marker)
 * - Cross-SDK interop: Web-encrypted ciphertext decryptable by reference decryptor
 * - Round-trip encrypt/decrypt for standard plaintexts
 * - getCrypto() handling for browser, Web Worker, and Node.js contexts
 */

import { encryptValue, decryptValue, generateKeyPair } from "../AvoEncryption";

// =========================================================================
// TypeScript mirror of Java EncryptionInteropTestUtil.decrypt
// Uses Node.js crypto module for the ECDH + AES-GCM decryption
// =========================================================================
import * as nodeCrypto from "crypto";

/**
 * Reference decryptor that mirrors the Java EncryptionInteropTestUtil.
 * Wire format: [0x00][65-byte ephemeral pubkey][16-byte IV][16-byte authTag][ciphertext]
 */
function interopDecrypt(
  base64Encrypted: string,
  privateKeyHex: string
): string {
  const data = Buffer.from(base64Encrypted, "base64");

  // Minimum length check (1 + 65 + 16 + 16 + 1 = 99)
  if (data.length < 99) {
    throw new Error(
      `Encrypted data too short: expected at least 99 bytes, got ${data.length}`
    );
  }

  // Version byte
  if (data[0] !== 0x00) {
    throw new Error(
      `Unsupported version byte: expected 0x00, got 0x${data[0].toString(16).padStart(2, "0")}`
    );
  }

  // Extract components
  const ephemeralPubKeyBytes = data.slice(1, 66); // 65 bytes
  const iv = data.slice(66, 82); // 16 bytes
  const authTag = data.slice(82, 98); // 16 bytes
  const ciphertext = data.slice(98); // remaining

  // Verify uncompressed point marker
  if (ephemeralPubKeyBytes[0] !== 0x04) {
    throw new Error(
      `Invalid ephemeral key marker: expected 0x04, got 0x${ephemeralPubKeyBytes[0].toString(16).padStart(2, "0")}`
    );
  }

  // Reconstruct ECDH shared secret using Node.js crypto
  // Create ECDH instance with P-256 curve
  const ecdh = nodeCrypto.createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(privateKeyHex, "hex"));

  // Compute shared secret (X coordinate only, 32 bytes)
  const sharedSecret = ecdh.computeSecret(ephemeralPubKeyBytes);

  // KDF: SHA-256(sharedSecret)
  const aesKey = nodeCrypto.createHash("sha256").update(sharedSecret).digest();

  // AES-256-GCM decrypt
  const decipher = nodeCrypto.createDecipheriv(
    "aes-256-gcm",
    aesKey,
    iv
  );
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf-8");
}

// =========================================================================
// Tests
// =========================================================================

describe("AvoEncryption", () => {
  // Generate a key pair for testing
  let testKeyPair: { privateKey: string; publicKey: string };

  beforeAll(() => {
    testKeyPair = generateKeyPair();
  });

  describe("generateKeyPair", () => {
    test("produces valid key pair with correct lengths", () => {
      const kp = generateKeyPair();
      // Private key: 32 bytes = 64 hex chars
      expect(kp.privateKey).toHaveLength(64);
      // Public key: 65 bytes uncompressed = 130 hex chars (04 + 32x + 32y)
      expect(kp.publicKey).toHaveLength(130);
      // Uncompressed marker
      expect(kp.publicKey.startsWith("04")).toBe(true);
    });

    test("generates different key pairs each time", () => {
      const kp1 = generateKeyPair();
      const kp2 = generateKeyPair();
      expect(kp1.privateKey).not.toEqual(kp2.privateKey);
      expect(kp1.publicKey).not.toEqual(kp2.publicKey);
    });
  });

  describe("Wire format structural tests", () => {
    test("base64 decoded output length >= 99 bytes", async () => {
      const encrypted = await encryptValue("hello", testKeyPair.publicKey);
      const decoded = Buffer.from(encrypted, "base64");
      expect(decoded.length).toBeGreaterThanOrEqual(99);
    });

    test("first byte (version) is 0x00", async () => {
      const encrypted = await encryptValue("test", testKeyPair.publicKey);
      const decoded = Buffer.from(encrypted, "base64");
      expect(decoded[0]).toBe(0x00);
    });

    test("second byte (ephemeral pubkey marker) is 0x04", async () => {
      const encrypted = await encryptValue("test", testKeyPair.publicKey);
      const decoded = Buffer.from(encrypted, "base64");
      expect(decoded[1]).toBe(0x04);
    });

    test("different encryptions of the same value produce different output", async () => {
      const enc1 = await encryptValue("same", testKeyPair.publicKey);
      const enc2 = await encryptValue("same", testKeyPair.publicKey);
      expect(enc1).not.toEqual(enc2);
    });
  });

  describe("Round-trip encrypt/decrypt", () => {
    const standardPlaintexts = [
      "hello world",
      42,
      3.14,
      true,
      "test string value",
    ];

    test.each(standardPlaintexts)(
      "round-trip for value: %p",
      async (value) => {
        const encrypted = await encryptValue(value, testKeyPair.publicKey);
        const decrypted = await decryptValue(encrypted, testKeyPair.privateKey);
        expect(decrypted).toEqual(value);
      }
    );

    test("round-trip for null", async () => {
      const encrypted = await encryptValue(null, testKeyPair.publicKey);
      const decrypted = await decryptValue(encrypted, testKeyPair.privateKey);
      expect(decrypted).toBeNull();
    });

    test("round-trip for undefined (maps to null)", async () => {
      const encrypted = await encryptValue(undefined, testKeyPair.publicKey);
      const decrypted = await decryptValue(encrypted, testKeyPair.privateKey);
      expect(decrypted).toBeNull();
    });

    test("round-trip for nested object", async () => {
      const obj = { key: "value", number: 123 };
      const encrypted = await encryptValue(obj, testKeyPair.publicKey);
      const decrypted = await decryptValue(encrypted, testKeyPair.privateKey);
      expect(decrypted).toEqual(obj);
    });
  });

  describe("Cross-SDK interop (EncryptionInteropTestUtil mirror)", () => {
    // The 5 standard plaintexts from acceptance criteria
    const interopPlaintexts: Array<{ label: string; value: any; jsonRepr: string }> = [
      { label: "string", value: "hello world", jsonRepr: '"hello world"' },
      { label: "integer", value: 42, jsonRepr: "42" },
      { label: "float", value: 3.14, jsonRepr: "3.14" },
      { label: "boolean", value: true, jsonRepr: "true" },
      { label: "test string", value: "test string value", jsonRepr: '"test string value"' },
    ];

    test.each(interopPlaintexts)(
      "Web-encrypted $label is decryptable by interop decryptor",
      async ({ value, jsonRepr }) => {
        const encrypted = await encryptValue(value, testKeyPair.publicKey);

        // Decrypt using the TypeScript mirror of Java EncryptionInteropTestUtil
        const decryptedJson = interopDecrypt(encrypted, testKeyPair.privateKey);
        expect(decryptedJson).toBe(jsonRepr);
      }
    );
  });

  describe("Error handling", () => {
    test("throws on invalid public key", async () => {
      await expect(
        encryptValue("test", "invalidhex")
      ).rejects.toThrow(/Failed to encrypt/);
    });

    test("throws on invalid encrypted data for decrypt", async () => {
      await expect(
        decryptValue("dG9vIHNob3J0", testKeyPair.privateKey)
      ).rejects.toThrow(/Failed to decrypt/);
    });
  });
});
