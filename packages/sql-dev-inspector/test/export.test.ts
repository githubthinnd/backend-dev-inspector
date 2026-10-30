import { describe, expect, it } from "vitest"
import { runInRequest } from "../src/context"
import { exportJson, exportMarkdown } from "../src/export"
import { createRecorder } from "../src/recorder"
import { buildReport } from "../src/report"
import { analyzeSql } from "../src/sql-analyzer"
import { TraceStore } from "../src/store"

function sample() {
  const store = new TraceStore({ maxRequests: 10, maxQueriesPerRequest: 100 })
  store.captureCaller = true
  const trace = store.startRequest("GET", "/api/orders?page=2")
  runInRequest(trace, () => {
    for (const id of [1, 2, 3, 4]) {
      const text = `select * from items where order_id = ${id}`
      createRecorder(store).begin({ driver: "pg", api: "query", text, connectionId: 1, analysis: analyzeSql(text) })?.end({ rowCount: 2 })
    }
    createRecorder(store).begin({ driver: "pg", api: "query", text: "select a | b from t", connectionId: 1, analysis: analyzeSql("select 1") })?.end({ error: new Error("bad | pipe") })
  })
  trace.logs = [{ level: "warn", at: trace.startedAt + 12, message: "slow cache\nsecond line" }]
  store.finishRequest(trace, 200)
  return trace
}

describe("a request as Markdown", () => {
  const markdown = exportMarkdown(buildReport(sample()), process.cwd())

  it("starts with the request and its totals", () => {
    expect(markdown).toMatch(/^## GET \/api\/orders\?page=2 → 200\n\n5 calls,/)
  })

  it("lists the findings with where they were called from and how to fix them", () => {
    expect(markdown).toContain("### Findings")
    expect(markdown).toMatch(/\*\*N\+1 queries\*\*: .*\(from `test\/export\.test\.ts:\d+`\)/)
    expect(markdown).toContain("How to fix:")
  })

  it("has a table of the calls, with errors, and nothing that breaks the table", () => {
    expect(markdown).toContain("| # | Driver | Call | ms | Rows | From |")
    expect(markdown).toContain("| 1 | pg | select * from items where order_id = 1 |")
    expect(markdown).toContain("select a \\| b from t ✖ bad \\| pipe")
    expect(markdown).toMatch(/test\/export\.test\.ts:\d+ \|/)
  })

  it("includes the console output and the tree, as plain text", () => {
    expect(markdown).toContain("[warn] +12ms slow cache")
    expect(markdown).not.toContain("second line")
    expect(markdown).toContain("### Tree")
    // eslint-disable-next-line no-control-regex
    expect(markdown).not.toMatch(/\u001B\[/)
  })
})

describe("a request as JSON", () => {
  const doc = exportJson(buildReport(sample()), { root: process.cwd(), redact: "params", now: new Date("2026-01-02T03:04:05Z") })

  it("is a versioned document that says how it was redacted", () => {
    expect(doc).toMatchObject({ format: "sql-dev-inspector/request", version: 1, exportedAt: "2026-01-02T03:04:05.000Z", redact: "params" })
    expect(doc.request).toMatchObject({ method: "GET", url: "/api/orders?page=2", status: 200 })
  })

  it("has every call with its timing, tables and where it was made", () => {
    expect(doc.calls).toHaveLength(5)
    expect(doc.calls[0]).toMatchObject({ driver: "pg", kind: "select", tables: ["items"], rows: 2, error: null })
    expect(doc.calls[0]!.from).toMatch(/^test\/export\.test\.ts:\d+$/)
    expect(doc.calls[4]!.error).toBe("bad | pipe")
  })

  it("has the findings with their calls and advice, the totals and the console", () => {
    expect(doc.findings[0]).toMatchObject({ type: "n-plus-one", severity: "warn" })
    expect(doc.findings[0]!.calls).toHaveLength(4)
    expect(doc.findings[0]!.hint).toBeTruthy()
    expect(doc.totals.breakdown.total).toBeGreaterThanOrEqual(0)
    expect(doc.console).toEqual([{ level: "warn", atMs: 12, message: "slow cache\nsecond line" }])
  })

  it("survives JSON.stringify and parse unchanged", () => {
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc)
  })
})
