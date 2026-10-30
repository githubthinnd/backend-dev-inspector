import type { RequestTrace } from "./types.js"
import { AsyncLocalStorage } from "node:async_hooks"

/**
 * One request scope for the whole process, however many copies of this package are loaded
 * (the package and the packages built on it each bring their own module instance).
 */
const SCOPE = Symbol.for("sqlDevInspector.requestScope")

function scope(): AsyncLocalStorage<RequestTrace> {
  const holder = globalThis as unknown as Record<symbol, AsyncLocalStorage<RequestTrace> | undefined>
  return (holder[SCOPE] ??= new AsyncLocalStorage<RequestTrace>())
}

/** Everything awaited inside `fn` is attributed to `trace`, however deep the call goes. */
export function runInRequest<T>(trace: RequestTrace, fn: () => T): T {
  return scope().run(trace, fn)
}

/** Id of the stand-in trace for work the route filters leave out; nothing run under it is recorded. */
export const IGNORED_ID = "ignored"

const IGNORED: RequestTrace = { id: IGNORED_ID, method: "-", url: "(ignored)", status: null, startedAt: 0, durationMs: null, queries: [], droppedQueries: 0 }

/** Runs `fn` for a request that is not followed: its statements are dropped, not gathered under "outside any request". */
export function runIgnored<T>(fn: () => T): T {
  return scope().run(IGNORED, fn)
}

/** The request the current code is running for, if any. */
export function currentTrace(): RequestTrace | undefined {
  return scope().getStore()
}

/**
 * Binds a callback to the request that is current now. Drivers hand callbacks to a connection
 * pool, which runs them later from whichever request freed a connection; binding keeps the
 * statement with the request that asked for it.
 */
export function bindToRequest<T extends (...args: never[]) => unknown>(fn: T): T {
  return AsyncLocalStorage.bind(fn)
}
