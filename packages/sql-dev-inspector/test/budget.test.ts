import type { QueryEvent, RequestTrace } from "../src/types"
import { describe, expect, it } from "vitest"
import { budgetFor, parseBudget, parseBudgets } from "../src/budget"
import { buildReport, DEFAULT_REPORT_OPTIONS } from "../src/report"
import { analyzeSql } from "../src/sql-analyzer"

describe("parsing budgets", () => {
  it("reads a route, an optional method and the limits", () => {
    expect(parseBudget("/api/**=calls:20,ms:300,callMs:80")).toEqual({ method: null, route: "/api/**", calls: 20, ms: 300, callMs: 80 })
    expect(parseBudget("get api/orders = Calls: 5")).toEqual({ method: "GET", route: "/api/orders", calls: 5, ms: null, callMs: null })
  })

  it("refuses what it cannot read", () => {
    for (const bad of ["", "/api", "/api=", "/api=calls", "/api=calls:x", "/api=calls:-1", "/api=speed:3", "GET POST /api=calls:1", "=calls:1", `/${"a".repeat(300)}=calls:1`]) {
      expect(parseBudget(bad), bad).toBeNull()
    }
  })

  it("takes several, from a string or a list, and drops the bad ones", () => {
    expect(parseBudgets("/a=calls:1; nope; /b=ms:5")).toHaveLength(2)
    expect(parseBudgets(["/a=calls:1;/b=ms:5", "bad"])).toHaveLength(2)
    expect(parseBudgets(undefined)).toEqual([])
  })

  it("applies the first budget that matches the method and the path", () => {
    const budgets = parseBudgets("POST /api/orders=calls:1; /api/**=calls:9")
    expect(budgetFor(budgets, "POST", "/api/orders?x=1")?.calls).toBe(1)
    expect(budgetFor(budgets, "GET", "/api/orders")?.calls).toBe(9)
    expect(budgetFor(budgets, "GET", "/home")).toBeUndefined()
  })
})

let seq = 0
const call = (startedAt: number, durationMs: number): QueryEvent => ({
  seq: seq++, requestId: "r", connectionId: 1, api: "q", sql: `select ${seq} from t`, driver: "pg", params: null, startedAt, durationMs,
  rowCount: null, affectedRows: null, error: null, analysis: analyzeSql("select 1 from t")
})
const reportFor = (budget: string, calls: number, each: number, total: number, url = "/api/orders") =>
  buildReport({ id: "r", method: "GET", url, status: 200, startedAt: 1000, durationMs: total, queries: Array.from({ length: calls }, (_, i) => call(1000 + i * 10, each)), droppedQueries: 0 } as RequestTrace, { ...DEFAULT_REPORT_OPTIONS, budgets: parseBudgets(budget) })

describe("a request against its budget", () => {
  it("stays quiet within the budget", () => {
    const { insights } = reportFor("/api/**=calls:5,ms:100,callMs:50", 2, 5, 40)
    expect(insights.filter(i => i.type.startsWith("budget"))).toEqual([])
  })

  it("warns for each limit that is passed, with the route, the limit and the actual value", () => {
    const { insights } = reportFor("GET /api/**=calls:2,ms:30,callMs:10", 4, 6, 80)
    const budget = insights.filter(i => i.type.startsWith("budget"))
    expect(budget.map(i => i.type)).toEqual(["budget-calls", "budget-time", "budget-call-time"])
    expect(budget[0]).toMatchObject({ severity: "warn", params: { route: "GET /api/**", max: "2", actual: "4" } })
    expect(budget[0]!.message).toBe("GET /api/** may make 2 calls; this request made 4")
    expect(budget[0]!.hint).toBeTruthy()
  })

  it("ignores requests of other routes", () => {
    expect(reportFor("/api/orders=calls:1", 5, 1, 10, "/health").insights.some(i => i.type.startsWith("budget"))).toBe(false)
  })
})
