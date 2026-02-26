import { AvoBatcher } from "../AvoBatcher";
import { AvoInspector } from "../AvoInspector";
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

  test("event is sent immediately on trackSchemaFromEvent (with encryption path)", async () => {
    const eventName = "event name";
    const properties = {
      prop0: "",
      prop2: false,
      prop3: 0,
      prop4: 0.0,
    };

    const callImmediatelySpy = jest.spyOn(
      (inspector as any).avoNetworkCallsHandler,
      "callInspectorImmediately"
    ).mockImplementation((_body: any, cb: any) => cb(null));

    await inspector.trackSchemaFromEvent(eventName, properties);

    expect(callImmediatelySpy).toHaveBeenCalledTimes(1);
    const sentBody = callImmediatelySpy.mock.calls[0][0] as any;
    expect(sentBody.eventName).toBe(eventName);
    expect(sentBody.avoFunction).toBe(false);

    callImmediatelySpy.mockRestore();
  });

  test("event is sent immediately on _avoFunctionTrackSchemaFromEvent (with encryption path)", async () => {
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
      (inspector as any).avoNetworkCallsHandler,
      "callInspectorImmediately"
    ).mockImplementation((_body: any, cb: any) => cb(null));

    // @ts-ignore
    await inspector._avoFunctionTrackSchemaFromEvent(eventName, properties, eventId, eventHash);

    expect(callImmediatelySpy).toHaveBeenCalledTimes(1);
    const sentBody = callImmediatelySpy.mock.calls[0][0] as any;
    expect(sentBody.eventName).toBe(eventName);
    expect(sentBody.avoFunction).toBe(true);
    expect(sentBody.eventId).toBe(eventId);
    expect(sentBody.eventHash).toBe(eventHash);

    callImmediatelySpy.mockRestore();
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
