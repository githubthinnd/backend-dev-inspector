import { createRequire } from "node:module"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const load = createRequire(import.meta.url)
const inject = load("light-my-request") as (handler: unknown, options: { url: string, method?: string, headers?: Record<string, string>, payload?: unknown }) => Promise<{ statusCode: number, body: string, headers: Record<string, string> }>

// The inspector's own API, driven the way a browser or a script would, over requests a real app (Express + better-sqlite3 + the
// mock shop API) has just made: the features that were each tested alone are checked here against the same data.
let app: unknown
let inspector: typeof import("backend-dev-inspector")

const api = async (path: string, init: { method?: string, headers?: Record<string, string>, payload?: unknown } = {}) => {
  const response = await inject(app, { url: `/__sql-inspector${path}`, ...init })
  return { status: response.statusCode, text: response.body, json: () => JSON.parse(response.body) as unknown, headers: response.headers }
}

beforeAll(async () => {
  inspector = await import("backend-dev-inspector")
  app = (await import("../apps/express-sqlite/src/app.ts")).createApp()
  for (const path of ["/api/orders", "/api/orders/n-plus-one", "/api/orders/n-plus-one", "/api/orders/error"]) {
    await inject(app, { url: path })
  }
})
afterAll(() => {
  inspector.getInspector().store.clear()
})

type Row = { id: string, url: string, queryCount: number, warnings: number, errors: number }

describe("the inspector's API over real requests", () => {
  it("lists the requests, with their trace ids", async () => {
    const rows = (await api("/api/requests")).json() as Array<Row & { traceId: string }>
    expect(rows.map(r => r.url)).toEqual(expect.arrayContaining(["/api/orders", "/api/orders/n-plus-one", "/api/orders/error"]))
    expect(rows.every(r => /^[0-9a-f]{32}$/.test(r.traceId))).toBe(true)
  })

  it("adds the requests up by route, folding the repeated one", async () => {
    const overview = (await api("/api/overview")).json() as { requests: number, routes: Array<{ route: string, requests: number, issues: Record<string, number> }>, issues: Array<{ type: string }> }
    const loop = overview.routes.find(r => r.route === "GET /api/orders/n-plus-one")!
    expect(loop.requests).toBe(2)
    expect(loop.issues["n-plus-one"]).toBe(2)
    expect(overview.issues.map(i => i.type)).toContain("n-plus-one")
  })

  it("compares a healthy request with the loop, and finds the N+1 only in the loop", async () => {
    const rows = (await api("/api/requests")).json() as Row[]
    const healthy = rows.find(r => r.url === "/api/orders")!
    const loop = rows.find(r => r.url === "/api/orders/n-plus-one")!
    const diff = (await api(`/api/compare/${healthy.id}/${loop.id}`)).json() as { totals: { calls: { delta: number } }, findings: Array<{ type: string, a: number, b: number }> }
    expect(diff.totals.calls.delta).toBeGreaterThan(1)
    expect(diff.findings).toContainEqual({ type: "n-plus-one", a: 0, b: 1 })
  })

  it("exports one request as Markdown, JSON and OpenTelemetry, with the same calls in each", async () => {
    const loop = ((await api("/api/requests")).json() as Row[]).find(r => r.url === "/api/orders/n-plus-one")!
    const markdown = (await api(`/api/requests/${loop.id}/markdown`)).text
    const json = (await api(`/api/requests/${loop.id}/export`)).json() as { calls: unknown[], findings: Array<{ type: string, hint?: string }> }
    const otlp = (await api(`/api/requests/${loop.id}/otlp`)).json() as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ kind: number }> }> }> }
    expect(markdown).toContain("N+1")
    expect(json.calls).toHaveLength(loop.queryCount)
    expect(json.findings.some(f => f.type === "n-plus-one" && f.hint)).toBe(true)
    const spans = otlp.resourceSpans[0]!.scopeSpans[0]!.spans
    expect(spans.filter(s => s.kind === 3)).toHaveLength(loop.queryCount)
    expect(spans.filter(s => s.kind === 2)).toHaveLength(1)
  })

  it("saves the history and loads it back as requests that report the same findings", async () => {
    const saved = await api("/api/history")
    expect(saved.headers["content-disposition"]).toContain("inspector-history.json")
    // the calls outside any request (the app's start-up) are listed, but are not a request and are not saved
    const before = (await api("/api/requests")).json() as Row[]
    const requests = before.filter(r => r.id !== "background")
    const loaded = (await api("/api/history", { method: "POST", headers: { "content-type": "application/json" }, payload: saved.text })).json() as { loaded: number, total: number }
    expect(loaded.total).toBe(requests.length)
    expect(loaded.loaded).toBe(requests.length)
    const after = (await api("/api/requests")).json() as Row[]
    expect(after).toHaveLength(before.length + requests.length)
    const copy = after.filter(r => !before.some(b => b.id === r.id)).find(r => r.url === "/api/orders/n-plus-one")!
    const original = before.find(r => r.url === "/api/orders/n-plus-one")!
    expect([copy.queryCount, copy.warnings, copy.errors]).toEqual([original.queryCount, original.warnings, original.errors])
  })

  it("answers an MCP client about the same requests, and refuses a body that is not a history file", async () => {
    const reply = (await api("/mcp", { method: "POST", headers: { "content-type": "application/json" }, payload: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_overview", arguments: {} } } })).json() as { result: { content: Array<{ text: string }> } }
    expect(JSON.parse(reply.result.content[0]!.text).routes.length).toBeGreaterThan(0)
    expect((await api("/api/history", { method: "POST", headers: { "content-type": "application/json" }, payload: { hello: "world" } })).status).toBe(400)
  })
})
