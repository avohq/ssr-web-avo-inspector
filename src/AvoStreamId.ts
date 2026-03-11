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
   * Returns null if AvoInspector.avoStorage is not initialized (caller
   * should omit streamId so the event is treated as a "wild event").
   */
  static getAnonymousId(): string | null {
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

    // Storage not ready — return null so callers omit streamId (wild event)
    if (!AvoStreamId.storageAvailable()) {
      return null;
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
