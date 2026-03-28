import { v } from "convex/values";

// ============================================================================
// TASK STATUS
// ============================================================================

export const TASK_STATUSES = ["queued", "running", "succeeded", "failed", "canceled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TERMINAL_STATUSES: readonly TaskStatus[] = ["succeeded", "failed", "canceled"];

export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

// ============================================================================
// PROGRESS EVENTS
// ============================================================================

export const PROGRESS_LEVELS = ["info", "warn", "error"] as const;
export type ProgressLevel = (typeof PROGRESS_LEVELS)[number];

export const PROGRESS_KINDS = ["system", "browser", "action", "thought", "result"] as const;
export type ProgressKind = (typeof PROGRESS_KINDS)[number];

export interface ProgressEvent {
  id: string;
  ts: number;
  level: ProgressLevel;
  kind: ProgressKind;
  message: string;
  data?: Record<string, unknown>;
}

// ============================================================================
// TASK ERROR
// ============================================================================

export interface TaskError {
  message: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// TASK OPTIONS
// ============================================================================

export interface TaskOptions {
  /** Custom timeout in milliseconds (default: 600000 = 10 minutes) */
  timeoutMs?: number;
  /** Custom poll interval in milliseconds (default: 3000) */
  pollIntervalMs?: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// TASK RESULT TYPE
// ============================================================================

/**
 * Task result can be either:
 * - A string (Browser Use sometimes returns a summary string)
 * - An object with key-value pairs
 *
 * Note: undefined (not null) is used for absent values per Convex conventions.
 */
export type TaskResult = string | Record<string, unknown>;

// ============================================================================
// FULL TASK OBJECT
// ============================================================================

export interface Task {
  _id: string;
  prompt: string;
  status: TaskStatus;
  providerTaskId?: string;
  progress: ProgressEvent[];
  lastProviderCursor?: string | number;
  screenshots: string[];
  result?: TaskResult;
  error?: TaskError;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  canceledAt?: number;
  options?: TaskOptions;
}

// ============================================================================
// PROVIDER RESPONSE TYPES
// ============================================================================

export type ProviderTaskStatus = "running" | "succeeded" | "failed";

export interface ProviderStartResponse {
  providerTaskId: string;
  cursor?: number;
  initialLogs?: ProgressEvent[];
  initialScreenshots?: string[];
}

export interface ProviderGetResponse {
  status: ProviderTaskStatus;
  logs: ProgressEvent[];
  screenshots: string[];
  /** Output can be string or object; undefined means no output yet */
  output?: TaskResult;
  error?: TaskError;
  cursor?: number;
}

export interface ProviderCancelResponse {
  ok: boolean;
}

// ============================================================================
// OUTPUT NORMALIZATION
// ============================================================================

/**
 * Normalize raw output from Browser Use to a schema-safe type.
 *
 * Browser Use can return:
 * - string: A text summary of what was done
 * - object: A structured result object
 * - undefined/null: No output
 * - other: Converted to string safely
 *
 * @param raw - The raw output from Browser Use API
 * @returns Normalized output as TaskResult | undefined
 */
export function normalizeOutput(raw: unknown): TaskResult | undefined {
  // Handle null/undefined - return undefined for Convex optional field
  if (raw === null || raw === undefined) {
    return undefined;
  }

  // Handle string
  if (typeof raw === "string") {
    return raw;
  }

  // Handle plain object (not array, not Date, etc.)
  if (
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    raw.constructor === Object
  ) {
    return raw as Record<string, unknown>;
  }

  // Handle array - wrap in object
  if (Array.isArray(raw)) {
    return { items: raw };
  }

  // Handle Date
  if (raw instanceof Date) {
    return { timestamp: raw.toISOString() };
  }

  // Handle everything else - stringify safely
  try {
    return String(raw);
  } catch {
    return "[Unable to convert output to string]";
  }
}

// ============================================================================
// CONVEX VALIDATORS
// ============================================================================

export const progressLevelValidator = v.union(
  v.literal("info"),
  v.literal("warn"),
  v.literal("error")
);

export const progressKindValidator = v.union(
  v.literal("system"),
  v.literal("browser"),
  v.literal("action"),
  v.literal("thought"),
  v.literal("result")
);

export const progressEventValidator = v.object({
  id: v.string(),
  ts: v.number(),
  level: progressLevelValidator,
  kind: progressKindValidator,
  message: v.string(),
  data: v.optional(v.record(v.string(), v.any())),
});

export const taskErrorValidator = v.object({
  message: v.string(),
  details: v.optional(v.record(v.string(), v.any())),
});

export const taskOptionsValidator = v.object({
  timeoutMs: v.optional(v.number()),
  pollIntervalMs: v.optional(v.number()),
  metadata: v.optional(v.record(v.string(), v.any())),
});

export const taskStatusValidator = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("canceled")
);

export const providerTaskStatusValidator = v.union(
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed")
);

/**
 * Validator for task result - can be string or object.
 * IMPORTANT: This replaces the previous v.record(v.string(), v.any())
 */
export const taskResultValidator = v.union(
  v.string(),
  v.record(v.string(), v.any())
);
