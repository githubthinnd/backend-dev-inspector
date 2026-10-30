import type { IncomingMessage, ServerResponse } from "node:http"
import { EventEmitter } from "node:events"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { currentTrace } from "../src/context"
import { createRecorder } from "../src/recorder"
import { isTracked, matchRoute, parsePatterns } from "../src/route-filter"
import { createWebInspector } from "../src/web"
import { createSqlInspector } from "../src/node"
import { getInspector } from "../src/runtime"
import { resetInspectorForTests } from "../src/setup"
import { analyzeSql } from "../src/sql-analyzer"

describe("route patterns", () => {
  it.each([
    ["/api/orders", "/api/orders", true],
    ["/api/orders", "/api/orders/", true],
    ["/api/orders", "/api/orders/1", false],
    ["/api/orders", "/api/orders?x=1", true],
    ["/api/*", "/api/orders", true],
    ["/api/*", "/api/orders/1", false],
    ["/api/*", "/api", false],
    ["/api/**", "/api", true],
    ["/api/**", "/api/orders/1/items", true],
    ["/api/**", "/other", false],
    ["/api/**/items", "/api/items", true],
    ["/api/**/items", "/api/a/b/items", true],
    ["/api/**/items", "/api/a/b", false],
    ["/*-webhook", "/stripe-webhook", true],
    ["/*-webhook", "/stripe", false],
    ["/api/v*/users", "/api/v2/users", true],
    ["/api/v*/users", "/api/x2/users", false],
    ["/a*b*c", "/aXXbYYc", true],
    ["/a*b*c", "/aXXcYYb", false],
    ["/**", "/anything/at/all", true]
  ])("%s on %s → %s", (pattern, path, expected) => {
    expect(matchRoute(pattern, path)).toBe(expected)
  })

  it("parses a list, adding the leading slash and dropping blanks", () => {
    expect(parsePatterns("/api/**, health , ,/x")).toEqual(["/api/**", "/health", "/x"])
    expect(parsePatterns(["api/**"])).toEqual(["/api/**"])
    expect(parsePatterns(undefined)).toEqual([])
  })

  it("include keeps only what matches, exclude removes from that", () => {
    const filters = { include: ["/api/**"], exclude: ["/api/webhooks/**"] }
    expect(isTracked(filters, "/api/orders?id=1")).toBe(true)
    expect(isTracked(filters, "/api/webhooks/stripe")).toBe(false)
    expect(isTracked(filters, "/pages/home")).toBe(false)
    expect(isTracked({ include: [], exclude: [] }, "/anything")).toBe(true)
    expect(isTracked({ include: [], exclude: ["/health"] }, "/health")).toBe(false)
  })
})

class FakeRes extends EventEmitter {
  statusCode = 200
  writeHead() { return this }
  write() { return true }
  end() {}
}
const request = (url: string) => ({ req: Object.assign(new EventEmitter(), { url, method: "GET" }) as unknown as IncomingMessage, res: new FakeRes() as unknown as ServerResponse })
const call = (inspector: { store: ReturnType<typeof getInspector>["store"] }, text = "select 1") =>
  createRecorder(inspector.store).begin({ driver: "test", api: "run", text, connectionId: 1, analysis: analyzeSql(text) })

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development")
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("sqlDevInspector.runtime")]
  resetInspectorForTests()
  vi.spyOn(console, "log").mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe("a request the filters leave out", () => {
  it("is not traced, and its calls are dropped instead of landing under 'outside any request'", () => {
    const inspector = createSqlInspector({ include: ["/api/**"], exclude: ["/api/webhooks/**"] })
    const store = getInspector().store

    const { req, res } = request("/api/orders")
    inspector.track(req, res, () => void call(getInspector()))
    const skipped = request("/api/webhooks/stripe")
    inspector.track(skipped.req, skipped.res, () => {
      expect(currentTrace()?.id).toBe("ignored")
      expect(call(getInspector())).toBeNull()
    })
    const outside = request("/pages/home")
    inspector.track(outside.req, outside.res, () => void call(getInspector()))

    expect(store.list().map(trace => trace.url)).toEqual(["/api/orders"])
    expect(store.list().some(trace => trace.id === "background")).toBe(false)
  })

  it("is taken from SQL_INSPECTOR_INCLUDE / SQL_INSPECTOR_EXCLUDE too", () => {
    vi.stubEnv("SQL_INSPECTOR_EXCLUDE", "/health,/assets/**")
    const inspector = createSqlInspector()
    for (const url of ["/health", "/assets/app.js", "/api/x"]) {
      const { req, res } = request(url)
      inspector.track(req, res, () => void call(getInspector()))
    }
    expect(getInspector().store.list().map(trace => trace.url)).toEqual(["/api/x"])
  })

  it("applies to web-standard requests", async () => {
    const web = createWebInspector({ exclude: ["/health"] })
    await web.track(new Request("http://localhost/health"), () => { call(getInspector()); return new Response("ok") })
    await web.track(new Request("http://localhost/api/x?y=1"), () => { call(getInspector()); return new Response("ok") })
    expect(getInspector().store.list().map(trace => trace.url)).toEqual(["/api/x?y=1"])
  })

  it("never applies to tasks", async () => {
    const inspector = createSqlInspector({ include: ["/api/**"] })
    await inspector.task("nightly", async () => { call(getInspector()) })
    expect(getInspector().store.list().map(trace => trace.url)).toEqual(["nightly"])
  })
})
