import { createRequire } from "node:module"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createDatabase } from "db0"
import betterSqlite3 from "db0/connectors/better-sqlite3"
import libsql from "db0/connectors/libsql/node"
import { withTracing } from "db0/tracing"
import { createRecorder, getInspector, type RequestTrace, resetInspectorForTests, runInRequest, startInspector } from "sql-dev-inspector"
import { allDrivers } from "../src/drivers"
import { db0Driver } from "../src/drivers/db0"

const BetterSqlite = createRequire(import.meta.url)("better-sqlite3") as typeof import("better-sqlite3")
const built = (() => {
  try {
    new BetterSqlite(":memory:").close()
    return true
  } catch {
    return false
  }
})()

const request = (url: string): RequestTrace => getInspector().store.startRequest("GET", url)
const sqlOf = (trace: RequestTrace) => trace.queries.map(q => `${q.driver}: ${q.sql}`)
let uninstalls: Array<() => void> = []

beforeEach(async () => {
  startInspector({ NODE_ENV: "development", SQL_INSPECTOR_LOG: "0", SQL_INSPECTOR_NOTICE: "0", SQL_INSPECTOR_REDACT: "off" }, { drivers: [] })
  const recorder = createRecorder(getInspector().store)
  uninstalls = allDrivers.filter(driver => ["better-sqlite3", "libsql", "db0"].includes(driver.name)).map(driver => driver.install(recorder)).filter((stop): stop is () => void => !!stop)
  await new Promise(resolve => setTimeout(resolve, 30)) // the ESM copy of @libsql/client is patched once imported
})
afterEach(() => {
  uninstalls.forEach(stop => stop())
  getInspector().store.clear()
  resetInspectorForTests()
})

describe("db0 (Nitro useDatabase, NuxtHub)", () => {
  it.skipIf(!built)("over better-sqlite3: recorded once, at the driver, with nothing to set up", async () => {
    const db = createDatabase(betterSqlite3({ name: ":memory:" }))
    await db.exec("create table users (id integer primary key, name text)")
    const trace = request("/better")
    await runInRequest(trace, async () => {
      await db.prepare("select * from users where id = ?").all(1)
      await db.sql`select * from users`
    })
    expect(sqlOf(trace).map(line => line.split(":")[0])).toEqual(["better-sqlite3", "better-sqlite3"])
  })

  it.skipIf(!built)("over better-sqlite3 with withTracing(): still once, the channel leaves watched connectors alone", async () => {
    const db = withTracing(createDatabase(betterSqlite3({ name: ":memory:" })))
    await db.exec("create table t (id integer)")
    const trace = request("/traced")
    await runInRequest(trace, async () => await db.sql`select * from t`)
    expect(trace.queries).toHaveLength(1)
    expect(trace.queries[0]!.driver).toBe("better-sqlite3")
  })

  it("over libSQL: recorded once, at the libSQL driver", async () => {
    // `lib` hands db0 the copy this test resolves, so a client installed next to this package (not at the root) is found too.
    const db = createDatabase(libsql({ url: ":memory:", lib: createRequire(import.meta.url)("@libsql/client") }))
    await db.exec("create table users (id integer primary key)")
    const trace = request("/libsql")
    await runInRequest(trace, async () => await db.sql`select * from users`)
    expect(trace.queries).toHaveLength(1)
    expect(trace.queries[0]!.driver).toBe("libsql")
  })

  it("a connector this package does not watch is recorded through db0's own tracing channel", async () => {
    // A stand-in for a connector such as PGlite or Cloudflare D1: db0 only needs exec / prepare / sql.
    const statement = { all: async () => [{ id: 1 }], run: async () => ({ changes: 1 }), get: async () => ({ id: 1 }), bind() { return statement } }
    const database = withTracing({
      connector: "pglite", dialect: "postgresql", capabilities: {}, disposed: false, getInstance: () => ({}),
      exec: async () => ({}), prepare: () => statement, sql: async () => ({ rows: [] }), dispose: async () => {}, [Symbol.asyncDispose]: async () => {}
    } as never)
    const trace = request("/pglite")
    await runInRequest(trace, async () => {
      await database.prepare("select id from users where id = $1").all(1)
      await database.prepare("update users set name = 'x'").run()
    })
    expect(trace.queries.map(q => [q.driver, q.analysis.kind, q.rowCount, q.affectedRows])).toEqual([
      ["db0:pglite", "select", 1, null],
      ["db0:pglite", "update", null, 1]
    ])
  })

  it("stops when uninstalled", async () => {
    uninstalls.forEach(stop => stop())
    uninstalls = []
    const database = withTracing({ connector: "pglite", dialect: "sqlite", exec: async () => ({}), prepare: () => ({}), sql: async () => [], getInstance: () => ({}) } as never)
    const trace = request("/off")
    await runInRequest(trace, async () => await database.exec("select 1"))
    expect(trace.queries).toHaveLength(0)
    expect(db0Driver.name).toBe("db0")
  })
})
