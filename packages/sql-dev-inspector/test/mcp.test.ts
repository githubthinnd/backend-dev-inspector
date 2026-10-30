import type { IncomingMessage } from "node:http"
import { EventEmitter } from "node:events"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { runInRequest } from "../src/context"
import { handleInspectorRequest } from "../src/inspector-server"
import { createRecorder } from "../src/recorder"
import { getInspector } from "../src/runtime"
import { resetInspectorForTests, startInspector } from "../src/setup"
import { analyzeSql } from "../src/sql-analyzer"

class FakeRes {
  statusCode = 200
  headers: Record<string, string> = {}
  body = ""
  writeHead(status: number, headers: Record<string, string> = {}) {
    this.statusCode = status
    this.headers = headers
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

async function rpc(message: unknown, method = "POST", headers: Record<string, string> = { "content-type": "application/json" }) {
  const req = Object.assign(new EventEmitter(), { url: "/__sql-inspector/mcp", method, headers: { host: "localhost:3000", ...headers } }) as unknown as IncomingMessage
  const res = new FakeRes()
  handleInspectorRequest(req, res as never, "/mcp", getInspector())
  req.emit("data", Buffer.from(typeof message === "string" ? message : JSON.stringify(message)))
  req.emit("end")
  await settle()
  return res
}
const call = (name: string, args: object = {}, id = 1) => rpc({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })
const payload = (res: FakeRes) => JSON.parse(res.json.result.content[0].text)

function record(url: string, calls: string[]) {
  const store = getInspector().store
  const trace = store.startRequest("GET", url)
  runInRequest(trace, () => calls.forEach((text) => {
    createRecorder(store).begin({ driver: "mysql2", api: "query", text, connectionId: 1, analysis: analyzeSql(text) })?.end({ rowCount: 1 })
  }))
  store.finishRequest(trace, 200)
  return trace
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development")
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("sqlDevInspector.runtime")]
  resetInspectorForTests()
  vi.spyOn(console, "log").mockImplementation(() => {})
  startInspector({ NODE_ENV: "development", SQL_INSPECTOR_LOG: "0", SQL_INSPECTOR_NOTICE: "0" }, { drivers: [] })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe("MCP over HTTP", () => {
  it("answers initialize with the protocol the client asked for, and a notification with 202", async () => {
    const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test" } } })
    expect(init.json.result).toMatchObject({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "dev-inspector" } })
    expect((await rpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } })).json.result.protocolVersion).toBe("2025-06-18")
    const note = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })
    expect(note.statusCode).toBe(202)
    expect(note.body).toBe("")
  })

  it("lists five read-only tools, each with a description and an input schema", async () => {
    const { result } = (await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" })).json
    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual(["list_requests", "get_request", "compare_requests", "get_overview", "find_problems", "get_settings", "diagnose"])
    for (const tool of result.tools) {
      expect(tool.description.length).toBeGreaterThan(20)
      expect(tool.inputSchema.type).toBe("object")
    }
  })

  it("lists the requests, newest first, only those with issues on request", async () => {
    record("/api/a", ["select 1 from a"])
    record("/api/loop", [1, 2, 3, 4].map(i => `select * from users where id = ${i}`))
    const all = payload(await call("list_requests"))
    expect(all.map((row: { url: string }) => row.url)).toEqual(["/api/loop", "/api/a"])
    expect(all[0]).toMatchObject({ method: "GET", status: 200, calls: 4, warnings: 1, errors: 0 })
    const issues = payload(await call("list_requests", { onlyIssues: true, limit: 5 }))
    expect(issues.map((row: { url: string }) => row.url)).toEqual(["/api/loop"])
  })

  it("returns one request in full: calls, insights with advice and the line that made them", async () => {
    getInspector().store.captureCaller = true
    const trace = record("/api/loop", [1, 2, 3].map(i => `select * from users where id = ${i}`))
    const detail = payload(await call("get_request", { id: trace.id }))
    expect(detail.statements).toHaveLength(3)
    expect(detail.statements[0]).toMatchObject({ driver: "mysql2", call: "query", rows: 1 })
    expect(detail.statements[0].calledFrom).toMatch(/mcp\.test\.ts:\d+$/)
    const nPlusOne = detail.insights.find((insight: { type: string }) => insight.type === "n-plus-one")
    expect(nPlusOne.hint).toContain("join")
    expect(nPlusOne.calledFrom).toMatch(/mcp\.test\.ts/)
  })

  it("answers for a request that is gone, as a tool error with a way forward", async () => {
    const res = await call("get_request", { id: "nope" })
    expect(res.json.result.isError).toBe(true)
    expect(payload(res).error).toContain("list_requests")
  })

  it("finds the problems across requests, errors first, grouped by route", async () => {
    record("/api/loop?page=1", [1, 2, 3].map(i => `select * from users where id = ${i}`))
    record("/api/loop?page=2", [1, 2, 3].map(i => `select * from users where id = ${i}`))
    const store = getInspector().store
    const trace = store.startRequest("GET", "/api/broken")
    runInRequest(trace, () => createRecorder(store).begin({ driver: "mysql2", api: "query", text: "select boom", connectionId: 1, analysis: analyzeSql("select boom") })?.end({ error: new Error("syntax error") }))
    const problems = payload(await call("find_problems"))
    expect(problems[0]).toMatchObject({ route: "GET /api/broken", type: "error", severity: "error" })
    expect(problems.find((p: { type: string }) => p.type === "n-plus-one")).toMatchObject({ route: "GET /api/loop", requests: 2 })
  })

  it("says so when there is nothing wrong, and describes the setup and the doctor", async () => {
    record("/api/a", ["select 1 from a"])
    expect(payload(await call("find_problems")).message).toContain("No warnings")
    expect(payload(await call("get_settings"))).toMatchObject({ redact: "params", page: "/__sql-inspector/", findCallingLine: true })
    expect(payload(await call("diagnose")).checks.length).toBeGreaterThan(1)
  })

  it("handles a batch, an unknown method and tool, and bad input", async () => {
    const batch = await rpc([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", id: 2, method: "tools/list" }])
    expect(batch.json).toHaveLength(2)
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "resources/list" })).json.error.code).toBe(-32601)
    expect((await call("delete_everything")).json.error.code).toBe(-32602)
    expect((await rpc({ nope: true })).json.error.code).toBe(-32600)
    const garbage = await rpc("{not json")
    expect(garbage.statusCode).toBe(400)
    expect(garbage.json.error.code).toBe(-32700)
  })

  it("takes only POST, and only from a local host", async () => {
    expect((await rpc("", "GET")).statusCode).toBe(405)
    const rebinding = await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, "POST", { "content-type": "application/json", "host": "evil.example.com" })
    expect(rebinding.statusCode).toBe(403)
  })

  it("has no tool that changes anything", async () => {
    const { result } = (await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" })).json
    expect(JSON.stringify(result.tools)).not.toMatch(/clear|delete|set_|update|write|execute/i)
  })
})

describe("a batch with a bad item", () => {
  it("answers the good items and reports the bad one, instead of failing the whole batch", async () => {
    const batch = await rpc([null, 5, [], { jsonrpc: "2.0", id: 7, method: "ping" }])
    expect(batch.json).toEqual([
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } },
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } },
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } },
      { jsonrpc: "2.0", id: 7, result: {} }
    ])
  })
})

describe("the tools that read a request", () => {
  beforeEach(() => {
    startInspector({ NODE_ENV: "development", SQL_INSPECTOR_LOG: "0", SQL_INSPECTOR_NOTICE: "0" }, { drivers: [] })
  })
  afterEach(() => {
    getInspector().store.clear()
    resetInspectorForTests()
  })

  it("compare_requests says what changed between two requests, and refuses an id that is gone", async () => {
    const store = getInspector().store
    const make = (url: string, calls: number) => {
      const trace = store.startRequest("GET", url)
      runInRequest(trace, () => {
        for (let i = 0; i < calls; i++) {
          createRecorder(store).begin({ driver: "t", api: "q", text: `select * from t where id = ${i}`, connectionId: 1, analysis: analyzeSql(`select * from t where id = ${i}`) })?.end()
        }
      })
      store.finishRequest(trace, 200)
      return trace
    }
    const before = make("/a", 5)
    const after = make("/a", 1)
    const answer = payload(await call("compare_requests", { before: before.id, after: after.id }))
    expect(answer.totals.calls).toEqual({ a: 5, b: 1, delta: -4 })
    expect(answer.findings.some((f: { type: string }) => f.type === "n-plus-one")).toBe(true)
    const missing = await call("compare_requests", { before: before.id, after: "nope" })
    expect(missing.json.result.isError).toBe(true)
    expect((await call("compare_requests", {})).json.result.isError).toBe(true)
  })

  it("get_request carries the trace id, the details of a call and what a library sent for it", async () => {
    const store = getInspector().store
    const trace = store.startRequest("GET", "/layered", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
    const { runInOperation } = await import("../src/context")
    runInRequest(trace, () => {
      const rec = createRecorder(store)
      const outer = rec.begin({ driver: "prisma", api: "findMany", text: "User.findMany {}", connectionId: 0, analysis: analyzeSql("select 1 from User") })!
      runInOperation(outer.event, () => rec.begin({ driver: "pg", api: "q", text: "select 1", connectionId: 1, analysis: analyzeSql("select 1") })?.end())
      outer.end({ details: { status: 200 } })
    })
    store.finishRequest(trace, 200)
    const answer = payload(await call("get_request", { id: trace.id }))
    expect(answer).toMatchObject({ traceId: "4bf92f3577b34da6a3ce929d0e0e4736", parentSpanId: "00f067aa0ba902b7" })
    expect(answer.statements[0]).toMatchObject({ details: { status: 200 }, sentToDatabase: [{ sql: "select 1" }] })
    expect(answer.totals.breakdown.total).toBeGreaterThanOrEqual(0)
  })

  it("get_overview and get_settings answer", async () => {
    expect(payload(await call("get_overview")).requests).toBe(0)
    expect(payload(await call("get_settings"))).toMatchObject({ page: "/__sql-inspector/" })
  })
})
