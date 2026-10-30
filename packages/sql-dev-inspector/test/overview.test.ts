import type { QueryEvent, RequestTrace } from "../src/types"
import { describe, expect, it } from "vitest"
import { buildReport } from "../src/report"
import { buildOverview, routeOf } from "../src/overview"
import { analyzeSql } from "../src/sql-analyzer"

let seq = 0
const call = (sql: string, startedAt: number, durationMs: number): QueryEvent => ({
  seq: seq++, requestId: "r", connectionId: 1, api: "q", sql, driver: "pg", params: null, startedAt, durationMs,
  rowCount: null, affectedRows: null, error: null, analysis: analyzeSql(sql, "postgres")
})
const report = (id: string, method: string, url: string, durationMs: number, queries: QueryEvent[]) =>
  buildReport({ id, method, url, status: 200, startedAt: 1000, durationMs, queries, droppedQueries: 0 } as RequestTrace)

describe("route of a request", () => {
  it("folds ids and drops the query string", () => {
    expect(routeOf("GET", "/api/orders/42?x=1")).toBe("GET /api/orders/:id")
    expect(routeOf("GET", "/u/3f2504e0-4f89-41d3-9a0c-0305e82c3301/posts")).toBe("GET /u/:id/posts")
    expect(routeOf("POST", "/")).toBe("POST /")
  })
})

describe("overview of the recent requests", () => {
  const loop = (n: number) => Array.from({ length: n }, (_, i) => call(`select * from items where order_id = ${i}`, 1000 + i, 4))
  const overview = buildOverview([
    report("a", "GET", "/api/orders/1", 100, loop(5)),
    report("b", "GET", "/api/orders/2", 300, loop(6)),
    report("c", "GET", "/api/health", 5, [call("select 1", 1000, 1)]),
    report("bg", "-", "(outside any request)", 0, [call("select 9", 1000, 1)])
  ].map((r, i) => i === 3 ? { ...r, trace: { ...r.trace, id: "background" } } : r))

  it("counts the requests, leaves the background out, and totals the calls", () => {
    expect(overview.requests).toBe(3)
    expect(overview.totals.calls).toBe(12)
  })

  it("lists the routes by what they cost in all, folding ids, with average, p95, calls and findings", () => {
    expect(overview.routes.map(r => r.route)).toEqual(["GET /api/orders/:id", "GET /api/health"])
    expect(overview.routes[0]).toMatchObject({ requests: 2, avgMs: 200, p95Ms: 300, maxMs: 300, avgCalls: 5.5, maxCalls: 6, worstId: "b" })
    expect(overview.routes[0]!.issues["n-plus-one"]).toBe(2)
  })

  it("lists the calls that cost the most in all, across routes, with values masked", () => {
    expect(overview.calls[0]).toMatchObject({ driver: "pg", count: 11, routes: 1 })
    expect(overview.calls[0]!.text).toContain("order_id = ?")
  })

  it("lists the findings that keep coming back", () => {
    expect(overview.issues[0]).toEqual({ type: "n-plus-one", requests: 2, routes: 1 })
  })

  it("is empty for no requests", () => {
    expect(buildOverview([])).toMatchObject({ requests: 0, from: null, routes: [], calls: [], issues: [] })
  })
})
