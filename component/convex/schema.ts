import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  progressEventValidator,
  taskErrorValidator,
  taskOptionsValidator,
  taskStatusValidator,
  taskResultValidator,
} from "./types";

// ============================================================================
// SCHEMA DEFINITION
// ============================================================================

export default defineSchema({
  /**
   * Tasks table - stores all browser automation tasks
   *
   * Each task represents a natural language browser automation request
   * that is executed durably via the workflow system.
   */
  tasks: defineTable({
    /** The natural language prompt describing what to do */
    prompt: v.string(),

    /** Current execution status */
    status: taskStatusValidator,

    /** External task ID from Browser Use Cloud provider */
    providerTaskId: v.optional(v.string()),

    /** Progress events - append-only log of execution steps */
    progress: v.array(progressEventValidator),

    /** Cursor for deduplicating provider logs on each poll (step index) */
    lastProviderCursor: v.optional(v.number()),

    /** Screenshot URLs captured during execution */
    screenshots: v.array(v.string()),

    /**
     * Final result payload (populated on success).
     * Can be either a string summary or a structured object.
     * Browser Use API sometimes returns string, sometimes object.
     */
    result: v.optional(taskResultValidator),

    /** Error details (populated on failure) */
    error: v.optional(taskErrorValidator),

    /** Timestamp when task was created */
    createdAt: v.number(),

    /** Timestamp of last update */
    updatedAt: v.number(),

    /** Timestamp when execution started */
    startedAt: v.optional(v.number()),

    /** Timestamp when task reached terminal state */
    finishedAt: v.optional(v.number()),

    /** Timestamp when cancellation was requested */
    canceledAt: v.optional(v.number()),

    /** Custom options for this task */
    options: v.optional(taskOptionsValidator),
  })
    .index("by_status", ["status"])
    .index("by_createdAt", ["createdAt"]),
});

// Re-export validators for convenience
export {
  progressEventValidator,
  taskErrorValidator,
  taskOptionsValidator,
  taskStatusValidator,
  taskResultValidator,
} from "./types";
