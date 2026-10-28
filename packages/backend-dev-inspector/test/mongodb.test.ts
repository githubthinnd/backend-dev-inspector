import { createRequire } from "node:module"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildReport, createRecorder, getInspector, type RequestTrace, resetInspectorForTests, runInRequest, startInspector } from "sql-dev-inspector"
import { mongodbDriver } from "../src/drivers/mongodb"
import { fakeNetwork } from "./helpers/fake-net"
import { type MockMongo, startMockMongo } from "./helpers/mock-mongo"

const { MongoClient } = createRequire(import.meta.url)("mongodb") as typeof import("mongodb")
const originalConnect = MongoClient.prototype.connect

let server: MockMongo
let restoreNetwork: () => void
let uninstall: (() => void) | null = null
let clients: InstanceType<typeof MongoClient>[] = []

const recorder = () => createRecorder(getInspector().store)
const request = (url: string): RequestTrace => getInspector().store.startRequest("GET", url)
const open = async () => {
  const client = new MongoClient("mongodb://mock:27017/?directConnection=true", { serverSelectionTimeoutMS: 3000, maxPoolSize: 5 })
  clients.push(client)
  await client.connect()
  return client
}
const summary = (trace: RequestTrace) => trace.queries.map(q => [q.analysis.label, q.analysis.kind, q.sql])

beforeEach(() => {
  server = startMockMongo()
  restoreNetwork = fakeNetwork(server.serve)
  startInspector({ NODE_ENV: "development", SQL_INSPECTOR_LOG: "0", SQL_INSPECTOR_NOTICE: "0" }, { drivers: [] })
  uninstall = mongodbDriver.install(recorder())
})
afterEach(async () => {
  await Promise.all(clients.map(client => client.close().catch(() => {})))
  clients = []
  uninstall?.()
  restoreNetwork()
  getInspector().store.clear()
  resetInspectorForTests()
})

describe("mongodb driver", () => {
  it("records commands as the statements they resemble, with the collection and the filter", async () => {
    const users = (await open()).db("app").collection("users")
    const trace = request("/users")
    await runInRequest(trace, async () => {
      expect(await users.find({ age: { $gt: 18 } }).toArray()).toHaveLength(2)
      await users.insertOne({ name: "ann" })
      await users.updateOne({ name: "ann" }, { $set: { age: 3 } })
      await users.deleteOne({ name: "ann" })
    })
    expect(summary(trace)).toEqual([
      ["FIND", "select", `users.find {"filter":{"age":{"$gt":18}}}`],
      ["INSERT", "insert", expect.stringMatching(/^users\.insert \{"documents":\[\{"name":"ann","_id":"[0-9a-f]{24}"\}\]/)],
      ["UPDATE", "update", expect.stringContaining(`users.update {"updates":[{"q":{"name":"ann"}`)],
      ["DELETE", "delete", expect.stringContaining(`users.delete {"deletes":[{"q":{"name":"ann"}`)]
    ])
    expect(trace.queries.map(q => [q.rowCount, q.affectedRows])).toEqual([[2, null], [null, 1], [null, 1], [null, 1]])
    expect(trace.queries[0]).toMatchObject({ driver: "mongodb", api: "find", error: null })
    expect(trace.queries[0]!.analysis.tables).toEqual(["users"])
    expect(trace.queries[0]!.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("does not report the handshake or the driver's own housekeeping", async () => {
    await open()
    expect(getInspector().store.get("background")).toBeUndefined()
  })

  it("records a failed command with its error, and the call still rejects", async () => {
    const users = (await open()).db("app").collection("users")
    const trace = request("/bad")
    await expect(runInRequest(trace, () => users.find({ boom: 1 }).toArray())).rejects.toThrow("boom")
    expect(trace.queries[0]!.error).toContain("boom")
    expect(trace.queries[0]!.durationMs).not.toBeNull()
  })

  it("reports an N+1 of finds whose filter differs only by an id", async () => {
    const orders = (await open()).db("app").collection("orders")
    const trace = request("/n-plus-one")
    await runInRequest(trace, async () => {
      for (const customerId of [11, 12, 13, 14]) {
        await orders.find({ customerId }).toArray()
      }
    })
    const insight = buildReport(trace).insights.find(i => i.type === "n-plus-one")
    expect(insight?.params.sql).toBe(`orders.find {"filter":{"customerId":?}}`)
  })

  it("keeps the calls of overlapping requests with the request that made them", async () => {
    const coll = (await open()).db("app").collection("things")
    const a = request("/a")
    const b = request("/b")
    await Promise.all([
      runInRequest(a, async () => {
        await coll.find({ sleepMs: 40, tag: "a" }).toArray()
        await coll.find({ tag: "a2" }).toArray()
      }),
      runInRequest(b, async () => {
        await coll.find({ tag: "b" }).toArray()
        await coll.find({ tag: "b2" }).toArray()
      })
    ])
    expect(a.queries.map(q => q.sql.match(/"tag":"(\w+)"/)?.[1])).toEqual(["a", "a2"])
    expect(b.queries.map(q => q.sql.match(/"tag":"(\w+)"/)?.[1])).toEqual(["b", "b2"])
    expect(getInspector().store.get("background")).toBeUndefined()
  })

  it("keeps attribution when the connection pool is saturated and commands wait their turn", async () => {
    const client = new MongoClient("mongodb://mock:27017/?directConnection=true", { serverSelectionTimeoutMS: 3000, maxPoolSize: 1 })
    clients.push(client)
    await client.connect()
    const coll = client.db("app").collection("busy")
    const requests = ["/a", "/b", "/c", "/d"].map(request)
    await Promise.all(requests.map((trace, i) => runInRequest(trace, () => coll.find({ sleepMs: i % 2 === 0 ? 20 : 1, who: i }).toArray())))
    for (const [i, trace] of requests.entries()) {
      expect(trace.queries.map(q => q.sql.match(/"who":(\d)/)?.[1]), trace.url).toEqual([String(i)])
    }
    expect(getInspector().store.get("background")).toBeUndefined()
  })

  it("shows a transaction: the flag on its first command becomes a BEGIN, commit closes it", async () => {
    const client = await open()
    const coll = client.db("app").collection("accounts")
    const trace = request("/tx")
    await runInRequest(trace, async () => {
      const session = client.startSession()
      await session.withTransaction(async () => {
        await coll.insertOne({ n: 1 }, { session })
        await coll.updateOne({ n: 1 }, { $inc: { n: 1 } }, { session })
      })
      await session.endSession()
    })
    const labels = trace.queries.map(q => q.analysis.label)
    expect(labels).toEqual(["BEGIN", "INSERT", "UPDATE", "COMMITTRANSACTION"])
    const tree = buildReport(trace).tree
    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({ type: "transaction", status: "committed" })
  })

  it("watches a client that was never connected by hand: the driver connects on first use", async () => {
    const client = new MongoClient("mongodb://mock:27017/?directConnection=true", { serverSelectionTimeoutMS: 3000 })
    clients.push(client)
    const trace = request("/auto")
    await runInRequest(trace, () => client.db("app").collection("users").find({ auto: true }).toArray())
    expect(trace.queries.map(q => q.sql)).toEqual([`users.find {"filter":{"auto":true}}`])
  })

  it("only watches clients that connect while it is installed, and restores connect when removed", async () => {
    expect(MongoClient.prototype.connect).not.toBe(originalConnect)
    uninstall?.()
    uninstall = null
    expect(MongoClient.prototype.connect).toBe(originalConnect)
    const users = (await open()).db("app").collection("users")
    const trace = request("/after")
    await runInRequest(trace, () => users.find({}).toArray())
    expect(trace.queries).toHaveLength(0)
  })
})
