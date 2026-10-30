import { describe, expect, it } from "vitest"
import { runInOperation, runInRequest } from "../src/context"
import { exportHistory, HISTORY_FORMAT, importHistory } from "../src/history"
import { createRecorder } from "../src/recorder"
import { buildReport } from "../src/report"
import { analyzeSql } from "../src/sql-analyzer"
import { TraceStore } from "../src/store"

function recorded() {
  const store = new TraceStore({ maxRequests: 10, maxQueriesPerRequest: 100 })
  store.captureCaller = true
  const rec = createRecorder(store)
  for (const url of ["/a", "/b"]) {
    const trace = store.startRequest("GET", url)
    runInRequest(trace, () => {
      for (const id of [1, 2, 3]) {
        rec.begin({ driver: "pg", api: "query", text: `select * from t where id = ${id}`, params: [id], connectionId: 1, analysis: analyzeSql(`select * from t where id = ${id}`) })?.end({ rowCount: 1 })
      }
    })
    store.finishRequest(trace, 200)
  }
  return store
}

describe("history file", () => {
  it("saves the requests oldest first, in a named and versioned format", () => {
    const file = exportHistory(recorded().list(), new Date("2026-01-02T00:00:00Z"))
    expect(file).toMatchObject({ format: HISTORY_FORMAT, version: 1, savedAt: "2026-01-02T00:00:00.000Z" })
    expect(file.requests.map(r => r.url)).toEqual(["/a", "/b"])
  })

  it("loads back into requests that report the same findings, under new ids", () => {
    const original = recorded().list()
    const back = importHistory(JSON.parse(JSON.stringify(exportHistory(original))))!
    expect(back.map(t => t.url)).toEqual(["/a", "/b"])
    expect(back.every(t => !original.some(o => o.id === t.id))).toBe(true)
    expect(back[0]!.queries[0]!.requestId).toBe(back[0]!.id)
    expect(buildReport(back[0]!).insights.map(i => i.type)).toEqual(buildReport(original.at(-1)!).insights.map(i => i.type))
    expect(back[0]!.queries[0]!.caller?.file).toMatch(/history\.test\.ts$/)
  })

  it("refuses what is not a history file", () => {
    for (const bad of [null, [], "x", {}, { format: HISTORY_FORMAT }, { format: HISTORY_FORMAT, version: 2, requests: [] }, { format: "other", version: 1, requests: [] }]) {
      expect(importHistory(bad), JSON.stringify(bad)).toBeNull()
    }
  })

  it("keeps only known fields with checked types and sizes, and drops what is not a request or a call", () => {
    const back = importHistory({
      format: HISTORY_FORMAT, version: 1,
      requests: [
        "junk", { queries: "no" },
        { id: "mine", method: 5, url: "x".repeat(5000), status: "200", __proto__: { evil: 1 }, polluted: true, traceId: "zz", queries: [{ sql: "select 1", seq: 1, evil: "<script>", durationMs: "slow", analysis: { kind: 9 } }, { nope: 1 }, "x"] }
      ]
    })!
    expect(back).toHaveLength(1)
    const [trace] = back
    expect(trace).toMatchObject({ method: "GET", status: null })
    expect(trace!.id).not.toBe("mine")
    expect(trace!.url).toHaveLength(2000)
    expect(trace).not.toHaveProperty("polluted")
    expect(trace).not.toHaveProperty("traceId")
    expect(trace!.queries).toHaveLength(1)
    expect(trace!.queries[0]).toMatchObject({ sql: "select 1", durationMs: null })
    expect(trace!.queries[0]).not.toHaveProperty("evil")
    expect(trace!.queries[0]!.analysis.kind).toBe("select")
  })

  it("keeps what a library ran for a call, and the mode the request was recorded under, with seqs that never clash", () => {
    const store = new TraceStore({ maxRequests: 10, maxQueriesPerRequest: 100 })
    store.redact = "params"
    const rec = createRecorder(store)
    const trace = store.startRequest("GET", "/layered")
    runInRequest(trace, () => {
      const outer = rec.begin({ driver: "prisma", api: "findMany", text: "User.findMany {}", connectionId: 0, analysis: analyzeSql("select 1 from User") })!
      runInOperation(outer.event, () => {
        rec.begin({ driver: "pg", api: "query", text: "select 1", connectionId: 1, analysis: analyzeSql("select 1") })?.end()
        rec.begin({ driver: "pg", api: "query", text: "select 2", connectionId: 1, analysis: analyzeSql("select 2") })?.end()
      })
      outer.end()
    })
    const [back] = importHistory(JSON.parse(JSON.stringify(exportHistory([trace]))))!
    expect(back!.redact).toBe("params")
    expect(back!.queries[0]!.statements!.map(s => s.sql)).toEqual(["select 1", "select 2"])
    const seqs = [...back!.queries, ...back!.queries.flatMap(q => q.statements ?? [])].map(q => q.seq)
    expect(new Set(seqs).size).toBe(seqs.length)
  })

  it("is not expired like a live request: a file saved days ago still opens, even with a short expiry", () => {
    const store = new TraceStore({ maxRequests: 10, maxQueriesPerRequest: 100, maxAgeMs: 60_000 })
    const old = importHistory({ format: HISTORY_FORMAT, version: 1, requests: [{ method: "GET", url: "/old", startedAt: Date.now() - 3 * 24 * 3600_000, queries: [{ sql: "select 1", startedAt: Date.now() - 3 * 24 * 3600_000 }] }] })!
    store.load(old)
    expect(store.list().map(t => t.url)).toEqual(["/old"])
    expect(store.get(old[0]!.id)).toBeDefined()
  })

  it("adds to the store, and the ring still drops the oldest", () => {
    const store = new TraceStore({ maxRequests: 3, maxQueriesPerRequest: 100 })
    const back = importHistory(exportHistory(recorded().list()))!
    store.load(back)
    store.load(importHistory(exportHistory(recorded().list()))!)
    expect(store.list()).toHaveLength(3)
  })
})

describe("loading more than the ring holds", () => {
  it("says how many are in the store now", () => {
    const store = new TraceStore({ maxRequests: 1, maxQueriesPerRequest: 10 })
    const back = importHistory(exportHistory(recorded().list()))!
    expect(back).toHaveLength(2)
    expect(store.load(back)).toBe(1)
    expect(store.list()).toHaveLength(1)
  })
})
