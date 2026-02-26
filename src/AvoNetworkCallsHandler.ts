import AvoGuid from "./AvoGuid";
import { AvoStreamId } from "./AvoStreamId";
import { AvoInspector } from "./AvoInspector";
import { encryptValue } from "./AvoEncryption";
import type { EventSpecMetadata } from "./eventSpec/AvoEventSpecFetchTypes";

export interface EventProperty {
  propertyName: string;
  propertyType: string;
  encryptedPropertyValue?: string;
  children?: any;
  failedEventIds?: string[];
  passedEventIds?: string[];
}

export interface BaseBody {
  apiKey: string;
  appName: string;
  appVersion: string;
  libVersion: string;
  env: string;
  libPlatform: "web";
  messageId: string;
  trackingId: string;
  createdAt: string;
  sessionId: string;
  streamId: string;
  samplingRate: number;
  publicEncryptionKey?: string;
}

export interface SessionStartedBody extends BaseBody {
  type: "sessionStarted";
}

export interface EventSchemaBody extends BaseBody {
  type: "event";
  eventName: string;
  eventProperties: EventProperty[];
  avoFunction: boolean;
  eventId: string | null;
  eventHash: string | null;
  eventSpecMetadata?: EventSpecMetadata;
  validatedBranchId?: string;
}

export class AvoNetworkCallsHandler {
  private apiKey: string;
  private envName: string;
  private appName: string;
  private appVersion: string;
  private libVersion: string;
  private publicEncryptionKey?: string;
  private samplingRate: number = 1.0;
  private sending: boolean = false;

  private static trackingEndpoint = "https://api.avo.app/inspector/v1/track";

  constructor(
    apiKey: string,
    envName: string,
    appName: string,
    appVersion: string,
    libVersion: string,
    publicEncryptionKey?: string
  ) {
    this.apiKey = apiKey;
    this.envName = envName;
    this.appName = appName;
    this.appVersion = appVersion;
    this.libVersion = libVersion;
    this.publicEncryptionKey = publicEncryptionKey;
  }

  /**
   * Determines whether encryption should be applied.
   * Truth table:
   *   dev + key = true
   *   staging + key = true
   *   prod + key = false
   *   dev + null = false
   *   dev + empty = false
   */
  private shouldEncrypt(): boolean {
    if (!this.publicEncryptionKey || this.publicEncryptionKey.trim().length === 0) {
      return false;
    }
    // Only encrypt in dev and staging, never in prod
    return this.envName !== "prod";
  }

  /**
   * Adds encrypted property values to event properties.
   * For each property that has a corresponding value in eventValues:
   *   - Skip list-type properties (omitted entirely)
   *   - Encrypt the value and set encryptedPropertyValue
   *   - On failure: console.warn, omit property value, continue
   */
  private async addEncryptedValues(
    eventProperties: EventProperty[],
    eventValues: { [propName: string]: any }
  ): Promise<EventProperty[]> {
    if (!this.shouldEncrypt()) {
      return eventProperties;
    }

    const result: EventProperty[] = [];

    for (const prop of eventProperties) {
      const newProp: EventProperty = { ...prop };

      // Skip list-type properties entirely
      if (prop.propertyType === "list" || prop.propertyType.startsWith("list(")) {
        continue;
      }

      const value = eventValues[prop.propertyName];
      if (value != null) {
        try {
          newProp.encryptedPropertyValue = await encryptValue(
            value,
            this.publicEncryptionKey!
          );
        } catch (e) {
          console.warn(
            `[Avo Inspector] Warning: Failed to encrypt property "${prop.propertyName}". Property value will be omitted. Error: ${
              e instanceof Error ? e.message : String(e)
            }`
          );
          // Don't set encryptedPropertyValue - omit it
        }
      }

      result.push(newProp);
    }

    return result;
  }

  callInspectorWithBatchBody(inEvents: Array<SessionStartedBody | EventSchemaBody>, onCompleted: (error: string | null) => any): void {
    if (this.sending) {
      onCompleted("Batch sending cancelled because another batch sending is in progress. Your events will be sent with next batch.");
      return;
    }

    const events = inEvents.filter(x => x != null);

    if (events.length === 0) {
      return;
    }

    if (Math.random() > this.samplingRate) {
      if (AvoInspector.shouldLog) {
        console.log("Avo Inspector: last event schema dropped due to sampling rate.");
      }
      return;
    }

    if (AvoInspector.shouldLog) {
      console.log("Avo Inspector: events", events);

      events.forEach(
        function (event) {
          if (event.type === "sessionStarted") {
            console.log("Avo Inspector: sending session started event.");
          } else if (event.type === "event") {
            let schemaEvent: EventSchemaBody = event;
            console.log("Avo Inspector: sending event " + schemaEvent.eventName + " with schema " + JSON.stringify(schemaEvent.eventProperties));
          }
        }
      )
    }

    this.sending = true;

    fetch(AvoNetworkCallsHandler.trackingEndpoint, {
      headers: { "Content-Type": "text/plain" },
      method: "POST",
      body: JSON.stringify(events),
    }).then((response) => {
      if (response.status != 200) {
        onCompleted(`Error ${response.status}: ${response.statusText}`);
      } else {
        response.json().then((data) => {
          const samplingRate = data["samplingRate"];
          if (samplingRate !== undefined) {
            this.samplingRate = samplingRate;
          }

          onCompleted(null);
        });
      }
    });

    this.sending = false;
  }

  bodyForSessionStartedCall(): SessionStartedBody {
    let sessionBody = this.createBaseCallBody() as SessionStartedBody;
    sessionBody.type = "sessionStarted";
    return sessionBody;
  }

  bodyForEventSchemaCall(
    eventName: string,
    eventProperties: Array<{
      propertyName: string;
      propertyType: string;
      children?: any;
    }>,
    eventId: string | null,
    eventHash: string | null,
    eventSpecMetadata?: EventSpecMetadata,
    validatedBranchId?: string
  ): EventSchemaBody {
    let eventSchemaBody = this.createBaseCallBody() as EventSchemaBody;
    eventSchemaBody.type = "event";
    eventSchemaBody.eventName = eventName;
    eventSchemaBody.eventProperties = eventProperties;

    if (eventId != null) {
      eventSchemaBody.avoFunction = true;
      eventSchemaBody.eventId = eventId;
      eventSchemaBody.eventHash = eventHash;
    } else {
      eventSchemaBody.avoFunction = false;
      eventSchemaBody.eventId = null;
      eventSchemaBody.eventHash = null;
    }

    if (eventSpecMetadata) {
      eventSchemaBody.eventSpecMetadata = eventSpecMetadata;
    }

    if (validatedBranchId) {
      eventSchemaBody.validatedBranchId = validatedBranchId;
    }

    return eventSchemaBody;
  }

  /**
   * Async version of bodyForEventSchemaCall that also encrypts property values.
   * Used when event validation has been performed and we have access to the
   * original event property values for encryption.
   *
   * @param eventName - Event name
   * @param eventProperties - Schema properties (type info)
   * @param eventId - Event ID (null if not from Avo function)
   * @param eventHash - Event hash (null if not from Avo function)
   * @param eventValues - Original property values to encrypt
   * @returns Promise resolving to EventSchemaBody with encrypted values
   */
  async bodyForValidatedEventSchemaCall(
    eventName: string,
    eventProperties: EventProperty[],
    eventId: string | null,
    eventHash: string | null,
    eventValues: { [propName: string]: any }
  ): Promise<EventSchemaBody> {
    let eventSchemaBody = this.createBaseCallBody() as EventSchemaBody;
    eventSchemaBody.type = "event";
    eventSchemaBody.eventName = eventName;

    // Add encrypted values to properties
    eventSchemaBody.eventProperties = await this.addEncryptedValues(
      eventProperties,
      eventValues
    );

    if (eventId != null) {
      eventSchemaBody.avoFunction = true;
      eventSchemaBody.eventId = eventId;
      eventSchemaBody.eventHash = eventHash;
    } else {
      eventSchemaBody.avoFunction = false;
      eventSchemaBody.eventId = null;
      eventSchemaBody.eventHash = null;
    }

    return eventSchemaBody;
  }

  /**
   * Calls Inspector API immediately with a single event (bypasses batching).
   * Used when event spec validation is available.
   * Note: Does not drop due to sampling - validated events are always sent.
   */
  callInspectorImmediately(
    eventBody: EventSchemaBody,
    onCompleted: (error: string | null) => any
  ): void {
    if (AvoInspector.shouldLog) {
      console.log(
        "Avo Inspector: calling inspector immediately (with validation)",
        eventBody.eventName
      );
      console.log("Avo Inspector: event body", eventBody);
    }

    fetch(AvoNetworkCallsHandler.trackingEndpoint, {
      headers: { "Content-Type": "text/plain" },
      method: "POST",
      body: JSON.stringify([eventBody]),
    })
      .then((response) => {
        if (response.status !== 200) {
          onCompleted(`Error ${response.status}: ${response.statusText}`);
        } else {
          response.json().then((data) => {
            const samplingRate = data["samplingRate"];
            if (samplingRate !== undefined) {
              this.samplingRate = samplingRate;
            }
            onCompleted(null);
          });
        }
      })
      .catch((error) => {
        onCompleted(
          error instanceof Error ? error.message : String(error)
        );
      });
  }

  private createBaseCallBody(): BaseBody {
    const body: BaseBody = {
      apiKey: this.apiKey,
      appName: this.appName,
      appVersion: this.appVersion,
      libVersion: this.libVersion,
      env: this.envName,
      libPlatform: "web",
      messageId: AvoGuid.newGuid(),
      trackingId: "",
      createdAt: new Date().toISOString(),
      sessionId: "",
      streamId: AvoStreamId.getAnonymousId(),
      samplingRate: this.samplingRate,
    };
    if (this.shouldEncrypt()) {
      body.publicEncryptionKey = this.publicEncryptionKey;
    }
    return body;
  }
}
