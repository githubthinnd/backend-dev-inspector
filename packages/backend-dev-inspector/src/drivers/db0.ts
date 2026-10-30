import type { DriverAdapter, OperationEnd, OperationHandle, Recorder } from "sql-dev-inspector"
import { tracingChannel } from "node:diagnostics_channel"
import { analyzeSql } from "sql-dev-inspector"

/**
 * db0, the database layer under Nitro's `useDatabase()` and NuxtHub. db0 does not talk to a database:
 * a connector hands each call to a real driver, and for most connectors that driver is one this package
 * already watches (`better-sqlite3`, `@libsql/client`, `pg`, `mysql2`), so those calls are recorded once, at the
 * driver, with nothing to set up.
 *
 * For the connectors whose driver is not watched (PGlite, Neon, Cloudflare D1, PlanetScale, Bun's SQLite, the
 * `sqlite3` package) db0 can publish each call on its own tracing channel: `withTracing(database)` from
 * `db0/tracing`. This driver listens to it, and leaves out the connectors that are already recorded at their driver,
 * so that a call is never listed twice.
 */

const CHANNEL = "db0.query"

/** Connectors whose driver is recorded by this package: their calls are not taken from db0 as well. */
const WATCHED = new Set([
  "sqlite", // the better-sqlite3 connector
  "libsql-node", "libsql-http", "libsql-web", "libsql-core",
  "postgresql", // pg
  "mysql" // mysql2
])

interface Db0Context {
  query?: string
  method?: string
  /** The connector's name as a string (`sqlite`, `libsql-node`, `postgresql`, `pglite`…). */
  connector?: string | { name?: string } | null
  dialect?: string
  result?: unknown
  error?: unknown
}

const MAX_TEXT = 4000

function addressId(text: string): number {
  let hash = 5381
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  }
  return -(Math.abs(hash) + 3_000_000)
}

/** db0 dialects: `sqlite`, `libsql`, `postgresql`, `mysql`. */
const dialectOf = (dialect: string | undefined) => dialect === "postgresql" ? "postgres" : dialect === "mysql" ? "mysql" : "sqlite"

function outcomeOf(result: unknown): OperationEnd {
  if (Array.isArray(result)) {
    return { rowCount: result.length }
  }
  const changes = (result as { changes?: unknown, rowsAffected?: unknown } | null | undefined)
  const affected = typeof changes?.changes === "number" ? changes.changes : changes?.rowsAffected
  return typeof affected === "number" ? { affectedRows: affected } : {}
}

export const db0Driver: DriverAdapter = {
  name: "db0",
  install(recorder: Recorder) {
    const channel = tracingChannel(CHANNEL)
    const handles = new WeakMap<object, OperationHandle>()
    const finish = (message: object) => {
      const handle = handles.get(message)
      if (handle) {
        handles.delete(message)
        const { result, error } = message as Db0Context
        handle.end({ error, ...(error === undefined ? outcomeOf(result) : {}) })
      }
    }
    const handlers = {
      start(message: object) {
        try {
          const context = message as Db0Context
          const connector = typeof context.connector === "string" ? context.connector : context.connector?.name ?? "db0"
          if (WATCHED.has(connector) || typeof context.query !== "string") {
            return
          }
          const text = context.query.slice(0, MAX_TEXT)
          const handle = recorder.begin({
            driver: `db0:${connector}`,
            api: String(context.method ?? "query"),
            text,
            connectionId: addressId(connector),
            analysis: analyzeSql(text, dialectOf(context.dialect))
          })
          if (handle) {
            handles.set(message, handle)
          }
        } catch {
          // best effort: never get in the way of the call
        }
      },
      end(message: object) {
        if ((message as Db0Context).error !== undefined) {
          finish(message)
        }
      },
      asyncStart() {},
      asyncEnd: finish,
      error: finish
    }
    channel.subscribe(handlers)
    return () => void channel.unsubscribe(handlers)
  }
}
