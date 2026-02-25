import { AvoInspectorEnv, AvoInspectorEnvValueType } from "./AvoInspectorEnv";
import { AvoSchemaParser } from "./AvoSchemaParser";
import { AvoBatcher } from "./AvoBatcher";
import { AvoNetworkCallsHandler } from "./AvoNetworkCallsHandler";
import { AvoStorage } from "./AvoStorage";
import { AvoDeduplicator } from "./AvoDeduplicator";
import { AvoStreamId } from "./AvoStreamId";
import { AvoEventSpecFetcher } from "./eventSpec/AvoEventSpecFetcher";
import { EventSpecCache } from "./eventSpec/AvoEventSpecCache";
import { validateEvent as runValidation } from "./eventSpec/EventValidator";
import type { ValidationResult } from "./eventSpec/AvoEventSpecFetchTypes";

import { isValueEmpty } from "./utils";

const libVersion = require("../package.json").version;

export class AvoInspector {
  environment: AvoInspectorEnvValueType;
  avoBatcher: AvoBatcher;
  avoDeduplicator: AvoDeduplicator;
  apiKey: string;
  version: string;

  static avoStorage: AvoStorage;

  private eventSpecFetcher: AvoEventSpecFetcher;
  private eventSpecCache: EventSpecCache;
  /** Last seen branchId from event spec responses, used for cache flush on branch change */
  private lastSeenBranchId: string | null = null;

  private static _batchSize = 30;
  static get batchSize() {
    return this._batchSize;
  }
  static set batchSize(newSize: number) {
    if (newSize < 1) {
      this._batchSize = 1;
    } else {
      this._batchSize = newSize;
    }
  }

  private static _batchFlushSeconds = 30;
  static get batchFlushSeconds() {
    return this._batchFlushSeconds;
  }

  private static _shouldLog = false;
  static get shouldLog() {
    return this._shouldLog;
  }
  static set shouldLog(enable) {
    this._shouldLog = enable;
  }

  // constructor(apiKey: string, env: AvoInspectorEnv, version: string) {
  constructor(options: {
    apiKey: string;
    env: AvoInspectorEnvValueType;
    version: string;
    appName?: string;
    suffix?: string;
  }) {
    // the constructor does aggressive null/undefined checking because same code paths will be accessible from JS
    if (isValueEmpty(options.env)) {
      this.environment = AvoInspectorEnv.Dev;
      console.warn(
        "[Avo Inspector] No environment provided. Defaulting to dev."
      );
    } else if (Object.values(AvoInspectorEnv).indexOf(options.env) === -1) {
      this.environment = AvoInspectorEnv.Dev;
      console.warn(
        "[Avo Inspector] Unsupported environment provided. Defaulting to dev. Supported environments - Dev, Staging, Prod."
      );
    } else {
      this.environment = options.env;
    }

    if (isValueEmpty(options.apiKey)) {
      throw new Error(
        "[Avo Inspector] No API key provided. Inspector can't operate without API key."
      );
    } else {
      this.apiKey = options.apiKey;
    }

    if (isValueEmpty(options.version)) {
      throw new Error(
        "[Avo Inspector] No version provided. Many features of Inspector rely on versioning. Please provide comparable string version, i.e. integer or semantic."
      );
    } else {
      this.version = options.version;
    }

    if (this.environment === AvoInspectorEnv.Dev) {
      AvoInspector._batchSize = 1;
      AvoInspector._shouldLog = true;
    } else {
      AvoInspector._batchSize = 30;
      AvoInspector._batchFlushSeconds = 30;
      AvoInspector._shouldLog = false;
    }

    AvoInspector.avoStorage = new AvoStorage(AvoInspector._shouldLog, options.suffix != null ? options.suffix : "");

    let avoNetworkCallsHandler = new AvoNetworkCallsHandler(
      this.apiKey,
      this.environment.toString(),
      options.appName || "",
      this.version,
      libVersion
    );
    this.avoBatcher = new AvoBatcher(avoNetworkCallsHandler);
    this.avoDeduplicator = new AvoDeduplicator();

    // Initialize event spec validation (active in dev/staging only)
    this.eventSpecCache = new EventSpecCache(AvoInspector._shouldLog);
    this.eventSpecFetcher = new AvoEventSpecFetcher(
      2000,
      AvoInspector._shouldLog,
      this.environment.toString()
    );
  }

  trackSchemaFromEvent(
    eventName: string,
    eventProperties: { [propName: string]: any }
  ): Array<{
    propertyName: string;
    propertyType: string;
    children?: any;
  }> {
    try {
      if (
        this.avoDeduplicator.shouldRegisterEvent(
          eventName,
          eventProperties,
          false
        )
      ) {
        if (AvoInspector.shouldLog) {
          console.log(
            "Avo Inspector: supplied event " +
            eventName +
            " with params " +
            JSON.stringify(eventProperties)
          );
        }
        let eventSchema = this.extractSchema(eventProperties, false);
        this.trackSchemaInternal(eventName, eventSchema, null, null);
        return eventSchema;
      } else {
        if (AvoInspector.shouldLog) {
          console.log("Avo Inspector: Deduplicated event: " + eventName);
        }
        return [];
      }
    } catch (e) {
      console.error(
        "Avo Inspector: something went wrong. Please report to support@avo.app.",
        e
      );
      return [];
    }
  }

  private _avoFunctionTrackSchemaFromEvent(
    eventName: string,
    eventProperties: { [propName: string]: any },
    eventId: string,
    eventHash: string
  ): Array<{
    propertyName: string;
    propertyType: string;
    children?: any;
  }> {
    try {
      if (
        this.avoDeduplicator.shouldRegisterEvent(
          eventName,
          eventProperties,
          true
        )
      ) {
        if (AvoInspector.shouldLog) {
          console.log(
            "Avo Inspector: supplied event " +
            eventName +
            " with params " +
            JSON.stringify(eventProperties)
          );
        }
        let eventSchema = this.extractSchema(eventProperties, false);
        this.trackSchemaInternal(eventName, eventSchema, eventId, eventHash);
        return eventSchema;
      } else {
        if (AvoInspector.shouldLog) {
          console.log("Avo Inspector: Deduplicated event: " + eventName);
        }
        return [];
      }
    } catch (e) {
      console.error(
        "Avo Inspector: something went wrong. Please report to support@avo.app.",
        e
      );
      return [];
    }
  }

  trackSchema(
    eventName: string,
    eventSchema: Array<{
      propertyName: string;
      propertyType: string;
      children?: any;
    }>
  ): void {
    try {
      if (
        this.avoDeduplicator.shouldRegisterSchemaFromManually(
          eventName,
          eventSchema
        )
      ) {
        if (AvoInspector.shouldLog) {
          console.log(
            "Avo Inspector: supplied event " +
            eventName +
            " with schema " +
            JSON.stringify(eventSchema)
          );
        }
        this.trackSchemaInternal(eventName, eventSchema, null, null);
      } else {
        if (AvoInspector.shouldLog) {
          console.log("Avo Inspector: Deduplicated event: " + eventName);
        }
      }
    } catch (e) {
      console.error(
        "Avo Inspector: something went wrong. Please report to support@avo.app.",
        e
      );
    }
  }

  private trackSchemaInternal(
    eventName: string,
    eventSchema: Array<{
      propertyName: string;
      propertyType: string;
      children?: any;
    }>,
    eventId: string | null,
    eventHash: string | null
  ): void {
    try {
      this.avoBatcher.handleTrackSchema(
        eventName,
        eventSchema,
        eventId,
        eventHash
      );
    } catch (e) {
      console.error(
        "Avo Inspector: something went wrong. Please report to support@avo.app.",
        e
      );
    }
  }

  enableLogging(enable: boolean) {
    AvoInspector._shouldLog = enable;
  }

  extractSchema(
    eventProperties: {
      [propName: string]: any;
    },
    shouldLogIfEnabled = true
  ): Array<{
    propertyName: string;
    propertyType: string;
    children?: any;
  }> {
    try {
      if (this.avoDeduplicator.hasSeenEventParams(eventProperties, true)) {
        if (shouldLogIfEnabled && AvoInspector.shouldLog) {
          console.warn(
            "Avo Inspector: WARNING! You are trying to extract schema shape that was just reported by your Avo functions. " +
            "This is an indicator of duplicate inspector reporting. " +
            "Please reach out to support@avo.app for advice if you are not sure how to handle this."
          );
        }
      }

      if (AvoInspector.shouldLog) {
        console.log(
          "Avo Inspector: extracting schema from " +
          JSON.stringify(eventProperties)
        );
      }

      return AvoSchemaParser.extractSchema(eventProperties);
    } catch (e) {
      console.error(
        "Avo Inspector: something went wrong. Please report to support@avo.app.",
        e
      );
      return [];
    }
  }

  setBatchSize(newBatchSize: number): void {
    AvoInspector._batchSize = newBatchSize;
  }

  setBatchFlushSeconds(newBatchFlushSeconds: number): void {
    AvoInspector._batchFlushSeconds = newBatchFlushSeconds;
  }

  /**
   * Validates event properties against the Avo tracking plan spec.
   *
   * Active only in dev/staging environments. In prod, returns null immediately.
   * Null spec responses are cached to avoid re-fetching.
   * Cache is flushed when branchId changes between responses.
   *
   * @param eventName - The name of the event to validate
   * @param eventProperties - The properties to validate
   * @returns ValidationResult with property validation results, or null if spec unavailable
   */
  async validateEvent(
    eventName: string,
    eventProperties: { [propName: string]: any }
  ): Promise<ValidationResult | null> {
    // Only validate in dev/staging
    if (
      this.environment !== AvoInspectorEnv.Dev &&
      this.environment !== AvoInspectorEnv.Staging
    ) {
      return null;
    }

    try {
      // Determine stream ID for spec fetching (anonymous ID via AvoStreamId)
      const streamId = AvoStreamId.getAnonymousId();

      // Check cache first
      const cachedSpec = this.eventSpecCache.get(this.apiKey, streamId, eventName);
      if (cachedSpec !== undefined) {
        // Cache hit - cachedSpec is either EventSpecResponse or null (known absent)
        if (cachedSpec === null) {
          return null;
        }
        return runValidation(eventProperties, cachedSpec);
      }

      // Cache miss - fetch the spec
      const spec = await this.eventSpecFetcher.fetch({
        apiKey: this.apiKey,
        streamId,
        eventName,
      });

      // Cache the result (including null for known-absent specs)
      this.eventSpecCache.set(this.apiKey, streamId, eventName, spec);

      if (spec === null) {
        return null;
      }

      // Check for branchId change and flush cache if needed
      const responseBranchId = spec.metadata.branchId;
      if (this.lastSeenBranchId !== null && this.lastSeenBranchId !== responseBranchId) {
        if (AvoInspector._shouldLog) {
          console.log(
            `[Avo Inspector] Branch ID changed from ${this.lastSeenBranchId} to ${responseBranchId}. Flushing event spec cache.`
          );
        }
        this.eventSpecCache.clear();
        // Re-cache the current spec after flush
        this.eventSpecCache.set(this.apiKey, streamId, eventName, spec);
      }
      this.lastSeenBranchId = responseBranchId;

      return runValidation(eventProperties, spec);
    } catch (e) {
      if (AvoInspector._shouldLog) {
        console.error(
          "[Avo Inspector] Error during event spec validation:",
          e
        );
      }
      return null;
    }
  }
}
