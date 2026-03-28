import { query, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { taskOptionsValidator, taskStatusValidator } from "./types";
import type { Task, TaskStatus } from "./types";

// Component source lives in convex/ subdirectory, so deployed function paths
// include "convex/" prefix (e.g. "convex/workflow:startWorkflow"). The inner
// _generated/api uses anyApi which omits this prefix. Adding .convex fixes it.
const cInternal = (internal as any).convex;

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * List tasks with pagination (newest first).
 */
export const listTasks = query({
  args: {
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    tasks: v.array(
      v.object({
        _id: v.id("tasks"),
        prompt: v.string(),
        status: taskStatusValidator,
        progress: v.array(v.any()),
        screenshots: v.array(v.string()),
        result: v.optional(v.any()),
        error: v.optional(v.any()),
        createdAt: v.number(),
        updatedAt: v.number(),
        startedAt: v.optional(v.number()),
        finishedAt: v.optional(v.number()),
      })
    ),
    nextCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 100);

    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_createdAt")
      .order("desc")
      .take(limit + 1);

    let nextCursor: string | null = null;
    if (tasks.length > limit) {
      const lastTask = tasks.pop()!;
      nextCursor = lastTask._id;
    }

    return {
      tasks: tasks.map((task: Doc<"tasks">) => ({
        _id: task._id,
        prompt: task.prompt,
        status: task.status,
        progress: task.progress,
        screenshots: task.screenshots,
        result: task.result,
        error: task.error,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt,
      })),
      nextCursor,
    };
  },
});

/**
 * Get a single task by ID.
 */
export const getTask = query({
  args: {
    taskId: v.id("tasks"),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("tasks"),
      prompt: v.string(),
      status: taskStatusValidator,
      providerTaskId: v.optional(v.string()),
      progress: v.array(v.any()),
      screenshots: v.array(v.string()),
      result: v.optional(v.any()),
      error: v.optional(v.any()),
      createdAt: v.number(),
      updatedAt: v.number(),
      startedAt: v.optional(v.number()),
      finishedAt: v.optional(v.number()),
      canceledAt: v.optional(v.number()),
      options: v.optional(v.any()),
    })
  ),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return null;

    return {
      _id: task._id,
      prompt: task.prompt,
      status: task.status,
      providerTaskId: task.providerTaskId,
      progress: task.progress,
      screenshots: task.screenshots,
      result: task.result,
      error: task.error,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      canceledAt: task.canceledAt,
      options: task.options,
    };
  },
});

/**
 * Start a new browser automation task.
 *
 * Creates a task in "queued" state and kicks off the durable workflow.
 */
export const startTask = mutation({
  args: {
    prompt: v.string(),
    options: v.optional(taskOptionsValidator),
    apiKey: v.optional(v.string()),
  },
  returns: v.object({
    taskId: v.id("tasks"),
  }),
  handler: async (ctx, args) => {
    // Validate prompt
    const prompt = args.prompt.trim();
    if (!prompt) {
      throw new Error("Prompt cannot be empty");
    }
    if (prompt.length > 10000) {
      throw new Error("Prompt is too long (max 10000 characters)");
    }

    const now = Date.now();

    // Create the task record
    const taskId = await ctx.db.insert("tasks", {
      prompt,
      status: "queued",
      progress: [],
      screenshots: [],
      createdAt: now,
      updatedAt: now,
      options: args.options,
    });

    // Schedule the workflow to start
    // Using scheduler.runAfter(0, ...) to start immediately but asynchronously
    await ctx.scheduler.runAfter(0, cInternal.workflow.startWorkflow, {
      taskId,
      apiKey: args.apiKey,
    });

    return { taskId };
  },
});

/**
 * Cancel a running task.
 *
 * Sets the canceledAt flag. The workflow will check this flag
 * on the next iteration and mark the task as canceled.
 */
export const cancelTask = mutation({
  args: {
    taskId: v.id("tasks"),
  },
  returns: v.object({
    ok: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);

    if (!task) {
      return { ok: false };
    }

    // Only cancel if task is still running or queued
    const status = task.status as TaskStatus;
    if (!["queued", "running"].includes(status)) {
      return { ok: false };
    }

    // Set canceledAt flag - the workflow will pick this up on next iteration
    await ctx.db.patch(args.taskId, {
      canceledAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});
