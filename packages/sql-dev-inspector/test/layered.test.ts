import { describe, expect, it } from "vitest"
import { runInOperation, runInRequest } from "../src/context"
import { exportJson, exportMarkdown } from "../src/export"
import { createRecorder } from "../src/recorder"
import { buildReport } from "../src/report"
import { analyzeSql } from "../src/sql-analyzer"
import { TraceStore } from "../src/store"
import { renderReport } from "../src/terminal"

function layered(redact: "off" | "all" = "off") {
  const store = new TraceStore({ maxRequests: 10, maxQueriesPerRequest: 100 })
  store.redact = redact
  const recorder = createRecorder(store)
  const trace = store.startRequest("GET", "/users")
  runInRequest(trace, () => {
    const outer = recorder.begin({ driver: "prisma", api: "findMany", text: "User.findMany {}", connectionId: 0, analysis: analyzeSql("select 1 from User") })!
    runInOperation(outer.event, () => {
      recorder.begin({ driver: "pg", api: "query", text: 'select "id" from "User" where "id" = 42', params: [42], connectionId: 3, analysis: analyzeSql('select "id" from "User" where "id" = 42', "postgres") })?.end({ rowCount: 1 })
    })
    outer.end({ rowCount: 1 })
  })
  store.finishRequest(trace, 200)
  return { store, trace }
}

describe("calls that are the work of a layered call", () => {
  it("are kept on the call, not counted, and keep their own timing and rows", () => {
    const { trace } = layered()
    expect(trace.queries).toHaveLength(1)
    expect(buildReport(trace).totals.queryCount).toBe(1)
    const [inner] = trace.queries[0]!.statements!
    expect(inner).toMatchObject({ driver: "pg", sql: 'select "id" from "User" where "id" = 42', rowCount: 1 })
    expect(inner!.durationMs).not.toBeNull()
  })

  it("follow the redaction mode like any call", () => {
    const params = layered("off").trace.queries[0]!.statements![0]!
    expect(params.params).toEqual([42])
    const masked = layered("all").trace.queries[0]!.statements![0]!
    expect(masked.sql).not.toContain("42")
  })

  it("are shown in the terminal, the Markdown and the JSON export", () => {
    const report = buildReport(layered().trace)
    // eslint-disable-next-line no-control-regex
    expect(renderReport(report).replace(/\u001B\[[0-9;]*m/g, "")).toContain('⇒ select "id" from "User" where "id" = 42')
    expect(exportMarkdown(report)).toContain("⇒ `select \"id\" from \"User\" where \"id\" = 42`")
    expect(exportJson(report).calls[0]!.sent).toEqual([expect.objectContaining({ driver: "pg", text: 'select "id" from "User" where "id" = 42', rows: 1 })])
  })

  it("do not leak into a call made after the layered one", () => {
    const { trace } = layered()
    const store = new TraceStore({ maxRequests: 10, maxQueriesPerRequest: 100 })
    const recorder = createRecorder(store)
    runInRequest(trace, () => recorder.begin({ driver: "pg", api: "query", text: "select 2", connectionId: 1, analysis: analyzeSql("select 2") })?.end())
    expect(trace.queries[0]!.statements).toHaveLength(1)
  })
})
