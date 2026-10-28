import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createRequire } from "node:module"
import { createRecorder, getInspector, type RequestTrace, resetInspectorForTests, runInRequest, startInspector } from "sql-dev-inspector"
import { pgDriver } from "../src/drivers/pg"
import { startMockPostgres, type MockPostgres } from "./helpers/mock-postgres"

const pg = createRequire(import.meta.url)("pg") as typeof import("pg")
const originalQuery = pg.Client.prototype.query

let server: MockPostgres
let uninstall: (() => void) | null = null
let clients: import("pg").Client[] = []

const connect = async (extra: object = {}) => {
  const client = new pg.Client({ host: "mock", user: "u", database: "d", stream: server.stream as never, ...extra })
  clients.push(client)
  await client.connect()
  return client
}
const request = (url: string): RequestTrace => getInspector().store.startRequest("GET", url)
const calls = (trace: RequestTrace) => trace.queries.map(q => ({ sql: q.sql, api: q.api, rowCount: q.rowCount, affectedRows: q.affectedRows, error: q.error, driver: q.driver }))

beforeEach(() => {
  server = startMockPostgres()
  startInspector({ NODE_ENV: "development", SQL_INSPECTOR_LOG: "0", SQL_INSPECTOR_NOTICE: "0" }, { drivers: [] })
  uninstall = pgDriver.install(recorder())
})
afterEach(async () => {
  await Promise.all(clients.map(client => client.end().catch(() => {})))
  clients = []
  uninstall?.()
  getInspector().store.clear()
  resetInspectorForTests()
})

const recorder = () => createRecorder(getInspector().store)

describe("pg driver", () => {
  it("is installed, and does nothing for an application without pg", () => {
    expect(uninstall).toBeTypeOf("function")
    expect(pgDriver.name).toBe("pg")
  })

  it("records a text query: sql, driver, timing and rows, attached to the request", async () => {
    const client = await connect()
    const trace = request("/users")
    const result = await runInRequest(trace, () => client.query("select id, name from users"))

    expect(result.rows).toHaveLength(2)
    expect(calls(trace)).toEqual([{ sql: "select id, name from users", api: "query", rowCount: 2, affectedRows: null, error: null, driver: "pg" }])
    expect(trace.queries[0]!.durationMs).toBeGreaterThanOrEqual(0)
    expect(trace.queries[0]!.analysis).toMatchObject({ kind: "select", tables: ["users"] })
    expect(trace.queries[0]!.connectionId).toBe(server.processIds[0])
  })

  it("records parameterised queries (extended protocol) with their values", async () => {
    const client = await connect()
    const trace = request("/user")
    await runInRequest(trace, () => client.query("select id, name from users where id = $1", [7]))
    await runInRequest(trace, () => client.query({ text: "insert into users (name) values ($1)", values: ["ann"], name: "ins" }))

    expect(calls(trace)).toEqual([
      { sql: "select id, name from users where id = $1", api: "query", rowCount: 2, affectedRows: null, error: null, driver: "pg" },
      { sql: "insert into users (name) values ($1)", api: "query", rowCount: null, affectedRows: 1, error: null, driver: "pg" }
    ])
    expect(trace.queries[0]!.params).toEqual([7])
    expect(trace.queries[1]!.params).toEqual(["ann"])
    expect(server.statements).toEqual(["select id, name from users where id = $1", "insert into users (name) values ($1)"])
  })

  it("records the error of a failed query and still rejects", async () => {
    const client = await connect()
    const trace = request("/bad")
    await expect(runInRequest(trace, () => client.query("select boom"))).rejects.toThrow("syntax error")
    expect(trace.queries[0]!.error).toContain("syntax error")
    expect(trace.queries[0]!.durationMs).not.toBeNull()
  })

  it("supports the callback style, and gives the callback its result untouched", async () => {
    const client = await connect()
    const trace = request("/cb")
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      runInRequest(trace, () => client.query("select id, name from users", (error, result) => (error ? reject(error) : resolve(result.rows))))
    })
    expect(rows).toHaveLength(2)
    expect(trace.queries[0]).toMatchObject({ rowCount: 2, error: null })

    const failing = request("/cb-bad")
    await new Promise<void>((resolve) => {
      runInRequest(failing, () => client.query("select boom", error => resolve(void expect(error?.message).toContain("syntax"))))
    })
    expect(failing.queries[0]!.error).toContain("syntax")
  })

  it("builds the transaction tree from begin / savepoint / commit on one connection", async () => {
    const client = await connect()
    const trace = request("/tx")
    await runInRequest(trace, async () => {
      await client.query("BEGIN")
      await client.query("insert into t values (1)")
      await client.query("SAVEPOINT sp1")
      await client.query("insert into t values (2)")
      await client.query("ROLLBACK TO SAVEPOINT sp1")
      await client.query("COMMIT")
    })
    const { buildReport } = await import("sql-dev-inspector")
    const tree = buildReport(trace).tree
    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({ type: "transaction", status: "committed" })
    const children = (tree[0] as { children: { type: string, status?: string }[] }).children
    expect(children.map(c => c.type)).toEqual(["query", "savepoint"])
    expect(children[1]).toMatchObject({ status: "rolled-back" })
  })

  it("keeps two transactions on two connections apart, with their own ids", async () => {
    const a = await connect()
    const b = await connect()
    expect(server.processIds).toHaveLength(2)
    const trace = request("/two")
    await runInRequest(trace, () => Promise.all([
      (async () => {
        await a.query("BEGIN")
        await a.query("select sleep(20)")
        await a.query("COMMIT")
      })(),
      (async () => {
        await b.query("BEGIN")
        await b.query("insert into t values (1)")
        await b.query("COMMIT")
      })()
    ]))
    const { buildReport } = await import("sql-dev-inspector")
    const transactions = buildReport(trace).tree
    expect(transactions).toHaveLength(2)
    expect(new Set(trace.queries.map(q => q.connectionId))).toEqual(new Set(server.processIds))
  })

  it("flags an N+1 over pg like it does over mysql", async () => {
    const client = await connect()
    const trace = request("/n-plus-one")
    await runInRequest(trace, async () => {
      for (const id of [1, 2, 3]) {
        await client.query("select id, name from users where id = $1", [id])
      }
    })
    const { buildReport } = await import("sql-dev-inspector")
    expect(buildReport(trace).insights.map(i => i.type)).toEqual(["n-plus-one"])
  })

  it("attributes statements to the right request through a busy pool", async () => {
    const pool = new pg.Pool({ host: "mock", user: "u", database: "d", stream: server.stream as never, max: 1 } as never)
    const requests = ["/a", "/b", "/c", "/d"].map(request)
    await Promise.all(requests.map((trace, i) => runInRequest(trace, () => pool.query(`select ${i} as n, sleep(${i % 2 === 0 ? 15 : 1})`))))
    await pool.end()

    for (const [i, trace] of requests.entries()) {
      expect(trace.queries.map(q => q.sql), trace.url).toEqual([`select ${i} as n, sleep(${i % 2 === 0 ? 15 : 1})`])
    }
    expect(getInspector().store.get("background")).toBeUndefined()
  })

  it("restores pg when uninstalled, and reinstalling does not stack a second wrapper", () => {
    expect(pg.Client.prototype.query).not.toBe(originalQuery)
    uninstall?.()
    expect(pg.Client.prototype.query).toBe(originalQuery)

    uninstall = pgDriver.install(recorder())
    const again = pgDriver.install(recorder())
    again?.()
    expect(pg.Client.prototype.query).toBe(originalQuery) // one uninstall undoes everything: nothing was stacked
    uninstall = null
  })

  it("leaves a query the driver itself would reject untouched", () => {
    const client = new pg.Client({ host: "mock", stream: server.stream as never })
    expect(() => (client.query as unknown as (c: unknown) => unknown)(null)).toThrow(TypeError)
  })
})
