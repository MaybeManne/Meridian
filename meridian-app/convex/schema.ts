import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  humintSweeps: defineTable({
    status: v.union(
      v.literal("running"),
      v.literal("complete"),
      v.literal("failed")
    ),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    findingsCount: v.number(),
  }).index("by_startedAt", ["startedAt"]),

  humintAgents: defineTable({
    sweepId: v.id("humintSweeps"),
    name: v.string(),
    taskId: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("complete"),
      v.literal("failed")
    ),
    findingsCount: v.number(),
    lastScreenshot: v.optional(v.string()),
    progressEvents: v.array(v.string()),
    createdAt: v.number(),
  }).index("by_sweep", ["sweepId"]),

  humintFindings: defineTable({
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
    createdAt: v.number(),
  })
    .index("by_sweep", ["sweepId"])
    .index("by_createdAt", ["createdAt"]),

  // === ARIA — Autonomous Browser Agent Chat ===
  ariaConversations: defineTable({
    title: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),

  ariaMessages: defineTable({
    conversationId: v.id("ariaConversations"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    taskId: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("thinking"),
        v.literal("browsing"),
        v.literal("complete"),
        v.literal("failed")
      )
    ),
    screenshots: v.array(v.string()),
    progressEvents: v.array(v.string()),
    sources: v.array(v.string()),
    createdAt: v.number(),
  }).index("by_conversation", ["conversationId"]),
});
