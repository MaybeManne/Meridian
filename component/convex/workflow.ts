/**
 * Durable Workflow Actions for Browser Automation Tasks
 *
 * This module implements a scheduler-based durable workflow pattern.
 * The workflow survives server restarts and page refreshes.
 *
 * WORKFLOW SEMANTICS:
 * - Each step is persisted to the database
 * - Workflow is idempotent (safe to retry)
 * - Terminal states are checked at workflow entry
 * - Cancellation is checked every iteration
 * - Timeout is enforced
 */

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { ProgressEvent, TaskStatus } from "./types";
import { isTerminalStatus } from "./types";

// Component source lives in convex/ subdirectory, so deployed function paths
// include "convex/" prefix. The inner _generated/api uses anyApi which omits
// this prefix. Adding .convex fixes the path resolution.
const cInternal = (internal as any).convex;

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_MS = 600000; // 10 minutes

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
// DURABLE WORKFLOW ACTION
// ============================================================================

/**
 * Main workflow action - runs one iteration of the polling loop
 * and reschedules itself until the task reaches a terminal state.
 *
 * DURABILITY GUARANTEES:
 * - Each step is persisted to the database
 * - If the server restarts, the scheduled action resumes
 * - Progress survives page refreshes
 *
 * IDEMPOTENCY GUARANTEES:
 * - Terminal state check at entry prevents duplicate work
 * - Provider task is only created if not already created
 * - Progress events are deduplicated by ID
 * - Screenshots are deduplicated by URL
 */
export const runWorkflowStep = internalAction({
  args: {
    taskId: v.id("tasks"),
    startTime: v.number(),
    apiKey: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    // =========================================================================
    // STEP 1: Load task and check terminal state
    // =========================================================================

    const task = await ctx.runQuery(cInternal.workflowMutations.getTaskInternal, {
      taskId: args.taskId,
    });

    if (!task) {
      console.error(`[Workflow] Task ${args.taskId} not found, exiting`);
      return;
    }

    // CRITICAL: Exit early if task is already terminal
    if (isTerminalStatus(task.status as TaskStatus)) {
      console.log(`[Workflow] Task ${args.taskId} is ${task.status}, exiting`);
      return;
    }

    // =========================================================================
    // STEP 2: Get configuration
    // =========================================================================

    const timeoutMs = task.options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const pollIntervalMs = task.options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

    // =========================================================================
    // STEP 3: Check for timeout
    // =========================================================================

    const elapsed = Date.now() - args.startTime;
    if (elapsed > timeoutMs) {
      console.log(`[Workflow] Task ${args.taskId} timed out after ${elapsed}ms`);
      await ctx.runMutation(cInternal.workflowMutations.markTaskFailed, {
        taskId: args.taskId,
        error: {
          message: `Task timed out after ${Math.round(timeoutMs / 1000)} seconds`,
          details: { timeoutMs, elapsed },
        },
      });
      return;
    }

    // =========================================================================
    // STEP 4: Check for cancellation
    // =========================================================================

    if (task.canceledAt) {
      console.log(`[Workflow] Task ${args.taskId} was canceled`);

      // Attempt to cancel provider task (best effort)
      if (task.providerTaskId) {
        try {
          await ctx.runAction(cInternal.provider.providerCancelTask, {
            providerTaskId: task.providerTaskId,
          });
        } catch (e) {
          console.error(`[Workflow] Failed to cancel provider task: ${e}`);
        }
      }

      await ctx.runMutation(cInternal.workflowMutations.markTaskCanceled, {
        taskId: args.taskId,
      });
      return;
    }

    // =========================================================================
    // STEP 5: Initialize - Mark as running if queued
    // =========================================================================

    if (task.status === "queued") {
      await ctx.runMutation(cInternal.workflowMutations.markTaskRunning, {
        taskId: args.taskId,
      });
    }

    // =========================================================================
    // STEP 6: Start provider task if not already started (IDEMPOTENT)
    // =========================================================================

    let providerTaskId = task.providerTaskId;
    let cursor = task.lastProviderCursor as number | undefined;

    if (!providerTaskId) {
      try {
        console.log(`[Workflow] Starting provider task for ${args.taskId}`);

        const startResult = await ctx.runAction(cInternal.provider.providerStartTask, {
          prompt: task.prompt,
          options: task.options,
          apiKey: args.apiKey,
        });

        providerTaskId = startResult.providerTaskId;
        cursor = startResult.cursor;

        const initialProgress: ProgressEvent[] = [
          createProgressEvent("info", "system", "Started remote browser task", {
            providerTaskId,
          }),
        ];

        if (startResult.initialLogs) {
          initialProgress.push(...startResult.initialLogs);
        }

        await ctx.runMutation(cInternal.workflowMutations.updateTaskProvider, {
          taskId: args.taskId,
          providerTaskId,
          cursor,
          progressEvents: initialProgress,
          screenshots: startResult.initialScreenshots ?? [],
        });
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.error(`[Workflow] Failed to start provider task: ${errorMessage}`);

        await ctx.runMutation(cInternal.workflowMutations.markTaskFailed, {
          taskId: args.taskId,
          error: {
            message: errorMessage || "Failed to start provider task",
            details: { error: errorMessage },
          },
        });
        return;
      }
    }

    // =========================================================================
    // STEP 7: Poll provider for status
    // =========================================================================

    try {
      const pollResult = await ctx.runAction(cInternal.provider.providerGetTask, {
        providerTaskId: providerTaskId!,
        cursor,
        apiKey: args.apiKey,
      });

      // Update cursor
      const newCursor = pollResult.cursor;

      // Append new logs and screenshots (deduplicated in mutation)
      if (pollResult.logs.length > 0 || pollResult.screenshots.length > 0) {
        await ctx.runMutation(cInternal.workflowMutations.appendProgress, {
          taskId: args.taskId,
          progressEvents: pollResult.logs,
          screenshots: pollResult.screenshots,
          cursor: newCursor,
        });
      }

      // =========================================================================
      // STEP 8: Handle terminal states
      // =========================================================================

      if (pollResult.status === "succeeded") {
        console.log(`[Workflow] Task ${args.taskId} succeeded`);
        await ctx.runMutation(cInternal.workflowMutations.markTaskSucceeded, {
          taskId: args.taskId,
          result: pollResult.output,
        });
        return;
      }

      if (pollResult.status === "failed") {
        console.log(`[Workflow] Task ${args.taskId} failed`);
        await ctx.runMutation(cInternal.workflowMutations.markTaskFailed, {
          taskId: args.taskId,
          error: pollResult.error ?? { message: "Task failed" },
        });
        return;
      }

      // =========================================================================
      // STEP 9: Still running - schedule next poll
      // =========================================================================

      console.log(`[Workflow] Task ${args.taskId} still running, scheduling next poll in ${pollIntervalMs}ms`);

      await ctx.scheduler.runAfter(pollIntervalMs, cInternal.workflow.runWorkflowStep, {
        taskId: args.taskId,
        startTime: args.startTime,
        apiKey: args.apiKey,
      });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.error(`[Workflow] Poll error for task ${args.taskId}: ${errorMessage}`);

      await ctx.runMutation(cInternal.workflowMutations.markTaskFailed, {
        taskId: args.taskId,
        error: {
          message: errorMessage || "Workflow error",
          details: { error: errorMessage },
        },
      });
    }
  },
});

/**
 * Start the workflow for a task.
 * Called by startTask mutation after creating the task record.
 */
export const startWorkflow = internalAction({
  args: {
    taskId: v.id("tasks"),
    apiKey: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    console.log(`[Workflow] Starting workflow for task ${args.taskId}`);

    // Schedule the first workflow step immediately
    await ctx.scheduler.runAfter(0, cInternal.workflow.runWorkflowStep, {
      taskId: args.taskId,
      startTime: Date.now(),
      apiKey: args.apiKey,
    });
  },
});
