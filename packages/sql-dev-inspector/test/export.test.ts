import { describe, expect, it } from "vitest"
import { runInRequest } from "../src/context"
import { exportMarkdown } from "../src/export"
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
