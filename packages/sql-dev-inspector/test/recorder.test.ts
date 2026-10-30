import { describe, expect, it } from "vitest"
import { describeOperation, genericFingerprint } from "../src/analysis"
import { bindToRequest, currentTrace, runInRequest } from "../src/context"
import { createRecorder } from "../src/recorder"
import { buildReport } from "../src/report"
import { analyzeSql } from "../src/sql-analyzer"
import { TraceStore } from "../src/store"

function setup() {
  const store = new TraceStore({ maxRequests: 50, maxQueriesPerRequest: 500 })
  return { store, recorder: createRecorder(store) }
}

const start = (text: string, extra = {}) => ({ driver: "test", api: "run", text, connectionId: 1, analysis: analyzeSql(text), ...extra })

describe("recorder", () => {
  it("attaches a call to the request it runs in, and times it", () => {
    const { store, recorder } = setup()
    const trace = store.startRequest("GET", "/x")
    const handle = runInRequest(trace, () => recorder.begin(start("select 1", { params: [1] })))!

    expect(trace.queries).toEqual([handle.event])
    expect(handle.event).toMatchObject({ driver: "test", api: "run", sql: "select 1", params: [1], requestId: trace.id, durationMs: null })

    handle.end({ rowCount: 3 })
    expect(handle.event).toMatchObject({ rowCount: 3, error: null })
    expect(handle.event.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("gathers calls outside any request under the background trace", () => {
    const { store, recorder } = setup()
    recorder.begin(start("select 1"))
    expect(store.get("background")?.queries).toHaveLength(1)
  })

  it("keeps the first outcome only, and maps errors to their message", () => {
    const { store, recorder } = setup()
    const trace = store.startRequest("GET", "/x")
    const failed = runInRequest(trace, () => recorder.begin(start("select 1")))!
    failed.end({ error: new Error("boom") })
    failed.end({ error: undefined, rowCount: 9 })
    expect(failed.event).toMatchObject({ error: "boom", rowCount: null })

    const text = runInRequest(trace, () => recorder.begin(start("select 2")))!
    text.end({ error: "plain" })
    expect(text.event.error).toBe("plain")
  })

  it("announces changes so the UI and terminal refresh", () => {
    const { store, recorder } = setup()
    const changes: string[] = []
    store.subscribe(change => changes.push(change.type))
    const trace = store.startRequest("GET", "/x")
    runInRequest(trace, () => recorder.begin(start("select 1"))!.end())
    expect(changes).toEqual(["query", "query"])
  })

  it("numbers calls in order, across recorders", () => {
    const { recorder } = setup()
    const other = createRecorder(new TraceStore({ maxRequests: 5, maxQueriesPerRequest: 5 }))
    const seqs = [recorder, other, recorder].map(r => r.begin(start("select 1"))!.event.seq)
    expect(seqs[1]).toBe(seqs[0]! + 1)
    expect(seqs[2]).toBe(seqs[1]! + 1)
  })
})

describe("request context", () => {
  it("follows awaits, and bindToRequest keeps a callback with the request that asked", async () => {
    const { store } = setup()
    const a = store.startRequest("GET", "/a")
    const b = store.startRequest("GET", "/b")
    let later: (() => string | undefined) | undefined

    runInRequest(a, () => {
      later = bindToRequest(() => currentTrace()?.url)
    })
    const seen = await runInRequest(b, async () => {
      await Promise.resolve()
      return later!()
    })
    expect(seen).toBe("/a")
    expect(currentTrace()).toBeUndefined()
  })
})

describe("calls that are not SQL", () => {
  it("masks ids, numbers and JSON values into one fingerprint", () => {
    expect(genericFingerprint("GET user:42")).toBe("GET user:?")
    expect(genericFingerprint("GET https://api.test/users/550e8400-e29b-41d4-a716-446655440000/orders?page=2")).toBe("GET https://api.test/users/?/orders?page=?")
    expect(genericFingerprint(`users.find {"email":"a@b.c","age":{"$gt":18}}`)).toBe(`users.find {"email":"?","age":{"$gt":?}}`)
    expect(genericFingerprint("orders.findOne 507f1f77bcf86cd799439011")).toBe("orders.findOne ?")
  })

  it("describes a call as the SQL statement it resembles, with its own label", () => {
    expect(describeOperation({ kind: "select", label: "GET", targets: ["user:1"], text: "GET user:1" })).toEqual({
      kind: "select", label: "GET", tables: ["user:1"], subqueryDepth: 0, subqueryCount: 0, fingerprint: "GET user:?", selectStar: false, savepoint: null
    })
  })

  it("is judged by the usual insights: N+1, repeats and slow calls", () => {
    const { store, recorder } = setup()
    const trace = store.startRequest("GET", "/x")
    runInRequest(trace, () => {
      for (const id of [1, 2, 3]) {
        recorder.begin({ driver: "redis", api: "get", text: `GET user:${id}`, connectionId: 0, analysis: describeOperation({ kind: "select", label: "GET", text: `GET user:${id}` }) })!.end()
      }
      const slow = recorder.begin({ driver: "http", api: "GET", text: "GET https://api.test/slow", connectionId: 0, analysis: describeOperation({ kind: "select", label: "HTTP GET", text: "GET https://api.test/slow" }) })!
      slow.end()
      slow.event.durationMs = 500
    })
    const report = buildReport(trace)
    expect(report.insights.map(i => i.type).sort()).toEqual(["n-plus-one", "slow"])
  })
})

describe("a callback handed to a pool", () => {
  it("keeps the request and the layered call it was made in: binding restores the whole async context, not one store", async () => {
    const { currentOperation, runInOperation } = await import("../src/context")
    const store = new TraceStore({ maxRequests: 5, maxQueriesPerRequest: 10 })
    const trace = store.startRequest("GET", "/pool")
    const operation = { seq: 1 } as never
    let bound!: () => { trace: unknown, operation: unknown }
    runInRequest(trace, () => runInOperation(operation, () => {
      bound = bindToRequest(() => ({ trace: currentTrace(), operation: currentOperation() }))
    }))
    // run later, from outside both scopes, as a pool does
    expect(currentTrace()).toBeUndefined()
    expect(bound()).toEqual({ trace, operation })
  })
})
