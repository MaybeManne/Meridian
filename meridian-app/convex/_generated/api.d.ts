/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aria from "../aria.js";
import type * as ariaAgent from "../ariaAgent.js";
import type * as claudeHelpers from "../claudeHelpers.js";
import type * as humint from "../humint.js";
import type * as sweep from "../sweep.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aria: typeof aria;
  ariaAgent: typeof ariaAgent;
  claudeHelpers: typeof claudeHelpers;
  humint: typeof humint;
  sweep: typeof sweep;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  browserUse: {
    convex: {
      tasks: {
        cancelTask: FunctionReference<
          "mutation",
          "internal",
          { taskId: string },
          { ok: boolean }
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
          }
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
          }
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
          { taskId: string }
        >;
      };
    };
  };
};
