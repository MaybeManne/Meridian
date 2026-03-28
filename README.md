# Browser Use Convex Component

> Durable browser automation for Convex. Drop-in. Reactive. Zero polling.

[![npm](https://img.shields.io/badge/convex-component-orange)](https://convex.dev/components)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A [Convex Component](https://docs.convex.dev/components) that wraps
[Browser Use Cloud](https://browser-use.com) — giving your Convex app
durable browser agents that survive server restarts, stream progress
reactively, and never need polling.

Built with the Convex Components SDK. Inspired by the Stagehand component.

---

## Why this exists

The official Browser Use integration requires you to poll for task status:

```javascript
// ❌ Without this component — polling anti-pattern
useEffect(() => {
  const interval = setInterval(async () => {
    const status = await fetchTaskStatus(taskId);
    setTask(status);
  }, 3000);
  return () => clearInterval(interval);
}, [taskId]);
```

This component gives you reactive updates with zero polling:

```typescript
// ✅ With this component — reactive, zero polling
const task = useQuery(api.tasks.getTask, { taskId });
// Updates automatically. No interval. No manual fetching.
```

---

## Install

### 1. Install the package

```bash
npm install @convex-dev/browser-use
```

### 2. Register the component

```typescript
// convex.config.ts
import { defineApp } from "convex/server";
import browserUse from "@convex-dev/browser-use/convex.config";

const app = defineApp();
app.use(browserUse);
export default app;
```

### 3. Set your API key

```bash
npx convex env set BROWSER_USE_API_KEY=your_key_here
```

Get a Browser Use API key at [browser-use.com](https://browser-use.com)

---

## Use

### Start a browser agent

```typescript
// In any Convex action
import { components } from "./_generated/api";

const { taskId } = await ctx.runMutation(
  components.browserUse.tasks.startTask,
  {
    prompt: "Go to reuters.com and find the latest oil headlines",
    options: { timeoutMs: 120000 }
  }
);
```

### Subscribe to live updates

```typescript
// In your React component — zero polling, fully reactive
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

function TaskViewer({ taskId }) {
  const task = useQuery(api.tasks.getTask, { taskId });

  if (!task) return <div>Loading...</div>;

  return (
    <div>
      <div>Status: {task.status}</div>

      {/* Live screenshots as agent browses */}
      {task.screenshots.map((url, i) => (
        <img key={i} src={url} />
      ))}

      {/* Step by step progress */}
      {task.progress.map((step, i) => (
        <div key={i}>{step.message}</div>
      ))}

      {/* Final result */}
      {task.status === "succeeded" && (
        <div>{task.result}</div>
      )}
    </div>
  );
}
```

---

## API Reference

### `startTask({ prompt, options? })`

Start a durable browser agent task.

| Parameter | Type | Description |
|-----------|------|-------------|
| `prompt` | `string` | Natural language instruction for the agent |
| `options.timeoutMs` | `number` | Max runtime in ms (default: 300000) |

Returns `{ taskId: string }`

### `getTask({ taskId })`

Reactive query — use with `useQuery` for live updates.

Returns task object:
| Field | Type | Description |
|-------|------|-------------|
| `status` | `"queued" \| "running" \| "succeeded" \| "failed" \| "canceled"` | Current task status |
| `progress` | `ProgressEvent[]` | Live step-by-step updates |
| `screenshots` | `string[]` | Screenshot URLs, updated as agent browses |
| `result` | `string \| null` | Final extracted data when complete |
| `error` | `string \| null` | Error message if failed |

### `listTasks({ limit? })`

List recent tasks ordered by creation time.

### `cancelTask({ taskId })`

Cancel a running task.

---

## How it works

Under the hood this component uses **Convex's durable scheduler** to manage the
Browser Use task lifecycle:

```
startTask mutation
  → inserts task record
  → schedules workflow via ctx.scheduler.runAfter

workflow (runWorkflowStep)
  → calls Browser Use Cloud API to create task
  → polls for completion using scheduler.runAfter (not setInterval)
  → updates task record as progress arrives
  → reschedules itself until terminal state
  → final result stored in Convex database

useQuery(getTask)
  → reactive subscription
  → updates automatically when task record changes
  → zero client-side polling
```

This means:
- **Durable** — workflow survives server restarts mid-task
- **Reactive** — UI updates via WebSocket push, not polling
- **Parallel** — run 50 agents simultaneously, each gets its own workflow
- **Observable** — every step logged to Convex database
- **Idempotent** — safe to retry, deduplicates progress events and screenshots

---

## Example app: MERIDIAN

MERIDIAN is a geopolitical intelligence terminal built on this component.

Browser Use agents read paywalled Reuters articles, shipping forums, and
defense news sites — sources no API can access — and feed findings into
a stock prediction engine.

It also includes **ARIA** — an autonomous chat agent that uses the component
to browse the web for any task you give it.

**Run it:**

```bash
git clone https://github.com/MaybeManne/ConvexComponent
cd ConvexComponent
cp .env.example .env
# Add BROWSER_USE_API_KEY and other keys
npm install
cd meridian-app && npm install && cd ..
npm run dev:meridian
```

- `http://localhost:3117` — MERIDIAN intelligence dashboard
- `http://localhost:3118` — ARIA browser agent chat

---

## Development

```bash
git clone https://github.com/MaybeManne/ConvexComponent
cd ConvexComponent/component
npm install
npm run typecheck
```

To test with the example app:
```bash
cd ../
npm install
cd meridian-app && npm install
npx convex dev
```

---

## License

MIT — free to use, modify, and distribute.

---

## Acknowledgements

- [Convex](https://convex.dev) for the Components SDK
- [Browser Use](https://browser-use.com) for the browser automation API
- Inspired by the [Stagehand Convex component](https://github.com/browserbase/stagehand)
- Data layer forked from [Crucix](https://github.com/calesthio/Crucix) by @calesthio (AGPL-3.0)
