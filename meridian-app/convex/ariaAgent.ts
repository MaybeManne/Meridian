"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal, components } from "./_generated/api";
import { claudeDecide, claudeSynthesize } from "./claudeHelpers";

// ============================================================================
// BROWSER USE COMPONENT HELPERS
// ============================================================================

async function startBrowserTask(
  ctx: { runMutation: Function },
  prompt: string,
  timeoutMs = 300000
) {
  const result = await ctx.runMutation(
    components.browserUse.convex.tasks.startTask,
    { prompt, options: { timeoutMs }, apiKey: process.env.BROWSER_USE_API_KEY }
  );
  return result.taskId as string;
}

async function getTaskStatus(ctx: { runQuery: Function }, taskId: string) {
  return await ctx.runQuery(components.browserUse.convex.tasks.getTask, { taskId });
}

// ============================================================================
// FALLBACK PROMPT BUILDER (used when Claude is unavailable)
// ============================================================================

function buildFallbackPrompt(userMessage: string): string {
  const msg = userMessage.toLowerCase();

  if (msg.match(/flight|fly|airport|book.*travel/)) {
    return `${userMessage}\n\nGo to https://www.google.com/flights\nSearch for the requested flights.\nFind the best 3 options.\nFor each return:\nOPTION: [airline] | [departure time] → [arrival time] | [duration] | $[price] | [stops]\nTake a screenshot of the results page.\nAt the end: RECOMMENDATION: [which option is best and why]`;
  }

  if (msg.match(/hotel|stay|accommodation|airbnb/)) {
    return `${userMessage}\n\nGo to https://www.booking.com\nSearch for the accommodation.\nFind 3 options.\nFor each: HOTEL: [name] | $[price]/night | [rating]/10 | [key feature]\nTake a screenshot.`;
  }

  if (msg.match(/latest|news|happening|today|update|current|situation|war|attack|crisis/)) {
    return `${userMessage}\n\nSearch multiple news sources for the latest information.\nGo to https://www.reuters.com first, then https://apnews.com\nFind the 3-5 most recent relevant articles.\nTake screenshots of the key pages.\nReturn:\nHEADLINE: [title] | SOURCE: [site] | DATE: [date]\nSUMMARY: [2-3 sentence summary]\n\nRepeat for each story.\n\nOVERALL: [paragraph synthesizing what's happening]\nSOURCES: [list websites checked]`;
  }

  if (msg.match(/price|cheap|cheapest|cost|buy|how much/)) {
    return `${userMessage}\n\nCheck prices across multiple stores.\nGo to https://www.amazon.com and search.\nAlso check https://www.google.com/shopping\nReturn top 3 results:\nRESULT: [store] | $[price] | [condition/notes] | [link]\nBEST_DEAL: [recommendation]\nTake screenshots.`;
  }

  if (msg.match(/restaurant|food|eat|dinner|lunch|cafe/)) {
    return `${userMessage}\n\nGo to https://www.google.com/maps and search for this.\nFind top 3 options with ratings.\nRESTAURANT: [name] | [cuisine] | [rating] | [price range] | [address]\nTake a screenshot of the results.`;
  }

  if (msg.match(/stock|market|trading|invest/)) {
    return `${userMessage}\n\nGo to https://finance.yahoo.com and search for the relevant ticker or company.\nFind current price, today's change, and recent news.\nReturn:\nPRICE: $[current] | CHANGE: [today's change %] | VOLUME: [volume]\nNEWS: [latest relevant headline]\nSUMMARY: [brief market context]\nTake a screenshot.`;
  }

  return `${userMessage}\n\nResearch this thoroughly.\nCheck at least 2-3 reliable websites.\nTake screenshots of the most relevant information.\nReturn a comprehensive, well-organized answer.\nAt the end list: SOURCES: [websites checked]`;
}

// ============================================================================
// ARIA INTELLIGENCE LOOP
// ============================================================================

export const runBrowserAgent = internalAction({
  args: {
    conversationId: v.id("ariaConversations"),
    messageId: v.id("ariaMessages"),
    userMessage: v.string(),
    meridianContext: v.optional(v.string()),
  },
  handler: async (ctx, { conversationId, messageId, userMessage, meridianContext }) => {
    try {
      // === STEP 1: Claude decides what to do ===
      await ctx.runMutation(internal.aria.updateMessage, {
        messageId,
        status: "thinking",
        progressEvent: "Analyzing your request...",
      });

      const decision = await claudeDecide(
        userMessage,
        meridianContext ?? "No live data available"
      );

      await ctx.runMutation(internal.aria.updateMessage, {
        messageId,
        progressEvent: decision.reasoning,
      });

      // Set conversation title
      await ctx.runMutation(internal.aria.updateConversationTitle, {
        conversationId,
        title: userMessage.slice(0, 60),
      });

      // === STEP 2A: Answer directly from MERIDIAN data ===
      if (!decision.needsBrowsing && decision.directAnswer) {
        await ctx.runMutation(internal.aria.updateMessage, {
          messageId,
          content: decision.directAnswer,
          status: "complete",
          progressEvent: "Answered from live MERIDIAN data",
          source: "MERIDIAN Intelligence Dashboard",
        });
        return;
      }

      // === STEP 2B: Browse the web via Convex component ===
      const browserPrompt =
        decision.browserPrompt ?? buildFallbackPrompt(userMessage);

      await ctx.runMutation(internal.aria.updateMessage, {
        messageId,
        status: "browsing",
        progressEvent: "Launching browser agent...",
      });

      // THIS IS THE CONVEX COMPONENT CALL
      const taskId = await startBrowserTask(ctx, browserPrompt);

      await ctx.runMutation(internal.aria.updateMessage, {
        messageId,
        taskId,
        progressEvent: "Browser agent navigating the web...",
      });

      // === STEP 3: Poll for results, streaming screenshots ===
      const deadline = Date.now() + 280000;
      let lastScreenshots = 0;
      let lastProgress = 0;

      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));

        const task = await getTaskStatus(ctx, taskId);
        if (!task) continue;

        // Stream screenshots reactively
        const screenshots = task.screenshots ?? [];
        for (let i = lastScreenshots; i < screenshots.length; i++) {
          await ctx.runMutation(internal.aria.updateMessage, {
            messageId,
            screenshot: screenshots[i],
          });
        }
        lastScreenshots = screenshots.length;

        // Stream progress events
        const progress = task.progress ?? [];
        for (let i = lastProgress; i < progress.length; i++) {
          const e = progress[i] as
            | string
            | { message?: string; type?: string };
          const text =
            typeof e === "string"
              ? e
              : e?.message ?? e?.type ?? "Processing...";
          await ctx.runMutation(internal.aria.updateMessage, {
            messageId,
            progressEvent: text,
          });
        }
        lastProgress = progress.length;

        // === STEP 4: Handle completion ===
        if (task.status === "succeeded" || task.status === "failed") {
          if (task.status === "succeeded" && task.result) {
            const rawResult =
              typeof task.result === "string"
                ? task.result
                : JSON.stringify(task.result, null, 2);

            // Claude synthesizes raw result into clean answer
            await ctx.runMutation(internal.aria.updateMessage, {
              messageId,
              progressEvent: "Synthesizing results...",
            });

            const synthesized = await claudeSynthesize(userMessage, rawResult);

            // Extract sources from synthesized answer
            const sourceMatches =
              synthesized.match(/\*?\*?Sources?\*?\*?:?\s*([^\n]+)/gi) ?? [];
            for (const match of sourceMatches) {
              const source = match
                .replace(/\*?\*?Sources?\*?\*?:?\s*/i, "")
                .trim();
              if (source && source.length > 3) {
                await ctx.runMutation(internal.aria.updateMessage, {
                  messageId,
                  source,
                });
              }
            }

            await ctx.runMutation(internal.aria.updateMessage, {
              messageId,
              content: synthesized,
              status: "complete",
              progressEvent: "Complete",
            });
          } else {
            await ctx.runMutation(internal.aria.updateMessage, {
              messageId,
              content:
                "The browser agent couldn't complete that task. Please try rephrasing or try again.",
              status: "failed",
            });
          }
          return;
        }
      }

      // Timeout
      await ctx.runMutation(internal.aria.updateMessage, {
        messageId,
        content: "The task took too long. Please try a simpler request.",
        status: "failed",
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("[ARIA] Agent error:", errorMsg);
      await ctx.runMutation(internal.aria.updateMessage, {
        messageId,
        content: "Something went wrong. Please try again.",
        status: "failed",
      });
    }
  },
});
