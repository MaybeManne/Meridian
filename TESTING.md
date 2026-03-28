# Testing MERIDIAN + Browser Use Convex Component

## Prerequisites
- Node.js 18+
- A Convex account (free at convex.dev)
- A Browser Use API key (get at browser-use.com)

## Setup (5 minutes)

### 1. Clone and install
```bash
git clone https://github.com/MaybeManne/ConvexComponent
cd ConvexComponent
cp .env.example .env
npm install
cd meridian-app && npm install && cd ..
```

### 2. Configure Convex
```bash
cd meridian-app
npx convex dev --once
# This creates your Convex project and shows your URL
# Copy the NEXT_PUBLIC_CONVEX_URL to meridian-app/.env.local
```

### 3. Set environment variables

In Convex dashboard (dashboard.convex.dev):
- Go to your project → Settings → Environment Variables
- Add: `BROWSER_USE_API_KEY=your_key`

In `meridian-app/.env.local`:
```
NEXT_PUBLIC_CONVEX_URL=https://your-project.convex.cloud
```

In root `.env` (optional but recommended):
```
LLM_API_KEY=your_anthropic_key
LLM_PROVIDER=anthropic
EIA_API_KEY=your_eia_key
FRED_API_KEY=your_fred_key
```

### 4. Run everything
```bash
npm run dev:meridian
```

### 5. Open
- MERIDIAN: http://localhost:3117
- ARIA chat: http://localhost:3118

## Testing the component

### Test 1: Basic Browser Use task via ARIA
1. Open http://localhost:3118
2. Type: "What's the latest news about oil prices?"
3. Watch: screenshots stream in as agent browses Reuters
4. Result appears when complete

This proves: component works, reactive updates work, zero polling.

### Test 2: MERIDIAN HUMINT sweep
1. Open http://localhost:3117
2. Click "SWEEP" button in the HUMINT panel
3. Watch: HUMINT agent pills appear in right panel
4. Gold signals appear as Browser Use agents find intelligence
5. MERIDIAN score updates

This proves: component powers background intelligence gathering.

### Test 3: Reactive updates survive page refresh
1. Start a task in ARIA
2. While it's running: refresh the page
3. Task continues and updates still stream in

This proves: Convex durability — not possible with raw API polling.

## The component directly

The component lives in `/component`.
To use it in your own Convex app:

```typescript
// convex.config.ts
import { defineApp } from "convex/server";
import browserUse from "@convex-dev/browser-use/convex.config";

const app = defineApp();
app.use(browserUse);
export default app;
```

Then in your Convex actions:
```typescript
import { components } from "./_generated/api";

// Start a task
const { taskId } = await ctx.runMutation(
  components.browserUse.tasks.startTask,
  { prompt: "your task here" }
);
```

In your React components:
```typescript
import { useQuery } from "convex/react";

// Subscribe reactively — zero polling
const task = useQuery(api.tasks.getTask, { taskId });
```

## Architecture verification

```bash
# Component is used (not direct API calls from app code)
grep -r "browser-use.com/api" meridian-app/convex/
# Should return nothing

# Component calls are present
grep -r "components.browserUse" meridian-app/convex/
# Should return results from ariaAgent.ts and sweep.ts

# Workflow is durable (uses scheduler, not setInterval)
grep -r "scheduler.runAfter" component/convex/
# Should return results from workflow.ts and tasks.ts
```
