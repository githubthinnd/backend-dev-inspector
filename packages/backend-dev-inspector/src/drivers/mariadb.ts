import type { DriverAdapter, OperationEnd } from "sql-dev-inspector"
import { analyzeSql } from "sql-dev-inspector"
import { objectId } from "../patch.js"
import { wrapperDriver } from "./wrapper.js"

/**
 * The `mariadb` connector (not `mysql2`, which is covered by sql-dev-inspector and also talks to
 * MariaDB servers). The connector keeps its classes out of reach, so there is no prototype to
 * patch: wrap the module once, where the application imports it, and every connection and pool it
 * creates is watched.
 *
 *   import * as mariadbModule from "mariadb"
 *   import { instrumentMariadb } from "backend-dev-inspector"
 *   const mariadb = instrumentMariadb(mariadbModule)
 *
 * Outside development (no inspector running) the module is returned unchanged.
 */

type Method = "query" | "execute" | "batch"
const METHODS: Method[] = ["query", "execute", "batch"]

interface ConnectionLike {
  threadId?: number
  query: (...args: unknown[]) => Promise<unknown>
  execute?: (...args: unknown[]) => Promise<unknown>
  batch?: (...args: unknown[]) => Promise<unknown>
}

interface PoolLike extends ConnectionLike {
  getConnection: () => Promise<ConnectionLike>
}

export interface MariadbModule {
  createConnection: (...args: never[]) => Promise<ConnectionLike>
  createPool: (...args: never[]) => PoolLike
}

/** The recorder is looked up when a call is made, so a module wrapped before the application starts the inspector is still watched. */
const wrapper = wrapperDriver("mariadb")

export const mariadbDriver: DriverAdapter = wrapper.driver

function sqlOf(first: unknown): string | null {
  if (typeof first === "string") {
    return first
  }
  return first && typeof first === "object" && "sql" in first && typeof first.sql === "string" ? first.sql : null
}

function paramsOf(first: unknown, second: unknown): unknown[] | null {
  const own = second ?? (first && typeof first === "object" && "values" in first ? first.values : null)
  if (Array.isArray(own)) {
    return own
  }
  return own && typeof own === "object" ? [own] : null
}

function outcomeOf(result: unknown): OperationEnd {
  if (Array.isArray(result)) {
    return { rowCount: result.length }
  }
  if (result && typeof result === "object" && "affectedRows" in result) {
    return { affectedRows: Number((result as { affectedRows: number | bigint }).affectedRows) }
  }
  return {}
}

const WRAPPED = new WeakSet<object>()

function wrapTarget<T extends ConnectionLike>(target: T, connectionId: () => number): T {
  if (WRAPPED.has(target)) {
    return target
  }
  WRAPPED.add(target)
  for (const method of METHODS) {
    const original = target[method]
    if (typeof original !== "function") {
      continue
    }
    ;(target as Record<string, unknown>)[method] = function wrapped(this: unknown, ...args: unknown[]) {
      const recorder = wrapper.recorder()
      const sql = recorder ? sqlOf(args[0]) : null
      const handle = recorder && sql !== null
        ? recorder.begin({ driver: "mariadb", api: method, text: sql, params: paramsOf(args[0], args[1]), connectionId: connectionId(), analysis: analyzeSql(sql, "mysql") })
        : null
      const result = original.apply(target, args) as Promise<unknown>
      if (handle && result && typeof result.then === "function") {
        result.then(value => handle.end(outcomeOf(value)), error => handle.end({ error }))
      }
      return result
    }
  }
  return target
}

function wrapConnection<T extends ConnectionLike>(connection: T): T {
  return wrapTarget(connection, () => connection.threadId ?? objectId(connection))
}

function wrapPool<T extends PoolLike>(pool: T): T {
  wrapTarget(pool, () => objectId(pool))
  const getConnection = pool.getConnection
  if (typeof getConnection === "function" && !WRAPPED.has(getConnection)) {
    const wrapped = async function wrappedGetConnection(this: unknown, ...args: unknown[]) {
      return wrapConnection(await getConnection.apply(pool, args as never))
    }
    WRAPPED.add(wrapped)
    pool.getConnection = wrapped as never
  }
  return pool
}

/** Returns a copy of the `mariadb` module whose connections and pools are reported to the inspector. */
export function instrumentMariadb<M extends MariadbModule>(mariadb: M): M {
  if (!wrapper.recorder()) {
    return mariadb // the inspector is off for this process
  }
  const { createConnection, createPool } = mariadb
  return {
    ...mariadb,
    createConnection: async (...args: never[]) => wrapConnection(await createConnection(...args)),
    createPool: (...args: never[]) => wrapPool(createPool(...args))
  }
}
