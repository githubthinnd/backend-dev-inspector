import type { IncomingMessage, ServerResponse } from "node:http"
import { runIgnored, runInRequest } from "./context.js"
import { handleInspectorRequest, inspectorSubPath } from "./inspector-server.js"
import { isTracked } from "./route-filter.js"
import { type StartOptions, startInspector } from "./setup.js"

export interface SqlInspector {
  /** False when the environment switched the inspector off; every other member is then a no-op. */
  enabled: boolean
  /** Connect / Express style middleware. Mount it before your routes. */
  middleware: (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => void
  /**
   * For plain `http` servers and other frameworks: serves the inspector's own pages and
   * returns true when it did, in which case the request must not be handled further.
   */
  handle: (req: IncomingMessage, res: ServerResponse) => boolean
  /** Runs `fn` as one traced request; everything awaited inside is attributed to it. */
  track: <T>(req: IncomingMessage, res: ServerResponse, fn: () => T) => T
  /** Runs `fn` as one traced unit of work that is not an HTTP request (job, cron, script). */
  task: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>
}

/**
 * Framework-agnostic entry point for any Node server whose SQL goes through mysql2
 * (directly, or via Drizzle, Knex, Sequelize, TypeORM, Prisma's mysql2 adapter…).
 */
export function createSqlInspector(options: StartOptions = {}): SqlInspector {
  const inspector = startInspector(undefined, options)
  if (!inspector) {
    return {
      enabled: false,
      middleware: (_req, _res, next) => next(),
      handle: () => false,
      track: (_req, _res, fn) => fn(),
      task: async (_name, fn) => await fn()
    }
  }
  const { store } = inspector

  const handle: SqlInspector["handle"] = (req, res) => {
    const subPath = inspectorSubPath(req.url, inspector.mount)
    if (subPath === null) {
      return false
    }
    handleInspectorRequest(req, res, subPath, inspector)
    return true
  }

  const track: SqlInspector["track"] = (req, res, fn) => {
    const url = req.originalUrl ?? req.url ?? "/"
    if (!isTracked(inspector.filters, url)) {
      return runIgnored(fn)
    }
    const trace = store.startRequest(req.method ?? "GET", url, req.headers?.traceparent)
    res.once("close", () => store.finishRequest(trace, res.statusCode))
    return runInRequest(trace, fn)
  }

  return {
    enabled: true,
    handle,
    track,
    middleware: (req, res, next) => {
      if (!handle(req, res)) {
        track(req, res, () => next())
      }
    },
    task: async (name, fn) => {
      const trace = store.startRequest("TASK", name)
      try {
        return await runInRequest(trace, fn)
      } finally {
        store.finishRequest(trace, 0)
      }
    }
  }
}

declare module "node:http" {
  interface IncomingMessage {
    /** Set by Express when a router rewrites `url`. */
    originalUrl?: string
  }
}
