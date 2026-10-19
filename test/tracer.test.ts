import { eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/mysql2"
import { int, mysqlTable, varchar } from "drizzle-orm/mysql-core"
import { createPool, type Pool } from "mysql2/promise"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildReport, DEFAULT_REPORT_OPTIONS } from "../src/report"
import { TraceStore } from "../src/store"
import { installTracer, runInRequest } from "../src/tracer"
import { type MockServer, startMockMysql } from "./mock-mysql-server"

const users = mysqlTable("users", { id: int("id"), name: varchar("name", { length: 255 }) })

let server: MockServer
let pool: Pool
const makeDb = (p: Pool) => drizzle(p, { mode: "default" })
let db: ReturnType<typeof makeDb>
let store: TraceStore
let uninstall: () => void

beforeAll(() => {
  server = startMockMysql()
})
afterAll(() => server.close())

beforeEach(() => {
  store = new TraceStore({ maxRequests: 50, maxQueriesPerRequest: 500 })
  uninstall = installTracer(store)
  pool = createPool({ stream: server.stream, connectionLimit: 3 })
  db = makeDb(pool)
  server.statements.length = 0
})
afterEach(async () => {
  uninstall()
  await pool.end()
})

function inRequest<T>(url: string, fn: () => Promise<T>) {
  const trace = store.startRequest("GET", url)
  // `await` inside the scope: a Drizzle builder is lazy and only runs its query when awaited.
  return runInRequest(trace, async () => await fn()).then(result => ({ trace, result }))
}

describe("tracer against the real mysql2 client and Drizzle", () => {
  it("records a Drizzle select with its SQL, timing and row count", async () => {
    const { trace, result } = await inRequest("/a", () => db.select().from(users).where(sqlId(1)))

    expect(result).toHaveLength(2)
    expect(trace.queries).toHaveLength(1)
    const [query] = trace.queries
    expect(query!.sql).toMatch(/^select `id`, `name` from `users` where/i)
    expect(query!.analysis.kind).toBe("select")
    expect(query!.analysis.tables).toEqual(["users"])
    expect(query!.rowCount).toBe(2)
    expect(query!.durationMs).toBeGreaterThanOrEqual(0)
    expect(query!.error).toBeNull()
    expect(store.list()).toEqual([trace])
  })

  it("does not change what the query returns or sends", async () => {
    await inRequest("/a", () => db.insert(users).values({ id: 9, name: "zed" }))
    expect(server.statements).toEqual(["insert into `users` (`id`, `name`) values (9, 'zed')"])
  })

  it("nests statements under a transaction, and a savepoint under its parent", async () => {
    const { trace } = await inRequest("/tx", () =>
      db.transaction(async (tx) => {
        await tx.insert(users).values({ id: 1, name: "a" })
        await tx.transaction(async (inner) => {
          await inner.insert(users).values({ id: 2, name: "b" })
        })
        await tx.select().from(users)
      }))

    const report = buildReport(trace)
    expect(report.tree).toHaveLength(1)
    const [transaction] = report.tree
    expect(transaction).toMatchObject({ type: "transaction", status: "committed" })
    if (transaction!.type === "query") {
      throw new Error("expected a transaction node")
    }
    const kinds = transaction!.children.map(c => c.type === "query" ? c.query.analysis.kind : c.type)
    expect(kinds).toEqual(["insert", "savepoint", "select"])
    const savepoint = transaction!.children[1]
    expect(savepoint).toMatchObject({ type: "savepoint", name: "sp1", status: "committed" })
    expect(buildReport(trace, { ...DEFAULT_REPORT_OPTIONS, transactionConvention: true }).insights.map(i => i.type)).toContain("select-in-transaction")
  })

  it("marks a rolled-back transaction", async () => {
    const { trace } = await inRequest("/rb", () =>
      db.transaction(async (tx) => {
        await tx.insert(users).values({ id: 1, name: "a" })
        throw new Error("abort")
      }).catch(() => undefined))
    expect(buildReport(trace).tree[0]).toMatchObject({ type: "transaction", status: "rolled-back" })
  })

  it("keeps two transactions of one request apart when they overlap", async () => {
    const { trace } = await inRequest("/par", () => Promise.all([
      db.transaction(async (tx) => {
        await tx.execute(sqlText("select sleep(30) as a"))
        await tx.insert(users).values({ id: 1, name: "a" })
      }),
      db.transaction(async (tx) => {
        await tx.insert(users).values({ id: 2, name: "b" })
        await tx.execute(sqlText("select sleep(30) as b"))
      })
    ]))

    const roots = buildReport(trace).tree
    expect(roots).toHaveLength(2)
    for (const root of roots) {
      expect(root.type).toBe("transaction")
      if (root.type !== "query") {
        expect(root.children).toHaveLength(2)
        expect(new Set(root.children.map(c => c.type === "query" ? c.query.connectionId : -1))).toEqual(new Set([root.connectionId]))
      }
    }
    expect(roots[0]!.type === "transaction" && roots[1]!.type === "transaction" && roots[0]!.connectionId !== roots[1]!.connectionId).toBe(true)
  })

  it("attributes concurrent requests to their own trace, even when the pool queues statements", async () => {
    // 3 connections, 8 requests x 2 statements: most statements wait for a free connection,
    // which is the case where a callback runs from another request's async context.
    const runs = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      inRequest(`/r${i}`, async () => {
        await db.execute(sqlText(`select sleep(${5 + i}) as first_${i}`))
        await db.execute(sqlText(`select ${i} as second_${i}`))
      })))

    for (const [i, { trace }] of runs.entries()) {
      expect(trace.queries.map(q => q.sql)).toEqual([`select sleep(${5 + i}) as first_${i}`, `select ${i} as second_${i}`])
    }
    expect(store.list()).toHaveLength(8)
    expect(store.get("background")).toBeUndefined()
  })

  it("collects statements issued outside any request in the background trace", async () => {
    await db.select().from(users)
    expect(store.get("background")?.queries).toHaveLength(1)
  })

  it("records a failing statement and still rejects the caller", async () => {
    const { trace } = await inRequest("/err", () => db.execute(sqlText("select boom")).catch((e: Error) => e))
    expect(trace.queries[0]!.error).toMatch(/boom/)
    expect(buildReport(trace).insights.map(i => i.type)).toContain("error")
  })

  it("flags an N+1 loop and a repeated identical query", async () => {
    const { trace } = await inRequest("/n1", async () => {
      for (const id of [1, 2, 3, 4]) {
        await db.select().from(users).where(sqlId(id))
      }
      await db.select().from(users)
      await db.select().from(users)
    })
    const insights = buildReport(trace).insights
    expect(insights.find(i => i.type === "n-plus-one")).toMatchObject({ seqs: expect.arrayContaining([expect.any(Number)]) })
    expect(insights.find(i => i.type === "n-plus-one")!.params).toMatchObject({ count: 4 })
    expect(insights.find(i => i.type === "duplicate")!.params).toMatchObject({ count: 2 })
  })

  it("restores the original methods on uninstall and never stacks wrappers", async () => {
    const second = installTracer(store)
    await inRequest("/x", () => db.select().from(users))
    expect(store.list()[0]!.queries).toHaveLength(1)
    second()
    uninstall()
    await inRequest("/y", () => db.select().from(users))
    expect(store.list()).toHaveLength(1)
  })
})

function sqlId(id: number) {
  return eq(users.id, id)
}

const sqlText = (text: string) => sql.raw(text)
