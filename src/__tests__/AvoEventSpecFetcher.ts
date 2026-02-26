import { AvoEventSpecFetcher } from "../eventSpec/AvoEventSpecFetcher";
import type { EventSpecResponse } from "../eventSpec/AvoEventSpecFetchTypes";

// Mock global fetch
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

function makeValidWireResponse() {
  return {
    events: [
      {
        b: "branch1",
        id: "evt_1",
        vids: ["var_1"],
        p: {
          method: { t: "string", r: true, p: { email: ["evt_1"] } },
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

describe("AvoEventSpecFetcher", () => {
  let fetcher: AvoEventSpecFetcher;

  beforeEach(() => {
    mockFetch.mockReset();
    fetcher = new AvoEventSpecFetcher(2000, false, "dev", "https://api.test.com");
  });

  test("returns null in production environment", async () => {
    const prodFetcher = new AvoEventSpecFetcher(2000, false, "prod");
    const result = await prodFetcher.fetch({
      apiKey: "key",
      streamId: "stream",
      eventName: "test",
    });
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("fetches and parses wire format correctly", async () => {
    const wireResponse = makeValidWireResponse();
    mockFetch.mockResolvedValue({
      status: 200,
      json: async () => wireResponse,
    });

    const result = await fetcher.fetch({
      apiKey: "key",
      streamId: "stream",
      eventName: "test",
    });

    expect(result).not.toBeNull();
    expect(result).not.toBe("transient_error");
    const spec = result as EventSpecResponse;
    expect(spec.events[0].branchId).toBe("branch1");
    expect(spec.events[0].baseEventId).toBe("evt_1");
    expect(spec.events[0].variantIds).toEqual(["var_1"]);
    expect(spec.events[0].props.method.type).toBe("string");
    expect(spec.events[0].props.method.required).toBe(true);
    expect(spec.events[0].props.method.pinnedValues).toEqual({
      email: ["evt_1"],
    });
    expect(spec.metadata.schemaId).toBe("schema1");
  });

  test("builds correct URL with query parameters", async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      json: async () => makeValidWireResponse(),
    });

    await fetcher.fetch({
      apiKey: "my-key",
      streamId: "my-stream",
      eventName: "Sign Up",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("https://api.test.com/trackingPlan/eventSpec?"),
      expect.objectContaining({ method: "GET" })
    );
    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain("apiKey=my-key");
    expect(url).toContain("streamId=my-stream");
    expect(url).toContain("eventName=Sign+Up");
  });

  test("returns transient_error on non-200 status", async () => {
    mockFetch.mockResolvedValue({
      status: 404,
      json: async () => ({}),
    });

    const result = await fetcher.fetch({
      apiKey: "key",
      streamId: "stream",
      eventName: "test",
    });
    expect(result).toBe("transient_error");
  });

  test("returns transient_error on invalid response shape", async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      json: async () => ({ invalid: true }),
    });

    const result = await fetcher.fetch({
      apiKey: "key",
      streamId: "stream",
      eventName: "test",
    });
    expect(result).toBe("transient_error");
  });

  test("returns transient_error on network error", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetcher.fetch({
      apiKey: "key",
      streamId: "stream",
      eventName: "test",
    });
    expect(result).toBe("transient_error");
  });

  test("returns transient_error on JSON parse error", async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      json: async () => {
        throw new Error("Invalid JSON");
      },
    });

    const result = await fetcher.fetch({
      apiKey: "key",
      streamId: "stream",
      eventName: "test",
    });
    expect(result).toBe("transient_error");
  });

  test("returns null (cacheable) on event_not_found response", async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      json: async () => ({ error: "event_not_found", name: "Unknown Event" }),
    });

    const result = await fetcher.fetch({
      apiKey: "key",
      streamId: "stream",
      eventName: "Unknown Event",
    });
    expect(result).toBeNull();
  });

  test("in-flight de-duplication: exactly ONE fetch for concurrent same-key events", async () => {
    let resolveJson: Function;
    const jsonPromise = new Promise((resolve) => {
      resolveJson = resolve;
    });

    mockFetch.mockReturnValue(
      Promise.resolve({
        status: 200,
        json: () => jsonPromise,
      })
    );

    const params = { apiKey: "key", streamId: "stream", eventName: "test" };

    // Start two concurrent fetches
    const promise1 = fetcher.fetch(params);
    const promise2 = fetcher.fetch(params);

    // Resolve the JSON
    resolveJson!(makeValidWireResponse());

    const [result1, result2] = await Promise.all([promise1, promise2]);

    // Both should get the same result
    expect(result1).toEqual(result2);
    // Only one fetch call should have been made
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("in-flight failure: all queued callbacks resolved with null on fetch failure", async () => {
    let rejectFetch: Function;
    const fetchPromise = new Promise((_resolve, reject) => {
      rejectFetch = reject;
    });

    mockFetch.mockReturnValue(fetchPromise);

    const params = { apiKey: "key", streamId: "stream", eventName: "test" };

    const promise1 = fetcher.fetch(params);
    const promise2 = fetcher.fetch(params);

    rejectFetch!(new Error("Network failure"));

    const [result1, result2] = await Promise.all([promise1, promise2]);

    expect(result1).toBe("transient_error");
    expect(result2).toBe("transient_error");
  });

  test("works in staging environment", async () => {
    const stagingFetcher = new AvoEventSpecFetcher(
      2000,
      false,
      "staging",
      "https://api.test.com"
    );

    mockFetch.mockResolvedValue({
      status: 200,
      json: async () => makeValidWireResponse(),
    });

    const result = await stagingFetcher.fetch({
      apiKey: "key",
      streamId: "stream",
      eventName: "test",
    });
    expect(result).not.toBeNull();
  });

  test("parses property constraints including children, lists, regex, allowedValues, minmax", async () => {
    const wireResponse = {
      events: [
        {
          b: "branch1",
          id: "evt_1",
          vids: [],
          p: {
            name: {
              t: "string",
              r: true,
              rx: { "^[A-Z]": ["evt_1"] },
              v: { '["option1","option2"]': ["evt_1"] },
            },
            age: {
              t: "int",
              r: false,
              minmax: { "0,120": ["evt_1"] },
            },
            items: {
              t: "object",
              r: false,
              l: true,
              children: {
                id: { t: "string", r: true },
              },
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

    mockFetch.mockResolvedValue({
      status: 200,
      json: async () => wireResponse,
    });

    const result = await fetcher.fetch({
      apiKey: "key",
      streamId: "stream",
      eventName: "test",
    });

    expect(result).not.toBeNull();
    expect(result).not.toBe("transient_error");
    const props = (result as EventSpecResponse).events[0].props;

    expect(props.name.regexPatterns).toEqual({ "^[A-Z]": ["evt_1"] });
    expect(props.name.allowedValues).toEqual({
      '["option1","option2"]': ["evt_1"],
    });
    expect(props.age.minMaxRanges).toEqual({ "0,120": ["evt_1"] });
    expect(props.items.isList).toBe(true);
    expect(props.items.children).toBeDefined();
    expect(props.items.children!.id.type).toBe("string");
  });
});
