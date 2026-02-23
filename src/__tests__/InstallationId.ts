import { AvoStreamId } from "../AvoStreamId";
import { AvoStorage } from "../AvoStorage";
import { AvoInspector } from "../AvoInspector";

import { defaultOptions } from "../__tests__/constants";

describe("InstallationId (replaced by AvoStreamId)", () => {
  beforeAll(() => {
    new AvoInspector(defaultOptions);
  });

  afterEach(() => {
    AvoStreamId["_anonymousId"] = null;
  });

  test("AvoStreamId provides anonymousId", () => {
    const id = AvoStreamId.getAnonymousId();
    expect(id).not.toBeNull();
    expect(id).not.toBe("unknown");
  });

  test("AvoStreamId reuses ID on subsequent calls", () => {
    const id1 = AvoStreamId.getAnonymousId();
    const id2 = AvoStreamId.getAnonymousId();
    expect(id1).toBe(id2);
  });
});
