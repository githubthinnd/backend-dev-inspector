import type { SqlInspector, StartOptions, WebInspector } from "sql-dev-inspector"
import { createSqlInspector as createNodeInspector, createWebInspector as createFetchInspector, startInspector as startBase } from "sql-dev-inspector"
import { withDefaults } from "./options.js"

/** Connect / Express style and plain `node:http` inspector, with every driver. */
export function createInspector(options: StartOptions = {}): SqlInspector {
  return createNodeInspector(withDefaults(options))
}

/** Same as `createInspector`; the name sql-dev-inspector uses. */
export const createSqlInspector = createInspector

/** Web-standard `Request` / `Response` inspector (Hono, SvelteKit, Next.js route handlers, Bun, Deno), with every driver. */
export function createWebInspector(options: StartOptions = {}): WebInspector {
  return createFetchInspector(withDefaults(options))
}

/** Starts the inspector with every driver, once per process. */
export const startInspector = ((env, options) => startBase(env, withDefaults(options, env))) as typeof startBase
