import { createRequire } from "node:module"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createClient, type Client } from "@libsql/client"
import { buildReport, createRecorder, getInspector, type RequestTrace, resetInspectorForTests, runInRequest, startInspector } from "sql-dev-inspector"
import { libsqlDriver } from "../src/drivers/libsql"

const request = (url: string): RequestTrace => getInspector().store.startRequest("GET", url)
const calls = (trace: RequestTrace) => trace.queries.map(q => ({ kind: q.analysis.kind, sql: q.sql, api: q.api, rows: q.rowCount, affected: q.affectedRows, error: q.error }))
const settled = () => new Promise(resolve => setTimeout(resolve, 30)) // the ESM copies are patched once their import resolves

let uninstall: (() => void) | null = null
let client: Client

beforeEach(async () => {
  startInspector({ NODE_ENV: "development", SQL_INSPECTOR_LOG: "0", SQL_INSPECTOR_NOTICE: "0" }, { drivers: [] })
  uninstall = libsqlDriver.install(createRecorder(getInspector().store))
  await settled()
  client = createClient({ url: ":memory:" })
  await client.execute("create table users (id integer primary key, name text)")
  await client.execute({ sql: "insert into users (id, name) values (?, ?)", args: [1, "Ada"] })
  getInspector().store.clear()
})
afterEach(() => {
  client.close()
  uninstall?.()
  getInspector().store.clear()
  resetInspectorForTests()
})

describe("libsql driver", () => {
  it("records a read with its text and row count, attached to the request", async () => {
    const trace = request("/users")
    const result = await runInRequest(trace, () => client.execute("select id, name from users"))
    expect(result.rows).toHaveLength(1)
    expect(calls(trace)).toEqual([{ kind: "select", sql: "select id, name from users", api: "execute", rows: 1, affected: null, error: null }])
    expect(trace.queries[0]!.driver).toBe("libsql")
  })

  it("records a write with the rows it affected, and hides the values it was given", async () => {
    const trace = request("/users")
    await runInRequest(trace, () => client.execute({ sql: "insert into users (id, name) values (?, ?)", args: [2, "Grace"] }))
    expect(calls(trace)[0]).toMatchObject({ kind: "insert", affected: 1 })
    expect(trace.queries[0]!.params).toEqual(["<number>", "<string:5>"])
  })

  it("records a failing statement with its error", async () => {
    const trace = request("/boom")
    await expect(runInRequest(trace, () => client.execute("select * from missing_table"))).rejects.toThrow()
    expect(calls(trace)[0]!.error).toContain("no such table")
  })

  it("reports an N+1 over the same statement with different ids", async () => {
    const trace = request("/loop")
    await runInRequest(trace, async () => {
      for (const id of [1, 2, 3, 4]) {
        await client.execute({ sql: "select * from users where id = ?", args: [id] })
      }
    })
    expect(buildReport(trace).insights.map(i => i.type)).toContain("n-plus-one")
  })

  it("lists every statement of a batch, and marks the one that failed", async () => {
    const trace = request("/batch")
    await runInRequest(trace, () => client.batch([
      { sql: "insert into users (id, name) values (10, 'a')", args: [] },
      { sql: "insert into users (id, name) values (11, 'b')", args: [] }
    ], "write"))
    expect(calls(trace).map(c => [c.kind, c.api, c.affected])).toEqual([["insert", "batch", 1], ["insert", "batch", 1]])

    const failing = request("/batch-fail")
    const error = await runInRequest(failing, () => client.batch([
      "insert into users (id, name) values (20, 'a')",
      "insert into users (id, name) values (20, 'dup')"
    ], "write")).then(() => null, (reason: unknown) => reason as { statementIndex?: number })
    expect(error).not.toBeNull()
    // A client that says which statement failed gets it alone marked; one that does not (0.14) gets the whole batch marked, since all of it was rolled back.
    expect(calls(failing).map(c => c.error !== null)).toEqual(typeof error?.statementIndex === "number" ? [false, true] : [true, true])
  })

  it("shows a transaction: BEGIN, its statements and COMMIT, grouped", async () => {
    const trace = request("/tx")
    await runInRequest(trace, async () => {
      const tx = await client.transaction("write")
      await tx.execute("insert into users (id, name) values (30, 'tx')")
      await tx.execute("select * from users")
      await tx.commit()
    })
    expect(calls(trace).map(c => c.kind)).toEqual(["tx-begin", "insert", "select", "tx-commit"])
    const [node] = buildReport(trace).tree
    expect(node?.type).toBe("transaction")
    expect(node?.type === "transaction" && node.status).toBe("committed")
  })

  it("shows a rolled-back transaction", async () => {
    const trace = request("/tx-rollback")
    await runInRequest(trace, async () => {
      const tx = await client.transaction("write")
      await tx.execute("insert into users (id, name) values (31, 'tx')")
      await tx.rollback()
    })
    const [node] = buildReport(trace).tree
    expect(node?.type === "transaction" && node.status).toBe("rolled-back")
  })

  it("watches the CommonJS copy of the library as well", async () => {
    const cjs = createRequire(import.meta.url)("@libsql/client") as { createClient: typeof createClient }
    const other = cjs.createClient({ url: ":memory:" })
    const trace = request("/cjs")
    await runInRequest(trace, () => other.execute("select 1"))
    expect(calls(trace).map(c => c.sql)).toEqual(["select 1"])
    other.close()
  })

  it("watches a remote client too: the call is recorded even when the server cannot be reached", async () => {
    const remote = createClient({ url: "http://127.0.0.1:9" })
    const trace = request("/remote")
    await expect(runInRequest(trace, () => remote.execute("select 1"))).rejects.toThrow()
    expect(calls(trace)[0]).toMatchObject({ sql: "select 1", api: "execute" })
    expect(calls(trace)[0]!.error).not.toBeNull()
    remote.close()
  })

  it("restores the library when uninstalled", async () => {
    uninstall?.()
    uninstall = null
    const trace = request("/off")
    await runInRequest(trace, () => client.execute("select 1"))
    expect(trace.queries).toHaveLength(0)
  })
})
