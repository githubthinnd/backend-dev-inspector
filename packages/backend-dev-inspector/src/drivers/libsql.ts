import type { DriverAdapter, OperationEnd, OperationHandle, Recorder } from "sql-dev-inspector"
import { analyzeSql } from "sql-dev-inspector"
import { applyPatches, objectId, type Patch } from "../patch.js"
import { tryImport, tryLoad } from "../peer.js"

/**
 * libSQL / Turso through `@libsql/client`: the local file or in-memory database, and the remote
 * ones over HTTP or WebSocket (`libsql://…`, `https://…`). The client is a set of classes, one per
 * kind of connection, each with `execute`, `batch`, `executeMultiple` and `transaction`; those are
 * the funnel, and the classes are the ones named by the package's own subpaths.
 *
 * `@libsql/client` ships an ESM and a CommonJS build, which are two separate copies of every class:
 * an application that imports it is on the ESM one, a `require` is on the other. Both are patched.
 *
 * A transaction shows as BEGIN … COMMIT, with its statements inside, grouped by the transaction
 * object. A `batch` is one atomic unit: each statement is listed, all ending together.
 */

interface ResultSetLike {
  rows?: unknown[]
  rowsAffected?: number
}

interface ClassLike {
  prototype: object
}

interface LibsqlModule {
  Sqlite3Client?: ClassLike
  Sqlite3Transaction?: ClassLike
  HttpClient?: ClassLike
  HttpTransaction?: ClassLike
  WsClient?: ClassLike
  WsTransaction?: ClassLike
}

interface Statement {
  text: string
  params: unknown[] | null
}

const listOf = (args: unknown): unknown[] | null =>
  Array.isArray(args) ? args : args && typeof args === "object" ? Object.values(args) : null

/** A statement as the client accepts it: a string (with `args`), `{ sql, args }`, or the `[sql, args]` pair of a batch. */
function statementOf(statement: unknown, args?: unknown): Statement | null {
  if (typeof statement === "string") {
    return { text: statement, params: listOf(args) }
  }
  if (Array.isArray(statement) && typeof statement[0] === "string") {
    return { text: statement[0], params: listOf(statement[1]) }
  }
  if (statement && typeof statement === "object" && typeof (statement as { sql?: unknown }).sql === "string") {
    return { text: (statement as { sql: string }).sql, params: listOf((statement as { args?: unknown }).args) }
  }
  return null
}

const MAX_TEXT = 4000

function open(recorder: Recorder, api: string, statement: Statement, id: number): OperationHandle | null {
  const text = statement.text.slice(0, MAX_TEXT)
  return recorder.begin({ driver: "libsql", api, text, params: statement.params, connectionId: id, analysis: analyzeSql(text, "sqlite") })
}

function outcomeOf(handle: OperationHandle, result: unknown): OperationEnd {
  const set = result as ResultSetLike | undefined
  const kind = handle.event.analysis.kind
  if (kind === "insert" || kind === "update" || kind === "delete" || kind === "replace") {
    return { affectedRows: typeof set?.rowsAffected === "number" ? set.rowsAffected : null }
  }
  return { rowCount: Array.isArray(set?.rows) ? set.rows.length : null }
}

/** Closes `handle` when `promise` settles, without changing what the caller gets. */
function settle<T>(handle: OperationHandle | null, promise: T): T {
  if (handle && promise && typeof (promise as { then?: unknown }).then === "function") {
    ;(promise as unknown as Promise<unknown>).then(result => handle.end(outcomeOf(handle, result)), error => handle.end({ error }))
  } else {
    handle?.end()
  }
  return promise
}

function executeOf(recorder: Recorder, api: string): Patch["make"] {
  return original => function patched(this: object, ...args: unknown[]) {
    let handle: OperationHandle | null = null
    try {
      const statement = statementOf(args[0], args[1])
      handle = statement ? open(recorder, api, statement, objectId(this)) : null
    } catch {
      handle = null
    }
    return settle(handle, original.apply(this, args))
  }
}

/** `batch([...])`: every statement is listed; the one that failed (the error says which) carries the error. */
function batchOf(recorder: Recorder): Patch["make"] {
  return original => function patched(this: object, ...args: unknown[]) {
    const handles: Array<OperationHandle | null> = []
    try {
      const statements = Array.isArray(args[0]) ? args[0] : []
      for (const item of statements) {
        const statement = statementOf(item)
        handles.push(statement ? open(recorder, "batch", statement, objectId(this)) : null)
      }
    } catch {
      // best effort
    }
    const promise = original.apply(this, args) as Promise<unknown[]>
    if (handles.length > 0 && promise && typeof promise.then === "function") {
      promise.then(
        (results) => { handles.forEach((handle, index) => handle?.end(outcomeOf(handle, results?.[index]))) },
        (error: { statementIndex?: number }) => {
          handles.forEach((handle, index) => handle?.end(typeof error?.statementIndex !== "number" || error.statementIndex === index ? { error } : {}))
        }
      )
    } else {
      handles.forEach(handle => handle?.end())
    }
    return promise
  }
}

function controlOf(recorder: Recorder, text: string): Patch["make"] {
  return original => function patched(this: object, ...args: unknown[]) {
    let handle: OperationHandle | null = null
    try {
      handle = open(recorder, text.toLowerCase(), { text, params: null }, objectId(this))
    } catch {
      handle = null
    }
    return settle(handle, original.apply(this, args))
  }
}

/** `client.transaction()`: BEGIN is listed when the transaction opens, grouped with its statements by the transaction object. */
function transactionOf(recorder: Recorder): Patch["make"] {
  return original => function patched(this: object, ...args: unknown[]) {
    const promise = original.apply(this, args) as Promise<object>
    let handle: OperationHandle | null = null
    try {
      handle = open(recorder, "begin", { text: "BEGIN", params: null }, objectId(this))
    } catch {
      handle = null
    }
    if (handle && promise && typeof promise.then === "function") {
      const { event, end } = handle
      promise.then((transaction) => {
        event.connectionId = objectId(transaction)
        end()
      }, error => end({ error }))
    } else {
      handle?.end()
    }
    return promise
  }
}

function patchesFor(recorder: Recorder, client: ClassLike | undefined, transaction: ClassLike | undefined): Array<{ owner: object, patches: Patch[] }> {
  const groups: Array<{ owner: object, patches: Patch[] }> = []
  if (client) {
    groups.push({
      owner: client,
      patches: [
        { target: client.prototype, name: "execute", make: executeOf(recorder, "execute") },
        { target: client.prototype, name: "executeMultiple", make: executeOf(recorder, "executeMultiple") },
        { target: client.prototype, name: "batch", make: batchOf(recorder) },
        { target: client.prototype, name: "transaction", make: transactionOf(recorder) }
      ]
    })
  }
  if (transaction) {
    groups.push({
      owner: transaction,
      patches: [
        { target: transaction.prototype, name: "execute", make: executeOf(recorder, "execute") },
        { target: transaction.prototype, name: "executeMultiple", make: executeOf(recorder, "executeMultiple") },
        { target: transaction.prototype, name: "batch", make: batchOf(recorder) },
        { target: transaction.prototype, name: "commit", make: controlOf(recorder, "COMMIT") },
        { target: transaction.prototype, name: "rollback", make: controlOf(recorder, "ROLLBACK") }
      ]
    })
  }
  return groups
}

/** Patches the classes of one build (ESM or CommonJS) of one connection kind. */
function patchModule(recorder: Recorder, module: LibsqlModule | null): Array<() => void> {
  if (!module) {
    return []
  }
  return [
    ...patchesFor(recorder, module.Sqlite3Client, module.Sqlite3Transaction),
    ...patchesFor(recorder, module.HttpClient, module.HttpTransaction),
    ...patchesFor(recorder, module.WsClient, module.WsTransaction)
  ].map(group => applyPatches(group.owner, group.patches))
}

export const libsqlDriver: DriverAdapter = {
  name: "libsql",
  install(recorder) {
    const stops: Array<() => void> = []
    let stopped = false
    const add = (module: LibsqlModule | null) => {
      if (!stopped) {
        stops.push(...patchModule(recorder, module))
      }
    }
    // The CommonJS copies, now; the ESM copies (what an `import` gets) as soon as they are loaded.
    add(tryLoad(r => r("@libsql/client/sqlite3") as LibsqlModule))
    add(tryLoad(r => r("@libsql/client/http") as LibsqlModule))
    add(tryLoad(r => r("@libsql/client/ws") as LibsqlModule))
    void Promise.all([
      tryImport(r => r("@libsql/client/sqlite3") as Promise<LibsqlModule>),
      tryImport(r => r("@libsql/client/http") as Promise<LibsqlModule>),
      tryImport(r => r("@libsql/client/ws") as Promise<LibsqlModule>)
    ]).then(modules => modules.forEach(add))
    // Nothing found means nothing to watch (the application does not use libSQL).
    return () => {
      stopped = true
      stops.forEach(stop => stop())
    }
  }
}
