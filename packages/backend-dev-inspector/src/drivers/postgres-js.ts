import type { DriverAdapter, OperationHandle, Recorder } from "sql-dev-inspector"
import { tracingChannel } from "node:diagnostics_channel"
import { analyzeSql } from "sql-dev-inspector"
import { objectId } from "../patch.js"
import { lazyRecorder } from "./verbs.js"

/**
 * PostgreSQL through postgres.js (`postgres`), and with it Drizzle, Kysely and Prisma's adapters
 * when they are given a postgres.js client.
 *
 * postgres.js 4 publishes every query on a `diagnostics_channel` tracing channel
 * (`postgres:query`), so nothing is patched and the driver needs no setup. Its text and the
 * connection it ran on are filled in as the query is sent, so they are read when it settles.
 *
 * postgres.js 3 publishes nothing, and the copy an application imports cannot be patched from here
 * (a package that ships both an ESM and a CommonJS build is loaded twice). Wrap the client once
 * instead: `const sql = instrumentPostgres(postgres(url))`. The wrapper covers tagged queries,
 * `sql.unsafe()` and the `sql` passed to `sql.begin()` / `sql.savepoint()` callbacks.
 */

const WRITES = new Set(["INSERT", "UPDATE", "DELETE", "MERGE", "COPY"])
const MAX_TEXT = 4000

/** Ids that cannot clash with the process ids of node-postgres connections or with other drivers' synthetic ids. */
const connectionId = (id: number) => -(2_000_000 + id)
/** What a query is grouped under until postgres.js says which connection carries it. */
const UNKNOWN_CONNECTION = connectionId(0)

interface QueryContext {
  query?: string | null
  database?: string
  host?: string | null
  connection?: number | null
  command?: string | null
  count?: number | null
  error?: unknown
}

function outcomeOf(command: string | null | undefined, count: number | null | undefined) {
  if (typeof count !== "number") {
    return {}
  }
  return WRITES.has(String(command)) ? { affectedRows: count } : { rowCount: count }
}

function bind(recorder: Recorder, text: string, id: number, params?: unknown[] | null): OperationHandle | null {
  const sql = text.slice(0, MAX_TEXT)
  return recorder.begin({ driver: "postgres", api: "query", text: sql, params: params ?? null, connectionId: id, analysis: analyzeSql(sql, "postgres") })
}

/** Gives a call its real text and connection once postgres.js has built and sent it. */
function refresh(handle: OperationHandle, context: QueryContext) {
  const text = context.query
  if (text) {
    handle.event.sql = text.slice(0, MAX_TEXT)
    handle.event.analysis = analyzeSql(handle.event.sql, "postgres")
  }
  if (typeof context.connection === "number") {
    handle.event.connectionId = connectionId(context.connection)
  }
}

export const postgresJsDriver: DriverAdapter = {
  name: "postgres",
  install(recorder) {
    active = recorder // for `instrumentPostgres`
    // `tracingChannel` exists on every supported Node. The channel is only ever published by postgres.js 4.
    const channel = tracingChannel("postgres:query")
    const handles = new WeakMap<object, OperationHandle>()
    const finish = (message: object) => {
      const context = message as QueryContext
      const handle = handles.get(message)
      if (!handle) {
        return
      }
      handles.delete(message)
      refresh(handle, context)
      handle.end({ error: context.error, ...outcomeOf(context.command, context.count) })
    }
    const handlers = {
      start(message: object) {
        try {
          const context = message as QueryContext
          // The text can be missing here (it is built when the query is sent); it is read again at the end.
          const handle = bind(recorder, context.query ?? "(postgres query)", typeof context.connection === "number" ? connectionId(context.connection) : UNKNOWN_CONNECTION)
          if (handle) {
            handles.set(message, handle)
          }
        } catch {
          // best effort: never get in the way of the query
        }
      },
      end(message: object) {
        // A failure while the query is being started ends it here; otherwise asyncEnd / error close it.
        if ((message as QueryContext).error !== undefined) {
          finish(message)
        }
      },
      asyncStart() {},
      asyncEnd: finish,
      error: finish
    }
    channel.subscribe(handlers)
    return () => {
      channel.unsubscribe(handlers)
      if (active === recorder) {
        active = null
      }
    }
  }
}

let active: Recorder | null = null

// ── postgres.js 3: an explicit wrapper ───────────────────────────────────

interface QueryLike {
  strings: ArrayLike<string> & { raw?: unknown }
  args: unknown[]
  tagged?: boolean
  executed?: boolean
  handle: () => unknown
  resolve: (value: unknown) => unknown
  reject: (error: unknown) => unknown
}

type SqlFunction = ((...args: unknown[]) => unknown) & Record<string, unknown>

const isQuery = (value: unknown): value is QueryLike =>
  !!value && typeof value === "object" && "strings" in value && "handle" in value && typeof (value as QueryLike).handle === "function"

/** `select * from t where id = $1`, from the pieces of a tagged template. */
function templateOf(query: QueryLike): { text: string, params: unknown[] } {
  const pieces = Array.from(query.strings)
  if (!query.tagged) {
    return { text: String(pieces[0] ?? ""), params: Array.isArray(query.args) ? query.args : [] }
  }
  return { text: pieces.reduce((text, piece, index) => text + piece + (index < pieces.length - 1 ? `$${index + 1}` : ""), ""), params: query.args ?? [] }
}

function follow(recorder: Recorder, query: QueryLike, id: number) {
  const handle0 = query.handle
  query.handle = function patchedHandle(this: QueryLike) {
    if (!this.executed) {
      try {
        const { text, params } = templateOf(this)
        const handle = bind(recorder, text, id, params)
        if (handle) {
          const { resolve, reject } = this
          this.resolve = (value) => {
            const result = value as { command?: string, count?: number } | null
            handle.end(outcomeOf(result?.command, result?.count))
            return resolve(value)
          }
          this.reject = (error) => {
            handle.end({ error })
            return reject(error)
          }
        }
      } catch {
        // best effort: the query itself must run untouched
      }
    }
    return handle0.call(this)
  }
  return query
}

/**
 * postgres.js 3: reports every query of `sql` (and of the `sql` given to `begin()` / `savepoint()` /
 * `reserve()` callbacks), with its transaction. Returns `sql` unchanged when the inspector is off or when
 * the client is postgres.js 4, which needs no wrapper.
 */
export function instrumentPostgres<T extends (...args: never[]) => unknown>(sql: T, recorder?: Recorder): T {
  const rec = lazyRecorder(recorder, activeRecorder)
  if (!rec) {
    return sql
  }
  return wrap(rec, sql as unknown as SqlFunction, objectId(sql)) as unknown as T
}

const activeRecorder = () => active

const SCOPES = new Set(["begin", "savepoint", "reserve"])

function wrap(recorder: Recorder, sql: SqlFunction, id: number): SqlFunction {
  const instrument = (result: unknown) => {
    // postgres.js 4 publishes its own events: a wrapper would count every query twice.
    if (isQuery(result) && !("run" in Object.getPrototypeOf(result))) {
      follow(recorder, result, id)
    }
    return result
  }
  return new Proxy(sql, {
    apply: (target, thisArg, args) => instrument(Reflect.apply(target, thisArg, args)),
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown
      if (typeof value !== "function") {
        return value
      }
      if (property === "unsafe" || property === "file") {
        return (...args: unknown[]) => instrument((value as (...a: unknown[]) => unknown).apply(target, args))
      }
      if (typeof property === "string" && SCOPES.has(property)) {
        // The callback receives a `sql` bound to one connection: wrap that one too, under its own id.
        return (...args: unknown[]) => {
          const index = args.findIndex(arg => typeof arg === "function")
          if (index !== -1) {
            const callback = args[index] as (scoped: SqlFunction, ...rest: unknown[]) => unknown
            args[index] = (scoped: SqlFunction, ...rest: unknown[]) => callback(wrap(recorder, scoped, objectId(scoped)), ...rest)
          }
          return (value as (...a: unknown[]) => unknown).apply(target, args)
        }
      }
      return (value as (...a: unknown[]) => unknown).bind(target)
    }
  })
}
