import AvoGuid from "./AvoGuid";
import { AvoInspector } from "./AvoInspector";

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export class AvoStreamId {
  private static _anonymousId: string | null = null;

  /**
   * Returns the anonymous ID using Model B (time-window client).
   * Resets when BOTH:
   *   - age > 4 hours (time since creation)
   *   - idle > 2 hours (time since last activity)
   *
   * When storage is not yet initialized, generates an in-memory ID immediately
   * and schedules a sync once storage is ready (for cross-session continuity).
   */
  static getAnonymousId(): string {
    const now = Date.now();

    // If we have a cached in-memory ID, check if it needs reset
    if (AvoStreamId._anonymousId !== null) {
      if (AvoStreamId.storageAvailable() && AvoStreamId.shouldReset(now)) {
        AvoStreamId.createNewId(now);
      } else if (AvoStreamId.storageAvailable()) {
        AvoStreamId.updateLastActivity(now);
      }
      return AvoStreamId._anonymousId as string;
    }

    // Storage not yet initialized — generate an in-memory ID immediately so
    // early callers (e.g. validateEvent) get a real ID instead of 'unknown'.
    // Once storage is ready, sync: load the persisted ID if one exists (for
    // cross-session continuity), or persist the in-memory ID if not.
    if (!AvoStreamId.storageAvailable()) {
      AvoStreamId._anonymousId = AvoGuid.newGuid();
      AvoInspector.avoStorage.runAfterInit(() => {
        AvoStreamId.syncWithStorageAfterInit(Date.now());
      });
      return AvoStreamId._anonymousId as string;
    }

    // Try to load from storage
    let storedId: string | null = null;
    try {
      storedId = AvoInspector.avoStorage.getItem<string>(AvoStreamId.streamIdKey);
    } catch (e) {
      console.error(
        "Avo Inspector: something went wrong. Please report to support@avo.app.",
        e
      );
    }

    if (storedId !== null && storedId !== undefined) {
      // Check if the stored ID needs to be reset
      if (AvoStreamId.shouldReset(now)) {
        AvoStreamId.createNewId(now);
      } else {
        AvoStreamId._anonymousId = storedId;
        AvoStreamId.updateLastActivity(now);
      }
    } else {
      AvoStreamId.createNewId(now);
    }

    return AvoStreamId._anonymousId as string;
  }

  private static storageAvailable(): boolean {
    return !!AvoInspector.avoStorage && AvoInspector.avoStorage.isInitialized();
  }

  private static shouldReset(now: number): boolean {
    let createdAt: number | null = null;
    let lastActivity: number | null = null;

    try {
      createdAt = AvoInspector.avoStorage.getItem<number>(AvoStreamId.createdAtKey);
      lastActivity = AvoInspector.avoStorage.getItem<number>(AvoStreamId.lastActivityKey);
    } catch (e) {
      // If we can't read timestamps, don't reset
      return false;
    }

    if (createdAt === null || createdAt === undefined || lastActivity === null || lastActivity === undefined) {
      return false;
    }

    const age = now - createdAt;
    const idle = now - lastActivity;

    return age > FOUR_HOURS_MS && idle > TWO_HOURS_MS;
  }

  /**
   * Called once storage becomes available. Loads any persisted ID to maintain
   * cross-session continuity, or persists the in-memory ID created before
   * storage was ready.
   */
  private static syncWithStorageAfterInit(now: number): void {
    try {
      const storedId = AvoInspector.avoStorage.getItem<string>(AvoStreamId.streamIdKey);
      if (storedId !== null && storedId !== undefined && !AvoStreamId.shouldReset(now)) {
        // Restore from persisted session — replace the temporary in-memory ID
        AvoStreamId._anonymousId = storedId;
        AvoStreamId.updateLastActivity(now);
      } else {
        // No valid stored ID — persist the in-memory ID we already generated
        AvoInspector.avoStorage.setItem(AvoStreamId.streamIdKey, AvoStreamId._anonymousId);
        AvoInspector.avoStorage.setItem(AvoStreamId.createdAtKey, now);
        AvoInspector.avoStorage.setItem(AvoStreamId.lastActivityKey, now);
      }
    } catch (e) {
      console.error(
        "Avo Inspector: something went wrong. Please report to support@avo.app.",
        e
      );
    }
  }

  private static createNewId(now: number): void {
    AvoStreamId._anonymousId = AvoGuid.newGuid();
    try {
      AvoInspector.avoStorage.setItem(AvoStreamId.streamIdKey, AvoStreamId._anonymousId);
      AvoInspector.avoStorage.setItem(AvoStreamId.createdAtKey, now);
      AvoInspector.avoStorage.setItem(AvoStreamId.lastActivityKey, now);
    } catch (e) {
      console.error(
        "Avo Inspector: something went wrong. Please report to support@avo.app.",
        e
      );
    }
  }

  private static updateLastActivity(now: number): void {
    try {
      AvoInspector.avoStorage.setItem(AvoStreamId.lastActivityKey, now);
    } catch (e) {
      console.error(
        "Avo Inspector: something went wrong. Please report to support@avo.app.",
        e
      );
    }
  }

  static get streamIdKey(): string {
    return "AvoInspectorStreamId";
  }

  static get createdAtKey(): string {
    return "AvoInspectorStreamIdCreatedAt";
  }

  static get lastActivityKey(): string {
    return "AvoInspectorStreamIdLastActivityAt";
  }
}
