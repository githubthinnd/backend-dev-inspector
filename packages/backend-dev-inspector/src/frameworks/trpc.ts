import type { LogEntry, StartOptions } from "sql-dev-inspector"
import { currentTrace } from "sql-dev-inspector"
import { createWebInspector } from "../start.js"

/**
 * tRPC. A tRPC server runs inside an HTTP framework, which the matching adapter already traces; a batch of procedures
 * (`/api/trpc/orders.list,users.get`) is then one request. This middleware tells you what each procedure did to it:
 * every procedure leaves a line under the request's "Console output" (`tRPC query orders.list · 12.3 ms · ok`), in the
 * order they ran, with the calls it made in between. Where there is no traced request (a caller made with
 * `createCaller`, a job), the procedure is a request of its own: `QUERY orders.list`.
 *
 *   const t = initTRPC.create()
 *   const inspected = t.procedure.use(trpcInspector())
 *   export const appRouter = t.router({ list: inspected.query(() => …) })
 *
 * Nothing is loaded from `@trpc/server`.
 */

interface MiddlewareArgs {
  path: string
  type: string
  next: () => unknown
}

const MAX_LOGS = 200

/** What a tRPC `next()` gives back: `{ ok: true, … }` or `{ ok: false, error }`; a rejected promise is a failure too. */
function failureOf(result: unknown): string | null {
  const outcome = result as { ok?: boolean, error?: { message?: unknown, code?: unknown } } | null
  if (outcome && outcome.ok === false) {
    return String(outcome.error?.code ?? outcome.error?.message ?? "error")
  }
  return null
}

export function trpcInspector(options: StartOptions = {}) {
  const web = createWebInspector(options)
  return async ({ path, type, next }: MiddlewareArgs): Promise<unknown> => {
    if (!web.enabled) {
      return await next()
    }
    const trace = currentTrace()
    if (!trace || trace.id === "ignored") {
      return await web.run(type.toUpperCase(), path, async () => await next(), ({ result, error }) => error !== undefined || failureOf(result) ? 500 : 200)
    }
    const startedAt = Date.now()
    const t0 = performance.now()
    const note = (outcome: string) => {
      const entry: LogEntry = { level: outcome === "ok" ? "info" : "error", at: startedAt, message: `tRPC ${type} ${path} · ${Math.round((performance.now() - t0) * 10) / 10} ms · ${outcome}` }
      const logs = (trace.logs ??= [])
      if (logs.length < MAX_LOGS) {
        logs.push(entry)
      }
    }
    try {
      const result = await next()
      note(failureOf(result) ?? "ok")
      return result
    } catch (error) {
      note(error instanceof Error ? error.message : "error")
      throw error
    }
  }
}
