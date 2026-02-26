/**
 * Integration tests for encryption in AvoNetworkCallsHandler.
 *
 * Tests:
 * - shouldEncrypt() truth table
 * - publicEncryptionKey in base body
 * - addEncryptedValues is async and encrypts correctly
 * - List-type property values are omitted
 * - Encryption failure: console.warn, omit property, continue
 * - Prod negative test: no encryptedPropertyValue in prod env payload
 * - bodyForValidatedEventSchemaCall is async
 */

import AvoGuid from "../AvoGuid";
import { AvoNetworkCallsHandler } from "../AvoNetworkCallsHandler";
import { AvoStreamId } from "../AvoStreamId";
import { AvoInspector } from "../AvoInspector";
import { generateKeyPair, decryptValue } from "../AvoEncryption";

import {
  defaultOptions,
  mockedReturns,
} from "./constants";

// Mock fetch
global.fetch = jest.fn(() =>
  Promise.resolve({
    status: 200,
    json: () => Promise.resolve({ test: 100 }),
  })
) as jest.Mock;

const inspectorVersion = process.env.npm_package_version || "";
const TEST_PUBLIC_KEY = "04" + "a".repeat(128); // Dummy 65-byte uncompressed key for structural tests

describe("AvoNetworkCallsHandler - Encryption", () => {
  let realKeyPair: { privateKey: string; publicKey: string };

  beforeAll(() => {
    new AvoInspector(defaultOptions);
    realKeyPair = generateKeyPair();

    jest
      .spyOn(AvoStreamId as any, "getAnonymousId")
      .mockImplementation(() => mockedReturns.ANONYMOUS_ID);
    jest
      .spyOn(AvoGuid as any, "newGuid")
      .mockImplementation(() => mockedReturns.GUID);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("shouldEncrypt truth table", () => {
    // dev+key=true, staging+key=true, prod+key=false, dev+null=false, dev+empty=false

    test("dev + valid key = should encrypt (has encryptedPropertyValue)", async () => {
      const handler = new AvoNetworkCallsHandler(
        "key", "dev", "", "1.0", inspectorVersion, realKeyPair.publicKey
      );

      const props = [{ propertyName: "name", propertyType: "string" }];
      const body = await handler.bodyForValidatedEventSchemaCall(
        "testEvent", props, null, null,
        { name: "John" }
      );
      // In dev with a key, properties should get encrypted values
      const nameProp = body.eventProperties.find(
        (p: any) => p.propertyName === "name"
      );
      expect(nameProp?.encryptedPropertyValue).toBeDefined();
    });

    test("staging + valid key = should encrypt", async () => {
      const handler = new AvoNetworkCallsHandler(
        "key", "staging", "", "1.0", inspectorVersion, realKeyPair.publicKey
      );

      const props = [{ propertyName: "name", propertyType: "string" }];
      const body = await handler.bodyForValidatedEventSchemaCall(
        "testEvent", props, null, null,
        { name: "John" }
      );
      const nameProp = body.eventProperties.find(
        (p: any) => p.propertyName === "name"
      );
      expect(nameProp?.encryptedPropertyValue).toBeDefined();
    });

    test("prod + valid key = should NOT encrypt", async () => {
      const handler = new AvoNetworkCallsHandler(
        "key", "prod", "", "1.0", inspectorVersion, realKeyPair.publicKey
      );

      const props = [{ propertyName: "name", propertyType: "string" }];
      const body = await handler.bodyForValidatedEventSchemaCall(
        "testEvent", props, null, null,
        { name: "John" }
      );
      const nameProp = body.eventProperties.find(
        (p: any) => p.propertyName === "name"
      );
      expect(nameProp?.encryptedPropertyValue).toBeUndefined();
    });

    test("dev + null key = should NOT encrypt", async () => {
      const handler = new AvoNetworkCallsHandler(
        "key", "dev", "", "1.0", inspectorVersion, undefined
      );

      const props = [{ propertyName: "name", propertyType: "string" }];
      const body = await handler.bodyForValidatedEventSchemaCall(
        "testEvent", props, null, null,
        { name: "John" }
      );
      const nameProp = body.eventProperties.find(
        (p: any) => p.propertyName === "name"
      );
      expect(nameProp?.encryptedPropertyValue).toBeUndefined();
    });

    test("dev + empty string key = should NOT encrypt", async () => {
      const handler = new AvoNetworkCallsHandler(
        "key", "dev", "", "1.0", inspectorVersion, ""
      );

      const props = [{ propertyName: "name", propertyType: "string" }];
      const body = await handler.bodyForValidatedEventSchemaCall(
        "testEvent", props, null, null,
        { name: "John" }
      );
      const nameProp = body.eventProperties.find(
        (p: any) => p.propertyName === "name"
      );
      expect(nameProp?.encryptedPropertyValue).toBeUndefined();
    });
  });

  describe("publicEncryptionKey in base body", () => {
    test("included when non-null and non-empty", async () => {
      const handler = new AvoNetworkCallsHandler(
        "key", "dev", "", "1.0", inspectorVersion, realKeyPair.publicKey
      );

      const body = await handler.bodyForValidatedEventSchemaCall(
        "testEvent", [], null, null, {}
      );
      expect(body.publicEncryptionKey).toBe(realKeyPair.publicKey);
    });

    test("not included when null", () => {
      const handler = new AvoNetworkCallsHandler(
        "key", "dev", "", "1.0", inspectorVersion, undefined
      );

      const body = handler.bodyForSessionStartedCall();
      expect(body.publicEncryptionKey).toBeUndefined();
    });

    test("not included when empty string", () => {
      const handler = new AvoNetworkCallsHandler(
        "key", "dev", "", "1.0", inspectorVersion, ""
      );

      const body = handler.bodyForSessionStartedCall();
      expect(body.publicEncryptionKey).toBeUndefined();
    });
  });

  describe("List-type property values", () => {
    test("list-type properties are omitted entirely from encrypted values", async () => {
      const handler = new AvoNetworkCallsHandler(
        "key", "dev", "", "1.0", inspectorVersion, realKeyPair.publicKey
      );

      const props = [
        { propertyName: "name", propertyType: "string" },
        { propertyName: "tags", propertyType: "list" },
      ];
      const body = await handler.bodyForValidatedEventSchemaCall(
        "testEvent", props, null, null,
        { name: "John", tags: ["a", "b"] }
      );
      const nameProp = body.eventProperties.find(
        (p: any) => p.propertyName === "name"
      );
      const tagsProp = body.eventProperties.find(
        (p: any) => p.propertyName === "tags"
      );
      expect(nameProp?.encryptedPropertyValue).toBeDefined();
      expect(tagsProp?.encryptedPropertyValue).toBeUndefined();
    });
  });

  describe("Null and undefined property values", () => {
    test("null property values should NOT get encryptedPropertyValue", async () => {
      const handler = new AvoNetworkCallsHandler(
        "key", "dev", "", "1.0", inspectorVersion, realKeyPair.publicKey
      );

      const props = [
        { propertyName: "name", propertyType: "string" },
        { propertyName: "nickname", propertyType: "null" },
      ];
      const body = await handler.bodyForValidatedEventSchemaCall(
        "testEvent", props, null, null,
        { name: "John", nickname: null }
      );
      const nameProp = body.eventProperties.find(
        (p: any) => p.propertyName === "name"
      );
      const nicknameProp = body.eventProperties.find(
        (p: any) => p.propertyName === "nickname"
      );
      expect(nameProp?.encryptedPropertyValue).toBeDefined();
      expect(nicknameProp?.encryptedPropertyValue).toBeUndefined();
    });

    test("undefined property values should NOT get encryptedPropertyValue", async () => {
      const handler = new AvoNetworkCallsHandler(
        "key", "dev", "", "1.0", inspectorVersion, realKeyPair.publicKey
      );

      const props = [
        { propertyName: "name", propertyType: "string" },
        { propertyName: "missing", propertyType: "string" },
      ];
      const body = await handler.bodyForValidatedEventSchemaCall(
        "testEvent", props, null, null,
        { name: "John" } // "missing" is not in event values
      );
      const nameProp = body.eventProperties.find(
        (p: any) => p.propertyName === "name"
      );
      const missingProp = body.eventProperties.find(
        (p: any) => p.propertyName === "missing"
      );
      expect(nameProp?.encryptedPropertyValue).toBeDefined();
      expect(missingProp?.encryptedPropertyValue).toBeUndefined();
    });
  });

  describe("Encryption failure handling", () => {
    test("on encryption failure: console.warn, omit property value, continue", async () => {
      const handler = new AvoNetworkCallsHandler(
        "key", "dev", "", "1.0", inspectorVersion, "04" + "ff".repeat(64) // invalid key
      );

      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

      const props = [
        { propertyName: "name", propertyType: "string" },
        { propertyName: "age", propertyType: "int" },
      ];
      const body = await handler.bodyForValidatedEventSchemaCall(
        "testEvent", props, null, null,
        { name: "John", age: 30 }
      );

      // Should have warned
      expect(warnSpy).toHaveBeenCalled();
      const warnMessage = warnSpy.mock.calls.find(
        (call) => typeof call[0] === "string" && call[0].includes("[Avo Inspector] Warning:")
      );
      expect(warnMessage).toBeDefined();

      // Properties should still exist but without encrypted values
      expect(body.eventProperties.length).toBe(2);
      const nameProp = body.eventProperties.find(
        (p: any) => p.propertyName === "name"
      );
      expect(nameProp?.encryptedPropertyValue).toBeUndefined();

      warnSpy.mockRestore();
    });
  });

  describe("Encrypted values are actually decryptable", () => {
    test("encrypted property value can be decrypted to original value", async () => {
      const handler = new AvoNetworkCallsHandler(
        "key", "dev", "", "1.0", inspectorVersion, realKeyPair.publicKey
      );

      const props = [{ propertyName: "name", propertyType: "string" }];
      const body = await handler.bodyForValidatedEventSchemaCall(
        "testEvent", props, null, null,
        { name: "John" }
      );
      const nameProp = body.eventProperties.find(
        (p: any) => p.propertyName === "name"
      );
      expect(nameProp?.encryptedPropertyValue).toBeDefined();

      const decrypted = await decryptValue(
        nameProp!.encryptedPropertyValue!,
        realKeyPair.privateKey
      );
      expect(decrypted).toBe("John");
    });
  });

  describe("Prod negative test", () => {
    test("no encryptedPropertyValue in prod env payload even with valid key", async () => {
      const handler = new AvoNetworkCallsHandler(
        "key", "prod", "", "1.0", inspectorVersion, realKeyPair.publicKey
      );

      const props = [
        { propertyName: "name", propertyType: "string" },
        { propertyName: "age", propertyType: "int" },
      ];
      const body = await handler.bodyForValidatedEventSchemaCall(
        "testEvent", props, null, null,
        { name: "John", age: 30 }
      );

      for (const prop of body.eventProperties) {
        expect((prop as any).encryptedPropertyValue).toBeUndefined();
      }
    });
  });

  describe("bodyForValidatedEventSchemaCall is async", () => {
    test("returns a Promise", () => {
      const handler = new AvoNetworkCallsHandler(
        "key", "dev", "", "1.0", inspectorVersion, realKeyPair.publicKey
      );

      const result = handler.bodyForValidatedEventSchemaCall(
        "testEvent", [], null, null, {}
      );
      expect(result).toBeInstanceOf(Promise);
    });
  });
});
