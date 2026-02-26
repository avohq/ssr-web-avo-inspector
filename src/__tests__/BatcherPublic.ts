import { AvoBatcher } from "../AvoBatcher";
import { AvoInspector } from "../AvoInspector";
import { AvoInspectorEnv } from "../AvoInspectorEnv";
import { AvoNetworkCallsHandler } from "../AvoNetworkCallsHandler";

import { defaultOptions } from "./constants";

const inspectorVersion = process.env.npm_package_version || "";

jest.mock("../AvoBatcher");
jest.mock("../AvoStorage");

describe("Batcher", () => {
  let inspector: AvoInspector;

  const { apiKey, env, version } = defaultOptions;
  let networkHandler = new AvoNetworkCallsHandler(
    apiKey,
    env,
    "",
    version,
    inspectorVersion,
  );

  beforeAll(() => {
    inspector = new AvoInspector(defaultOptions);
    inspector.enableLogging(false);
  });

  afterEach(() => {
    jest.clearAllMocks();
    // @ts-ignore
    inspector.avoDeduplicator._clearEvents();
  });

  test("Batcher is initialized on Inspector init", () => {
    expect(AvoBatcher).toHaveBeenCalledTimes(1);
    expect(AvoBatcher).toHaveBeenCalledWith(networkHandler);
  });

  test("handleTrackSchema is called on trackSchema", () => {
    const eventName = "event name";
    const schema = [
      {
        propertyName: "prop0",
        propertyType: "string",
      },
      {
        propertyName: "prop1",
        propertyType: "string",
      },
    ];

    inspector.trackSchema(eventName, schema);

    expect(inspector.avoBatcher.handleTrackSchema).toHaveBeenCalledTimes(1);
    expect(inspector.avoBatcher.handleTrackSchema).toBeCalledWith(
      eventName,
      schema,
      null,
      null
    );
  });

  describe("dev/staging: immediate send path", () => {
    let devInspector: AvoInspector;

    beforeEach(() => {
      devInspector = new AvoInspector({
        apiKey: "api-key-xxx",
        env: AvoInspectorEnv.Dev,
        version: "1",
      });
      devInspector.enableLogging(false);
    });

    afterEach(() => {
      // @ts-ignore
      devInspector.avoDeduplicator._clearEvents();
    });

    test("event is sent immediately on trackSchemaFromEvent", async () => {
      const eventName = "event name";
      const properties = {
        prop0: "",
        prop2: false,
        prop3: 0,
        prop4: 0.0,
      };

      const callImmediatelySpy = jest.spyOn(
        (devInspector as any).avoNetworkCallsHandler,
        "callInspectorImmediately"
      ).mockImplementation((_body: any, cb: any) => cb(null));

      await devInspector.trackSchemaFromEvent(eventName, properties);

      expect(callImmediatelySpy).toHaveBeenCalledTimes(1);
      const sentBody = callImmediatelySpy.mock.calls[0][0] as any;
      expect(sentBody.eventName).toBe(eventName);
      expect(sentBody.avoFunction).toBe(false);

      callImmediatelySpy.mockRestore();
    });

    test("event is sent immediately on _avoFunctionTrackSchemaFromEvent", async () => {
      const eventName = "event name";
      const properties = {
        prop0: "",
        prop2: false,
        prop3: 0,
        prop4: 0.0,
      };
      const eventId = "testId";
      const eventHash = "testHash";

      const callImmediatelySpy = jest.spyOn(
        (devInspector as any).avoNetworkCallsHandler,
        "callInspectorImmediately"
      ).mockImplementation((_body: any, cb: any) => cb(null));

      // @ts-ignore
      await devInspector._avoFunctionTrackSchemaFromEvent(eventName, properties, eventId, eventHash);

      expect(callImmediatelySpy).toHaveBeenCalledTimes(1);
      const sentBody = callImmediatelySpy.mock.calls[0][0] as any;
      expect(sentBody.eventName).toBe(eventName);
      expect(sentBody.avoFunction).toBe(true);
      expect(sentBody.eventId).toBe(eventId);
      expect(sentBody.eventHash).toBe(eventHash);

      callImmediatelySpy.mockRestore();
    });
  });

  describe("prod: batched send path", () => {
    test("trackSchemaFromEvent uses batcher in prod", async () => {
      const eventName = "event name";
      const properties = {
        prop0: "",
        prop2: false,
      };

      const callImmediatelySpy = jest.spyOn(
        (inspector as any).avoNetworkCallsHandler,
        "callInspectorImmediately"
      );

      await inspector.trackSchemaFromEvent(eventName, properties);

      expect(callImmediatelySpy).not.toHaveBeenCalled();
      expect(inspector.avoBatcher.handleTrackSchema).toHaveBeenCalledTimes(1);

      callImmediatelySpy.mockRestore();
    });

    test("_avoFunctionTrackSchemaFromEvent uses batcher in prod", async () => {
      const eventName = "event name";
      const properties = {
        prop0: "",
        prop2: false,
      };

      const callImmediatelySpy = jest.spyOn(
        (inspector as any).avoNetworkCallsHandler,
        "callInspectorImmediately"
      );

      // @ts-ignore
      await inspector._avoFunctionTrackSchemaFromEvent(eventName, properties, "testId", "testHash");

      expect(callImmediatelySpy).not.toHaveBeenCalled();
      expect(inspector.avoBatcher.handleTrackSchema).toHaveBeenCalledTimes(1);

      callImmediatelySpy.mockRestore();
    });
  });

  test("batchSize is updated", () => {
    const count = 10;

    inspector.setBatchSize(count);

    expect(AvoInspector.batchSize).toBe(count);
  });

  test("batchFlushSeconds is updated", () => {
    const seconds = 10;

    inspector.setBatchFlushSeconds(seconds);

    expect(AvoInspector.batchFlushSeconds).toBe(seconds);
  });
});
