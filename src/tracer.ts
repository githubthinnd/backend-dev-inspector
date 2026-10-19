import type { TraceStore } from "./store.js"
import type { QueryEvent, RequestTrace } from "./types.js"
import { AsyncLocalStorage } from "node:async_hooks"
import * as mysql from "mysql2"
import { analyzeSql } from "./sql-analyzer.js"

/**
 * Why patch mysql2 and not use Drizzle's `logger` or mysql2's diagnostics channels:
 *  - Drizzle's logger sees SQL + params only: no duration, no result, no connection, so
 *    transactions and savepoints cannot be told apart from each other.
 *  - mysql2's tracing channels add timing but still hide the connection, which is what
 *    separates two transactions running at once in the same request.
 *  - `Connection.prototype.query/execute` is the single funnel under Drizzle, pools,
 *    transactions and streaming, and `this` gives the connection.
 */

const requestScope = new AsyncLocalStorage<RequestTrace>()

/** Everything awaited inside `fn` is attributed to `trace`, however deep the call goes. */
export function runInRequest<T>(trace: RequestTrace, fn: () => T): T {
  return requestScope.run(trace, fn)
}

type Method = "query" | "execute"
type PatchableMethod = (this: ConnectionLike, ...args: unknown[]) => CommandLike

interface ConnectionLike {
  threadId?: number | null
}

interface CommandLike {
  sql: string
  values?: unknown[]
  parameters?: unknown[]
  onResult?: (error: Error | null, result?: unknown, fields?: unknown) => unknown
  once: (event: string, listener: (...args: unknown[]) => void) => unknown
  on: (event: string, listener: (...args: unknown[]) => void) => unknown
}

type GetConnection = (this: unknown, callback: (...args: unknown[]) => unknown) => unknown

/** The classes to patch; tests pass stand-ins. */
export interface TracerTargets {
  connection: { prototype: Record<Method, PatchableMethod> }
  pool: { prototype: { getConnection: GetConnection } }
}

const INSTALLED = Symbol.for("sqlDevInspector.installed")

let connectionCounter = 0
const connectionIds = new WeakMap<object, number>()

/** The MySQL thread id once the handshake is done; a stable negative id for a connection that has none yet. */
function connectionIdOf(connection: ConnectionLike): number {
  if (typeof connection.threadId === "number") {
    return connection.threadId
  }
  let id = connectionIds.get(connection)
  if (id === undefined) {
    id = -(++connectionCounter)
    connectionIds.set(connection, id)
  }
  return id
}

function describeResult(result: unknown): Pick<QueryEvent, "rowCount" | "affectedRows"> {
  if (Array.isArray(result)) {
    return { rowCount: result.length, affectedRows: null }
  }
  if (result && typeof result === "object" && "affectedRows" in result) {
    return { rowCount: null, affectedRows: Number((result as { affectedRows: number }).affectedRows) }
  }
  return { rowCount: null, affectedRows: null }
}

let nextSeq = 0

function wrap(store: TraceStore, method: Method, original: PatchableMethod): PatchableMethod {
  return function patched(this: ConnectionLike, ...args: unknown[]) {
    const startedAt = Date.now()
    const t0 = performance.now()
    const command = original.apply(this, args)

    try {
      const trace = requestScope.getStore() ?? store.backgroundTrace()
      const sql = String(command.sql)
      const event: QueryEvent = {
        seq: nextSeq++,
        requestId: trace.id,
        connectionId: connectionIdOf(this),
        api: method,
        sql,
        params: (command.parameters ?? null) as unknown[] | null,
        startedAt,
        durationMs: null,
        rowCount: null,
        affectedRows: null,
        error: null,
        analysis: analyzeSql(sql)
      }
      store.record(trace, event)

      let done = false
      const finish = (error: Error | null, result?: unknown) => {
        if (done) {
          return
        }
        done = true
        event.durationMs = performance.now() - t0
        event.error = error ? error.message : null
        Object.assign(event, describeResult(result))
        store.touch(trace)
      }

      if (typeof command.onResult === "function") {
        const callback = command.onResult
        command.onResult = function onResult(this: unknown, error, result, fields) {
          finish(error ?? null, result)
          return callback.call(this, error, result, fields)
        }
      } else {
        // Streaming / event mode: rows arrive as events, nobody gets a result array.
        let rows = 0
        command.on("result", () => void rows++)
        command.once("error", error => finish(error as Error))
        command.once("end", () => {
          event.rowCount = rows
          finish(null)
        })
      }
    } catch {
      // Recording is best effort; the real query is already on its way and must be returned untouched.
    }
    return command
  }
}

/**
 * `pool.query()` and `pool.getConnection(cb)` hand the statement to a connection from a
 * callback. When every connection is busy that callback runs later, from whichever request
 * released one, so without this the statement would be attributed to that other request.
 * Binding the callback at the call site keeps the caller's request.
 */
function keepRequestContext(original: GetConnection): GetConnection {
  return function getConnection(this: unknown, callback) {
    return original.call(this, typeof callback === "function" ? AsyncLocalStorage.bind(callback) : callback)
  }
}

// `Pool` is a class at runtime but only a type in mysql2's typings.
const DEFAULT_TARGETS = { connection: mysql.Connection, pool: (mysql as unknown as { Pool: unknown }).Pool } as unknown as TracerTargets

/**
 * Patches `query` / `execute` on the connection class and `getConnection` on the pool class,
 * once. Returns the function that restores the originals. Calling it again first undoes the
 * previous install, so a reloaded module never stacks two wrappers.
 */
export function installTracer(store: TraceStore, targets: TracerTargets = DEFAULT_TARGETS): () => void {
  const registry = targets.connection as unknown as Record<symbol, (() => void) | undefined>
  registry[INSTALLED]?.()

  const patches = [
    { prototype: targets.connection.prototype as Record<string, unknown>, name: "query", make: (fn: unknown) => wrap(store, "query", fn as PatchableMethod) },
    { prototype: targets.connection.prototype as Record<string, unknown>, name: "execute", make: (fn: unknown) => wrap(store, "execute", fn as PatchableMethod) },
    { prototype: targets.pool.prototype as Record<string, unknown>, name: "getConnection", make: (fn: unknown) => keepRequestContext(fn as GetConnection) }
  ].map(patch => ({ ...patch, original: patch.prototype[patch.name], hadOwn: Object.hasOwn(patch.prototype, patch.name) }))

  for (const patch of patches) {
    patch.prototype[patch.name] = patch.make(patch.original)
  }

  const uninstall = () => {
    for (const patch of patches) {
      if (patch.hadOwn) {
        patch.prototype[patch.name] = patch.original
      } else {
        delete patch.prototype[patch.name]
      }
    }
    registry[INSTALLED] = undefined
  }
  registry[INSTALLED] = uninstall
  return uninstall
}
