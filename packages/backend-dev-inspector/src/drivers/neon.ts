import type { DriverAdapter, OperationHandle, Recorder } from "sql-dev-inspector"
import { analyzeSql } from "sql-dev-inspector"
import { objectId } from "../patch.js"
import { lazyRecorder } from "./verbs.js"

/**
 * Neon's serverless driver over HTTP, `neon(url)`: the function it returns runs a query when it is awaited, which no
 * library hook sees. Wrap it once:
 *
 *   import { neon } from "@neondatabase/serverless"
 *   import { instrumentNeon } from "backend-dev-inspector"
 *   const sql = instrumentNeon(neon(databaseUrl))
 *
 * Tagged queries (`` sql`select …` ``), `sql.query(text, params)` and `sql.transaction([...])` are reported; the
 * transaction as one call. (Neon's WebSocket `Pool` / `Client` is a copy of `pg` the inspector cannot patch from outside;
 * Drizzle and Prisma on the HTTP driver go through `neon()` and are covered.) Nothing is loaded from Neon.
 */

let active: Recorder | null = null

export const neonDriver: DriverAdapter = {
  name: "neon",
  install(recorder) {
    active = recorder
    return () => {
      if (active === recorder) {
        active = null
      }
    }
  }
}

const MAX_TEXT = 4000

type Thenable = { then: (onFulfilled?: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) => unknown }
type SqlFunction = ((...args: unknown[]) => unknown) & Record<string, unknown>

const isThenable = (value: unknown): value is Thenable => !!value && typeof (value as Thenable).then === "function"

function rowsOf(result: unknown): number | null {
  if (Array.isArray(result)) {
    return result.length
  }
  const rows = (result as { rows?: unknown, rowCount?: unknown } | null)?.rows
  return Array.isArray(rows) ? rows.length : typeof (result as { rowCount?: unknown } | null)?.rowCount === "number" ? (result as { rowCount: number }).rowCount : null
}

/** Starts the call when the query is awaited (that is when Neon runs it), and ends it with the result. */
function follow(recorder: Recorder, id: number, text: string, params: unknown[] | null, query: unknown): unknown {
  if (!isThenable(query)) {
    return query
  }
  let handle: OperationHandle | null | undefined
  const start = () => {
    if (handle === undefined) {
      const sql = text.slice(0, MAX_TEXT)
      handle = recorder.begin({ driver: "neon", api: "query", text: sql, params, connectionId: id, analysis: analyzeSql(sql, "postgres") })
    }
  }
  return new Proxy(query as object, {
    get(target, property, receiver) {
      if (property === "then") {
        return (onFulfilled?: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) => {
          start()
          return (target as Thenable).then(
            (result) => {
              handle?.end({ rowCount: rowsOf(result) })
              return onFulfilled ? onFulfilled(result) : result
            },
            (error) => {
              handle?.end({ error })
              if (onRejected) {
                return onRejected(error)
              }
              throw error
            }
          )
        }
      }
      const value = Reflect.get(target, property, receiver) as unknown
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value
    }
  })
}

const templateText = (strings: ArrayLike<string>) => Array.from(strings).reduce((text, piece, index, all) => text + piece + (index < all.length - 1 ? `$${index + 1}` : ""), "")

export function instrumentNeon<T extends (...args: never[]) => unknown>(sql: T, recorder?: Recorder): T {
  const rec = lazyRecorder(recorder, () => active)
  if (!rec) {
    return sql
  }
  const id = objectId(sql)
  const fn = sql as unknown as SqlFunction
  return new Proxy(fn, {
    apply(target, thisArg, args) {
      const result = Reflect.apply(target, thisArg, args)
      const [first, ...rest] = args
      if (Array.isArray(first) && "raw" in first) {
        return follow(rec, id, templateText(first as unknown as ArrayLike<string>), rest, result)
      }
      return result
    },
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown
      if (typeof value !== "function") {
        return value
      }
      if (property === "query") {
        return (text: unknown, params?: unknown, ...more: unknown[]) =>
          follow(rec, id, String(text), Array.isArray(params) ? params : null, (value as (...a: unknown[]) => unknown).call(target, text, params, ...more))
      }
      if (property === "transaction") {
        return (queries: unknown, ...more: unknown[]) => {
          const count = Array.isArray(queries) ? queries.length : 0
          return follow(rec, id, `BEGIN; -- neon transaction of ${count} queries; COMMIT`, null, (value as (...a: unknown[]) => unknown).call(target, queries, ...more))
        }
      }
      return (value as (...a: unknown[]) => unknown).bind(target)
    }
  }) as unknown as T
}
