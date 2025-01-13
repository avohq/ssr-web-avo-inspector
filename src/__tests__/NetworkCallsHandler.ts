import AvoGuid from "../AvoGuid";
import { AvoInstallationId } from "../AvoInstallationId";
import { AvoNetworkCallsHandler, BaseBody } from "../AvoNetworkCallsHandler";
import { AvoSessionTracker } from "../AvoSessionTracker";

global.fetch = jest.fn(() =>
  Promise.resolve({
    status: 200,
    json: () => Promise.resolve({ test: 100 }),
  }),
) as jest.Mock;

import {
  defaultOptions,
  mockedReturns,
  requestMsg,
  trackingEndpoint,
} from "./constants";

const inspectorVersion = process.env.npm_package_version || "";

describe("NetworkCallsHandler", () => {
  const { apiKey, env, version } = defaultOptions;
  const appName = "";

  let networkHandler: AvoNetworkCallsHandler;
  let baseBody: BaseBody;

  const customCallback = jest.fn(() => { });
  const now = new Date();

  beforeAll(() => {
    // @ts-ignore
    jest.spyOn(global, "Date").mockImplementation(() => now);

    jest
      .spyOn(AvoInstallationId as any, "getInstallationId")
      .mockImplementation(() => mockedReturns.INSTALLATION_ID);

    jest
      .spyOn(AvoGuid as any, "newGuid")
      .mockImplementation(() => mockedReturns.GUID);

    jest
      .spyOn(AvoSessionTracker as any, "sessionId", "get")
      .mockImplementation(() => mockedReturns.SESSION_ID);

    networkHandler = new AvoNetworkCallsHandler(
      apiKey,
      env,
      "",
      version,
      inspectorVersion,
    );

    baseBody = {
      apiKey,
      appName,
      appVersion: version,
      libVersion: inspectorVersion,
      env,
      libPlatform: "web",
      messageId: mockedReturns.GUID,
      trackingId: mockedReturns.INSTALLATION_ID,
      createdAt: new Date().toISOString(),
      sessionId: mockedReturns.SESSION_ID,
      samplingRate: 1.0,
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("bodyForSessionStartedCall returns base body + session started body used for session started", () => {
    const body = networkHandler.bodyForSessionStartedCall();

    expect(body).toEqual({
      ...baseBody,
      type: "sessionStarted",
    });
  });

  test("bodyForEventSchemaCall returns base body + event schema used for event sending from non avo functions", () => {
    const eventName = "event name";
    const eventProperties = [{ propertyName: "prop0", propertyType: "string" }];

    const body = networkHandler.bodyForEventSchemaCall(
      eventName,
      eventProperties,
      null, null
    );

    expect(body).toEqual({
      ...baseBody,
      type: "event",
      eventName,
      eventProperties,
      avoFunction: false,
      eventId: null,
      eventHash: null
    });
  });

  test("bodyForEventSchemaCall returns base body + event schema used for event sending from avo functions", () => {
    const eventName = "event name";
    const eventId = "event id";
    const eventHash = "event hash";
    const eventProperties = [{ propertyName: "prop0", propertyType: "string" }];

    const body = networkHandler.bodyForEventSchemaCall(
      eventName,
      eventProperties,
      eventId,
      eventHash
    );

    expect(body).toEqual({
      ...baseBody,
      type: "event",
      eventName,
      eventProperties,
      avoFunction: true,
      eventId,
      eventHash
    });
  });

  test("POST request is not sent if event list is empty", () => {
    const events: any = [];

    networkHandler.callInspectorWithBatchBody(events, customCallback);

    expect(fetch).not.toHaveBeenCalled();
  });

  test("callInspectorWithBatchBody sends POST request", () => {
    const eventName = "event name";
    const eventProperties = [{ propertyName: "prop0", propertyType: "string" }];

    const sessionStartedBody = networkHandler.bodyForSessionStartedCall();
    const eventBody = networkHandler.bodyForEventSchemaCall(
      eventName,
      eventProperties,
      null, null
    );

    const events = [sessionStartedBody, eventBody];

    networkHandler.callInspectorWithBatchBody(events, (error) => {
      expect(error).toBe(null);
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("Custom callback is called when 200 OK", () => {
    const sessionStartedBody = networkHandler.bodyForSessionStartedCall();
    const events = [sessionStartedBody];

    networkHandler.callInspectorWithBatchBody(events, (error) => {
      expect(error).toBe(null);
    });
  });
  /*
  test("Custom callback is called with error when not 200 OK", () => {
    const axiosErrorMock = require("../__mocks__/axiosError").default;

    const sessionStartedBody = networkHandler.bodyForSessionStartedCall();
    const events = [sessionStartedBody];

    networkHandler.callInspectorWithBatchBody(events, (error) => {
      console.log("result", error);
      expect(error).toBe("Error 400: Bad Request");
    });
  });

  test("Custom callback is called onerror", () => {
    const xhrErrorMock = require("../__mocks__/axiosError").default;

    const sessionStartedBody = networkHandler.bodyForSessionStartedCall();
    const events = [sessionStartedBody];

    networkHandler.callInspectorWithBatchBody(events, customCallback);

    expect(customCallback).toBeCalledTimes(1);
    expect(customCallback).toBeCalledWith(requestMsg.ERROR);
  });

  test("Custom callback is called ontimeout", () => {
    const xhrErrorMock = require("../__mocks__/axiosError").default;

    const sessionStartedBody = networkHandler.bodyForSessionStartedCall();
    const events = [sessionStartedBody];

    networkHandler.callInspectorWithBatchBody(events, customCallback);

    expect(customCallback).toBeCalledTimes(1);
    expect(customCallback).toBeCalledWith(requestMsg.TIMEOUT);
  });*/
});
