"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { components } from "./_generated/api";

// ============================================================================
// KEY CONNECTION: Browser Use Convex Component
// startBrowserTask calls the component's startTask mutation
// getTaskStatus calls the component's getTask query
// This is what makes MERIDIAN the demo for the component
// ============================================================================

async function startBrowserTask(
  ctx: { runMutation: Function },
  prompt: string,
  timeoutMs = 180000
) {
  const result = await ctx.runMutation(
    components.browserUse.convex.tasks.startTask,
    {
      prompt,
      options: { timeoutMs },
      apiKey: process.env.BROWSER_USE_API_KEY,
    }
  );
  return result.taskId as string;
}

async function getTaskStatus(
  ctx: { runQuery: Function },
  taskId: string
) {
  return await ctx.runQuery(components.browserUse.convex.tasks.getTask, {
    taskId,
  });
}

// ============================================================================
// FINDING PARSER
// ============================================================================

function parseFindings(text: string) {
  if (!text) return [];
  const findings: Array<{
    headline: string;
    summary: string;
    signal: string;
    severity: string;
  }> = [];

  for (const line of text.split("\n")) {
    if (line.includes("HEADLINE:")) {
      const headline = line.match(/HEADLINE:\s*([^|]+)/i)?.[1]?.trim();
      const summary =
        line.match(/SUMMARY:\s*([^|]+)/i)?.[1]?.trim() ?? "";
      const signal =
        line.match(/SIGNAL:\s*([^|]+)/i)?.[1]?.trim() ?? "neutral";
      const severity =
        line.match(/SEVERITY:\s*([^|]+)/i)?.[1]?.trim() ?? "medium";
      if (headline) findings.push({ headline, summary, signal, severity });
    }
  }

  // Fallback: if no structured findings but meaningful text
  if (findings.length === 0 && text?.length > 100) {
    findings.push({
      headline: text.slice(0, 150).trim(),
      summary: text.slice(0, 300).trim(),
      signal: "neutral",
      severity: "medium",
    });
  }

  return findings;
}

// ============================================================================
// AGENT DEFINITIONS
// ============================================================================

const AGENTS = [
  {
    name: "Reuters Energy",
    category: "oil",
    location: { lat: 32, lon: 53, name: "Persian Gulf" },
    prompt: `Go to https://www.reuters.com/business/energy/
Find the 3 most recent headlines about oil supply, Iran, Middle East energy, tankers.
For each return on its own line:
HEADLINE: text | SUMMARY: one sentence | SIGNAL: bullish_oil/bearish_oil/neutral | SEVERITY: high/medium/low`,
  },
  {
    name: "Shipping Intelligence",
    category: "shipping",
    location: { lat: 26.5, lon: 56.3, name: "Strait of Hormuz" },
    prompt: `Go to https://www.hellenicshippingnews.com
Find articles about tanker rerouting, Strait of Hormuz, shipping disruptions.
For each return on its own line:
HEADLINE: text | SUMMARY: one sentence | SIGNAL: supply_disruption/normal | SEVERITY: high/medium/low`,
  },
  {
    name: "Defense Intelligence",
    category: "defense",
    location: { lat: 32, lon: 35, name: "Middle East" },
    prompt: `Go to https://www.defensenews.com
Find recent articles about Middle East military activity, defense escalation.
For each return on its own line:
HEADLINE: text | SUMMARY: one sentence | SIGNAL: bullish_defense/neutral | SEVERITY: high/medium/low`,
  },
  {
    name: "Options Flow",
    category: "market",
    location: { lat: 40.7, lon: -74, name: "US Markets" },
    prompt: `Go to https://finviz.com/news.ashx
Find recent news about oil stocks XOM HAL USO, defense stocks LMT RTX.
For each return on its own line:
HEADLINE: text | SUMMARY: one sentence | SIGNAL: bullish_oil/bearish_market/bullish_defense/neutral | SEVERITY: high/medium/low`,
  },
];

// ============================================================================
// SWEEP ACTION — orchestrates all HUMINT agents via the component
// ============================================================================

export const runSweep = internalAction({
  args: { sweepId: v.id("humintSweeps") },
  handler: async (ctx, { sweepId }) => {
    try {
      // Create agent records in parallel
      const agentIds = await Promise.all(
        AGENTS.map((agent) =>
          ctx.runMutation(internal.humint.insertAgent, {
            sweepId,
            name: agent.name,
          })
        )
      );

      // START ALL BROWSER USE TASKS VIA THE COMPONENT
      // Component handles durability, reactive updates, workflows
      const taskResults = await Promise.allSettled(
        AGENTS.map(async (agent, i) => {
          const taskId = await startBrowserTask(ctx, agent.prompt);
          await ctx.runMutation(internal.humint.updateAgent, {
            agentId: agentIds[i],
            taskId,
            status: "running",
            progressEvent: "Agent started via Convex component",
          });
          return { agent, agentId: agentIds[i], taskId };
        })
      );

      const activeTasks = taskResults
        .filter(
          (r): r is PromiseFulfilledResult<{
            agent: (typeof AGENTS)[number];
            agentId: string;
            taskId: string;
          }> => r.status === "fulfilled"
        )
        .map((r) => r.value);

      // Mark failed launches
      taskResults.forEach(async (r, i) => {
        if (r.status === "rejected") {
          await ctx.runMutation(internal.humint.updateAgent, {
            agentId: agentIds[i],
            status: "failed",
            progressEvent: `Launch failed: ${r.reason}`,
          });
        }
      });

      // POLL — component handles the actual Browser Use workflow
      const deadline = Date.now() + 200000;
      let pending = [...activeTasks];

      while (pending.length > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 4000));

        const stillPending: typeof pending = [];
        for (const task of pending) {
          const status = await getTaskStatus(ctx, task.taskId);
          if (!status) {
            stillPending.push(task);
            continue;
          }

          // Update screenshot as agent works
          const screenshot =
            status.screenshots?.[status.screenshots.length - 1];
          if (screenshot) {
            await ctx.runMutation(internal.humint.updateAgent, {
              agentId: task.agentId,
              lastScreenshot: screenshot,
              progressEvent: `Step ${status.progress?.length ?? 0}`,
            });
          }

          if (
            status.status === "succeeded" ||
            status.status === "failed"
          ) {
            if (status.status === "succeeded" && status.result) {
              const text =
                typeof status.result === "string"
                  ? status.result
                  : JSON.stringify(status.result);
              const findings = parseFindings(text);

              // Each finding inserted immediately — makes the dashboard reactive
              for (const finding of findings) {
                await ctx.runMutation(internal.humint.insertFinding, {
                  sweepId,
                  agentId: task.agentId,
                  agentName: task.agent.name,
                  headline: finding.headline,
                  summary: finding.summary,
                  signal: finding.signal,
                  severity: finding.severity as "high" | "medium" | "low",
                  category: task.agent.category,
                  location: task.agent.location,
                  screenshot,
                });
              }

              await ctx.runMutation(internal.humint.updateAgent, {
                agentId: task.agentId,
                status: "complete",
                findingsCount: findings.length,
                progressEvent: `Complete — ${findings.length} signals found`,
              });
            } else {
              await ctx.runMutation(internal.humint.updateAgent, {
                agentId: task.agentId,
                status: "failed",
                progressEvent: "Agent failed",
              });
            }
          } else {
            stillPending.push(task);
          }
        }
        pending = stillPending;
      }

      // Mark any still-pending tasks as failed (timeout)
      for (const task of pending) {
        await ctx.runMutation(internal.humint.updateAgent, {
          agentId: task.agentId,
          status: "failed",
          progressEvent: "Timed out",
        });
      }

      await ctx.runMutation(internal.humint.completeSweep, { sweepId });
    } catch (err) {
      console.error("HUMINT sweep failed:", err);
      await ctx.runMutation(internal.humint.completeSweep, {
        sweepId,
        failed: true,
      });
    }
  },
});
