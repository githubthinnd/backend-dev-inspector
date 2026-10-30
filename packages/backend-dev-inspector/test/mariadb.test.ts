import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildReport, createRecorder, getInspector, type RequestTrace, resetInspectorForTests, runInRequest, startInspector } from "sql-dev-inspector"
import { instrumentMariadb, type MariadbModule, mariadbDriver } from "../src/drivers/mariadb"

/**
 * The connector keeps its classes private and cannot talk to an in-memory server in a test, so
 * these tests use a module with the connector's documented promise API: createConnection,
 * createPool, query / execute / batch, getConnection, threadId. The wrapper touches nothing else.
 */
interface FakeConnection {
  threadId: number
  query: (sql: string | { sql: string, values?: unknown }, values?: unknown) => Promise<unknown>
  execute: FakeConnection["query"]
  batch: FakeConnection["query"]
  release: () => Promise<void>
  calls: string[]
}

function fakeMariadb() {
  let nextThread = 300
  const makeConnection = (): FakeConnection => {
    // The connector's three entry points share internals, not each other's public methods.
    const run: FakeConnection["query"] = async (sql) => {
      const text = typeof sql === "string" ? sql : sql.sql
      connection.calls.push(text)
      const sleep = /sleep\((\d+)\)/.exec(text)?.[1]
      await new Promise(resolve => setTimeout(resolve, sleep ? Number(sleep) : 0))
      if (/\bboom\b/.test(text)) {
        throw Object.assign(new Error("(conn:1, no: 1064) boom: syntax error"), { code: "ER_PARSE_ERROR" })
      }
      if (/^\s*select/i.test(text)) {
        return Object.assign([{ id: 1, name: "alice" }, { id: 2, name: "bob" }], { meta: [] })
      }
      return { affectedRows: 1, insertId: 7, warningStatus: 0 }
    }
    const connection: FakeConnection = {
      threadId: ++nextThread,
      calls: [],
      query: run,
      execute: run,
      batch: run,
      release: async () => {}
    }
    return connection
  }
  const mariadb = {
    createConnection: async () => makeConnection(),
    createPool: () => {
      const shared = makeConnection()
      return Object.assign(shared, { getConnection: async () => makeConnection() })
    }
  }
  return mariadb as unknown as MariadbModule
}

let uninstall: (() => void) | null = null
const request = (url: string): RequestTrace => getInspector().store.startRequest("GET", url)

beforeEach(() => {
  startInspector({ NODE_ENV: "development", SQL_INSPECTOR_LOG: "0", SQL_INSPECTOR_NOTICE: "0", SQL_INSPECTOR_REDACT: "off" }, { drivers: [] })
  uninstall = mariadbDriver.install(createRecorder(getInspector().store))
})
afterEach(() => {
  uninstall?.()
  uninstall = null
  getInspector().store.clear()
  resetInspectorForTests()
})

describe("mariadb connector helper", () => {
  it("returns the module itself when no inspector is running", () => {
    uninstall?.()
    uninstall = null
    const raw = fakeMariadb()
    expect(instrumentMariadb(raw)).toBe(raw)
  })

  it("records queries of a connection with rows, affected rows, parameters and errors", async () => {
    const mariadb = instrumentMariadb(fakeMariadb())
    const conn = await mariadb.createConnection()
    const trace = request("/users")
    await runInRequest(trace, async () => {
      expect(await conn.query("select id, name from users where id = ?", [1])).toHaveLength(2)
      await conn.query({ sql: "update users set name = ? where id = 1", values: ["x"] })
      await expect(conn.query("select boom")).rejects.toThrow("boom")
      await conn.execute?.("insert into users (name) values (?)", ["z"])
      await conn.batch?.("insert into users (name) values (?)", [["a"], ["b"]])
    })
    expect(trace.queries.map(q => [q.driver, q.api, q.analysis.kind, q.rowCount, q.affectedRows, q.error?.includes("boom") ?? null])).toEqual([
      ["mariadb", "query", "select", 2, null, null],
      ["mariadb", "query", "update", null, 1, null],
      ["mariadb", "query", "select", null, null, true],
      ["mariadb", "execute", "insert", null, 1, null],
      ["mariadb", "batch", "insert", null, 1, null]
    ])
    expect(trace.queries[0]!.params).toEqual([1])
    expect(trace.queries[1]!.params).toEqual(["x"])
    expect(trace.queries[0]!.connectionId).toBe(conn.threadId)
  })

  it("records pools, and the transaction on a connection taken from one", async () => {
    const mariadb = instrumentMariadb(fakeMariadb())
    const pool = mariadb.createPool()
    const trace = request("/pool")
    await runInRequest(trace, async () => {
      await pool.query("select id, name from users")
      const conn = await pool.getConnection()
      await conn.query("START TRANSACTION")
      await conn.query("insert into users (name) values ('z')")
      await conn.query("COMMIT")
    })
    expect(trace.queries).toHaveLength(4)
    const tree = buildReport(trace).tree
    expect(tree.map(node => node.type)).toEqual(["query", "transaction"])
    expect(tree[1]).toMatchObject({ status: "committed" })
  })

  it("keeps overlapping requests apart and flags an N+1", async () => {
    const mariadb = instrumentMariadb(fakeMariadb())
    const conn = await mariadb.createConnection()
    const a = request("/a")
    const b = request("/b")
    await Promise.all([
      runInRequest(a, async () => {
        await conn.query("select sleep(25) as a")
        for (const id of [1, 2, 3]) {
          await conn.query(`select name from users where id = ${id}`)
        }
      }),
      runInRequest(b, () => conn.query("select 1 as b"))
    ])
    expect(a.queries).toHaveLength(4)
    expect(b.queries.map(q => q.sql)).toEqual(["select 1 as b"])
    expect(buildReport(a).insights.map(i => i.type)).toEqual(["n-plus-one"])
  })

  it("wraps a connection only once, and leaves a call without SQL text alone", async () => {
    const mariadb = instrumentMariadb(fakeMariadb())
    const conn = await mariadb.createConnection()
    const trace = request("/odd")
    await runInRequest(trace, async () => {
      await conn.query({ sql: "select 1" })
      await (conn.query as unknown as (arg: unknown) => Promise<unknown>)({ values: [] }).catch(() => {})
    })
    expect(trace.queries).toHaveLength(1)
  })
})
