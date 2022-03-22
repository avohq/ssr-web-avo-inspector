import localforage = require("localforage");
import memoryDriver = require("localforage-driver-memory");

abstract class PlatformAvoStorage {
  abstract init(shouldLog: boolean, suffix: string): void;
  abstract getItemAsync<T>(key: string): Promise<T | null>;
  abstract getItem<T>(key: string): T | null;
  abstract setItem<T>(key: string, value: T): void;
  abstract removeItem(key: string): void;
  abstract runAfterInit(func: () => void): void;
  abstract isInitialized(): boolean;

  parseJson<T>(maybeItem: string | null | undefined): T | null {
    if (maybeItem !== null && maybeItem !== undefined) {
      return JSON.parse(maybeItem);
    } else {
      return null;
    }
  }
}

let memoryStorage: { [key: string]: string | null } = {};

class BrowserAvoStorage extends PlatformAvoStorage {
  localForage: LocalForage | null = null;
  onStorageInitFuncs: Array<() => void> = [];
  shouldLog: boolean = false;
  storageInitialized = false;

  init(shouldLog: boolean, suffix: string) {
    this.shouldLog = shouldLog;

    if (this.createLocalForage(suffix)) {
      this.localForage?.ready().then(() => {
        this.loadDataToMemoryToAvoidAsyncQueries(() => {
          this.onInitializeStorageWeb();
        });
      }).catch((error) => {
        if (this.shouldLog && typeof window !== "undefined") {
          if (typeof window !== "undefined") {
            console.log("Avo Inspector: Using in-memory storage because:", error);
          } else {
            console.log("Avo Inspector: Using in-memory storage");
          }
        }
        this.onInitializeStorageWeb();
      });
    } else {
      this.onInitializeStorageWeb();
    }
  }

  private loadDataToMemoryToAvoidAsyncQueries(onLoaded: () => void) {
    if (this.localForage == null) {
      onLoaded();
    } else {
      let thisStorage = this;
      this.localForage?.iterate(function (value, key, _iterationNumber) {
        if (typeof value === 'string') {
          memoryStorage[key] = value;
        }
        if (thisStorage.shouldLog) {
          console.log("Avo Inspector: loaded data from memory", key, value);
        }
      })
        .then((_) => {
          onLoaded();
        }).catch((error) => {
          if (this.shouldLog) {
            if (typeof window !== "undefined") {
              console.log("Avo Inspector load data: Using in-memory storage because:", error);
            } else {
              console.log("Avo Inspector load data: Using in-memory storage");
            }
          }
          onLoaded();
        });
    }
  }

  private onInitializeStorageWeb() {
    this.storageInitialized = true;
    this.onStorageInitFuncs.forEach((func) => {
      func();
    });
  }

  private createLocalForage(suffix: string): boolean {
    try {
      this.localForage = localforage.createInstance({
        name: "avoinspector" + suffix
      });
      this.localForage.defineDriver(memoryDriver);
      this.localForage.setDriver([this.localForage.LOCALSTORAGE,
      this.localForage.INDEXEDDB, this.localForage.WEBSQL, memoryDriver._driver]);
      return true;
    } catch (error) {
      return false;
    }
  }

  isInitialized() {
    return this.storageInitialized;
  }

  getItemAsync<T>(key: string): Promise<T | null> {
    let thisStorage = this;
    return new Promise(function (resolve, _reject) {
      thisStorage.runAfterInit(() => {
        let maybeItem = /* thisStorage. */memoryStorage[key];
        resolve(thisStorage.parseJson(maybeItem));
      });
    });
  }

  getItem<T>(key: string): T | null {
    let maybeItem = memoryStorage[key];
    return this.parseJson(maybeItem);
  }

  setItem<T>(key: string, value: T): void {
    memoryStorage[key] = JSON.stringify(value);

    try {
      this.localForage?.setItem(key, JSON.stringify(value)).then(function (_) { }).catch((error) => {
        if (this.shouldLog) {
          if (typeof window !== "undefined") {
            console.log("Avo Inspector: Using in-memory storage because:", error);
          } else {
            console.log("Avo Inspector: Using in-memory storage");
          }
        }
      });
    } catch (error) {
      if (this.shouldLog) {
        console.log("Avo Inspector: Using in-memory storage because:", error);
      }

    }
  }

  removeItem(key: string): void {
    memoryStorage[key] = null;
    try {
      this.localForage?.removeItem(key).then(function () { }).catch((err) => {
        if (this.shouldLog) {
          if (typeof window !== "undefined") {
            console.log('Avo Inspector: Using in-memory storage because:', err);
          } else {
            console.log('Avo Inspector: Using in-memory storage');
          }
        }
      });
    } catch (error) {
      if (this.shouldLog) {
        console.error("Avo Inspector: Using in-memory storage because:", error);
      }
    }
  }

  runAfterInit(func: () => void): void {
    if (this.isInitialized()) {
      func();
    } else {
      this.onStorageInitFuncs.push(func);
    }
  }
}

export class AvoStorage {
  Platform: string | null = null;

  storageImpl: PlatformAvoStorage;

  constructor(shouldLog: boolean, suffix: string = "") {
    this.Platform = "browser";
    this.storageImpl = new BrowserAvoStorage();
    this.storageImpl.init(shouldLog, suffix);
  }

  isInitialized() {
    return this.storageImpl.isInitialized();
  }

  getItemAsync<T>(key: string): Promise<T | null> {
    return this.storageImpl.getItemAsync(key);
  }

  getItem<T>(key: string): T | null {
    return this.storageImpl.getItem(key);
  }

  setItem<T>(key: string, value: T): void {
    this.storageImpl.setItem(key, value);
  }

  removeItem(key: string): void {
    this.storageImpl.removeItem(key);
  }

  runAfterInit(func: () => void): void {
    this.storageImpl.runAfterInit(func);
  }
}
