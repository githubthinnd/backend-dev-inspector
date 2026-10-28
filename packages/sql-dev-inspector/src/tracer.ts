import type { DriverAdapter } from "./driver.js"
import type { TraceStore } from "./store.js"
import type { QueryEvent } from "./types.js"
import { bindToRequest, runInRequest } from "./context.js"
import { tryLoad } from "./peer.js"
import { createRecorder, type Recorder } from "./recorder.js"
import { analyzeSql } from "./sql-analyzer.js"

export { runInRequest }

/**
 * Why patch mysql2 and not use Drizzle's `logger` or mysql2's diagnostics channels:
 *  - Drizzle's logger sees SQL + params only: no duration, no result, no connection, so
 *    transactions and savepoints cannot be told apart from each other.
 *  - mysql2's tracing channels add timing but still hide the connection, which is what
 *    separates two transactions running at once in the same request.
 *  - `Connection.prototype.query/execute` is the single funnel under Drizzle, pools,
 *    transactions and streaming, and `this` gives the connection.
 */

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

function wrap(recorder: Recorder, method: Method, original: PatchableMethod): PatchableMethod {
  return function patched(this: ConnectionLike, ...args: unknown[]) {
    const command = original.apply(this, args)

    try {
      const sql = String(command.sql)
      const handle = recorder.begin({
        driver: "mysql2",
        api: method,
        text: sql,
        params: (command.parameters ?? null) as unknown[] | null,
        connectionId: connectionIdOf(this),
        analysis: analyzeSql(sql, "mysql")
      })
      if (!handle) {
        return command
      }
      const { end } = handle

      if (typeof command.onResult === "function") {
        const callback = command.onResult
        command.onResult = function onResult(this: unknown, error, result, fields) {
          end({ error, ...describeResult(result) })
          return callback.call(this, error, result, fields)
        }
      } else {
        // Streaming / event mode: rows arrive as events, nobody gets a result array.
        let rows = 0
        command.on("result", () => void rows++)
        command.once("error", error => end({ error }))
        command.once("end", () => end({ rowCount: rows }))
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
    return original.call(this, typeof callback === "function" ? bindToRequest(callback) : callback)
  }
}

/** mysql2's own classes, or null when the application does not have mysql2. */
function defaultTargets(): TracerTargets | null {
  const mysql = tryLoad(r => r("mysql2") as { Connection: unknown, Pool?: unknown })
  // `Pool` is a class at runtime but only a type in mysql2's typings.
  return mysql ? { connection: mysql.Connection, pool: mysql.Pool } as unknown as TracerTargets : null
}

/**
 * Patches `query` / `execute` on the connection class and `getConnection` on the pool class,
 * once. Returns the function that restores the originals. Calling it again first undoes the
 * previous install, so a reloaded module never stacks two wrappers.
 */
export function installTracer(store: TraceStore, targets: TracerTargets | null = defaultTargets()): () => void {
  if (!targets) {
    return () => {}
  }
  const recorder = createRecorder(store)
  const registry = targets.connection as unknown as Record<symbol, (() => void) | undefined>
  registry[INSTALLED]?.()

  const patches = [
    { prototype: targets.connection.prototype as Record<string, unknown>, name: "query", make: (fn: unknown) => wrap(recorder, "query", fn as PatchableMethod) },
    { prototype: targets.connection.prototype as Record<string, unknown>, name: "execute", make: (fn: unknown) => wrap(recorder, "execute", fn as PatchableMethod) },
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

/** mysql2, and with it MariaDB and everything built on mysql2 (Drizzle, Knex, Sequelize, TypeORM). */
export const mysql2Driver: DriverAdapter = {
  name: "mysql2",
  install(recorder) {
    const targets = defaultTargets()
    return targets ? installTracer(recorder.store, targets) : null
  }
}
