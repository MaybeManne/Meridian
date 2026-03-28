/**
 * Browser Use Convex Component
 *
 * A durable browser automation component that runs tasks to completion
 * using Browser Use Cloud for remote browser execution.
 *
 * @example
 * ```typescript
 * // In your convex.config.ts
 * import { browserUse } from "@convex-browser-use/component";
 *
 * export default defineApp({
 *   components: [browserUse],
 * });
 *
 * // In your app
 * import { api } from "./convex/_generated/api";
 *
 * // Start a task
 * const { taskId } = await ctx.runMutation(api.browserUse.startTask, {
 *   prompt: "Go to airbnb.com and find rooms in Barcelona",
 * });
 *
 * // Subscribe to task updates (reactive)
 * const task = useQuery(api.browserUse.getTask, { taskId });
 *
 * // Cancel if needed
 * await ctx.runMutation(api.browserUse.cancelTask, { taskId });
 * ```
 */

export type {
  Task,
  TaskStatus,
  TaskOptions,
  TaskError,
  TaskResult,
  ProgressEvent,
  ProgressLevel,
  ProgressKind,
} from "../convex/types";
