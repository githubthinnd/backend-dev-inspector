import type { DriverAdapter, OperationHandle, Recorder } from "sql-dev-inspector"
import { analyzeSql } from "sql-dev-inspector"
import { objectId } from "../patch.js"

/**
 * Cloudflare D1, the database binding of a Worker (`env.DB`):
 *
 *   import { instrumentD1 } from "backend-dev-inspector"
 *   const db = instrumentD1(env.DB)
 *   await db.prepare("select * from users where id = ?").bind(id).first()
 *
 * `prepare(...).bind(...)` followed by `first()`, `all()`, `run()` or `raw()` is one call with its parameters; `batch()` lists
 * each statement; `exec()` is one call. Rows come back as the count of `results`, changes as `meta.changes`. Nothing is
 * loaded from Cloudflare's packages.
 */

let active: Recorder | null = null

export const d1Driver: DriverAdapter = {
  name: "d1",
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
const RUNNERS = new Set(["first", "all", "run", "raw"])

type AnyFn = (...args: unknown[]) => unknown
interface Wrapped {
  original: object
  sql: string
  params: unknown[] | null
}

function bindParams(recorder: Recorder, id: number, text: string, params: unknown[] | null): OperationHandle | null {
  const sql = text.slice(0, MAX_TEXT)
  return recorder.begin({ driver: "d1", api: "query", text: sql, params, connectionId: id, analysis: analyzeSql(sql, "sqlite") })
}

function outcomeOf(result: unknown) {
  const value = result as { results?: unknown, meta?: { changes?: unknown } } | unknown[] | null | undefined
  if (Array.isArray(value)) {
    return { rowCount: value.length }
  }
  const results = value?.results
  const changes = value?.meta?.changes
  if (Array.isArray(results) && results.length > 0) {
    return { rowCount: results.length }
  }
  return typeof changes === "number" && changes > 0 ? { affectedRows: changes } : { rowCount: value === null ? 0 : Array.isArray(results) ? 0 : value === undefined ? null : 1 }
}

export function instrumentD1<T extends object>(db: T, recorder?: Recorder): T {
  const rec = recorder ?? active
  if (!rec) {
    return db
  }
  const id = objectId(db)
  const originals = new WeakMap<object, Wrapped>()

  const statement = (original: object, sql: string, params: unknown[] | null): object => {
    const proxy: object = new Proxy(original, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown
        if (typeof value !== "function") {
          return value
        }
        if (property === "bind") {
          return (...values: unknown[]) => statement((value as AnyFn).apply(target, values) as object, sql, values)
        }
        if (typeof property === "string" && RUNNERS.has(property)) {
          return (...args: unknown[]) => {
            const handle = bindParams(rec, id, sql, params)
            try {
              const pending = (value as AnyFn).apply(target, args) as Promise<unknown>
              return pending.then(
                (result) => {
                  handle?.end(outcomeOf(result))
                  return result
                },
                (error: unknown) => {
                  handle?.end({ error })
                  throw error
                }
              )
            } catch (error) {
              handle?.end({ error })
              throw error
            }
          }
        }
        return (value as AnyFn).bind(target)
      }
    })
    originals.set(proxy, { original, sql, params })
    return proxy
  }

  return new Proxy(db, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown
      if (typeof value !== "function") {
        return value
      }
      if (property === "prepare") {
        return (sql: string) => statement((value as AnyFn).call(target, sql) as object, String(sql), null)
      }
      if (property === "batch") {
        return (statements: unknown[], ...more: unknown[]) => {
          const known = statements.map(item => (typeof item === "object" && item ? originals.get(item) : undefined))
          const handles = known.map(item => item ? bindParams(rec, id, item.sql, item.params) : null)
          const pending = (value as AnyFn).call(target, statements.map((item, index) => known[index]?.original ?? item), ...more) as Promise<unknown[]>
          return pending.then(
            (results) => {
              handles.forEach((handle, index) => handle?.end(outcomeOf(results?.[index])))
              return results
            },
            (error: unknown) => {
              handles.forEach(handle => handle?.end({ error }))
              throw error
            }
          )
        }
      }
      if (property === "exec") {
        return (sql: string) => {
          const handle = bindParams(rec, id, String(sql), null)
          return ((value as AnyFn).call(target, sql) as Promise<unknown>).then(
            (result: unknown) => {
              handle?.end()
              return result
            },
            (error: unknown) => {
              handle?.end({ error })
              throw error
            }
          )
        }
      }
      return (value as AnyFn).bind(target)
    }
  })
}
