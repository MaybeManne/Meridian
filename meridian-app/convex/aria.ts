import {
  mutation,
  query,
  internalMutation,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

// ============================================================================
// PUBLIC — called from ARIA frontend
// ============================================================================

export const createConversation = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.insert("ariaConversations", { createdAt: Date.now() });
  },
});

export const sendMessage = mutation({
  args: {
    conversationId: v.id("ariaConversations"),
    content: v.string(),
    meridianContext: v.optional(v.string()),
  },
  handler: async (ctx, { conversationId, content, meridianContext }) => {
    // Insert user message
    await ctx.db.insert("ariaMessages", {
      conversationId,
      role: "user",
      content,
      screenshots: [],
      progressEvents: [],
      sources: [],
      createdAt: Date.now(),
    });

    // Insert placeholder assistant message
    const assistantMsgId = await ctx.db.insert("ariaMessages", {
      conversationId,
      role: "assistant",
      content: "",
      status: "thinking",
      screenshots: [],
      progressEvents: [],
      sources: [],
      createdAt: Date.now() + 1,
    });

    // Kick off ARIA intelligence loop
    await ctx.scheduler.runAfter(0, internal.ariaAgent.runBrowserAgent, {
      conversationId,
      messageId: assistantMsgId,
      userMessage: content,
      meridianContext,
    });

    return { assistantMsgId };
  },
});

export const getMessages = query({
  args: { conversationId: v.id("ariaConversations") },
  handler: async (ctx, { conversationId }) => {
    return await ctx.db
      .query("ariaMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId)
      )
      .order("asc")
      .collect();
  },
});

export const listConversations = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("ariaConversations")
      .withIndex("by_createdAt")
      .order("desc")
      .take(20);
  },
});

// ============================================================================
// INTERNAL — called by aria-agent
// ============================================================================

export const updateMessage = internalMutation({
  args: {
    messageId: v.id("ariaMessages"),
    content: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("thinking"),
        v.literal("browsing"),
        v.literal("complete"),
        v.literal("failed")
      )
    ),
    taskId: v.optional(v.string()),
    screenshot: v.optional(v.string()),
    progressEvent: v.optional(v.string()),
    source: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { messageId, content, status, taskId, screenshot, progressEvent, source }
  ) => {
    const msg = await ctx.db.get(messageId);
    if (!msg) return;
    const patch: Record<string, unknown> = {};
    if (content !== undefined) patch.content = content;
    if (status !== undefined) patch.status = status;
    if (taskId !== undefined) patch.taskId = taskId;
    if (screenshot !== undefined)
      patch.screenshots = [...(msg.screenshots ?? []), screenshot];
    if (progressEvent !== undefined)
      patch.progressEvents = [
        ...(msg.progressEvents ?? []).slice(-6),
        progressEvent,
      ];
    if (source !== undefined && !(msg.sources ?? []).includes(source)) {
      patch.sources = [...(msg.sources ?? []), source];
    }
    await ctx.db.patch(messageId, patch);
  },
});

export const updateConversationTitle = internalMutation({
  args: {
    conversationId: v.id("ariaConversations"),
    title: v.string(),
  },
  handler: async (ctx, { conversationId, title }) => {
    await ctx.db.patch(conversationId, { title });
  },
});
