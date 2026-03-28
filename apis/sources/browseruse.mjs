// Browser Use HUMINT — AI browser agents for deep OSINT
// Calls Browser Use Cloud API directly to run intelligence gathering tasks
// Each sweep dispatches focused agents, polls for results, caches findings

const API_BASE = 'https://api.browser-use.com/api/v2';
const POLL_INTERVAL_MS = 3000;
const MAX_WAIT_MS = 25000; // Stay within 30s source timeout

// Persistent cache between sweeps
let cachedFindings = [];
let cachedAgents = [];
let cacheTimestamp = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min cache

// Track running tasks across sweeps
let pendingTasks = []; // { id, agent, startedAt }

function getApiKey() {
  return process.env.BROWSER_USE_API_KEY || '';
}

// HUMINT agent prompts — each one is a focused intelligence gathering mission
const AGENTS = [
  {
    name: 'Reuters Flash',
    prompt: `Go to reuters.com/world and read the top 5 headlines visible on the page. For each headline, extract:
- The exact headline text
- The region/country it relates to
- Whether it involves military, economic, or political events
- A severity rating: critical, high, medium, low

Return your findings as a structured list. Focus on: military conflicts, sanctions, trade disputes, energy disruptions, and diplomatic crises. Skip sports, entertainment, and lifestyle stories.`,
  },
  {
    name: 'Defense Intel',
    prompt: `Go to defense.gov/News and read the latest 3-4 news items. Then go to janes.com and read any visible headlines. Extract:
- Military deployments or exercises mentioned
- Any weapons systems, procurement, or defense contracts
- Regions involved
- Severity/urgency of each item

Return a structured summary of defense and military intelligence findings.`,
  },
  {
    name: 'Energy Monitor',
    prompt: `Go to oilprice.com and read the top 3 headlines. Then check reuters.com/business/energy for the latest energy news. Extract:
- Oil/gas supply disruptions or production changes
- OPEC decisions or statements
- Pipeline or shipping route disruptions
- Price-moving events
- Regions affected

Return structured findings about energy market intelligence.`,
  },
  {
    name: 'Shipping Watch',
    prompt: `Go to gcaptain.com and read the top 3-4 headlines about shipping and maritime activity. Focus on:
- Any shipping disruptions, attacks on vessels, or route diversions
- Port closures or congestion
- Red Sea / Suez Canal / Panama Canal status
- Sanctions affecting shipping
- Piracy or maritime security incidents

Return structured findings about maritime and shipping intelligence.`,
  },
];

async function createTask(prompt) {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const res = await fetch(`${API_BASE}/tasks`, {
      method: 'POST',
      headers: {
        'X-Browser-Use-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ task: prompt }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const text = await res.text();
      console.log(`[BrowserUse] Create task failed: ${res.status} ${text.substring(0, 100)}`);
      return null;
    }
    const data = await res.json();
    return data.id || null;
  } catch (e) {
    console.log(`[BrowserUse] Create task error: ${e.message}`);
    return null;
  }
}

async function pollTask(taskId) {
  const apiKey = getApiKey();
  try {
    const res = await fetch(`${API_BASE}/tasks/${taskId}`, {
      headers: { 'X-Browser-Use-API-Key': apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function normalizeStatus(status) {
  const s = (status || '').toLowerCase();
  if (['finished', 'completed', 'succeeded', 'success', 'done'].includes(s)) return 'succeeded';
  if (['failed', 'error', 'cancelled', 'canceled', 'timeout', 'stopped'].includes(s)) return 'failed';
  return 'running';
}

function parseFindings(agentName, output) {
  if (!output) return [];
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  if (!text || text.length < 20) return [];

  // Split output into individual findings
  const findings = [];
  // Try to parse structured items (numbered lists, bullet points)
  const lines = text.split(/\n/).filter(l => l.trim());
  let currentFinding = null;

  for (const line of lines) {
    const trimmed = line.trim();
    // Detect new finding start (numbered, bulleted, or headline-like)
    if (/^[\d]+[.)]\s|^[-•*]\s|^#+\s/.test(trimmed) || /^(headline|finding|item|story)\s*\d*:/i.test(trimmed)) {
      if (currentFinding && currentFinding.text.length > 10) {
        findings.push(currentFinding);
      }
      currentFinding = {
        agent: agentName,
        text: trimmed.replace(/^[\d]+[.)]\s*|^[-•*]\s*|^#+\s*/, '').trim(),
        severity: 'medium',
        category: guessCategoryFromAgent(agentName),
      };
    } else if (currentFinding) {
      currentFinding.text += ' ' + trimmed;
    } else {
      // First line without marker
      currentFinding = {
        agent: agentName,
        text: trimmed,
        severity: 'medium',
        category: guessCategoryFromAgent(agentName),
      };
    }

    // Check for severity markers
    if (/critical|urgent|breaking|emergency/i.test(trimmed)) {
      if (currentFinding) currentFinding.severity = 'critical';
    } else if (/high|significant|major|escalat/i.test(trimmed)) {
      if (currentFinding) currentFinding.severity = 'high';
    } else if (/low|minor|routine/i.test(trimmed)) {
      if (currentFinding) currentFinding.severity = 'low';
    }
  }
  if (currentFinding && currentFinding.text.length > 10) {
    findings.push(currentFinding);
  }

  // If no structured findings found, treat whole output as one finding
  if (findings.length === 0 && text.length > 20) {
    findings.push({
      agent: agentName,
      text: text.substring(0, 500),
      severity: 'medium',
      category: guessCategoryFromAgent(agentName),
    });
  }

  return findings.slice(0, 8);
}

function guessCategoryFromAgent(name) {
  if (/defense|military/i.test(name)) return 'defense';
  if (/energy|oil/i.test(name)) return 'energy';
  if (/shipping|maritime/i.test(name)) return 'maritime';
  return 'geopolitical';
}

export async function briefing() {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      source: 'Browser Use HUMINT',
      findings: [],
      agents: [],
      disabled: true,
      summary: 'BROWSER_USE_API_KEY not set — HUMINT disabled',
    };
  }

  // Return cache if fresh
  if (cachedFindings.length > 0 && (Date.now() - cacheTimestamp) < CACHE_TTL_MS) {
    return {
      source: 'Browser Use HUMINT',
      timestamp: new Date(cacheTimestamp).toISOString(),
      findings: cachedFindings,
      agents: cachedAgents,
      disabled: false,
      cached: true,
      summary: `${cachedFindings.length} HUMINT findings (cached)`,
    };
  }

  // Check if any pending tasks from last sweep completed
  const completedFindings = [];
  const agentStatuses = [];
  const stillPending = [];

  for (const task of pendingTasks) {
    const result = await pollTask(task.id);
    if (!result) continue;
    const status = normalizeStatus(result.status);
    agentStatuses.push({ name: task.agent, taskId: task.id, status });

    if (status === 'succeeded') {
      const findings = parseFindings(task.agent, result.output);
      completedFindings.push(...findings);
      console.log(`[BrowserUse] ${task.agent} completed: ${findings.length} findings`);
    } else if (status === 'running' && (Date.now() - task.startedAt) < 5 * 60 * 1000) {
      stillPending.push(task);
    } else if (status === 'failed') {
      console.log(`[BrowserUse] ${task.agent} failed: ${result.error || 'unknown'}`);
    }
  }
  pendingTasks = stillPending;

  // If we got findings from pending tasks, cache and return
  if (completedFindings.length > 0) {
    cachedFindings = completedFindings;
    cachedAgents = agentStatuses;
    cacheTimestamp = Date.now();
  }

  // Launch new agents (pick 2 per sweep to balance cost/coverage)
  const agentsToRun = pickAgents(2);
  const newTasks = [];

  for (const agent of agentsToRun) {
    console.log(`[BrowserUse] Dispatching agent: ${agent.name}`);
    const taskId = await createTask(agent.prompt);
    if (taskId) {
      newTasks.push({ id: taskId, agent: agent.name, startedAt: Date.now() });
      agentStatuses.push({ name: agent.name, taskId, status: 'running' });
      console.log(`[BrowserUse] ${agent.name} started: ${taskId}`);
    }
  }

  // Wait for at least one to complete (up to MAX_WAIT_MS)
  if (newTasks.length > 0) {
    const deadline = Date.now() + MAX_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

      for (const task of newTasks) {
        if (completedFindings.some(f => f._taskDone === task.id)) continue;
        const result = await pollTask(task.id);
        if (!result) continue;
        const status = normalizeStatus(result.status);

        // Update agent status
        const agentEntry = agentStatuses.find(a => a.taskId === task.id);
        if (agentEntry) agentEntry.status = status;

        if (status === 'succeeded') {
          const findings = parseFindings(task.agent, result.output);
          findings.forEach(f => f._taskDone = task.id);
          completedFindings.push(...findings);
          console.log(`[BrowserUse] ${task.agent} completed: ${findings.length} findings`);
        } else if (status === 'failed') {
          console.log(`[BrowserUse] ${task.agent} failed`);
        }
      }

      // If all tasks resolved, stop waiting
      const allDone = newTasks.every(t =>
        agentStatuses.find(a => a.taskId === t.id)?.status !== 'running'
      );
      if (allDone) break;
    }

    // Any still-running tasks go to pending for next sweep
    for (const task of newTasks) {
      const a = agentStatuses.find(x => x.taskId === task.id);
      if (a?.status === 'running') {
        pendingTasks.push(task);
      }
    }
  }

  // Clean up internal markers
  const cleanFindings = completedFindings.map(({ _taskDone, ...rest }) => rest);

  // Update cache
  if (cleanFindings.length > 0) {
    cachedFindings = cleanFindings;
    cachedAgents = agentStatuses;
    cacheTimestamp = Date.now();
  }

  return {
    source: 'Browser Use HUMINT',
    timestamp: new Date().toISOString(),
    findings: cleanFindings,
    agents: agentStatuses,
    disabled: false,
    cached: false,
    summary: `${cleanFindings.length} HUMINT findings from ${agentStatuses.length} agents`,
  };
}

// Rotate agents across sweeps for coverage
let lastAgentIdx = 0;
function pickAgents(count) {
  const picked = [];
  for (let i = 0; i < count; i++) {
    picked.push(AGENTS[lastAgentIdx % AGENTS.length]);
    lastAgentIdx++;
  }
  return picked;
}
