/**
 * Claude AI helpers for ARIA intelligence loop.
 *
 * Imported by ariaAgent.ts (which has "use node") —
 * runs in the Convex Node.js runtime, NOT the browser.
 */

import Anthropic from "@anthropic-ai/sdk";

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

export async function claudeDecide(
  userMessage: string,
  meridianContext: string
): Promise<{
  needsBrowsing: boolean;
  browserPrompt?: string;
  directAnswer?: string;
  reasoning: string;
}> {
  const client = getClient();
  if (!client) {
    // No API key — default to browsing
    return {
      needsBrowsing: true,
      reasoning: "No ANTHROPIC_API_KEY set — defaulting to web search",
      browserPrompt: `${userMessage}\n\nSearch for this information on reliable websites. Return a clear, structured answer with sources.`,
    };
  }

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    system: `You are ARIA — an autonomous intelligence agent with two capabilities:
1. Answer from live MERIDIAN geopolitical data (flights, conflicts, stocks, satellites, HUMINT)
2. Browse the web in real time using Browser Use

Decide which capability to use based on the user's message.

MERIDIAN has live data on:
- Aircraft positions over conflict zones (OpenSky)
- Armed conflict events (ACLED)
- Oil prices and inventory (EIA)
- Stock prices and predictions
- Satellite coverage of hotspots
- HUMINT from Browser Use agents
- Breaking news (GDELT)
- Nuclear site radiation monitoring
- Maritime vessel tracking (AIS)
- Regime stability scores for 8 nations

If the question can be answered well from MERIDIAN data — answer directly.
If it needs current web information, booking, research, or anything outside MERIDIAN — browse.

Always respond in this exact JSON format:
{
  "needsBrowsing": true/false,
  "reasoning": "one sentence explaining your decision",
  "browserPrompt": "if needsBrowsing: the exact prompt to give Browser Use agent",
  "directAnswer": "if not needsBrowsing: your answer using the MERIDIAN data provided"
}`,
    messages: [
      {
        role: "user",
        content: `MERIDIAN LIVE DATA:
${meridianContext || "No live data available"}

USER MESSAGE: ${userMessage}

Respond with JSON only.`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  try {
    const clean = text.replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return {
      needsBrowsing: true,
      reasoning: "Defaulting to web search",
      browserPrompt: `${userMessage}\n\nSearch for this information on reliable websites. Return a clear, structured answer with sources.`,
    };
  }
}

export async function claudeSynthesize(
  userMessage: string,
  rawBrowserResult: string
): Promise<string> {
  const client = getClient();
  if (!client) {
    // No API key — return raw result
    return rawBrowserResult;
  }

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: `You are ARIA — an intelligence analyst.
A browser agent just searched the web and returned raw results.
Synthesize the raw data into a clean, well-structured answer for the user.

Format your response clearly:
- Use ## headers if there are multiple sections
- Use bullet points for lists
- Bold important numbers and names using **bold**
- End with a brief "**Sources:**" section listing sites consulted
- Be concise but complete
- Preserve all specific data points (prices, dates, names, numbers)
- Do not add information that wasn't in the raw data`,
    messages: [
      {
        role: "user",
        content: `USER ASKED: ${userMessage}

BROWSER AGENT FOUND:
${rawBrowserResult}

Synthesize this into a clean, readable answer.`,
      },
    ],
  });

  return response.content[0].type === "text"
    ? response.content[0].text
    : rawBrowserResult;
}
