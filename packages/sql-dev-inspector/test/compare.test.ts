import type { QueryEvent, RequestTrace } from "../src/types"
import { describe, expect, it } from "vitest"
import { compareReports } from "../src/compare"
import { buildReport } from "../src/report"
import { analyzeSql } from "../src/sql-analyzer"

let seq = 0
const call = (sql: string, startedAt: number, durationMs: number, driver = "pg"): QueryEvent => ({
  seq: seq++, requestId: "r", connectionId: 1, api: "q", sql, driver, params: null, startedAt, durationMs,
  rowCount: null, affectedRows: null, error: null, analysis: analyzeSql(sql, "postgres")
})
const report = (id: string, durationMs: number, queries: QueryEvent[]) =>
  buildReport({ id, method: "GET", url: "/orders", status: 200, startedAt: 1000, durationMs, queries, droppedQueries: 0 } as RequestTrace)

const before = report("a", 120, [
  ...[1, 2, 3, 4, 5].map(i => call(`select * from items where order_id = ${i}`, 1000 + i, 4)),
  call("select * from orders", 1050, 30),
  call("select * from legacy", 1090, 2)
])
const after = report("b", 45, [
  call("select * from items where order_id in (1, 2, 3, 4, 5)", 1000, 6),
  call("select * from orders", 1010, 31),
  call("select * from cache_warm", 1040, 1)
])

describe("comparing two requests", () => {
  const diff = compareReports(before, after)

  it("says which is faster and by how much in all", () => {
    expect(diff.verdict).toBe("faster")
    expect(diff.totals.totalMs).toEqual({ a: 120, b: 45, delta: -75 })
    expect(diff.totals.calls).toEqual({ a: 7, b: 3, delta: -4 })
  })

  it("matches calls by what they are, not by order, and masks values so the same call with other values is one", () => {
    const loop = diff.groups.find(g => g.text.includes("order_id = ?"))
    expect(loop).toMatchObject({ change: "removed", count: { a: 5, b: 0, delta: -5 } })
    expect(diff.groups.find(g => g.text.includes("cache_warm"))?.change).toBe("added")
    expect(diff.groups.find(g => g.text.includes("legacy"))?.change).toBe("removed")
    // `select * from orders` ran once in both, in about the same time: not listed
    expect(diff.groups.some(g => g.text.includes("from orders"))).toBe(false)
  })

  it("lists the biggest change first", () => {
    expect(diff.groups[0]!.text).toContain("order_id = ?")
  })

  it("reports a repeated call, a slower call, and the warnings that went away", () => {
    const more = compareReports(report("c", 50, [call("select 1", 1000, 5)]), report("d", 50, [call("select 1", 1000, 5), call("select 1", 1010, 5)]))
    expect(more.groups[0]).toMatchObject({ change: "more", count: { a: 1, b: 2 } })
    const slower = compareReports(report("e", 50, [call("select 1", 1000, 5)]), report("f", 80, [call("select 1", 1000, 40)]))
    expect(slower.groups[0]).toMatchObject({ change: "slower" })
    expect(slower.verdict).toBe("slower")
    expect(diff.findings).toContainEqual({ type: "n-plus-one", a: 1, b: 0 })
  })

  it("calls two alike requests the same", () => {
    expect(compareReports(before, before)).toMatchObject({ verdict: "same", groups: [], findings: [] })
  })
})
