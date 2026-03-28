/**
 * Browser Use Cloud Provider Layer
 *
 * This module handles all communication with the Browser Use Cloud API.
 * Uses the documented v2 API endpoints:
 * - POST https://api.browser-use.com/api/v2/tasks (create task)
 * - GET  https://api.browser-use.com/api/v2/tasks/:task_id (get task status)
 *
 * TEST MODE:
 * - When BROWSER_USE_TEST_MODE=1, returns deterministic mock responses
 * - This allows CI/tests to run without external API calls
 * - Default is REAL Browser Use Cloud API
 *
 * OUTPUT NORMALIZATION:
 * - Browser Use can return string or object outputs
 * - We normalize to: string | Record<string, unknown> | undefined
 * - Schema-safe, no v.any() in validators
 *
 * SECURITY:
 * - API key is only accessed server-side via process.env
 * - API key is NEVER logged
 * - All sensitive data is redacted before logging
 */

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import type {
  ProgressEvent,
  ProgressKind,
  ProviderStartResponse,
  ProviderGetResponse,
  ProviderCancelResponse,
  ProviderTaskStatus,
  TaskResult,
} from "./types";
import {
  progressEventValidator,
  providerTaskStatusValidator,
  taskErrorValidator,
  taskResultValidator,
  normalizeOutput,
} from "./types";

// ============================================================================
// CONFIGURATION
// ============================================================================

const BROWSER_USE_API_BASE = "https://api.browser-use.com/api/v2";
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

// ============================================================================
// TEST MODE SUPPORT
// ============================================================================

/**
 * Check if test mode is enabled.
 * When enabled, provider returns deterministic mock responses.
 */
function isTestMode(): boolean {
  return process.env.BROWSER_USE_TEST_MODE === "1";
}

// Track mock task states for test mode
const mockTaskStates: Map<string, { step: number; startTime: number }> = new Map();

/**
 * Generate deterministic test responses.
 * Returns schema-compliant output (string or object, or undefined if not ready).
 */
function getTestResponse(taskId: string): {
  status: ProviderTaskStatus;
  logs: ProgressEvent[];
  screenshots: string[];
  output?: TaskResult;
} {
  const state = mockTaskStates.get(taskId) || { step: 0, startTime: Date.now() };
  state.step++;
  mockTaskStates.set(taskId, state);

  const generateEventId = () => `test_evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  // Simulate 3 steps then complete
  if (state.step === 1) {
    return {
      status: "running",
      logs: [{
        id: generateEventId(),
        ts: Date.now(),
        level: "info",
        kind: "browser",
        message: "Navigating to target page",
      }],
      screenshots: [],
      output: undefined,
    };
  } else if (state.step === 2) {
    return {
      status: "running",
      logs: [{
        id: generateEventId(),
        ts: Date.now(),
        level: "info",
        kind: "action",
        message: "Performing requested action",
      }],
      screenshots: ["https://via.placeholder.com/800x600?text=Screenshot+1"],
      output: undefined,
    };
  } else if (state.step === 3) {
    return {
      status: "running",
      logs: [{
        id: generateEventId(),
        ts: Date.now(),
        level: "info",
        kind: "thought",
        message: "Analyzing page content",
      }],
      screenshots: ["https://via.placeholder.com/800x600?text=Screenshot+2"],
      output: undefined,
    };
  } else {
    // Complete after step 4 - return a string output to test string handling
    mockTaskStates.delete(taskId);
    return {
      status: "succeeded",
      logs: [{
        id: generateEventId(),
        ts: Date.now(),
        level: "info",
        kind: "result",
        message: "Task completed successfully",
      }],
      screenshots: [],
      // Test mode returns string output to verify frontend handles it
      output: "Test task completed successfully. This is a string summary of the task result.",
    };
  }
}

// ============================================================================
// SECURITY: API KEY ACCESS
// ============================================================================

/**
 * Get the Browser Use Cloud API key.
 * Accepts explicit key (from parent app) or falls back to process.env.
 * SECURITY: This value is NEVER logged.
 */
function getApiKey(explicitKey?: string): string {
  // In test mode, we don't need an API key
  if (isTestMode()) {
    return "test_mode_key";
  }

  // Prefer explicit key passed from parent app (components can't read parent env vars)
  const key = explicitKey || (typeof process !== "undefined" && process.env?.BROWSER_USE_API_KEY);
  if (!key) {
    throw new Error(
      "BROWSER_USE_API_KEY is not set. " +
        "Pass apiKey when calling startTask, or set it via: npx convex env set BROWSER_USE_API_KEY <your_key>"
    );
  }
  return key;
}

/**
 * Redact sensitive information from strings before logging.
 */
function redactSecrets(message: string): string {
  return message
    .replace(/api[_-]?key[=:]\s*["']?[a-zA-Z0-9_-]+["']?/gi, "api_key=[REDACTED]")
    .replace(/password[=:]\s*["']?[^\s"']+["']?/gi, "password=[REDACTED]")
    .replace(/token[=:]\s*["']?[a-zA-Z0-9_.-]+["']?/gi, "token=[REDACTED]")
    .replace(/bearer\s+[a-zA-Z0-9_.-]+/gi, "Bearer [REDACTED]")
    .replace(/bu_[a-zA-Z0-9_-]+/gi, "bu_[REDACTED]")
    .replace(/X-Browser-Use-API-Key[=:]\s*["']?[a-zA-Z0-9_-]+["']?/gi, "X-Browser-Use-API-Key=[REDACTED]");
}

// ============================================================================
// BROWSER USE API RESPONSE TYPES
// ============================================================================

interface BrowserUseStep {
  id?: string;
  type?: string;
  action?: string;
  description?: string;
  screenshotUrl?: string;
  timestamp?: number;
  status?: string;
  result?: Record<string, unknown>;
}

interface BrowserUseTaskResponse {
  id: string;
  status: string;
  steps?: BrowserUseStep[];
  output?: unknown; // Can be string or object from Browser Use
  error?: string;
  screenshotUrl?: string;
  sessionId?: string;
}

// ============================================================================
// RETRY LOGIC WITH EXPONENTIAL BACKOFF
// ============================================================================

interface FetchOptions {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

async function fetchWithRetry(
  url: string,
  options: FetchOptions,
  maxRetries: number = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;
  let delay = INITIAL_RETRY_DELAY_MS;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      // Don't retry on 4xx errors (client errors)
      if (response.status >= 400 && response.status < 500) {
        return response;
      }

      // Retry on 5xx errors (server errors)
      if (response.status >= 500) {
        throw new Error(`Server error: ${response.status}`);
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        console.log(
          `[BrowserUse] Attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms...`
        );
        await sleep(delay);
        delay *= 2; // Exponential backoff
      }
    }
  }

  throw lastError ?? new Error("Request failed after retries");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate a unique event ID.
 */
function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Map Browser Use step type to our progress event kind.
 */
function mapStepKind(stepType?: string): ProgressKind {
  if (!stepType) return "action";

  const type = stepType.toLowerCase();
  if (type.includes("navigate") || type.includes("page") || type.includes("load")) {
    return "browser";
  }
  if (type.includes("click") || type.includes("type") || type.includes("scroll") || type.includes("input")) {
    return "action";
  }
  if (type.includes("think") || type.includes("analyze") || type.includes("plan")) {
    return "thought";
  }
  if (type.includes("result") || type.includes("output") || type.includes("complete")) {
    return "result";
  }
  if (type.includes("init") || type.includes("start") || type.includes("end")) {
    return "system";
  }
  return "action";
}

/**
 * Normalize Browser Use status to our three-state status.
 *
 * IMPORTANT: We do NOT hardcode search engine preferences.
 * Browser Use decides what to do. We only care about terminal states.
 */
function normalizeTaskStatus(status: string): ProviderTaskStatus {
  const s = status.toLowerCase();

  // Success states
  if (s === "finished" || s === "completed" || s === "succeeded" || s === "success" || s === "done") {
    return "succeeded";
  }

  // Failure states
  if (s === "failed" || s === "error" || s === "cancelled" || s === "canceled" || s === "timeout" || s === "stopped") {
    return "failed";
  }

  // Everything else is running
  return "running";
}

/**
 * Safely parse JSON response with error handling.
 */
async function safeParseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON response: ${redactSecrets(text.substring(0, 200))}`);
  }
}

/**
 * Convert Browser Use step to our progress event.
 */
function stepToProgressEvent(step: BrowserUseStep, index: number): ProgressEvent {
  const message =
    step.description ||
    step.action ||
    step.type ||
    `Step ${index + 1}`;

  return {
    id: step.id || `step_${index}_${generateEventId()}`,
    ts: step.timestamp || Date.now(),
    level: step.status === "error" ? "error" : "info",
    kind: mapStepKind(step.type || step.action),
    message: redactSecrets(message),
    data: step.result,
  };
}

/**
 * Extract valid screenshot URLs from steps.
 */
function extractScreenshots(data: BrowserUseTaskResponse): string[] {
  const screenshots: string[] = [];
  const seen = new Set<string>();

  // Main screenshot URL
  if (data.screenshotUrl && isValidUrl(data.screenshotUrl)) {
    screenshots.push(data.screenshotUrl);
    seen.add(data.screenshotUrl);
  }

  // Screenshots from steps
  if (data.steps) {
    for (const step of data.steps) {
      if (step.screenshotUrl && isValidUrl(step.screenshotUrl) && !seen.has(step.screenshotUrl)) {
        screenshots.push(step.screenshotUrl);
        seen.add(step.screenshotUrl);
      }
    }
  }

  return screenshots;
}

/**
 * Validate URL format.
 */
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return url.startsWith("http://") || url.startsWith("https://");
  } catch {
    return false;
  }
}

// ============================================================================
// PROVIDER ACTIONS
// ============================================================================

/**
 * Start a new browser automation task with Browser Use Cloud.
 */
export const providerStartTask = internalAction({
  args: {
    prompt: v.string(),
    options: v.optional(v.object({
      timeoutMs: v.optional(v.number()),
      pollIntervalMs: v.optional(v.number()),
      metadata: v.optional(v.record(v.string(), v.any())),
    })),
    apiKey: v.optional(v.string()),
  },
  returns: v.object({
    providerTaskId: v.string(),
    cursor: v.optional(v.number()),
    initialLogs: v.optional(v.array(progressEventValidator)),
    initialScreenshots: v.optional(v.array(v.string())),
  }),
  handler: async (_, args): Promise<ProviderStartResponse> => {
    const promptPreview = args.prompt.substring(0, 50) + (args.prompt.length > 50 ? "..." : "");

    // TEST MODE: Return mock response
    if (isTestMode()) {
      const mockTaskId = `test_task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      mockTaskStates.set(mockTaskId, { step: 0, startTime: Date.now() });

      console.log(`[BrowserUse:TEST] Starting mock task: "${promptPreview}"`);

      return {
        providerTaskId: mockTaskId,
        cursor: 0,
        initialLogs: [{
          id: generateEventId(),
          ts: Date.now(),
          level: "info",
          kind: "system",
          message: "[TEST MODE] Task submitted",
        }],
        initialScreenshots: [],
      };
    }

    // REAL MODE: Call Browser Use Cloud API
    const apiKey = getApiKey(args.apiKey);
    console.log(`[BrowserUse] Starting task: "${promptPreview}"`);

    const response = await fetchWithRetry(
      `${BROWSER_USE_API_BASE}/tasks`,
      {
        method: "POST",
        headers: {
          "X-Browser-Use-API-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          task: args.prompt,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[BrowserUse] Create task failed: ${response.status}`);
      throw new Error(
        `Browser Use API error (${response.status}): ${redactSecrets(errorText)}`
      );
    }

    const data = await safeParseJson<BrowserUseTaskResponse>(response);

    if (!data.id) {
      throw new Error("Browser Use API returned response without task ID");
    }

    console.log(`[BrowserUse] Task created: ${data.id}`);

    const initialLog: ProgressEvent = {
      id: generateEventId(),
      ts: Date.now(),
      level: "info",
      kind: "system",
      message: "Task submitted to Browser Use Cloud",
      data: { taskId: data.id },
    };

    return {
      providerTaskId: data.id,
      cursor: 0,
      initialLogs: [initialLog],
      initialScreenshots: [],
    };
  },
});

/**
 * Poll for task status and new progress events.
 *
 * IMPORTANT: Only marks as failed if provider status === "failed".
 * If provider says succeeded and has output, we succeed even if
 * there were earlier errors (e.g., Google CAPTCHA that was worked around).
 */
export const providerGetTask = internalAction({
  args: {
    providerTaskId: v.string(),
    cursor: v.optional(v.number()),
    apiKey: v.optional(v.string()),
  },
  returns: v.object({
    status: providerTaskStatusValidator,
    logs: v.array(progressEventValidator),
    screenshots: v.array(v.string()),
    output: v.optional(taskResultValidator),
    error: v.optional(taskErrorValidator),
    cursor: v.optional(v.number()),
  }),
  handler: async (_, args): Promise<ProviderGetResponse> => {
    // TEST MODE: Return mock response
    if (isTestMode()) {
      console.log(`[BrowserUse:TEST] Polling mock task: ${args.providerTaskId}`);

      // Add small delay to simulate network latency
      await sleep(500);

      const testResponse = getTestResponse(args.providerTaskId);

      // Normalize output using our helper (handles string/object/null)
      const normalizedOutput = normalizeOutput(testResponse.output);

      return {
        status: testResponse.status,
        logs: testResponse.logs,
        screenshots: testResponse.screenshots,
        output: normalizedOutput ?? undefined,
        cursor: (args.cursor ?? 0) + 1,
      };
    }

    // REAL MODE: Call Browser Use Cloud API
    const apiKey = getApiKey(args.apiKey);

    const response = await fetchWithRetry(
      `${BROWSER_USE_API_BASE}/tasks/${args.providerTaskId}`,
      {
        method: "GET",
        headers: {
          "X-Browser-Use-API-Key": apiKey,
        },
      }
    );

    // Handle 404 as a terminal failure
    if (response.status === 404) {
      console.error(`[BrowserUse] Task not found: ${args.providerTaskId}`);
      return {
        status: "failed",
        logs: [{
          id: generateEventId(),
          ts: Date.now(),
          level: "error",
          kind: "system",
          message: "Task not found on Browser Use Cloud",
        }],
        screenshots: [],
        error: { message: "Task not found" },
        cursor: args.cursor ?? 0,
      };
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[BrowserUse] Get task failed: ${response.status}`);
      throw new Error(
        `Browser Use API error (${response.status}): ${redactSecrets(errorText)}`
      );
    }

    const data = await safeParseJson<BrowserUseTaskResponse>(response);

    // Validate response has required fields
    if (!data.status) {
      console.warn(`[BrowserUse] Response missing status, treating as running`);
      data.status = "running";
    }

    const cursorNum = args.cursor ?? 0;
    const steps = data.steps ?? [];

    // Get new steps since cursor (deduplicate by index)
    const newSteps = steps.slice(cursorNum);
    const newLogs = newSteps.map((step, i) =>
      stepToProgressEvent(step, cursorNum + i)
    );

    // Extract screenshots with deduplication
    const screenshots = extractScreenshots(data);

    // Normalize status
    const status = normalizeTaskStatus(data.status);
    const newCursor = steps.length;

    console.log(
      `[BrowserUse] Task ${args.providerTaskId}: status=${status}, steps=${steps.length}, new=${newSteps.length}`
    );

    // NORMALIZE OUTPUT SAFELY
    // Browser Use can return string or object - normalize to schema-safe type
    const normalizedOutput = normalizeOutput(data.output);

    // Build response
    const result: ProviderGetResponse = {
      status,
      logs: newLogs,
      screenshots,
      cursor: newCursor,
    };

    // Add output for succeeded status
    // IMPORTANT: If provider says succeeded and has output, we succeed
    // regardless of any earlier issues (e.g., Google CAPTCHA workaround)
    if (status === "succeeded") {
      if (normalizedOutput !== null) {
        result.output = normalizedOutput;
      }
      if (newLogs.length === 0 || newLogs[newLogs.length - 1].kind !== "result") {
        result.logs.push({
          id: generateEventId(),
          ts: Date.now(),
          level: "info",
          kind: "result",
          message: "Task completed successfully",
        });
      }
    }

    // Add error details ONLY for failed status
    // IMPORTANT: Only mark as failed if provider explicitly says failed
    if (status === "failed") {
      result.error = {
        message: data.error || "Task failed",
        details: normalizedOutput !== null && typeof normalizedOutput === "object"
          ? normalizedOutput
          : undefined,
      };
      result.logs.push({
        id: generateEventId(),
        ts: Date.now(),
        level: "error",
        kind: "system",
        message: data.error || "Task failed",
      });
    }

    return result;
  },
});

/**
 * Cancel a running task.
 *
 * NOTE: Browser Use Cloud API cancel endpoint is not documented.
 * This function returns ok: true to allow the workflow to stop polling
 * and mark the task as canceled locally. The remote task may continue
 * running but we stop tracking it.
 *
 * LIMITATION: We do not attempt to call undocumented endpoints.
 */
export const providerCancelTask = internalAction({
  args: {
    providerTaskId: v.string(),
  },
  returns: v.object({
    ok: v.boolean(),
  }),
  handler: async (_, args): Promise<ProviderCancelResponse> => {
    if (isTestMode()) {
      console.log(`[BrowserUse:TEST] Canceling mock task: ${args.providerTaskId}`);
      mockTaskStates.delete(args.providerTaskId);
      return { ok: true };
    }

    console.log(`[BrowserUse] Cancel requested for task: ${args.providerTaskId}`);

    // We don't have a documented cancel endpoint, so we just acknowledge
    // the cancellation. The workflow will stop polling and mark the task
    // as canceled locally.
    console.log(`[BrowserUse] Marking task as canceled locally (no remote cancel API)`);

    return { ok: true };
  },
});
