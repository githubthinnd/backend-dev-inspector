import { afterEach, beforeEach, describe, expect, it } from "vitest"
import postgres from "postgres"
import postgres3 from "postgres3"
import { buildReport, createRecorder, getInspector, type RequestTrace, resetInspectorForTests, runInRequest, startInspector } from "sql-dev-inspector"
import { instrumentPostgres, postgresJsDriver } from "../src/drivers/postgres-js"
import { type MockPostgres, startMockPostgres } from "./helpers/mock-postgres"

let server: MockPostgres
let uninstall: (() => void) | null = null
const closers: Array<() => Promise<unknown>> = []

/** postgres.js asks its `socket` option for the connection: here, an in-memory one wired to the mock server. */
const options = () => ({
  host: "mock", user: "u", database: "d", max: 1, idle_timeout: 0,
  socket: async () => {
    const socket = server.stream() as unknown as Record<string, unknown>
    for (const method of ["setNoDelay", "setKeepAlive", "setTimeout", "ref", "unref"]) {
      socket[method] ??= () => socket
    }
    return socket
  }
})
const request = (url: string): RequestTrace => getInspector().store.startRequest("GET", url)
const calls = (trace: RequestTrace) => trace.queries.map(q => ({ kind: q.analysis.kind, sql: q.sql, rows: q.rowCount, affected: q.affectedRows, error: q.error, driver: q.driver }))

beforeEach(() => {
  server = startMockPostgres()
  startInspector({ NODE_ENV: "development", SQL_INSPECTOR_LOG: "0", SQL_INSPECTOR_NOTICE: "0", SQL_INSPECTOR_REDACT: "off" }, { drivers: [] })
  uninstall = postgresJsDriver.install(createRecorder(getInspector().store))
})
afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close().catch(() => {})))
  uninstall?.()
  getInspector().store.clear()
  resetInspectorForTests()
})

describe("postgres.js 4 (reported through its own tracing channel)", () => {
  it("records a query with its text, rows and connection, attached to the request", async () => {
    const sql = postgres(options() as never)
    closers.push(() => sql.end({ timeout: 0 }))
    const trace = request("/users")
    const rows = await runInRequest(trace, async () => await sql`select id, name from users`)
    expect(rows).toHaveLength(2)
    expect(calls(trace)).toEqual([{ kind: "select", sql: "select id, name from users", rows: 2, affected: null, error: null, driver: "postgres" }])
    expect(trace.queries[0]!.connectionId).toBeLessThan(0)
  })

  it("records a failing query with its error", async () => {
    const sql = postgres(options() as never)
    closers.push(() => sql.end({ timeout: 0 }))
    const trace = request("/boom")
    await expect(runInRequest(trace, async () => await sql.unsafe("select boom"))).rejects.toThrow()
    expect(calls(trace)[0]!.error).toContain("syntax error")
  })

  it("shows a transaction: BEGIN, its statements and COMMIT, grouped on one connection", async () => {
    const sql = postgres(options() as never)
    closers.push(() => sql.end({ timeout: 0 }))
    const trace = request("/tx")
    await runInRequest(trace, () => sql.begin(async (tx) => {
      await tx`select id, name from users`
      await tx.unsafe("insert into users values (1)")
    }))
    expect(calls(trace).map(c => c.kind)).toEqual(["tx-begin", "select", "insert", "tx-commit"])
    const [node] = buildReport(trace).tree
    expect(node?.type === "transaction" && node.status).toBe("committed")
  })

  it("does not wrap what it already sees: instrumentPostgres leaves a version 4 client alone", async () => {
    const sql = instrumentPostgres(postgres(options() as never))
    closers.push(() => sql.end({ timeout: 0 }))
    const trace = request("/once")
    await runInRequest(trace, async () => await sql`select id, name from users`)
    expect(trace.queries).toHaveLength(1)
  })

  it("stops when uninstalled", async () => {
    const sql = postgres(options() as never)
    closers.push(() => sql.end({ timeout: 0 }))
    uninstall?.()
    uninstall = null
    const trace = request("/off")
    await runInRequest(trace, async () => await sql`select id, name from users`)
    expect(trace.queries).toHaveLength(0)
  })
})

describe("postgres.js 3 (wrapped once with instrumentPostgres)", () => {
  const client = () => {
    const sql = instrumentPostgres(postgres3(options() as never))
    closers.push(() => sql.end({ timeout: 0 }))
    return sql
  }

  it("records tagged queries and sql.unsafe(), with their rows", async () => {
    const sql = client()
    const trace = request("/v3")
    await runInRequest(trace, async () => {
      await sql`select id, name from users`
      await sql.unsafe("select id, name from users where 1 = 1")
    })
    expect(calls(trace)).toEqual([
      { kind: "select", sql: "select id, name from users", rows: 2, affected: null, error: null, driver: "postgres" },
      { kind: "select", sql: "select id, name from users where 1 = 1", rows: 2, affected: null, error: null, driver: "postgres" }
    ])
  })

  it("records a failing query with its error", async () => {
    const sql = client()
    const trace = request("/v3-boom")
    await expect(runInRequest(trace, async () => await sql.unsafe("select boom"))).rejects.toThrow()
    expect(calls(trace)[0]!.error).toContain("syntax error")
  })

  it("shows a transaction opened with sql.begin(), grouped on its own connection", async () => {
    const sql = client()
    const trace = request("/v3-tx")
    await runInRequest(trace, () => sql.begin(async (tx) => {
      await tx.unsafe("select id, name from users where 1 = 1")
      await tx.unsafe("update users set name = 'x'")
    }))
    const kinds = calls(trace).map(c => c.kind)
    expect(kinds).toContain("select")
    expect(kinds).toContain("update")
    expect(new Set(trace.queries.map(q => q.connectionId)).size).toBeLessThanOrEqual(2)
  })

  it("reports nothing and returns the client untouched when the inspector is off", () => {
    uninstall?.()
    uninstall = null
    const sql = postgres3(options() as never)
    closers.push(() => sql.end({ timeout: 0 }))
    expect(instrumentPostgres(sql)).toBe(sql)
  })
})
