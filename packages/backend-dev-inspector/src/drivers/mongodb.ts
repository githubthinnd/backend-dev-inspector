import type { DriverAdapter, OperationHandle, Recorder, StatementKind } from "sql-dev-inspector"
import { describeOperation } from "sql-dev-inspector"
import { applyPatches } from "../patch.js"
import { tryLoad } from "../peer.js"

/**
 * MongoDB through the official driver, and with it Mongoose. The driver reports every command it
 * sends as an event (command monitoring) once `monitorCommands` is on, so no query code is
 * patched: `MongoClient#connect` switches monitoring on for the clients that connect while the
 * inspector is installed and listens to their events.
 *
 * A command is described as the SQL statement it resembles (`find` is a `select`, `insert` an
 * `insert`), so repeated finds that differ only by an id are reported as an N+1.
 */

interface MongoClientLike {
  monitorCommands?: boolean
  options?: { monitorCommands?: boolean }
  on: (event: string, listener: (event: never) => void) => unknown
}

interface StartedEvent {
  requestId: number
  commandName: string
  command: Record<string, unknown>
  databaseName?: string
  address?: string
  connectionId?: number | string
  serverConnectionId?: bigint | number | null
}

interface FinishedEvent {
  requestId: number
  commandName: string
  address?: string
  reply?: Record<string, unknown>
  failure?: { message?: string } | Error
}

/** Commands the driver sends for its own bookkeeping. */
const INTERNAL = new Set(["hello", "ismaster", "isMaster", "saslStart", "saslContinue", "endSessions", "killCursors", "buildInfo", "getnonce", "logout"])
const READS = new Set(["find", "aggregate", "count", "distinct", "getMore", "listCollections", "listIndexes", "listDatabases", "explain", "collStats", "dbStats", "ping"])
const DRIVER_KEYS = new Set(["lsid", "$clusterTime", "$db", "$readPreference", "txnNumber", "autocommit", "startTransaction", "readConcern", "writeConcern", "$readConcern", "apiVersion", "maxTimeMS", "comment"])
const MAX_TEXT = 300

function kindOf(name: string, command: Record<string, unknown>): StatementKind {
  if (name === "commitTransaction") {
    return "tx-commit"
  }
  if (name === "abortTransaction") {
    return "tx-rollback"
  }
  if (READS.has(name)) {
    return "select"
  }
  switch (name) {
    case "insert":
      return "insert"
    case "update":
      return "update"
    case "delete":
      return "delete"
    case "findAndModify":
    case "findandmodify":
      return command.remove === true ? "delete" : "update"
    default:
      return "other"
  }
}

function render(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, item) => {
      if (typeof item === "bigint") {
        return String(item)
      }
      if (item && typeof item === "object" && "_bsontype" in item) {
        return String(item)
      }
      return item
    }) ?? ""
  } catch {
    return "{…}"
  }
}

function textOf(event: StartedEvent): { text: string, collection: string | null } {
  const { command, commandName } = event
  const target = command[commandName]
  const collection = typeof target === "string" ? target : typeof command.collection === "string" ? command.collection : null
  const rest: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(command)) {
    if (key !== commandName && !DRIVER_KEYS.has(key)) {
      rest[key] = value
    }
  }
  const body = Object.keys(rest).length > 0 ? ` ${render(rest)}` : ""
  return { text: `${collection ? `${collection}.` : ""}${commandName}${body}`.slice(0, MAX_TEXT), collection }
}

function connectionIdOf(event: StartedEvent): number {
  if (event.serverConnectionId !== undefined && event.serverConnectionId !== null) {
    return Number(event.serverConnectionId)
  }
  if (typeof event.connectionId === "number") {
    return event.connectionId
  }
  let hash = 5381
  for (const char of String(event.address ?? "mongodb")) {
    hash = ((hash << 5) + hash + char.charCodeAt(0)) | 0
  }
  return -(Math.abs(hash) + 1)
}

function outcomeOf(name: string, reply: Record<string, unknown> | undefined) {
  if (!reply) {
    return {}
  }
  const cursor = reply.cursor as { firstBatch?: unknown[], nextBatch?: unknown[] } | undefined
  const batch = cursor?.firstBatch ?? cursor?.nextBatch
  if (batch) {
    return { rowCount: batch.length }
  }
  if (name === "insert" || name === "delete" || name === "update") {
    return { affectedRows: Number(name === "update" ? (reply.nModified ?? reply.n ?? 0) : (reply.n ?? 0)) }
  }
  if (name === "count") {
    return { rowCount: Number(reply.n ?? 0) }
  }
  if (name === "findAndModify") {
    return { rowCount: reply.value ? 1 : 0 }
  }
  return {}
}

function watch(recorder: Recorder, client: MongoClientLike) {
  const open = new Map<string, OperationHandle>()
  const keyOf = (event: { requestId: number, address?: string }) => `${event.address ?? ""}#${event.requestId}`

  client.on("commandStarted", ((event: StartedEvent) => {
    try {
      if (INTERNAL.has(event.commandName)) {
        return
      }
      const connectionId = connectionIdOf(event)
      if (event.command.startTransaction === true) {
        // The driver has no BEGIN command: the first command of a transaction carries the flag.
        recorder.begin({
          driver: "mongodb",
          api: "startTransaction",
          text: "startTransaction",
          connectionId,
          analysis: describeOperation({ kind: "tx-begin", label: "BEGIN", text: "startTransaction" })
        })?.end()
      }
      const { text, collection } = textOf(event)
      const handle = recorder.begin({
        driver: "mongodb",
        api: event.commandName,
        text,
        connectionId,
        analysis: describeOperation({ kind: kindOf(event.commandName, event.command), label: event.commandName.toUpperCase(), targets: collection ? [collection] : [], text })
      })
      if (handle) {
        open.set(keyOf(event), handle)
      }
    } catch {
      // best effort
    }
  }) as never)
  client.on("commandSucceeded", ((event: FinishedEvent) => {
    const handle = open.get(keyOf(event))
    open.delete(keyOf(event))
    handle?.end(outcomeOf(event.commandName, event.reply))
  }) as never)
  client.on("commandFailed", ((event: FinishedEvent) => {
    const handle = open.get(keyOf(event))
    open.delete(keyOf(event))
    handle?.end({ error: event.failure })
  }) as never)
}

type Connect = (this: MongoClientLike, ...args: unknown[]) => unknown

function watching(recorder: Recorder, original: Connect) {
  const watched = new WeakSet<object>()
  return function patchedConnect(this: MongoClientLike, ...args: unknown[]) {
    if (!watched.has(this)) {
      watched.add(this)
      try {
        if ("monitorCommands" in this) {
          this.monitorCommands = true
        } else if (this.options) {
          this.options.monitorCommands = true
        }
        watch(recorder, this)
      } catch {
        // a client that cannot be watched is simply not recorded
      }
    }
    return original.apply(this, args)
  }
}

export const mongodbDriver: DriverAdapter = {
  name: "mongodb",
  install(recorder) {
    const mongodb = tryLoad(r => r("mongodb") as { MongoClient?: { prototype: object } })
    const MongoClient = mongodb?.MongoClient
    if (!MongoClient) {
      return null
    }
    return applyPatches(MongoClient, [{ target: MongoClient.prototype, name: "connect", make: original => watching(recorder, original as Connect) }])
  }
}
