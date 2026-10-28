import type { Duplex } from "node:stream"
import { tracingChannel } from "node:diagnostics_channel"
import { createRequire } from "node:module"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildReport, createRecorder, getInspector, type RequestTrace, resetInspectorForTests, runInRequest, startInspector } from "sql-dev-inspector"
import { ioredisDriver, nodeRedisDriver } from "../src/drivers/redis"
import { fakeNetwork } from "./helpers/fake-net"
import { startMockRedis, type MockRedis } from "./helpers/mock-redis"

const ioredis = createRequire(import.meta.url)("ioredis") as { default: new (options: object) => IoRedis, AbstractConnector: new (timeout: number) => { stream: Duplex | null, connecting: boolean } }
interface IoRedis {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string) => Promise<string>
  del: (key: string) => Promise<number>
  call: (name: string, ...args: string[]) => Promise<unknown>
  multi: () => { set: (k: string, v: string) => unknown, get: (k: string) => unknown, exec: () => Promise<unknown> }
  quit: () => Promise<unknown>
  status: string
  disconnect: () => void
}

let server: MockRedis
let clients: IoRedis[] = []
let uninstall: (() => void) | null = null

function connect(): Promise<IoRedis> {
  class TestConnector extends ioredis.AbstractConnector {
    constructor() {
      super(0)
    }

    connect(): Promise<Duplex> {
      this.connecting = true
      const stream = server.stream()
      this.stream = stream
      setImmediate(() => stream.emit("connect"))
      return Promise.resolve(stream)
    }
  }
  const client = new ioredis.default({ Connector: TestConnector, maxRetriesPerRequest: 1 })
  clients.push(client)
  return new Promise((resolve) => {
    ;(client as unknown as { once: (e: string, f: () => void) => void }).once("ready", () => resolve(client))
  })
}
const recorder = () => createRecorder(getInspector().store)
const request = (url: string): RequestTrace => getInspector().store.startRequest("GET", url)
const summary = (trace: RequestTrace) => trace.queries.map(q => [q.driver, q.analysis.label, q.analysis.kind, q.sql, q.error])

beforeEach(() => {
  server = startMockRedis()
  startInspector({ NODE_ENV: "development", SQL_INSPECTOR_LOG: "0", SQL_INSPECTOR_NOTICE: "0" }, { drivers: [] })
})
afterEach(() => {
  uninstall?.()
  uninstall = null
  for (const client of clients) {
    client.disconnect()
  }
  clients = []
  getInspector().store.clear()
  resetInspectorForTests()
})

describe("ioredis (tracing channel)", () => {
  beforeEach(() => {
    uninstall = ioredisDriver.install(recorder())
  })

  it("records commands as the statements they resemble, without the values", async () => {
    const redis = await connect()
    const trace = request("/cache")
    await runInRequest(trace, async () => {
      await redis.set("user:1", "s3cret-value")
      expect(await redis.get("user:1")).toBe("value:user:1")
      await redis.del("user:1")
    })
    expect(summary(trace)).toEqual([
      ["ioredis", "SET", "update", "SET user:1 ?", null],
      ["ioredis", "GET", "select", "GET user:1", null],
      ["ioredis", "DEL", "delete", "DEL user:1", null]
    ])
    expect(JSON.stringify(trace.queries)).not.toContain("s3cret-value")
    expect(trace.queries[0]!.analysis.tables).toEqual(["user:1"])
    expect(trace.queries[1]!.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("does not report the commands the client sends on its own while connecting", async () => {
    await connect()
    expect(server.commands.map(c => c[0]!.toLowerCase())).toContain("info")
    expect(getInspector().store.get("background")).toBeUndefined()
  })

  it("records a failing command with its error, and the command still rejects", async () => {
    const redis = await connect()
    const trace = request("/bad")
    await expect(runInRequest(trace, () => redis.call("boom"))).rejects.toThrow("boom")
    expect(trace.queries[0]!.error).toContain("boom")
    expect(trace.queries[0]!.durationMs).not.toBeNull()
  })

  it("reports an N+1 of reads whose keys differ only by an id", async () => {
    const redis = await connect()
    const trace = request("/n-plus-one")
    await runInRequest(trace, async () => {
      for (const id of [1, 2, 3, 4]) {
        await redis.get(`user:${id}`)
      }
    })
    const insight = buildReport(trace).insights.find(i => i.type === "n-plus-one")
    expect(insight?.params.sql).toBe("GET user:?")
  })

  it("keeps calls of requests that overlap with the request that made them", async () => {
    const redis = await connect()
    const a = request("/a")
    const b = request("/b")
    await Promise.all([
      runInRequest(a, async () => {
        await redis.call("sleep", "25")
        await redis.get("a:1")
      }),
      runInRequest(b, async () => {
        await redis.get("b:1")
        await redis.get("b:2")
      })
    ])
    expect(a.queries.map(q => q.sql)).toEqual(["SLEEP ?", "GET a:1"])
    expect(b.queries.map(q => q.sql)).toEqual(["GET b:1", "GET b:2"])
  })

  it("shows MULTI ... EXEC as a transaction around the commands queued in it", async () => {
    const redis = await connect()
    const trace = request("/multi")
    await runInRequest(trace, async () => {
      const tx = redis.multi()
      tx.set("a", "1")
      tx.get("a")
      await tx.exec()
    })
    expect(trace.queries.map(q => q.sql)).toEqual(["MULTI", "SET a ?", "GET a", "EXEC"])
    const tree = buildReport(trace).tree
    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({ type: "transaction", status: "committed" })
    expect((tree[0] as { children: unknown[] }).children).toHaveLength(2)
  })

  it("stops recording once uninstalled, and installs one subscription however often it is asked", async () => {
    const redis = await connect()
    const second = ioredisDriver.install(recorder())
    const trace = request("/twice")
    await runInRequest(trace, () => redis.get("k"))
    expect(trace.queries).toHaveLength(2) // two installs, two subscribers: the caller decides, startInspector installs each driver once
    second?.()
    uninstall?.()
    uninstall = null
    const after = request("/after")
    await runInRequest(after, () => redis.get("k"))
    expect(after.queries).toHaveLength(0)
  })
})

describe("ioredis 5 (no tracing channel): patched instead", () => {
  it("records commands from sendCommand, showing keys but not values", async () => {
    // ioredis 6 publishes its commands; pretending to be an older release makes the driver patch.
    const proto = (ioredis.default as unknown as { prototype: Record<string, unknown> }).prototype
    const real = proto._buildCommandContext
    delete proto._buildCommandContext
    try {
      uninstall = ioredisDriver.install(recorder())
      const redis = await connect()
      const trace = request("/legacy")
      await runInRequest(trace, async () => {
        await redis.set("user:1", "s3cret-value")
        await redis.get("user:1")
        await expect(redis.call("boom")).rejects.toThrow("boom")
      })
      expect(summary(trace).map(row => row.slice(1, 4))).toEqual([
        ["SET", "update", "SET user:1 ?"],
        ["GET", "select", "GET user:1"],
        ["BOOM", "update", "BOOM"]
      ])
      expect(trace.queries[2]!.error).toContain("boom")
      expect(JSON.stringify(trace.queries)).not.toContain("s3cret-value")
      expect(getInspector().store.get("background")).toBeUndefined()
    } finally {
      uninstall?.()
      uninstall = null
      proto._buildCommandContext = real
    }
  })
})

describe("node-redis (tracing channel)", () => {
  // The context below is what node-redis 6 publishes (see its client/index.js #commandTraceContext).
  const channel = tracingChannel("node-redis:command")
  const context = (args: string[]) => ({ command: args[0]!.toUpperCase(), args, database: 0, clientId: 7, serverAddress: "localhost", serverPort: 6379 })

  beforeEach(() => {
    uninstall = nodeRedisDriver.install(recorder())
  })

  it("records a command from its published context, name included in args", async () => {
    const trace = request("/node-redis")
    await runInRequest(trace, async () => {
      await channel.tracePromise(async () => "OK", context(["SET", "user:1", "?"]))
      await channel.tracePromise(async () => "v", context(["GET", "user:1"]))
    })
    expect(summary(trace)).toEqual([
      ["redis", "SET", "update", "SET user:1 ?", null],
      ["redis", "GET", "select", "GET user:1", null]
    ])
    expect(trace.queries[1]!.analysis.tables).toEqual(["user:1"])
  })

  it("records a rejected command, and ignores handshake commands", async () => {
    const trace = request("/node-redis-error")
    await runInRequest(trace, async () => {
      await expect(channel.tracePromise(async () => {
        throw new Error("WRONGTYPE")
      }, context(["GET", "k"]))).rejects.toThrow("WRONGTYPE")
      await channel.tracePromise(async () => "OK", context(["HELLO", "3"]))
      await channel.tracePromise(async () => "OK", context(["CLIENT", "SETINFO"]))
    })
    expect(trace.queries).toHaveLength(1)
    expect(trace.queries[0]!.error).toBe("WRONGTYPE")
  })

  it("attributes interleaved commands to their own requests", async () => {
    const a = request("/a")
    const b = request("/b")
    const slow = (ms: number) => new Promise<string>(resolve => setTimeout(() => resolve("OK"), ms))
    await Promise.all([
      runInRequest(a, () => channel.tracePromise(() => slow(20), context(["GET", "a"]))),
      runInRequest(b, () => channel.tracePromise(() => slow(1), context(["GET", "b"])))
    ])
    expect(a.queries.map(q => q.sql)).toEqual(["GET a"])
    expect(b.queries.map(q => q.sql)).toEqual(["GET b"])
  })

  it("records a MULTI batch as one call and leaves a pipeline to its own commands", async () => {
    const batch = tracingChannel("node-redis:batch")
    const trace = request("/node-redis-batches")
    await runInRequest(trace, async () => {
      await batch.tracePromise(async () => [], { batchMode: "MULTI", batchSize: 3, database: 0, clientId: 7, serverAddress: "localhost", serverPort: 6379 })
      await batch.tracePromise(async () => [], { batchMode: "PIPELINE", batchSize: 3, database: 0, clientId: 7, serverAddress: "localhost", serverPort: 6379 })
    })
    expect(trace.queries.map(q => q.sql)).toEqual(["MULTI ×3"])
  })

  it("does not subscribe twice or leak after uninstall", async () => {
    uninstall?.()
    uninstall = null
    const trace = request("/gone")
    await runInRequest(trace, () => channel.tracePromise(async () => "OK", context(["GET", "k"])))
    expect(trace.queries).toHaveLength(0)
  })
})

interface NodeRedis {
  connect: () => Promise<unknown>
  quit: () => Promise<unknown>
  disconnect: () => Promise<unknown>
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string) => Promise<string | null>
  sendCommand: (args: string[]) => Promise<unknown>
  multi: () => { set: (k: string, v: string) => unknown, get: (k: string) => unknown, exec: () => Promise<unknown> }
}

// node-redis needs files named credentials-provider.*; a locked-down sandbox may refuse to read them,
// in which case the real-client tests are skipped and the published-channel tests above still run.
// NODE_REDIS_CLIENT points at another copy of the client (a directory) for such an environment.
function loadNodeRedis(): { createClient: (options: object) => NodeRedis } | null {
  try {
    return createRequire(import.meta.url)(process.env.NODE_REDIS_CLIENT ?? "redis")
  } catch {
    return null
  }
}
const nodeRedis = loadNodeRedis()

describe.skipIf(!nodeRedis)("node-redis (the real client, over an in-memory socket)", () => {
  const createClient = (options: object) => nodeRedis!.createClient(options)
  let restore: () => void
  let clients: NodeRedis[] = []

  async function open() {
    const client = createClient({ socket: { host: "127.0.0.1", port: 6379, reconnectStrategy: false } })
    clients.push(client)
    await client.connect()
    return client
  }

  beforeEach(() => {
    restore = fakeNetwork(server.serve)
    uninstall = nodeRedisDriver.install(recorder())
  })
  afterEach(async () => {
    await Promise.all(clients.map(client => client.disconnect().catch(() => {})))
    clients = []
    restore()
  })

  it("records commands without their values, and not the handshake", async () => {
    const redis = await open()
    const trace = request("/node-redis-real")
    await runInRequest(trace, async () => {
      await redis.set("user:1", "s3cret-value")
      expect(await redis.get("user:1")).toBe("value:user:1")
    })
    expect(summary(trace)).toEqual([
      ["redis", "SET", "update", "SET user:1 ?", null],
      ["redis", "GET", "select", "GET user:1", null]
    ])
    expect(JSON.stringify(trace.queries)).not.toContain("s3cret-value")
    expect(getInspector().store.get("background")).toBeUndefined()
  })

  it("records a failing command and reports an N+1 of reads", async () => {
    const redis = await open()
    const trace = request("/node-redis-real-2")
    await runInRequest(trace, async () => {
      await expect(redis.sendCommand(["BOOM"])).rejects.toThrow("boom")
      for (const id of [1, 2, 3]) {
        await redis.get(`order:${id}`)
      }
    })
    expect(trace.queries[0]!.error).toContain("boom")
    expect(buildReport(trace).insights.map(i => i.type).sort()).toEqual(["error", "n-plus-one"])
  })

  it("records a MULTI as one call, because node-redis does not publish its commands", async () => {
    const redis = await open()
    const trace = request("/node-redis-multi")
    await runInRequest(trace, async () => {
      const tx = redis.multi()
      tx.set("a", "1")
      tx.get("a")
      await tx.exec()
    })
    expect(trace.queries.map(q => [q.analysis.label, q.sql])).toEqual([["MULTI", "MULTI ×2"]])
  })
})
