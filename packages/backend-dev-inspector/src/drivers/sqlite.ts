import type { DriverAdapter, OperationEnd, Recorder } from "sql-dev-inspector"
import { analyzeSql } from "sql-dev-inspector"
import { applyPatches, objectId, type Patch } from "../patch.js"
import { tryLoad } from "../peer.js"

/**
 * SQLite through `better-sqlite3` and through Node's built-in `node:sqlite`. Both are
 * synchronous, which suits the request scope: whatever runs inside a request belongs to it. A
 * statement's methods (`run`, `get`, `all`, `iterate`) and `Database#exec` are the funnel;
 * `db.transaction()` of better-sqlite3 runs BEGIN / COMMIT through them too, so transactions
 * appear in the tree.
 */

type Method = "run" | "get" | "all" | "iterate"

interface Described {
  text: string
  connectionId: number
}

function paramsOf(args: unknown[]): unknown[] | null {
  if (args.length === 0) {
    return null
  }
  return args.length === 1 && Array.isArray(args[0]) ? args[0] : args
}

function outcomeOf(method: Method, result: unknown): OperationEnd {
  if (method === "run") {
    const changes = (result as { changes?: number | bigint } | undefined)?.changes
    return { affectedRows: changes === undefined ? null : Number(changes) }
  }
  if (method === "get") {
    return { rowCount: result === undefined || result === null ? 0 : 1 }
  }
  return { rowCount: Array.isArray(result) ? result.length : null }
}

/** Reports one call; `iterate` is closed when the iterator is exhausted or abandoned. */
function recordCall(recorder: Recorder, driver: string, method: Method, described: Described, args: unknown[], call: () => unknown): unknown {
  const handle = recorder.begin({
    driver,
    api: method,
    text: described.text,
    params: paramsOf(args),
    connectionId: described.connectionId,
    analysis: analyzeSql(described.text, "sqlite")
  })
  if (!handle) {
    return call()
  }
  try {
    const result = call()
    if (method !== "iterate") {
      handle.end(outcomeOf(method, result))
      return result
    }
    const iterator = result as Iterator<unknown> & { return?: (value?: unknown) => IteratorResult<unknown> }
    let rows = 0
    const wrapped = {
      next: (...next: [] | [undefined]) => {
        const step = iterator.next(...next)
        if (step.done) {
          handle.end({ rowCount: rows })
        } else {
          rows++
        }
        return step
      },
      return: (value?: unknown) => {
        handle.end({ rowCount: rows })
        return iterator.return ? iterator.return(value) : { done: true as const, value }
      },
      [Symbol.iterator]() {
        return wrapped
      }
    }
    return wrapped
  } catch (error) {
    handle.end({ error })
    throw error
  }
}

function statementPatches(recorder: Recorder, driver: string, target: object, describe: (statement: unknown) => Described): Patch[] {
  return (["run", "get", "all", "iterate"] as const).map(method => ({
    target,
    name: method,
    make: original => function patched(this: unknown, ...args: unknown[]) {
      return recordCall(recorder, driver, method, describe(this), args, () => (original as (...a: unknown[]) => unknown).apply(this, args))
    } as never
  }))
}

function execPatch(recorder: Recorder, driver: string, target: object, connectionOf: (database: unknown) => number): Patch {
  return {
    target,
    name: "exec",
    make: original => function patchedExec(this: unknown, ...args: unknown[]) {
      const sql = String(args[0])
      return recordCall(recorder, driver, "run", { text: sql, connectionId: connectionOf(this) }, [], () => (original as (...a: unknown[]) => unknown).apply(this, args))
    } as never
  }
}

/**
 * SQLite reads the statement when it is prepared, so a syntax error or a missing table is raised by
 * `prepare()`, before any `run` / `get` / `all` exists to report it. A failed prepare is listed as a call
 * with its error; one that succeeds is not (the statement is reported when it runs).
 */
function preparePatch(recorder: Recorder, driver: string, target: object, connectionOf: (database: unknown) => number, wrapSuccess?: (database: object, statement: unknown) => void): Patch {
  return {
    target,
    name: "prepare",
    make: original => function patchedPrepare(this: object, ...args: unknown[]) {
      try {
        const statement = (original as (...a: unknown[]) => unknown).apply(this, args)
        wrapSuccess?.(this, statement)
        return statement
      } catch (error) {
        try {
          const sql = String(args[0])
          recorder.begin({ driver, api: "prepare", text: sql, connectionId: connectionOf(this), analysis: analyzeSql(sql, "sqlite") })?.end({ error })
        } catch {
          // best effort: the original error is what the caller must get
        }
        throw error
      }
    } as never
  }
}

// ── better-sqlite3 ──────────────────────────────────────────────────────

interface BetterSqliteStatement {
  source?: string
  database?: object
}

type BetterSqliteDatabase = new (path: string) => { prepare: (sql: string) => unknown, close: () => void }

export const betterSqlite3Driver: DriverAdapter = {
  name: "better-sqlite3",
  install(recorder) {
    const Database = tryLoad(r => r("better-sqlite3") as BetterSqliteDatabase)
    if (!Database) {
      return null
    }
    // The statement class is not exported; a throwaway in-memory database hands out its prototype.
    // Constructing one fails when the native module was never built for this Node: then there is nothing to watch.
    let statementPrototype: object
    try {
      const probe = new Database(":memory:")
      statementPrototype = Object.getPrototypeOf(probe.prepare("select 1")) as object
      probe.close()
    } catch {
      return null
    }

    const describe = (statement: unknown): Described => {
      const { source, database } = statement as BetterSqliteStatement
      return { text: String(source ?? ""), connectionId: objectId(database ?? (statement as object)) }
    }
    return applyPatches(Database, [
      ...statementPatches(recorder, "better-sqlite3", statementPrototype, describe),
      execPatch(recorder, "better-sqlite3", Database.prototype, database => objectId(database as object)),
      preparePatch(recorder, "better-sqlite3", Database.prototype, database => objectId(database as object))
    ])
  }
}

// ── node:sqlite ─────────────────────────────────────────────────────────

interface NodeSqlite {
  DatabaseSync: { prototype: { prepare: (sql: string) => unknown } }
  StatementSync: { prototype: object }
}

/**
 * Not part of the automatic set: loading `node:sqlite` prints Node's experimental-feature
 * warning, which an application that does not use it should never see. Switch it on with
 * `SQL_INSPECTOR_DRIVERS=node:sqlite`, or by passing it to `createInspector({ drivers })`.
 */
export const nodeSqliteDriver: DriverAdapter = {
  name: "node:sqlite",
  install(recorder, context) {
    if (context?.explicit === false) {
      return null
    }
    const sqlite = process.getBuiltinModule?.("node:sqlite") as unknown as NodeSqlite | undefined
    if (!sqlite?.DatabaseSync || !sqlite.StatementSync) {
      return null
    }
    // A statement does not point back to its database, so `prepare` remembers which one made it.
    const owners = new WeakMap<object, object>()
    const describe = (statement: unknown): Described => {
      const { sourceSQL } = statement as { sourceSQL?: string }
      const owner = owners.get(statement as object)
      return { text: String(sourceSQL ?? ""), connectionId: objectId(owner ?? (statement as object)) }
    }
    return applyPatches(sqlite.DatabaseSync, [
      preparePatch(recorder, "node:sqlite", sqlite.DatabaseSync.prototype, database => objectId(database as object), (database, statement) => {
        if (statement && typeof statement === "object") {
          owners.set(statement, database)
        }
      }),
      ...statementPatches(recorder, "node:sqlite", sqlite.StatementSync.prototype, describe),
      execPatch(recorder, "node:sqlite", sqlite.DatabaseSync.prototype, database => objectId(database as object))
    ])
  }
}
