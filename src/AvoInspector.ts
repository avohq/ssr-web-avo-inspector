import { AvoInspectorEnv, AvoInspectorEnvValueType } from "./AvoInspectorEnv";
import { AvoSchemaParser } from "./AvoSchemaParser";
import { AvoBatcher } from "./AvoBatcher";
import { AvoNetworkCallsHandler, type EventProperty } from "./AvoNetworkCallsHandler";
import { AvoStorage } from "./AvoStorage";
import { AvoDeduplicator } from "./AvoDeduplicator";
import { AvoStreamId } from "./AvoStreamId";
import { AvoEventSpecFetcher } from "./eventSpec/AvoEventSpecFetcher";
import { EventSpecCache } from "./eventSpec/AvoEventSpecCache";
import { validateEvent as runValidation } from "./eventSpec/EventValidator";
import type { ValidationResult, PropertyValidationResult } from "./eventSpec/AvoEventSpecFetchTypes";

import { isValueEmpty } from "./utils";

const libVersion = require("../package.json").version;

export class AvoInspector {
  environment: AvoInspectorEnvValueType;
  avoBatcher: AvoBatcher;
  avoDeduplicator: AvoDeduplicator;
  apiKey: string;
  version: string;

  // Network handler for immediate sends (when validation is available)
  private avoNetworkCallsHandler: AvoNetworkCallsHandler;

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
    publicEncryptionKey?: string;
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

    this.avoNetworkCallsHandler = new AvoNetworkCallsHandler(
      this.apiKey,
      this.environment.toString(),
      options.appName || "",
      this.version,
      libVersion,
      options.publicEncryptionKey
    );
    this.avoBatcher = new AvoBatcher(this.avoNetworkCallsHandler);
    this.avoDeduplicator = new AvoDeduplicator();

    // Initialize event spec validation (active in dev/staging only)
    this.eventSpecCache = new EventSpecCache(AvoInspector._shouldLog);
    this.eventSpecFetcher = new AvoEventSpecFetcher(
      2000,
      AvoInspector._shouldLog,
      this.environment.toString()
    );
  }

  async trackSchemaFromEvent(
    eventName: string,
    eventProperties: { [propName: string]: any }
  ): Promise<Array<{
    propertyName: string;
    propertyType: string;
    children?: any;
  }>> {
    return this.trackSchemaFromEventInternal(
      eventName,
      eventProperties,
      false,
      null,
      null
    );
  }

  private async _avoFunctionTrackSchemaFromEvent(
    eventName: string,
    eventProperties: { [propName: string]: any },
    eventId: string,
    eventHash: string
  ): Promise<Array<{
    propertyName: string;
    propertyType: string;
    children?: any;
  }>> {
    return this.trackSchemaFromEventInternal(
      eventName,
      eventProperties,
      true,
      eventId,
      eventHash
    );
  }

  /**
   * Shared implementation for trackSchemaFromEvent and _avoFunctionTrackSchemaFromEvent.
   */
  private async trackSchemaFromEventInternal(
    eventName: string,
    eventProperties: { [propName: string]: any },
    fromAvoFunction: boolean,
    eventId: string | null,
    eventHash: string | null
  ): Promise<Array<{
    propertyName: string;
    propertyType: string;
    children?: any;
  }>> {
    try {
      if (
        this.avoDeduplicator.shouldRegisterEvent(
          eventName,
          eventProperties,
          fromAvoFunction
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

        // Fetch and validate event spec (blocking)
        const validationResult = await this.validateEvent(
          eventName,
          eventProperties
        );

        if (validationResult) {
          // Spec available: merge validation results into schema and send immediately
          const schemaWithValidation = this.mergeValidationResults(
            eventSchema,
            validationResult
          );
          await this.sendEventWithValidation(
            eventName,
            schemaWithValidation,
            eventId,
            eventHash,
            validationResult,
            eventProperties
          );
        } else {
          // No spec: fall back to batched flow (still encrypt if possible)
          await this.trackSchemaInternal(eventName, eventSchema, eventId, eventHash, eventProperties);
        }

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

  private async trackSchemaInternal(
    eventName: string,
    eventSchema: Array<{
      propertyName: string;
      propertyType: string;
      children?: any;
    }>,
    eventId: string | null,
    eventHash: string | null,
    eventProperties?: { [propName: string]: any }
  ): Promise<void> {
    try {
      // In dev/staging: if we have event properties, encrypt and send immediately (bypass batching/sampling)
      const isDevOrStaging =
        this.environment === AvoInspectorEnv.Dev ||
        this.environment === AvoInspectorEnv.Staging;

      if (isDevOrStaging && eventProperties) {
        const eventBody = await this.avoNetworkCallsHandler.bodyForValidatedEventSchemaCall(
          eventName,
          eventSchema as EventProperty[],
          eventId,
          eventHash,
          eventProperties
        );
        this.avoNetworkCallsHandler.callInspectorImmediately(eventBody, (error) => {
          if (error) {
            // Fallback to batch on failure
            this.avoBatcher.handleTrackSchema(eventName, eventSchema, eventId, eventHash);
          }
        });
        return;
      }

      // Production or no event properties: use normal batched flow (respects sampling)
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
      const streamId = AvoStreamId.getAnonymousId();

      // Check cache first
      const cachedSpec = this.eventSpecCache.get(this.apiKey, streamId, eventName);
      if (cachedSpec !== undefined) {
        // Cache hit - cachedSpec is either EventSpecResponse or null (known absent)
        if (cachedSpec === null) {
          if (AvoInspector.shouldLog) {
            console.log(
              `[Avo Inspector] Cache hit (empty) for event: ${eventName}. Sending without validation.`
            );
          }
          return null;
        }
        if (AvoInspector.shouldLog) {
          console.log(
            `[Avo Inspector] Cache hit for event: ${eventName}`
          );
        }
        return runValidation(eventProperties, cachedSpec);
      }

      // Cache miss - fetch the spec
      const spec = await this.eventSpecFetcher.fetch({
        apiKey: this.apiKey,
        streamId,
        eventName,
      });

      // Transient error (network, timeout, parse failure) — don't cache, retry next time
      if (spec === "transient_error") {
        if (AvoInspector.shouldLog) {
          console.log(
            `[Avo Inspector] Transient error fetching event spec for: ${eventName}. Will retry next time.`
          );
        }
        return null;
      }

      if (spec) {
        // Check for branchId change and flush cache if needed
        const responseBranchId = spec.metadata.branchId;
        if (this.lastSeenBranchId !== null && this.lastSeenBranchId !== responseBranchId) {
          if (AvoInspector.shouldLog) {
            console.log(
              `[Avo Inspector] Branch ID changed from ${this.lastSeenBranchId} to ${responseBranchId}. Flushing event spec cache.`
            );
          }
          this.eventSpecCache.clear();
        }
        this.lastSeenBranchId = responseBranchId;

        // Cache the result after branch check (so flush doesn't lose it)
        this.eventSpecCache.set(this.apiKey, streamId, eventName, spec);

        return runValidation(eventProperties, spec);
      } else {
        // Event definitively not found — cache so we don't re-fetch
        this.eventSpecCache.set(this.apiKey, streamId, eventName, null);
        if (AvoInspector.shouldLog) {
          console.log(
            `[Avo Inspector] Event not found in tracking plan: ${eventName}. Cached empty response.`
          );
        }
        return null;
      }
    } catch (e) {
      if (AvoInspector.shouldLog) {
        console.error(
          "[Avo Inspector] Error during event spec validation:",
          e
        );
      }
      return null;
    }
  }

  /**
   * Merges validation results into the event schema.
   * Adds failedEventIds or passedEventIds to each property based on validation.
   * Recursively merges validation results for nested children.
   */
  private mergeValidationResults(
    eventSchema: Array<{
      propertyName: string;
      propertyType: string;
      encryptedPropertyValue?: string;
      children?: any;
    }>,
    validationResult: ValidationResult
  ): EventProperty[] {
    return eventSchema.map((prop) => {
      const propValidation = validationResult.propertyResults[prop.propertyName];
      return this.mergePropertyValidation(prop, propValidation);
    });
  }

  /**
   * Merges validation result into a single property, recursively handling children.
   */
  private mergePropertyValidation(
    prop: {
      propertyName: string;
      propertyType: string;
      encryptedPropertyValue?: string;
      children?: any;
    },
    propValidation?: PropertyValidationResult
  ): EventProperty {
    const result: EventProperty = {
      propertyName: prop.propertyName,
      propertyType: prop.propertyType,
    };

    if (prop.encryptedPropertyValue) {
      result.encryptedPropertyValue = prop.encryptedPropertyValue;
    }

    // Recursively merge validation results into children
    if (prop.children && Array.isArray(prop.children)) {
      result.children = prop.children.map((child: any) => {
        // Children can be strings (for array types) or objects (for nested properties)
        if (typeof child === "string") {
          return child;
        }
        if (child && typeof child === "object" && child.propertyName) {
          // Get nested validation result for this child
          const childValidation = propValidation?.children?.[child.propertyName];
          return this.mergePropertyValidation(child, childValidation);
        }
        return child;
      });
    }

    // Add validation result for this property
    if (propValidation) {
      if (propValidation.failedEventIds) {
        result.failedEventIds = propValidation.failedEventIds;
      }
      if (propValidation.passedEventIds) {
        result.passedEventIds = propValidation.passedEventIds;
      }
    }

    return result;
  }

  /**
   * Sends an event immediately with validation data (bypasses batching).
   * Encrypts property values if publicEncryptionKey is configured.
   * Logs validation info if shouldLog is true.
   */
  private async sendEventWithValidation(
    eventName: string,
    eventSchema: EventProperty[],
    eventId: string | null,
    eventHash: string | null,
    validationResult: ValidationResult,
    eventProperties: { [propName: string]: any }
  ): Promise<void> {
    // Log validation info if shouldLog is enabled
    if (AvoInspector.shouldLog) {
      const hasFailures = eventSchema.some(
        (p) => p.failedEventIds && p.failedEventIds.length > 0
      );
      if (hasFailures) {
        console.log(
          `[Avo Inspector] Validation failures for event "${eventName}":`,
          eventSchema
            .filter((p) => p.failedEventIds && p.failedEventIds.length > 0)
            .map((p) => ({
              property: p.propertyName,
              failedEventIds: p.failedEventIds,
            }))
        );
      }
    }

    // Create the event body with encrypted values and validation data
    const eventBody = await this.avoNetworkCallsHandler.bodyForValidatedEventSchemaCall(
      eventName,
      eventSchema,
      eventId,
      eventHash,
      eventProperties
    );

    // Add metadata
    if (validationResult.metadata) {
      eventBody.eventSpecMetadata = validationResult.metadata;
    }
    if (validationResult.metadata?.branchId) {
      eventBody.validatedBranchId = validationResult.metadata.branchId;
    }

    // Send immediately (bypass batching)
    this.avoNetworkCallsHandler.callInspectorImmediately(eventBody, (error) => {
      if (error) {
        if (AvoInspector.shouldLog) {
          console.error(
            `[Avo Inspector] Failed to send event "${eventName}" with validation:`,
            error
          );
        }
        // Fallback: add to batch on failure (without validation data)
        this.avoBatcher.handleTrackSchema(
          eventName,
          eventSchema,
          eventId,
          eventHash
        );
      } else {
        if (AvoInspector.shouldLog) {
          console.log(
            `[Avo Inspector] Event "${eventName}" sent successfully with validation`
          );
        }
      }
    });
  }
}
