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
