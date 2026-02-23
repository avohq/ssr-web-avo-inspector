import { AvoInspector } from "../AvoInspector";

import { defaultOptions } from "../__tests__/constants";

jest.mock("../AvoBatcher");
jest.mock("../AvoNetworkCallsHandler");

describe("Sessions (replaced by AvoStreamId)", () => {
  test("AvoInspector no longer has sessionTracker property", () => {
    const inspector = new AvoInspector(defaultOptions);
    expect((inspector as any).sessionTracker).toBeUndefined();
  });
});
