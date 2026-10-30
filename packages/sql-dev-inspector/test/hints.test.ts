import { describe, expect, it } from "vitest"
import { describeOperation } from "../src/analysis"
import { runInRequest } from "../src/context"
import { createRecorder } from "../src/recorder"
import { buildReport, hintKey } from "../src/report"
import { analyzeSql } from "../src/sql-analyzer"
import { TraceStore } from "../src/store"
import { renderReport } from "../src/terminal"
import { MESSAGES } from "../src/i18n"

function report(driver: string, calls: string[], options: { slowMs?: number } = {}) {
  const store = new TraceStore({ maxRequests: 10, maxQueriesPerRequest: 50 })
  const trace = store.startRequest("GET", "/x")
  runInRequest(trace, () => calls.forEach((text) => {
    const analysis = driver === "redis" || driver === "http" || driver === "mongodb"
      ? describeOperation({ kind: "select", label: driver.toUpperCase(), text })
      : analyzeSql(text)
    createRecorder(store).begin({ driver, api: "q", text, connectionId: 1, analysis })?.end()
  }))
  return buildReport(trace, options.slowMs ? { ...{ slowMs: 100, nPlusOneThreshold: 3, manyQueriesThreshold: 30, transactionConvention: false, locale: "en" as const }, slowMs: options.slowMs } : undefined)
}

describe("advice on insights", () => {
  it("an N+1 over SQL says to load them together, and names the ORM options", () => {
    const insight = buildReport(report("pg", [1, 2, 3, 4].map(i => `select * from users where id = ${i}`)).trace).insights.find(i => i.type === "n-plus-one")!
    expect(insight.hint).toContain("join")
    expect(insight.hint).toContain("Prisma")
    expect(insight.params.family).toBe("sql")
  })

  it("the advice depends on what was called: Redis, MongoDB and HTTP each get their own", () => {
    const redis = report("redis", [1, 2, 3].map(i => `GET user:${i}`)).insights.find(i => i.type === "n-plus-one")!
    expect(redis.hint).toContain("MGET")
    const mongo = report("mongodb", [1, 2, 3].map(i => `users.find {"id":${i}}`)).insights.find(i => i.type === "n-plus-one")!
    expect(mongo.hint).toContain("$in")
    const http = report("http", [1, 2, 3].map(i => `GET https://api.example.com/users/${i}`)).insights.find(i => i.type === "n-plus-one")!
    expect(http.hint).toContain("batch")
  })

  it("a duplicate says to run it once, and an error has no general advice", () => {
    const duplicate = report("pg", ["select 1", "select 1"]).insights.find(i => i.type === "duplicate")!
    expect(duplicate.hint).toContain("once")
    const failing = report("pg", ["select * from users where"]).insights
    expect(failing.every(i => i.type !== "error" || i.hint === undefined)).toBe(true)
  })

  it("falls back to the general advice when a kind of call has none of its own", () => {
    expect(hintKey("slow", "sql")).toBe("insight.hint.slow")
    expect(hintKey("slow", "http")).toBe("insight.hint.slow.http")
    expect(hintKey("error", "sql")).toBeNull()
  })

  it("is printed under the warning in the terminal", () => {
    const text = renderReport(report("pg", [1, 2, 3].map(i => `select * from t where id = ${i}`)))
    expect(text).toContain("How to fix:")
  })

  it("exists in every language", () => {
    for (const locale of ["vi", "ja"] as const) {
      expect(MESSAGES[locale]["insight.hint.n-plus-one"]).toBeTruthy()
      expect(MESSAGES[locale]["hint.title"]).toBeTruthy()
    }
  })
})
