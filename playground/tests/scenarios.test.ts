import { afterEach, describe, expect, it } from "vitest"
import { buildReport, getInspector, resetInspectorForTests, type InsightType } from "backend-dev-inspector"
import { scenarios } from "@playground/shared"
import { stacks } from "./stacks.ts"

const store = () => getInspector().store

/** The insights the inspector reported for the one request that was made to `path`. */
function insightsFor(path: string): InsightType[] {
  const trace = store().list().find(candidate => candidate.url === path)
  expect(trace, `the inspector recorded a request for ${path}`).toBeDefined()
  return buildReport(trace!).insights.map(insight => insight.type)
}

const queryCount = (path: string) => buildReport(store().list().find(candidate => candidate.url === path)!).totals.queryCount

afterEach(() => {
  store().clear()
  resetInspectorForTests()
})

describe.each(stacks)("$name", ({ boot, sqlTransactions, available }) => {
  const run = available?.() === false ? it.skip : it

  run("serves the home page and a request without a database call", async () => {
    const get = await boot()
    const home = await get("/")
    expect(home.status).toBe(200)
    expect(home.body).toContain("/assets/app.js")
    expect((await get("/api/health")).status).toBe(200)
  })

  run("serves the inspector itself", async () => {
    const get = await boot()
    const page = await get("/__sql-inspector/")
    expect(page.status).toBe(200)
    expect(page.body.toLowerCase()).toContain("<html")
  })

  run("a healthy request runs one query and raises no warning", async () => {
    const get = await boot()
    expect((await get("/api/orders")).status).toBe(200)
    expect(queryCount("/api/orders")).toBe(1)
    expect(insightsFor("/api/orders")).not.toContain("n-plus-one")
    expect(insightsFor("/api/orders")).not.toContain("slow")
    expect(insightsFor("/api/orders")).not.toContain("error")
  })

  run("reports the N+1 loop", async () => {
    const get = await boot()
    expect((await get("/api/orders/n-plus-one")).status).toBe(200)
    expect(insightsFor("/api/orders/n-plus-one")).toContain("n-plus-one")
    expect(queryCount("/api/orders/n-plus-one")).toBe(11)
  })

  run("reports the slow query", async () => {
    const get = await boot()
    expect((await get("/api/orders/slow")).status).toBe(200)
    expect(insightsFor("/api/orders/slow")).toContain("slow")
  })

  run("reports the failing query", async () => {
    const get = await boot()
    const response = await get("/api/orders/error")
    expect(response.status).toBe(500)
    expect(response.body).toMatch(/foreign key/i)
    expect(insightsFor("/api/orders/error")).toContain("error")
  })

  run("shows the transaction with its rolled-back savepoint", async () => {
    const get = await boot()
    expect((await get("/api/orders/transaction")).status).toBe(200)
    const trace = store().list().find(candidate => candidate.url === "/api/orders/transaction")!
    const statements = trace.queries.map(query => query.analysis.kind)
    if (sqlTransactions) {
      expect(statements).toContain("tx-commit")
      expect(statements).toContain("savepoint")
      expect(statements).toContain("savepoint-rollback")
    } else {
      // Prisma shows the operations of the transaction: the order, its item, and the item that failed.
      expect(statements.filter(kind => kind === "insert")).toHaveLength(3)
      expect(trace.queries.filter(query => query.error)).toHaveLength(1)
    }
  })
})

describe("the scenario list", () => {
  it("is the one the pages and the tests use", () => {
    expect(scenarios.map(scenario => scenario.id)).toEqual(["orders", "n-plus-one", "slow", "error", "transaction", "external"])
  })
})
