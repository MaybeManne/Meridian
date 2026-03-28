# Project Context

## Overview

This is a Bloom take-home project implementing a **durable browser automation agent** using:

- **Convex Components SDK** - For building a reusable, isolated component
- **Convex Workflows** - For durable "run until completion" execution
- **Browser Use Cloud** - For remote browser automation (stubbed with mock mode)

## Goal

A user can:
1. Type a natural language task like "Go to Airbnb and book a room in Barcelona tomorrow"
2. Click Run
3. See a live timeline of the agent's progress
4. Get final results even if they refresh the page mid-run

## Key Files

### Component (`/component`)

| File | Purpose |
|------|---------|
| `convex.config.ts` | Defines the Convex Component |
| `convex/schema.ts` | Tasks table schema |
| `convex/types.ts` | TypeScript types for tasks, progress events, etc. |
| `convex/tasks.ts` | Public API (startTask, getTask, listTasks, cancelTask) |
| `convex/workflow.ts` | Durable workflow that orchestrates task execution |
| `convex/provider.ts` | Browser Use Cloud API integration (stubs + mock mode) |

### Example App (`/example`)

| File | Purpose |
|------|---------|
| `convex.config.ts` | Installs the browser use component |
| `app/page.tsx` | Main page with task UI |
| `app/components/*.tsx` | UI components (TaskInput, Timeline, etc.) |
| `app/providers.tsx` | Convex React provider setup |

## Architecture Decisions

### Why Convex Components?

- **Isolation**: Component has its own schema and state
- **Reusability**: Can be installed in any Convex app
- **Clean API**: Typed exports for queries/mutations/actions

### Why Convex Workflows?

- **Durability**: Tasks run to completion even if server restarts
- **Automatic Retry**: Built-in retry on transient failures
- **Long Running**: Supports tasks that take minutes to complete

### Why Mock Mode?

- **Development**: Test full flow without real API keys
- **Demos**: Show realistic behavior in any environment
- **Testing**: Deterministic behavior for integration tests

## Provider Stub Location

To implement real Browser Use Cloud integration:

```
component/convex/provider.ts
```

Look for sections marked:
```typescript
// =========================================================================
// REAL BROWSER USE CLOUD IMPLEMENTATION GOES HERE
// =========================================================================
```

## Running Locally

```bash
npm install
npm run dev
```

Opens:
- Convex dev server
- Next.js at http://localhost:3000

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_CONVEX_URL` | Yes | Convex deployment URL |
| `BROWSER_USE_MOCK` | No | Set to `1` for mock mode (default) |
| `BROWSER_USE_API_KEY` | If mock=0 | Browser Use Cloud API key |

## Testing Durability

1. Start a task
2. Refresh the page while running
3. Task continues and UI reconnects to show live progress
