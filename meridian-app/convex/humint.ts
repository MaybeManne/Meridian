import {
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

// ============================================================================
// PUBLIC — called from MERIDIAN frontend and server.mjs via HTTP
// ============================================================================

export const triggerSweep = mutation({
  args: {},
  handler: async (ctx) => {
    // Idempotency — don't start if already running
    const running = await ctx.db
      .query("humintSweeps")
      .filter((q) => q.eq(q.field("status"), "running"))
      .first();
    if (running) return { sweepId: running._id, alreadyRunning: true };

    const sweepId = await ctx.db.insert("humintSweeps", {
      status: "running",
      startedAt: Date.now(),
      findingsCount: 0,
    });

    await ctx.scheduler.runAfter(0, internal.sweep.runSweep, { sweepId });
    return { sweepId, alreadyRunning: false };
  },
});

export const getLatestSweep = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("humintSweeps")
      .withIndex("by_startedAt")
      .order("desc")
      .first();
  },
});

export const getAgents = query({
  args: { sweepId: v.id("humintSweeps") },
  handler: async (ctx, { sweepId }) => {
    return await ctx.db
      .query("humintAgents")
      .withIndex("by_sweep", (q) => q.eq("sweepId", sweepId))
      .collect();
  },
});

export const getFindings = query({
  args: { sweepId: v.id("humintSweeps") },
  handler: async (ctx, { sweepId }) => {
    return await ctx.db
      .query("humintFindings")
      .withIndex("by_sweep", (q) => q.eq("sweepId", sweepId))
      .order("desc")
      .collect();
  },
});

export const getAllRecentFindings = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    return await ctx.db
      .query("humintFindings")
      .withIndex("by_createdAt")
      .order("desc")
      .take(limit ?? 30);
  },
});

// ============================================================================
// INTERNAL — used by sweep action
// ============================================================================

export const getLatestSweepInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("humintSweeps")
      .withIndex("by_startedAt")
      .order("desc")
      .first();
  },
});

export const insertAgent = internalMutation({
  args: {
    sweepId: v.id("humintSweeps"),
    name: v.string(),
  },
  handler: async (ctx, { sweepId, name }) => {
    return await ctx.db.insert("humintAgents", {
      sweepId,
      name,
      status: "queued",
      findingsCount: 0,
      progressEvents: [],
      createdAt: Date.now(),
    });
  },
});

export const updateAgent = internalMutation({
  args: {
    agentId: v.id("humintAgents"),
    taskId: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("queued"),
        v.literal("running"),
        v.literal("complete"),
        v.literal("failed")
      )
    ),
    lastScreenshot: v.optional(v.string()),
    progressEvent: v.optional(v.string()),
    findingsCount: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { agentId, taskId, status, lastScreenshot, progressEvent, findingsCount }
  ) => {
    const agent = await ctx.db.get(agentId);
    if (!agent) return;
    const patch: Record<string, unknown> = {};
    if (taskId !== undefined) patch.taskId = taskId;
    if (status !== undefined) patch.status = status;
    if (lastScreenshot !== undefined) patch.lastScreenshot = lastScreenshot;
    if (findingsCount !== undefined) patch.findingsCount = findingsCount;
    if (progressEvent !== undefined) {
      patch.progressEvents = [
        ...(agent.progressEvents ?? []).slice(-4),
        progressEvent,
      ];
    }
    await ctx.db.patch(agentId, patch);
  },
});

export const insertFinding = internalMutation({
  args: {
    sweepId: v.id("humintSweeps"),
    agentId: v.id("humintAgents"),
    agentName: v.string(),
    headline: v.string(),
    summary: v.optional(v.string()),
    signal: v.string(),
    severity: v.union(
      v.literal("high"),
      v.literal("medium"),
      v.literal("low")
    ),
    category: v.string(),
    location: v.optional(
      v.object({
        lat: v.number(),
        lon: v.number(),
        name: v.string(),
      })
    ),
    screenshot: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("humintFindings", {
      ...args,
      createdAt: Date.now(),
    });
    const sweep = await ctx.db.get(args.sweepId);
    if (sweep) {
      await ctx.db.patch(args.sweepId, {
        findingsCount: sweep.findingsCount + 1,
      });
    }
    return id;
  },
});

export const completeSweep = internalMutation({
  args: {
    sweepId: v.id("humintSweeps"),
    failed: v.optional(v.boolean()),
  },
  handler: async (ctx, { sweepId, failed }) => {
    await ctx.db.patch(sweepId, {
      status: failed ? "failed" : "complete",
      completedAt: Date.now(),
    });
    if (!failed) {
      // Auto-schedule next sweep in 15 minutes
      await ctx.scheduler.runAfter(
        15 * 60 * 1000,
        internal.humint.autoSweep,
        {}
      );
    }
  },
});

export const autoSweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const running = await ctx.db
      .query("humintSweeps")
      .filter((q) => q.eq(q.field("status"), "running"))
      .first();
    if (running) return;
    const sweepId = await ctx.db.insert("humintSweeps", {
      status: "running",
      startedAt: Date.now(),
      findingsCount: 0,
    });
    await ctx.scheduler.runAfter(0, internal.sweep.runSweep, { sweepId });
  },
});
