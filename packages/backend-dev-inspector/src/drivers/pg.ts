import type { DriverAdapter, Recorder } from "sql-dev-inspector"
import { analyzeSql, bindToRequest } from "sql-dev-inspector"
import { applyPatches, objectId, type Patch } from "../patch.js"
import { tryLoad } from "../peer.js"

/**
 * PostgreSQL through node-postgres (`pg`), and with it Drizzle, Kysely, Knex, TypeORM, Sequelize
 * and Prisma's pg adapter. `Client.prototype.query` is the one funnel under every query, pool
 * included; `this.processID` tells the connections (and so the transactions) apart.
 */

interface PgClientLike {
  processID?: number | null
}

interface PgModule {
  Client: { prototype: object }
  Pool?: { prototype: object }
}

const WRITES = new Set(["INSERT", "UPDATE", "DELETE", "MERGE", "COPY"])

interface PgResultLike {
  command?: string
  rowCount?: number | null
  rows?: unknown[]
}

function outcomeOf(result: unknown) {
  const last = (Array.isArray(result) ? result.at(-1) : result) as PgResultLike | undefined
  if (!last || typeof last !== "object") {
    return {}
  }
  const count = typeof last.rowCount === "number" ? last.rowCount : (last.rows?.length ?? null)
  return WRITES.has(String(last.command)) ? { affectedRows: count } : { rowCount: count }
}

function textOf(config: unknown): string | null {
  if (typeof config === "string") {
    return config
  }
  if (config && typeof config === "object" && "text" in config && typeof config.text === "string") {
    return config.text
  }
  return null
}

function paramsOf(config: unknown, values: unknown): unknown[] | null {
  if (Array.isArray(values)) {
    return values
  }
  const own = config && typeof config === "object" && "values" in config ? config.values : null
  return Array.isArray(own) ? own : null
}

function wrapQuery(recorder: Recorder, original: (...args: unknown[]) => unknown) {
  return function patchedQuery(this: PgClientLike, ...args: unknown[]) {
    const [config, values, callback] = args
    let handle: ReturnType<Recorder["begin"]> = null
    try {
      const text = textOf(config)
      if (text !== null) {
        handle = recorder.begin({
          driver: "pg",
          api: "query",
          text,
          params: paramsOf(config, values),
          connectionId: typeof this.processID === "number" ? this.processID : objectId(this),
          analysis: analyzeSql(text, "postgres")
        })
      }
    } catch {
      handle = null
    }
    if (!handle) {
      return original.apply(this, args)
    }
    const { end } = handle

    // Callback style: the last function argument is called with the outcome.
    const wrapCallback = (cb: (...a: unknown[]) => unknown) => (error: unknown, result: unknown) => {
      end({ error, ...outcomeOf(result) })
      return cb(error, result)
    }
    let hasCallback = false
    if (typeof values === "function") {
      args[1] = wrapCallback(values as never)
      hasCallback = true
    } else if (typeof callback === "function") {
      args[2] = wrapCallback(callback as never)
      hasCallback = true
    } else if (config && typeof config === "object" && "callback" in config && typeof config.callback === "function") {
      args[0] = { ...config, callback: wrapCallback(config.callback as never) }
      hasCallback = true
    }

    const result = original.apply(this, args) as { then?: unknown, once?: unknown } | undefined
    if (!hasCallback && result && typeof result.then === "function") {
      ;(result as Promise<unknown>).then(res => end(outcomeOf(res)), error => end({ error }))
    } else if (!hasCallback && result && typeof result.once === "function") {
      // A submittable such as pg-cursor or pg-query-stream: it reports through events.
      const emitter = result as { once: (event: string, listener: (arg?: unknown) => void) => void }
      emitter.once("end", () => end())
      emitter.once("error", error => end({ error }))
    }
    return result
  }
}

/**
 * `pool.query()` and `pool.connect(cb)` hand the statement to a client from a callback, which
 * runs later from whichever request freed a client when the pool is busy. Binding the callback
 * at the call site keeps the statement with the request that asked for it.
 */
function keepRequestContext(original: (...args: unknown[]) => unknown) {
  return function patchedConnect(this: unknown, ...args: unknown[]) {
    if (typeof args[0] === "function") {
      args[0] = bindToRequest(args[0] as (...a: never[]) => unknown)
    }
    return original.apply(this, args)
  }
}

export function installPg(recorder: Recorder, pg: PgModule): () => void {
  const patches: Patch[] = [
    { target: pg.Client.prototype, name: "query", make: original => wrapQuery(recorder, original) },
    ...(pg.Pool ? [{ target: pg.Pool.prototype, name: "connect", make: keepRequestContext }] : [])
  ]
  return applyPatches(pg.Client, patches)
}

export const pgDriver: DriverAdapter = {
  name: "pg",
  install(recorder) {
    const pg = tryLoad(r => r("pg") as PgModule)
    return pg?.Client ? installPg(recorder, pg) : null
  }
}
