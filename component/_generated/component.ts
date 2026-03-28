/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    convex: {
      tasks: {
        cancelTask: FunctionReference<
          "mutation",
          "internal",
          { taskId: string },
          { ok: boolean },
          Name
        >;
        getTask: FunctionReference<
          "query",
          "internal",
          { taskId: string },
          null | {
            _id: string;
            canceledAt?: number;
            createdAt: number;
            error?: any;
            finishedAt?: number;
            options?: any;
            progress: Array<any>;
            prompt: string;
            providerTaskId?: string;
            result?: any;
            screenshots: Array<string>;
            startedAt?: number;
            status: "queued" | "running" | "succeeded" | "failed" | "canceled";
            updatedAt: number;
          },
          Name
        >;
        listTasks: FunctionReference<
          "query",
          "internal",
          { cursor?: string; limit?: number },
          {
            nextCursor: string | null;
            tasks: Array<{
              _id: string;
              createdAt: number;
              error?: any;
              finishedAt?: number;
              progress: Array<any>;
              prompt: string;
              result?: any;
              screenshots: Array<string>;
              startedAt?: number;
              status:
                | "queued"
                | "running"
                | "succeeded"
                | "failed"
                | "canceled";
              updatedAt: number;
            }>;
          },
          Name
        >;
        startTask: FunctionReference<
          "mutation",
          "internal",
          {
            apiKey?: string;
            options?: {
              metadata?: Record<string, any>;
              pollIntervalMs?: number;
              timeoutMs?: number;
            };
            prompt: string;
          },
          { taskId: string },
          Name
        >;
      };
    };
  };
