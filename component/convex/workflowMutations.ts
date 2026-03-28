/**
 * Workflow Mutations and Queries
 *
 * This module contains the database operations for the workflow.
 * These run in the Convex runtime (not Node.js).
 *
 * SCHEMA COMPLIANCE:
 * - result field accepts: string | Record<string, unknown> | undefined
 * - All patches include updatedAt
 * - All terminal states include finishedAt
 */

import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { ProgressEvent, TaskStatus, TaskResult } from "./types";
import {
  progressEventValidator,
  taskErrorValidator,
  taskResultValidator,
  isTerminalStatus,
} from "./types";

// ============================================================================
// HELPERS
// ============================================================================

function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function createProgressEvent(
  level: ProgressEvent["level"],
  kind: ProgressEvent["kind"],
  message: string,
  data?: Record<string, unknown>
): ProgressEvent {
  return {
    id: generateEventId(),
    ts: Date.now(),
    level,
    kind,
    message,
    data,
  };
}

// ============================================================================
// INTERNAL QUERIES
// ============================================================================

/**
 * Get task for internal workflow use.
 * Returns the full task document.
 */
export const getTaskInternal = internalQuery({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args): Promise<Doc<"tasks"> | null> => {
    return await ctx.db.get(args.taskId);
  },
});

// ============================================================================
// INTERNAL MUTATIONS
// ============================================================================

/**
 * Mark task as running.
 * IDEMPOTENT: Only updates if status is "queued".
 *
 * STATE MACHINE: queued -> running
 */
export const markTaskRunning = internalMutation({
  args: {
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args): Promise<void> => {
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      console.error(`[Workflow] Task ${args.taskId} not found`);
      return;
    }

    // Idempotency: only transition from queued
    if (task.status !== "queued") {
      console.log(`[Workflow] Task ${args.taskId} already ${task.status}, skipping markRunning`);
      return;
    }

    const now = Date.now();
    await ctx.db.patch(args.taskId, {
      status: "running",
      startedAt: now,
      updatedAt: now,
      progress: [createProgressEvent("info", "system", "Starting browser automation task")],
    });
  },
});

/**
 * Update task with provider info.
 * IDEMPOTENT: Checks for existing providerTaskId.
 */
export const updateTaskProvider = internalMutation({
  args: {
    taskId: v.id("tasks"),
    providerTaskId: v.string(),
    cursor: v.optional(v.number()),
    progressEvents: v.array(progressEventValidator),
    screenshots: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      throw new Error(`Task ${args.taskId} not found`);
    }

    // Idempotency: if providerTaskId is already set and matches, just update progress
    if (task.providerTaskId && task.providerTaskId !== args.providerTaskId) {
      console.warn(
        `[Workflow] Task ${args.taskId} has different providerTaskId: ${task.providerTaskId} vs ${args.providerTaskId}`
      );
      return;
    }

    // Deduplicate progress events by ID
    const existingIds = new Set(task.progress.map((e: ProgressEvent) => e.id));
    const newEvents = args.progressEvents.filter(
      (e: ProgressEvent) => !existingIds.has(e.id)
    );

    // Deduplicate screenshots
    const existingScreenshots = new Set(task.screenshots);
    const newScreenshots = args.screenshots.filter((s) => !existingScreenshots.has(s));
    const allScreenshots = [...task.screenshots, ...newScreenshots];

    await ctx.db.patch(args.taskId, {
      providerTaskId: args.providerTaskId,
      lastProviderCursor: args.cursor,
      progress: [...task.progress, ...newEvents],
      screenshots: allScreenshots,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Append progress events and screenshots.
 * IDEMPOTENT: Deduplicates by event ID.
 */
export const appendProgress = internalMutation({
  args: {
    taskId: v.id("tasks"),
    progressEvents: v.array(progressEventValidator),
    screenshots: v.array(v.string()),
    cursor: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      throw new Error(`Task ${args.taskId} not found`);
    }

    // Deduplicate progress events by ID
    const existingIds = new Set(task.progress.map((e: ProgressEvent) => e.id));
    const newEvents = args.progressEvents.filter(
      (e: ProgressEvent) => !existingIds.has(e.id)
    );

    // Deduplicate screenshots
    const existingScreenshots = new Set(task.screenshots);
    const newScreenshots = args.screenshots.filter((s) => !existingScreenshots.has(s));
    const allScreenshots = [...task.screenshots, ...newScreenshots];

    await ctx.db.patch(args.taskId, {
      progress: [...task.progress, ...newEvents],
      screenshots: allScreenshots,
      lastProviderCursor: args.cursor ?? task.lastProviderCursor,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Mark task as succeeded.
 * IDEMPOTENT: Only updates if not already terminal.
 *
 * STATE MACHINE: running -> succeeded
 *
 * RESULT HANDLING:
 * - Accepts string | Record<string, unknown> | undefined
 * - String results are stored directly (Browser Use summary)
 * - Object results are stored directly
 * - undefined means no result to store
 */
export const markTaskSucceeded = internalMutation({
  args: {
    taskId: v.id("tasks"),
    result: v.optional(taskResultValidator),
  },
  handler: async (ctx, args): Promise<void> => {
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      throw new Error(`Task ${args.taskId} not found`);
    }

    // Idempotency: don't update if already terminal
    if (isTerminalStatus(task.status as TaskStatus)) {
      console.log(`[Workflow] Task ${args.taskId} already ${task.status}, skipping markSucceeded`);
      return;
    }

    const now = Date.now();

    // Build patch object - only include result if provided
    const patch: {
      status: "succeeded";
      result?: TaskResult;
      finishedAt: number;
      updatedAt: number;
      progress: ProgressEvent[];
    } = {
      status: "succeeded",
      finishedAt: now,
      updatedAt: now,
      progress: [
        ...task.progress,
        createProgressEvent("info", "result", "Task completed successfully"),
      ],
    };

    // Only set result if it's defined (string or object)
    if (args.result !== undefined) {
      patch.result = args.result;
    }

    await ctx.db.patch(args.taskId, patch);
  },
});

/**
 * Mark task as failed.
 * IDEMPOTENT: Only updates if not already terminal.
 *
 * STATE MACHINE: running -> failed
 */
export const markTaskFailed = internalMutation({
  args: {
    taskId: v.id("tasks"),
    error: taskErrorValidator,
  },
  handler: async (ctx, args): Promise<void> => {
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      throw new Error(`Task ${args.taskId} not found`);
    }

    // Idempotency: don't update if already terminal
    if (isTerminalStatus(task.status as TaskStatus)) {
      console.log(`[Workflow] Task ${args.taskId} already ${task.status}, skipping markFailed`);
      return;
    }

    const now = Date.now();
    await ctx.db.patch(args.taskId, {
      status: "failed",
      error: args.error,
      finishedAt: now,
      updatedAt: now,
      progress: [
        ...task.progress,
        createProgressEvent("error", "system", args.error.message),
      ],
    });
  },
});

/**
 * Mark task as canceled.
 * IDEMPOTENT: Only updates if not already terminal.
 *
 * STATE MACHINE: queued|running -> canceled
 */
export const markTaskCanceled = internalMutation({
  args: {
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args): Promise<void> => {
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      throw new Error(`Task ${args.taskId} not found`);
    }

    // Idempotency: don't update if already terminal
    if (isTerminalStatus(task.status as TaskStatus)) {
      console.log(`[Workflow] Task ${args.taskId} already ${task.status}, skipping markCanceled`);
      return;
    }

    const now = Date.now();
    await ctx.db.patch(args.taskId, {
      status: "canceled",
      finishedAt: now,
      updatedAt: now,
      progress: [
        ...task.progress,
        createProgressEvent("info", "system", "Task canceled by user"),
      ],
    });
  },
});
