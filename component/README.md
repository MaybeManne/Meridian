# Browser Use Convex Component

Durable browser automation for Convex apps. Drop-in. Reactive. Zero polling.

Built with the Convex Components SDK.

## What this is

A Convex component that wraps [Browser Use Cloud](https://browser-use.com) —
giving your Convex app durable browser agents that:

- **Survive page refreshes** — agents run on the backend, not in the browser
- **Stream progress reactively** — useQuery updates automatically as agents work
- **Run in parallel** — spawn 10 agents simultaneously with zero polling
- **Handle retries automatically** — Convex workflows manage failures
- **Never need setInterval** — reactive subscriptions replace polling loops

## Install

```bash
npm install @convex-dev/browser-use
```

```typescript
// convex.config.ts
import browserUse from "@convex-dev/browser-use/convex.config";
const app = defineApp();
app.use(browserUse);
export default app;
```

```bash
npx convex env set BROWSER_USE_API_KEY=your_key_here
```

## Use

```typescript
// In any Convex action — start a durable browser agent
const { taskId } = await ctx.runMutation(
  components.browserUse.tasks.startTask,
  {
    prompt: "Go to reuters.com and find the latest oil headlines",
    options: { timeoutMs: 120000 }
  }
);
```

```typescript
// In your React component — subscribe reactively, zero polling
const task = useQuery(api.tasks.getTask, { taskId });

// task.status       → "queued" | "running" | "succeeded" | "failed"
// task.progress     → live step-by-step updates as agent browses
// task.screenshots  → array of screenshot URLs, updates live
// task.result       → final extracted data when complete
```

## API

### startTask({ prompt, options? }) → { taskId }
Start a durable browser agent. Returns immediately with a taskId.
The agent runs on the backend — survives page refreshes.

### getTask({ taskId }) → task
Reactive query. Updates automatically as agent progresses.
Use with useQuery for live streaming updates.

### listTasks({ limit? }) → task[]
List recent tasks. Useful for building task history.

### cancelTask({ taskId }) → void
Cancel a running task.

## Why Convex

Without this component, you'd need to:
- Manage task state yourself
- Build a polling loop (setInterval every 3s)
- Handle browser restarts losing in-flight tasks
- Wire up your own SSE or WebSocket for streaming

With this component — 3 lines of code. Everything else is handled.

## Example app

MERIDIAN — a geopolitical intelligence terminal powered by Browser Use agents
reading paywalled news, shipping forums, and defense sites in real time.

[github.com/MaybeManne/ConvexComponent](https://github.com/MaybeManne/ConvexComponent)

## License
MIT
