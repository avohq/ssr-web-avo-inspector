import { AvoStorage } from "../AvoStorage";
import { defaultOptions } from "../__tests__/constants";

const originalWindow = { ...window };

beforeEach(() => {
  window = originalWindow;
});

describe("Avo Storage", () => {
  const storage = new AvoStorage(defaultOptions.shouldLog);

  const key = "avoKey";
  const value = "avoValue";

  test("Sets and gets item with shouldLog on", () => {
    const storage = new AvoStorage(true);

    storage.setItem(key, value);

    const item = storage.getItem(key);

    expect(item).toBe(value);
  });

  test("Sets and gets item with shouldLog off", () => {
    const storage = new AvoStorage(false);

    storage.setItem(key, value);

    const item = storage.getItem(key);

    expect(item).toBe(value);
  });

  test("Gets item asynchronously", async () => {
    storage.removeItem(key);
    storage.setItem(key, value);

    const item = await storage.getItemAsync(key);

    expect(item).toBe(value);
  });

  test("Returns null if key does not exist", () => {
    storage.removeItem(key);

    const item = storage.getItem(key);

    expect(item).toBeNull();
  });

  test("Deletes item with shouldLog on", () => {
    const storage = new AvoStorage(true);

    storage.removeItem(key);

    const item = storage.getItem(key);

    expect(item).toBeNull();
  });

  test("Deletes item with shouldLog off", () => {
    const storage = new AvoStorage(false);

    storage.removeItem(key);

    const item = storage.getItem(key);

    expect(item).toBeNull();
  });
});

describe("Avo Storage unavailable", () => {
  const key = "avoKey";
  const value = "avoValue";

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {});
  });

  test("Fallback mode enabled", async () => {
    const storage = new AvoStorage(false);
    const storageImpl: any = storage.storageImpl;
    await new Promise(resolve => setTimeout(resolve, 1000));
    expect(storageImpl.storageInitialized).toBe(true);
  });

  test("Sets and gets item with shouldLog on", () => {
    const storage = new AvoStorage(true);

    storage.setItem(key, value);

    const item = storage.getItem(key);

    expect(item).toBe(value);
  });

  test("Sets and gets item with shouldLog off", () => {
    const storage = new AvoStorage(false);

    storage.setItem(key, value);

    const item = storage.getItem(key);

    expect(item).toBe(value);
  });

  test("Gets item asynchronously", async () => {
    const storage = new AvoStorage(false);

    storage.removeItem(key);
    storage.setItem(key, value);

    const item = await storage.getItemAsync(key);

    expect(item).toBe(value);
  });

  test("Returns null if key does not exist", () => {
    const storage = new AvoStorage(false);

    storage.removeItem(key);

    const item = storage.getItem(key);

    expect(item).toBeNull();
  });

  test("Deletes item with shouldLog on", () => {
    const storage = new AvoStorage(true);

    storage.removeItem(key);

    const item = storage.getItem(key);

    expect(item).toBeNull();
  });

  test("Deletes item with shouldLog off", () => {
    const storage = new AvoStorage(false);

    storage.removeItem(key);

    const item = storage.getItem(key);

    expect(item).toBeNull();
  });
});