import { AvoStreamId } from "../AvoStreamId";
import { AvoStorage } from "../AvoStorage";
import { AvoInspector } from "../AvoInspector";
import AvoGuid from "../AvoGuid";

import { defaultOptions } from "./constants";

describe("AvoStreamId", () => {
  beforeEach(async () => {
    // Reset static state
    AvoStreamId["_anonymousId"] = null;
    // Initialize storage and wait for it to be ready
    new AvoInspector(defaultOptions);
    // Wait for async storage initialization
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    AvoStreamId["_anonymousId"] = null;
  });

  describe("storage keys", () => {
    test('streamIdKey is "AvoInspectorStreamId"', () => {
      expect(AvoStreamId.streamIdKey).toBe("AvoInspectorStreamId");
    });

    test('createdAtKey is "AvoInspectorStreamIdCreatedAt"', () => {
      expect(AvoStreamId.createdAtKey).toBe("AvoInspectorStreamIdCreatedAt");
    });

    test('lastActivityKey is "AvoInspectorStreamIdLastActivityAt"', () => {
      expect(AvoStreamId.lastActivityKey).toBe("AvoInspectorStreamIdLastActivityAt");
    });
  });

  describe("getAnonymousId", () => {
    test('returns a real GUID (not "unknown") when avoStorage is not initialized and no cached ID', () => {
      // Force storage to appear uninitialized
      (AvoInspector.avoStorage.storageImpl as any).storageInitialized = false;
      AvoStreamId["_anonymousId"] = null;

      const result = AvoStreamId.getAnonymousId();

      expect(result).not.toBe("unknown");
      expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    test("returns cached ID even when avoStorage is not initialized", () => {
      // First get an ID with initialized storage
      const id = AvoStreamId.getAnonymousId();
      expect(id).not.toBe("unknown");

      // Force storage to appear uninitialized
      (AvoInspector.avoStorage.storageImpl as any).storageInitialized = false;

      // Should still return cached ID
      const result = AvoStreamId.getAnonymousId();
      expect(result).toBe(id);
    });

    test("generates a new ID when none is cached or stored", () => {
      AvoInspector.avoStorage.removeItem(AvoStreamId.streamIdKey);
      AvoInspector.avoStorage.removeItem(AvoStreamId.createdAtKey);
      AvoInspector.avoStorage.removeItem(AvoStreamId.lastActivityKey);
      AvoStreamId["_anonymousId"] = null;

      const id = AvoStreamId.getAnonymousId();

      expect(id).not.toBeNull();
      expect(id).not.toBe("unknown");
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });

    test("returns cached ID on subsequent calls", () => {
      AvoInspector.avoStorage.removeItem(AvoStreamId.streamIdKey);
      AvoStreamId["_anonymousId"] = null;

      const id1 = AvoStreamId.getAnonymousId();
      const id2 = AvoStreamId.getAnonymousId();

      expect(id1).toBe(id2);
    });

    test("reads ID from storage if not in memory", () => {
      const storedId = "stored-stream-id";
      const now = Date.now();
      AvoInspector.avoStorage.setItem(AvoStreamId.streamIdKey, storedId);
      AvoInspector.avoStorage.setItem(AvoStreamId.createdAtKey, now);
      AvoInspector.avoStorage.setItem(AvoStreamId.lastActivityKey, now);
      AvoStreamId["_anonymousId"] = null;

      const id = AvoStreamId.getAnonymousId();

      expect(id).toBe(storedId);
    });

    test("persists new ID to storage", () => {
      AvoInspector.avoStorage.removeItem(AvoStreamId.streamIdKey);
      AvoInspector.avoStorage.removeItem(AvoStreamId.createdAtKey);
      AvoInspector.avoStorage.removeItem(AvoStreamId.lastActivityKey);
      AvoStreamId["_anonymousId"] = null;

      const id = AvoStreamId.getAnonymousId();

      const storedId = AvoInspector.avoStorage.getItem<string>(AvoStreamId.streamIdKey);
      expect(storedId).toBe(id);

      const storedCreatedAt = AvoInspector.avoStorage.getItem<number>(AvoStreamId.createdAtKey);
      expect(storedCreatedAt).not.toBeNull();
      expect(typeof storedCreatedAt).toBe("number");

      const storedLastActivity = AvoInspector.avoStorage.getItem<number>(AvoStreamId.lastActivityKey);
      expect(storedLastActivity).not.toBeNull();
      expect(typeof storedLastActivity).toBe("number");
    });
  });

  describe("Model B: time-window reset (4h age AND 2h idle)", () => {
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

    test("does NOT reset when age > 4h but idle < 2h", () => {
      const now = Date.now();
      const createdLongAgo = now - FOUR_HOURS_MS - 1000; // > 4h ago
      const recentActivity = now - TWO_HOURS_MS + 60000;  // < 2h ago

      const storedId = "old-but-active-id";
      AvoInspector.avoStorage.setItem(AvoStreamId.streamIdKey, storedId);
      AvoInspector.avoStorage.setItem(AvoStreamId.createdAtKey, createdLongAgo);
      AvoInspector.avoStorage.setItem(AvoStreamId.lastActivityKey, recentActivity);
      AvoStreamId["_anonymousId"] = null;

      const id = AvoStreamId.getAnonymousId();

      expect(id).toBe(storedId);
    });

    test("does NOT reset when idle > 2h but age < 4h", () => {
      const now = Date.now();
      const createdRecently = now - FOUR_HOURS_MS + 60000; // < 4h ago
      const oldActivity = now - TWO_HOURS_MS - 1000;       // > 2h ago

      const storedId = "young-but-idle-id";
      AvoInspector.avoStorage.setItem(AvoStreamId.streamIdKey, storedId);
      AvoInspector.avoStorage.setItem(AvoStreamId.createdAtKey, createdRecently);
      AvoInspector.avoStorage.setItem(AvoStreamId.lastActivityKey, oldActivity);
      AvoStreamId["_anonymousId"] = null;

      const id = AvoStreamId.getAnonymousId();

      expect(id).toBe(storedId);
    });

    test("RESETS when BOTH age > 4h AND idle > 2h", () => {
      const now = Date.now();
      const createdLongAgo = now - FOUR_HOURS_MS - 1000; // > 4h ago
      const oldActivity = now - TWO_HOURS_MS - 1000;      // > 2h ago

      const storedId = "should-be-reset-id";
      AvoInspector.avoStorage.setItem(AvoStreamId.streamIdKey, storedId);
      AvoInspector.avoStorage.setItem(AvoStreamId.createdAtKey, createdLongAgo);
      AvoInspector.avoStorage.setItem(AvoStreamId.lastActivityKey, oldActivity);
      AvoStreamId["_anonymousId"] = null;

      const id = AvoStreamId.getAnonymousId();

      expect(id).not.toBe(storedId);
      expect(id).not.toBe("unknown");
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });

    test("does NOT reset when both age < 4h and idle < 2h", () => {
      const now = Date.now();
      const createdRecently = now - 1000;  // 1s ago
      const recentActivity = now - 500;     // 0.5s ago

      const storedId = "fresh-id";
      AvoInspector.avoStorage.setItem(AvoStreamId.streamIdKey, storedId);
      AvoInspector.avoStorage.setItem(AvoStreamId.createdAtKey, createdRecently);
      AvoInspector.avoStorage.setItem(AvoStreamId.lastActivityKey, recentActivity);
      AvoStreamId["_anonymousId"] = null;

      const id = AvoStreamId.getAnonymousId();

      expect(id).toBe(storedId);
    });

    test("updates lastActivityAt on each call", () => {
      AvoInspector.avoStorage.removeItem(AvoStreamId.streamIdKey);
      AvoInspector.avoStorage.removeItem(AvoStreamId.createdAtKey);
      AvoInspector.avoStorage.removeItem(AvoStreamId.lastActivityKey);
      AvoStreamId["_anonymousId"] = null;

      // First call generates and stores an ID
      AvoStreamId.getAnonymousId();

      // Second call should update lastActivityAt
      const beforeCall = Date.now();
      AvoStreamId.getAnonymousId();
      const afterCall = Date.now();

      const lastActivity = AvoInspector.avoStorage.getItem<number>(AvoStreamId.lastActivityKey);
      expect(lastActivity).toBeGreaterThanOrEqual(beforeCall);
      expect(lastActivity).toBeLessThanOrEqual(afterCall);
    });

    test("after reset, new ID has fresh createdAt and lastActivityAt", () => {
      const now = Date.now();
      const createdLongAgo = now - FOUR_HOURS_MS - 1000;
      const oldActivity = now - TWO_HOURS_MS - 1000;

      AvoInspector.avoStorage.setItem(AvoStreamId.streamIdKey, "old-id");
      AvoInspector.avoStorage.setItem(AvoStreamId.createdAtKey, createdLongAgo);
      AvoInspector.avoStorage.setItem(AvoStreamId.lastActivityKey, oldActivity);
      AvoStreamId["_anonymousId"] = null;

      const beforeReset = Date.now();
      AvoStreamId.getAnonymousId();
      const afterReset = Date.now();

      const newCreatedAt = AvoInspector.avoStorage.getItem<number>(AvoStreamId.createdAtKey);
      const newLastActivity = AvoInspector.avoStorage.getItem<number>(AvoStreamId.lastActivityKey);

      expect(newCreatedAt).toBeGreaterThanOrEqual(beforeReset);
      expect(newCreatedAt).toBeLessThanOrEqual(afterReset);
      expect(newLastActivity).toBeGreaterThanOrEqual(beforeReset);
      expect(newLastActivity).toBeLessThanOrEqual(afterReset);
    });
  });
});
