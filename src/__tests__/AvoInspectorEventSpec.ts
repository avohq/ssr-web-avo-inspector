/**
 * Integration tests for AvoInspector validation pipeline.
 * Tests that AvoInspector integrates with EventSpecFetcher and EventValidator
 * in dev/staging environments only.
 */
import { AvoInspector } from "../AvoInspector";
import { AvoInspectorEnv } from "../AvoInspectorEnv";

// Mock global fetch
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

function makeValidWireResponse(eventName: string = "testEvent") {
  return {
    events: [
      {
        b: "branch1",
        id: "evt_1",
        vids: [],
        p: {
          method: {
            t: "string",
            r: true,
            p: { email: ["evt_1"] },
          },
        },
      },
    ],
    metadata: {
      schemaId: "schema1",
      branchId: "branch1",
      latestActionId: "action1",
    },
  };
}

describe("AvoInspector Event Spec Validation Pipeline", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  test("validateEvent returns null in prod environment (no spec fetch)", async () => {
    // Mock fetch to return tracking endpoint OK, spec should NOT be called in prod
    mockFetch.mockResolvedValue({
      status: 200,
      json: async () => ({ samplingRate: 1 }),
    });

    const inspector = new AvoInspector({
      apiKey: "test-api-key",
      env: AvoInspectorEnv.Prod,
      version: "1.0",
    });

    const result = await inspector.validateEvent("testEvent", { method: "email" });
    expect(result).toBeNull();
  });

  test("validateEvent fetches spec and returns validation result in dev environment", async () => {
    // First call is from the trackingEndpoint (if needed), second from eventSpec
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("eventSpec")) {
        return Promise.resolve({
          status: 200,
          json: async () => makeValidWireResponse(),
        });
      }
      return Promise.resolve({
        status: 200,
        json: async () => ({ samplingRate: 1 }),
      });
    });

    const inspector = new AvoInspector({
      apiKey: "test-api-key",
      env: AvoInspectorEnv.Dev,
      version: "1.0",
    });

    const result = await inspector.validateEvent("testEvent", { method: "email" });

    // Result should contain validation data
    expect(result).not.toBeNull();
    expect(result!.metadata).toBeDefined();
    expect(result!.propertyResults).toBeDefined();
  });

  test("validateEvent returns null when spec fetch fails", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("eventSpec")) {
        return Promise.reject(new Error("Network error"));
      }
      return Promise.resolve({
        status: 200,
        json: async () => ({ samplingRate: 1 }),
      });
    });

    const inspector = new AvoInspector({
      apiKey: "test-api-key",
      env: AvoInspectorEnv.Dev,
      version: "1.0",
    });

    const result = await inspector.validateEvent("testEvent", { method: "email" });
    // Validation gracefully degrades to null on fetch failure
    expect(result).toBeNull();
  });

  test("validateEvent returns null on transient error (non-200 status) without caching", async () => {
    let fetchCount = 0;
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("eventSpec")) {
        fetchCount++;
        return Promise.resolve({
          status: 404,
          json: async () => ({}),
        });
      }
      return Promise.resolve({
        status: 200,
        json: async () => ({ samplingRate: 1 }),
      });
    });

    const inspector = new AvoInspector({
      apiKey: "test-api-key",
      env: AvoInspectorEnv.Dev,
      version: "1.0",
    });

    const result = await inspector.validateEvent("testEvent", { method: "email" });
    expect(result).toBeNull();

    // Call again — should NOT be cached, so fetcher is called again
    const result2 = await inspector.validateEvent("testEvent", { method: "email" });
    expect(result2).toBeNull();
    expect(fetchCount).toBe(2);
  });

  test("validateEvent returns null and caches when event_not_found", async () => {
    let fetchCount = 0;
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("eventSpec")) {
        fetchCount++;
        return Promise.resolve({
          status: 200,
          json: async () => ({ error: "event_not_found", name: "testEvent" }),
        });
      }
      return Promise.resolve({
        status: 200,
        json: async () => ({ samplingRate: 1 }),
      });
    });

    const inspector = new AvoInspector({
      apiKey: "test-api-key",
      env: AvoInspectorEnv.Dev,
      version: "1.0",
    });

    const result = await inspector.validateEvent("testEvent", { method: "email" });
    expect(result).toBeNull();

    // Call again — should be cached, so fetcher is NOT called again
    const result2 = await inspector.validateEvent("testEvent", { method: "email" });
    expect(result2).toBeNull();
    expect(fetchCount).toBe(1);
  });

  test("validateEvent works in staging environment", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("eventSpec")) {
        return Promise.resolve({
          status: 200,
          json: async () => makeValidWireResponse(),
        });
      }
      return Promise.resolve({
        status: 200,
        json: async () => ({ samplingRate: 1 }),
      });
    });

    const inspector = new AvoInspector({
      apiKey: "test-api-key",
      env: AvoInspectorEnv.Staging,
      version: "1.0",
    });

    const result = await inspector.validateEvent("testEvent", { method: "email" });
    expect(result).not.toBeNull();
  });

  test("validateEvent detects property validation failures", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("eventSpec")) {
        return Promise.resolve({
          status: 200,
          json: async () => makeValidWireResponse(),
        });
      }
      return Promise.resolve({
        status: 200,
        json: async () => ({ samplingRate: 1 }),
      });
    });

    const inspector = new AvoInspector({
      apiKey: "test-api-key",
      env: AvoInspectorEnv.Dev,
      version: "1.0",
    });

    // "phone" is not the pinned value "email" for evt_1
    const result = await inspector.validateEvent("testEvent", { method: "phone" });

    expect(result).not.toBeNull();
    expect(result!.propertyResults.method.failedEventIds).toContain("evt_1");
  });

  test("branchId cache flush: cache is cleared when branchId changes", async () => {
    let callCount = 0;
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("eventSpec")) {
        callCount++;
        const branchId = callCount === 1 ? "branch1" : "branch2";
        return Promise.resolve({
          status: 200,
          json: async () => ({
            events: [{ b: branchId, id: "evt_1", vids: [], p: {} }],
            metadata: {
              schemaId: "schema1",
              branchId,
              latestActionId: "action1",
            },
          }),
        });
      }
      return Promise.resolve({
        status: 200,
        json: async () => ({ samplingRate: 1 }),
      });
    });

    const inspector = new AvoInspector({
      apiKey: "test-api-key",
      env: AvoInspectorEnv.Dev,
      version: "1.0",
    });

    // First fetch returns branch1
    const result1 = await inspector.validateEvent("testEvent1", {});
    expect(result1!.metadata!.branchId).toBe("branch1");

    // Second fetch with different event name forces new fetch, returns branch2
    // branchId change should flush cache for previous entries
    const result2 = await inspector.validateEvent("testEvent2", {});
    expect(result2!.metadata!.branchId).toBe("branch2");
  });
});
