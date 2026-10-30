import type { Inspector } from "../src/runtime"
import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it } from "vitest"
import { handleInspectorRequest, SLOW_MS_RANGE } from "../src/inspector-server"
import { getInspector, setBudgets } from "../src/runtime"
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
  inspector.redact = inspector.defaults.redact
  inspector.store.redact = inspector.defaults.redact
  inspector.filters.include = [...inspector.defaults.filters.include]
  inspector.filters.exclude = [...inspector.defaults.filters.exclude]
  setBudgets(inspector, inspector.defaults.budgets)
  inspector.stack = inspector.defaults.stack
  inspector.logs = inspector.defaults.logs
  inspector.store.captureCaller = inspector.defaults.stack
  inspector.editor = { ...inspector.defaults.editor }
})

describe("settings API", () => {
  it("reports the current threshold, the default and the allowed range", () => {
    expect(get().json).toEqual({
      slowMs: inspector.defaultSlowMs,
      defaultSlowMs: inspector.defaultSlowMs,
      ...SLOW_MS_RANGE,
      brand: null,
      redact: "params",
      include: [],
      exclude: [],
      budgets: [],
      stack: true,
      logs: false,
      drivers: expect.any(Array),
      editor: { name: "vscode", template: "vscode://file/{path}:{line}:{column}" },
      root: expect.any(String),
      defaults: { budgets: [], redact: "params", include: [], exclude: [], stack: true, logs: false, editor: "vscode" },
      mount: "__sql-inspector"
    })
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

  describe("hiding values and choosing the requests to follow", () => {
    it("changes how values are hidden, for the recorder too, and tells every viewer", async () => {
      const changes: StoreChange[] = []
      const stop = inspector.store.subscribe(change => changes.push(change))
      const res = await post(JSON.stringify({ redact: "all" }))
      stop()
      expect(res.statusCode).toBe(200)
      expect(res.json.redact).toBe("all")
      expect(inspector.store.redact).toBe("all")
      expect(changes).toContainEqual({ type: "settings" })
    })

    it("sets the routes to include and exclude, normalising them, and null goes back to the defaults", async () => {
      const set = await post(JSON.stringify({ include: ["api/**", " /health "], exclude: ["/api/webhooks/**"] }))
      expect(set.json).toMatchObject({ include: ["/api/**", "/health"], exclude: ["/api/webhooks/**"] })
      expect(inspector.filters).toEqual({ include: ["/api/**", "/health"], exclude: ["/api/webhooks/**"] })

      const reset = await post(JSON.stringify({ include: null, exclude: null, redact: null }))
      expect(reset.json).toMatchObject({ include: [], exclude: [], redact: "params" })
    })

    it("sets budgets, refuses ones it cannot read, and null goes back to the defaults", async () => {
      const set = await post(JSON.stringify({ budgets: ["/api/**=calls:20,ms:300", " GET api/orders = calls:5 "] }))
      expect(set.json).toMatchObject({ budgets: ["/api/**=calls:20,ms:300", "GET api/orders = calls:5"] })
      expect(inspector.report.budgets).toEqual([
        { method: null, route: "/api/**", calls: 20, ms: 300, callMs: null },
        { method: "GET", route: "/api/orders", calls: 5, ms: null, callMs: null }
      ])
      expect((await post(JSON.stringify({ budgets: ["/api/**=speed:3"] }))).statusCode).toBe(400)
      expect((await post(JSON.stringify({ budgets: "/api/**=calls:3" }))).statusCode).toBe(400)
      expect((await post(JSON.stringify({ budgets: null }))).json).toMatchObject({ budgets: [] })
      expect(inspector.report.budgets).toEqual([])
    })

    it("changes one setting without touching the others", async () => {
      await post(JSON.stringify({ slowMs: 250 }))
      await post(JSON.stringify({ redact: "off" }))
      expect(get().json).toMatchObject({ slowMs: 250, redact: "off" })
    })

    it("refuses what it does not understand", async () => {
      for (const body of [
        { redact: "everything" }, { redact: 5 }, { include: "/api/**" }, { include: [1] },
        { exclude: ["a".repeat(201)] }, { include: Array.from({ length: 51 }, () => "/x") }, { exclude: ["/a\nb"] },
        {}, { unknown: true }, []
      ]) {
        expect((await post(JSON.stringify(body))).statusCode, JSON.stringify(body).slice(0, 40)).toBe(400)
      }
      expect(inspector.redact).toBe("params")
      expect(inspector.filters).toEqual({ include: [], exclude: [] })
    })
  })

  describe("listing console output", () => {
    it("switches it on and off, and null goes back to off", async () => {
      expect((await post(JSON.stringify({ logs: true }))).json.logs).toBe(true)
      expect(inspector.logs).toBe(true)
      expect((await post(JSON.stringify({ logs: null }))).json.logs).toBe(false)
      expect((await post(JSON.stringify({ logs: "yes" }))).statusCode).toBe(400)
    })
  })

  describe("finding the calling line", () => {
    it("switches the search for the calling line on and off, for the recorder too", async () => {
      const off = await post(JSON.stringify({ stack: false }))
      expect(off.json.stack).toBe(false)
      expect(inspector.store.captureCaller).toBe(false)
      expect((await post(JSON.stringify({ stack: null }))).json.stack).toBe(true)
      expect(inspector.store.captureCaller).toBe(true)
    })

    it("chooses the editor by name or by a link template of a known editor, and refuses others", async () => {
      expect((await post(JSON.stringify({ editor: "cursor" }))).json.editor).toEqual({ name: "cursor", template: "cursor://file/{path}:{line}:{column}" })
      expect((await post(JSON.stringify({ editor: "idea://open?file={file}&line={line}" }))).json.editor.name).toBe("custom")
      // a scheme that is not an editor's falls back to the default; it is never turned into a link
      expect((await post(JSON.stringify({ editor: "javascript://{file}" }))).json.editor.name).toBe("vscode")
      expect((await post(JSON.stringify({ editor: 5 }))).statusCode).toBe(400)
      expect((await post(JSON.stringify({ editor: null }))).json.editor.name).toBe("vscode")
    })
  })
})
