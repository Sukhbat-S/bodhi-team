// ============================================================
// BODHI — Parking system: executable trigger boundary
//
// New parking writes may promise only behavior BODHI actually performs:
// a date transition or a scheduled manual review. Richer historical JSON is
// retained verbatim and classified as descriptive-only when read.
// ============================================================

export type DateTrigger = { type: "date"; on: string };
export type ManualTrigger = { type: "manual" };
export type ParkTrigger = DateTrigger | ManualTrigger;

export type ParkingExecution =
  | {
      executable: true;
      mode: "date";
      description: "resurfaces when the trigger date is reached";
    }
  | {
      executable: true;
      mode: "manual-review";
      description: "resurfaces at review_by for explicit human review; closure remains manual";
    }
  | {
      executable: false;
      mode: "descriptive-only";
      description: string;
    }
  | {
      executable: false;
      mode: "invalid";
      description: string;
    };

/** Thrown when a newly submitted trigger cannot be executed honestly. */
export class TriggerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TriggerValidationError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) && !Number.isNaN(Date.parse(value));
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

/** Validate the complete executable vocabulary accepted by new writes. */
export function parseTrigger(raw: unknown): ParkTrigger {
  if (!isObject(raw)) {
    throw new TriggerValidationError("trigger must be a JSON object");
  }

  if (raw.type === "date") {
    if (!hasOnlyKeys(raw, ["type", "on"])) {
      throw new TriggerValidationError("date trigger accepts only type and on");
    }
    if (typeof raw.on !== "string" || !isIsoDate(raw.on)) {
      throw new TriggerValidationError("date.on must be an ISO date or timestamp");
    }
    return { type: "date", on: raw.on };
  }

  if (raw.type === "manual") {
    if (!hasOnlyKeys(raw, ["type"])) {
      throw new TriggerValidationError("manual trigger accepts only type; put descriptive intent in detail");
    }
    return { type: "manual" };
  }

  if (raw.type === "event" || raw.type === "activity" || raw.type === "state") {
    throw new TriggerValidationError(
      `trigger type '${raw.type}' has no BODHI executor; use date or manual and keep the richer condition in detail`,
    );
  }

  throw new TriggerValidationError(`unknown trigger type: ${String(raw.type)}`);
}

/**
 * Describe persisted trigger JSON without rewriting it. Historical event,
 * activity, and state conditions stay readable but cannot drive maintenance.
 */
export function describeStoredTrigger(raw: unknown): ParkingExecution {
  if (isObject(raw) && (raw.type === "event" || raw.type === "activity" || raw.type === "state")) {
    return {
      executable: false,
      mode: "descriptive-only",
      description: `legacy ${raw.type} condition is retained as descriptive intent and requires explicit review`,
    };
  }

  try {
    const trigger = parseTrigger(raw);
    return trigger.type === "date"
      ? {
          executable: true,
          mode: "date",
          description: "resurfaces when the trigger date is reached",
        }
      : {
          executable: true,
          mode: "manual-review",
          description: "resurfaces at review_by for explicit human review; closure remains manual",
        };
  } catch (error) {
    return {
      executable: false,
      mode: "invalid",
      description: error instanceof Error ? error.message : "stored trigger is invalid",
    };
  }
}
