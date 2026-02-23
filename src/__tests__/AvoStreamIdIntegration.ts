import AvoGuid from "../AvoGuid";
import { AvoNetworkCallsHandler, BaseBody } from "../AvoNetworkCallsHandler";
import { AvoStreamId } from "../AvoStreamId";
import { AvoInspector } from "../AvoInspector";

global.fetch = jest.fn(() =>
  Promise.resolve({
    status: 200,
    json: () => Promise.resolve({ test: 100 }),
  }),
) as jest.Mock;

import {
  defaultOptions,
  mockedReturns,
} from "./constants";

const inspectorVersion = process.env.npm_package_version || "";

describe("AvoStreamId integration with AvoNetworkCallsHandler", () => {
  const { apiKey, env, version } = defaultOptions;

  let networkHandler: AvoNetworkCallsHandler;

  beforeAll(() => {
    new AvoInspector(defaultOptions);

    jest
      .spyOn(AvoGuid as any, "newGuid")
      .mockImplementation(() => mockedReturns.GUID);

    jest
      .spyOn(AvoStreamId as any, "getAnonymousId")
      .mockImplementation(() => mockedReturns.ANONYMOUS_ID);

    networkHandler = new AvoNetworkCallsHandler(
      apiKey,
      env,
      "",
      version,
      inspectorVersion,
    );
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  test("BaseBody contains anonymousId, not sessionId or trackingId", () => {
    const body = networkHandler.bodyForSessionStartedCall();

    expect(body).toHaveProperty("anonymousId");
    expect(body).not.toHaveProperty("sessionId");
    expect(body).not.toHaveProperty("trackingId");
  });

  test("BaseBody has libPlatform set to 'web'", () => {
    const body = networkHandler.bodyForSessionStartedCall();

    expect(body.libPlatform).toBe("web");
  });

  test("fixSessionAndTrackingIds method does NOT exist", () => {
    expect((networkHandler as any).fixSessionAndTrackingIds).toBeUndefined();
  });

  test("AvoInspector does not have sessionTracker", () => {
    // Create with spies still active (AvoGuid.newGuid is mocked)
    // Need to temporarily restore Date if it was mocked
    const inspector = new AvoInspector(defaultOptions);
    expect((inspector as any).sessionTracker).toBeUndefined();
  });

  test("anonymousId in BaseBody comes from AvoStreamId", () => {
    const body = networkHandler.bodyForSessionStartedCall();
    expect(body.anonymousId).toBe(mockedReturns.ANONYMOUS_ID);
  });
});
