/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as answers from "../answers.js";
import type * as cartesia from "../cartesia.js";
import type * as chapters from "../chapters.js";
import type * as files from "../files.js";
import type * as ingest from "../ingest.js";
import type * as jobs from "../jobs.js";
import type * as lib_claude from "../lib/claude.js";
import type * as lib_pipeline from "../lib/pipeline.js";
import type * as lib_worker from "../lib/worker.js";
import type * as messages from "../messages.js";
import type * as segments from "../segments.js";
import type * as sessions from "../sessions.js";
import type * as sources from "../sources.js";
import type * as strokes from "../strokes.js";
import type * as timeline from "../timeline.js";
import type * as tutor from "../tutor.js";
import type * as worker from "../worker.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  answers: typeof answers;
  cartesia: typeof cartesia;
  chapters: typeof chapters;
  files: typeof files;
  ingest: typeof ingest;
  jobs: typeof jobs;
  "lib/claude": typeof lib_claude;
  "lib/pipeline": typeof lib_pipeline;
  "lib/worker": typeof lib_worker;
  messages: typeof messages;
  segments: typeof segments;
  sessions: typeof sessions;
  sources: typeof sources;
  strokes: typeof strokes;
  timeline: typeof timeline;
  tutor: typeof tutor;
  worker: typeof worker;
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

export declare const components: {};
