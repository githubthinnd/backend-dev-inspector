import type { DriverAdapter, OperationHandle, Recorder, StatementKind } from "sql-dev-inspector"
import { tracingChannel } from "node:diagnostics_channel"
import { describeOperation } from "sql-dev-inspector"
import { applyPatches } from "../patch.js"
import { tryLoad } from "../peer.js"

/**
 * Redis through `ioredis` and node-redis (`redis`). Both libraries publish every command on a
 * `diagnostics_channel` tracing channel (`ioredis:command`, `node-redis:command`), with the
 * arguments already stripped of values that could be secrets (`SET key ?`), so nothing is patched
 * for them. Older ioredis releases (5.x) publish nothing; those get a small patch instead.
 *
 * A command is described as the SQL statement it resembles (a read is a `select`), so repeated
 * reads of keys that differ only by an id are reported as an N+1, and a slow one as slow.
 */

/** Commands the clients send on their own while connecting; they are not the application's calls. */
const HANDSHAKE = new Set(["AUTH", "HELLO", "CLIENT", "INFO", "READONLY", "READWRITE"])

const READS = new Set([
  "GET", "MGET", "GETRANGE", "STRLEN", "EXISTS", "TTL", "PTTL", "EXPIRETIME", "TYPE", "KEYS", "SCAN", "DBSIZE", "RANDOMKEY",
  "HGET", "HMGET", "HGETALL", "HEXISTS", "HKEYS", "HVALS", "HLEN", "HSCAN", "HSTRLEN", "HRANDFIELD",
  "LRANGE", "LINDEX", "LLEN", "LPOS", "SMEMBERS", "SISMEMBER", "SMISMEMBER", "SCARD", "SSCAN", "SRANDMEMBER", "SINTER", "SUNION", "SDIFF",
  "ZRANGE", "ZRANGEBYSCORE", "ZREVRANGE", "ZSCORE", "ZCARD", "ZRANK", "ZREVRANK", "ZCOUNT", "ZSCAN",
  "XRANGE", "XREVRANGE", "XLEN", "XREAD", "GETBIT", "BITCOUNT", "PFCOUNT", "GEOPOS", "GEODIST", "GEOSEARCH", "JSON.GET", "FT.SEARCH", "PING"
])
const DELETES = new Set(["DEL", "UNLINK", "HDEL", "LREM", "SREM", "ZREM", "LPOP", "RPOP", "SPOP", "ZPOPMIN", "ZPOPMAX", "XDEL", "FLUSHDB", "FLUSHALL", "GETDEL"])
const INSERTS = new Set(["LPUSH", "RPUSH", "LPUSHX", "RPUSHX", "SADD", "ZADD", "XADD", "PFADD", "GEOADD"])

function kindOf(command: string): StatementKind {
  if (command === "MULTI") {
    return "tx-begin"
  }
  if (command === "EXEC") {
    return "tx-commit"
  }
  if (command === "DISCARD") {
    return "tx-rollback"
  }
  if (READS.has(command)) {
    return "select"
  }
  if (DELETES.has(command)) {
    return "delete"
  }
  return INSERTS.has(command) ? "insert" : "update"
}

const MAX_TEXT = 300

/** A small stable id for a server address, standing in for a connection id the clients do not expose. */
function addressId(address: string): number {
  let hash = 5381
  for (let i = 0; i < address.length; i++) {
    hash = ((hash << 5) + hash + address.charCodeAt(i)) | 0
  }
  return -(Math.abs(hash) + 1)
}

interface CommandContext {
  command?: string
  args?: unknown[]
  database?: number
  serverAddress?: string
  serverPort?: number
  clientId?: unknown
  batchMode?: string
  batchSize?: number
  error?: unknown
}

/**
 * @param nameInArgs node-redis puts the command name first in `args`; ioredis keeps it apart.
 */
function begin(recorder: Recorder, driver: string, context: CommandContext, nameInArgs: boolean): OperationHandle | null {
  const command = String(context.command ?? "").toUpperCase()
  if (!command || HANDSHAKE.has(command)) {
    return null
  }
  const args = (context.args ?? []).slice(nameInArgs ? 1 : 0).map(String)
  const text = [command, ...args].join(" ").slice(0, MAX_TEXT)
  return recorder.begin({
    driver,
    api: command.toLowerCase(),
    text,
    connectionId: addressId(`${context.serverAddress ?? "redis"}:${context.serverPort ?? ""}:${context.database ?? 0}`),
    analysis: describeOperation({ kind: kindOf(command), label: command, targets: args.length > 0 ? [args[0]!] : [], text })
  })
}

/** One call for a MULTI whose commands the client does not publish one by one. */
function beginMulti(recorder: Recorder, driver: string, context: CommandContext): OperationHandle | null {
  if (String(context.batchMode).toUpperCase() !== "MULTI") {
    return null // a pipeline's commands are published individually
  }
  const text = `MULTI ×${context.batchSize ?? "?"}`
  return recorder.begin({
    driver,
    api: "multi",
    text,
    connectionId: addressId(`${context.serverAddress ?? "redis"}:${context.serverPort ?? ""}:${context.database ?? 0}`),
    analysis: describeOperation({ kind: "update", label: "MULTI", text })
  })
}

/** Follows one tracing channel: a call opens at `start` and closes when its promise settles. */
function follow(recorder: Recorder, name: string, open: (recorder: Recorder, context: CommandContext) => OperationHandle | null): () => void {
  const channel = tracingChannel(name)
  const handles = new WeakMap<object, OperationHandle>()
  const handlers = {
    start(message: object) {
      try {
        const handle = open(recorder, message as CommandContext)
        if (handle) {
          handles.set(message, handle)
        }
      } catch {
        // best effort: never get in the way of the command
      }
    },
    end(message: object) {
      // A synchronous failure ends here; an asynchronous call is closed by asyncEnd / error.
      const context = message as CommandContext
      if (context.error !== undefined) {
        handles.get(message)?.end({ error: context.error })
      }
    },
    asyncStart() {},
    asyncEnd(message: object) {
      handles.get(message)?.end({ error: (message as CommandContext).error })
    },
    error(message: object) {
      handles.get(message)?.end({ error: (message as CommandContext).error })
    }
  }
  channel.subscribe(handlers)
  return () => void channel.unsubscribe(handlers)
}

export const ioredisDriver: DriverAdapter = {
  name: "ioredis",
  install(recorder) {
    const redis = tryLoad(r => r("ioredis") as { default?: IoredisClass } & IoredisClass)
    const Redis = redis?.default ?? redis
    if (!Redis?.prototype) {
      return null
    }
    // ioredis 6 publishes its commands; older releases need a patch on the one method every command goes through.
    if (typeof Redis.prototype._buildCommandContext === "function") {
      // The `ioredis:batch` channel is left alone: every command of a MULTI / pipeline is published on
      // the command channel too, so MULTI ... EXEC already shows up as a transaction.
      return follow(recorder, "ioredis:command", (rec, context) => begin(rec, "ioredis", context, false))
    }
    return installLegacyIoredis(recorder, Redis)
  }
}

interface IoredisClass {
  prototype: { _buildCommandContext?: unknown, sendCommand?: unknown, options?: { host?: string, port?: number, db?: number } }
}

interface LegacyCommand {
  name: string
  args: unknown[]
  promise?: Promise<unknown>
}

function installLegacyIoredis(recorder: Recorder, Redis: IoredisClass): () => void {
  return applyPatches(Redis, [{
    target: Redis.prototype,
    name: "sendCommand",
    make: original => function patchedSendCommand(this: { options?: { host?: string, port?: number, db?: number } }, ...args: unknown[]) {
      const command = args[0] as LegacyCommand | undefined
      let handle: OperationHandle | null = null
      try {
        if (command && typeof command.name === "string") {
          const name = command.name.toUpperCase()
          // Values may be secrets; only the key and the arguments of pure reads are shown.
          const shown = READS.has(name) ? command.args.map(String) : command.args.map((arg, index) => index === 0 ? String(arg) : "?")
          handle = begin(recorder, "ioredis", {
            command: name,
            args: shown,
            serverAddress: this.options?.host,
            serverPort: this.options?.port,
            database: this.options?.db
          }, false)
        }
      } catch {
        handle = null
      }
      const result = (original as (...a: unknown[]) => unknown).apply(this, args) as Promise<unknown> | undefined
      const settled = result && typeof result.then === "function" ? result : command?.promise
      if (handle && settled && typeof settled.then === "function") {
        const { end } = handle
        settled.then(() => end(), error => end({ error }))
      } else {
        handle?.end()
      }
      return result
    } as never
  }])
}

/**
 * node-redis (`redis`, `@redis/client`) 6.x and newer, which publish their commands. Nothing to
 * patch. A MULTI is published as one batch (its commands are not), so it is one call here; a
 * pipeline's commands come one by one.
 */
export const nodeRedisDriver: DriverAdapter = {
  name: "redis",
  install(recorder) {
    const stops = [
      follow(recorder, "node-redis:command", (rec, context) => begin(rec, "redis", context, true)),
      follow(recorder, "node-redis:batch", (rec, context) => beginMulti(rec, "redis", context))
    ]
    return () => stops.forEach(stop => stop())
  }
}
