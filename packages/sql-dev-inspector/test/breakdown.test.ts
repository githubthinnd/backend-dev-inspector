import type { QueryEvent, RequestTrace } from "../src/types"
import { describe, expect, it } from "vitest"
import { exportMarkdown } from "../src/export"
import { buildReport } from "../src/report"
import { analyzeSql } from "../src/sql-analyzer"

let seq = 0
const call = (driver: string, startedAt: number, durationMs: number | null, sql = "select 1"): QueryEvent => ({
  seq: seq++, requestId: "r", connectionId: 1, api: "q", sql, driver, params: null, startedAt, durationMs,
  rowCount: null, affectedRows: null, error: null, analysis: analyzeSql(sql)
})
const trace = (queries: QueryEvent[], durationMs: number | null = 100): RequestTrace =>
  ({ id: "r", method: "GET", url: "/x", status: 200, startedAt: 1000, durationMs, queries, droppedQueries: 0 })

describe("time breakdown", () => {
  it("splits a request into database, cache, HTTP and what is left", () => {
    const { breakdown } = buildReport(trace([call("pg", 1000, 20), call("redis", 1020, 5), call("http", 1030, 40), call("mysql2", 1075, 10)])).totals
    expect(breakdown).toEqual({ database: 30, cache: 5, http: 40, app: 25, total: 100 })
  })

  it("counts calls that ran at the same time once", () => {
    const { breakdown } = buildReport(trace([call("pg", 1000, 50), call("pg", 1010, 20), call("pg", 1040, 30)])).totals
    expect(breakdown.database).toBe(70)
    expect(breakdown.app).toBe(30)
  })

  it("never lets the application part go negative, and treats an unfinished call as running until now", () => {
    expect(buildReport(trace([call("pg", 1000, 500)], 100)).totals.breakdown.app).toBe(0)
    const open = buildReport(trace([call("pg", Date.now() - 50, null)], null)).totals.breakdown
    expect(open.database).toBeGreaterThanOrEqual(50)
  })

  it("is part of the Markdown export", () => {
    const markdown = exportMarkdown(buildReport(trace([call("pg", 1000, 20), call("http", 1020, 30)])))
    expect(markdown).toContain("Time: database 20 ms (20%), outbound HTTP 30 ms (30%), application and waiting 50 ms (50%).")
  })
})
