import type { Inspector } from "../src/runtime"
import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it } from "vitest"
import { handleInspectorRequest, SLOW_MS_RANGE } from "../src/inspector-server"
import { getInspector } from "../src/runtime"
import { analyzeSql } from "../src/sql-analyzer"
import type { StoreChange } from "../src/store"

class FakeRes {
  statusCode = 200
  body = ""
  writeHead(status: number) {
    this.statusCode = status
    return this
  }

  write(chunk: string) {
    this.body += chunk
    return true
  }

  end(chunk?: string) {
    this.body += chunk ?? ""
  }

  get json() {
    return JSON.parse(this.body)
  }
}

const settle = () => new Promise(resolve => setImmediate(resolve))
const inspector: Inspector = getInspector()

function get() {
  const req = Object.assign(new EventEmitter(), { url: "/__sql-inspector/api/settings", method: "GET", headers: {} })
  const res = new FakeRes()
  handleInspectorRequest(req as never, res as never, "/api/settings", inspector)
  return res
}

async function post(body: string, contentType = "application/json") {
  const req = Object.assign(new EventEmitter(), { url: "/__sql-inspector/api/settings", method: "POST", headers: { "content-type": contentType } })
  const res = new FakeRes()
  handleInspectorRequest(req as never, res as never, "/api/settings", inspector)
  req.emit("data", Buffer.from(body))
  req.emit("end")
  await settle()
  return res
}

afterEach(() => {
  inspector.report.slowMs = inspector.defaultSlowMs
})

describe("settings API", () => {
  it("reports the current threshold, the default and the allowed range", () => {
    expect(get().json).toEqual({ slowMs: inspector.defaultSlowMs, defaultSlowMs: inspector.defaultSlowMs, ...SLOW_MS_RANGE, brand: null })
  })

  it("changes the threshold for reports and tells every viewer", async () => {
    const changes: StoreChange[] = []
    const unsubscribe = inspector.store.subscribe(change => changes.push(change))

    const res = await post(JSON.stringify({ slowMs: 250 }))
    unsubscribe()

    expect(res.statusCode).toBe(200)
    expect(res.json.slowMs).toBe(250)
    expect(inspector.report.slowMs).toBe(250)
    expect(get().json.slowMs).toBe(250)
    expect(changes).toContainEqual({ type: "settings" })
  })

  it("goes back to the default on null", async () => {
    await post(JSON.stringify({ slowMs: 250 }))
    const res = await post(JSON.stringify({ slowMs: null }))
    expect(res.json.slowMs).toBe(inspector.defaultSlowMs)
    expect(inspector.report.slowMs).toBe(inspector.defaultSlowMs)
  })

  it.each([
    ["zero", { slowMs: 0 }],
    ["a fraction", { slowMs: 1.5 }],
    ["above the range", { slowMs: SLOW_MS_RANGE.max + 1 }],
    ["a string", { slowMs: "50" }],
    ["a missing field", {}]
  ])("rejects %s and keeps the current value", async (_name, body) => {
    const res = await post(JSON.stringify(body))
    expect(res.statusCode).toBe(400)
    expect(inspector.report.slowMs).toBe(inspector.defaultSlowMs)
  })

  it("rejects broken JSON and a non-JSON content type", async () => {
    expect((await post("{nope")).statusCode).toBe(400)
    expect((await post(JSON.stringify({ slowMs: 50 }), "text/plain")).statusCode).toBe(415)
    expect(inspector.report.slowMs).toBe(inspector.defaultSlowMs)
  })
})

describe("request list counts", () => {
  it("counts a failed statement as an error only, not also as a warning", () => {
    const trace = inspector.store.startRequest("GET", "/counts")
    const failing = {
      seq: 9001,
      requestId: trace.id,
      connectionId: 1,
      api: "query" as const,
      sql: "select boom",
      params: null,
      startedAt: Date.now(),
      durationMs: 1,
      rowCount: null,
      affectedRows: null,
      error: "boom",
      analysis: analyzeSql("select boom")
    }
    inspector.store.record(trace, failing)

    const req = Object.assign(new EventEmitter(), { url: "/__sql-inspector/api/requests", method: "GET", headers: {} })
    const res = new FakeRes()
    handleInspectorRequest(req as never, res as never, "/api/requests", inspector)
    const row = (res.json as { id: string, warnings: number, errors: number }[]).find(r => r.id === trace.id)

    expect(row).toMatchObject({ errors: 1, warnings: 0 })
    inspector.store.clear()
  })
})
