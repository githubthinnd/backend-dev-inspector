import { createRequire } from "node:module"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildReport, createRecorder, getInspector, type RequestTrace, resetInspectorForTests, runInRequest, startInspector } from "sql-dev-inspector"
import { betterSqlite3Driver, nodeSqliteDriver } from "../src/drivers/sqlite"

const load = createRequire(import.meta.url)
const BetterSqlite = load("better-sqlite3") as typeof import("better-sqlite3")
// Node prints an experimental-feature warning when node:sqlite loads; this is the test that asks for it.
process.removeAllListeners("warning")
const nodeSqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite")

/** better-sqlite3 is a native module; where it was not built (an install with scripts off) its tests are skipped. */
const betterSqliteBuilt = (() => {
  try {
    new BetterSqlite(":memory:").close()
    return true
  } catch {
    return false
  }
})()

const recorder = () => createRecorder(getInspector().store)
const request = (url: string): RequestTrace => getInspector().store.startRequest("GET", url)
const shape = (trace: RequestTrace) => trace.queries.map(q => [q.analysis.kind, q.rowCount, q.affectedRows, q.error])

beforeEach(() => {
  startInspector({ NODE_ENV: "development", SQL_INSPECTOR_LOG: "0", SQL_INSPECTOR_NOTICE: "0" }, { drivers: [] })
})
afterEach(() => {
  getInspector().store.clear()
  resetInspectorForTests()
})

describe.skipIf(!betterSqliteBuilt)("better-sqlite3", () => {
  let uninstall: (() => void) | null
  let db: InstanceType<typeof BetterSqlite>
  beforeEach(() => {
    db = new BetterSqlite(":memory:")
    db.exec("create table users (id integer primary key, name text)")
    uninstall = betterSqlite3Driver.install(recorder())
  })
  afterEach(() => {
    uninstall?.()
    db.close()
  })

  it("records run, get, all and iterate with their rows and parameters", () => {
    const trace = request("/users")
    runInRequest(trace, () => {
      expect(db.prepare("insert into users (name) values (?)").run("ann")).toMatchObject({ changes: 1 })
      db.prepare("insert into users (name) values (@name)").run({ name: "bob" })
      expect(db.prepare("select * from users where id = ?").get(1)).toMatchObject({ name: "ann" })
      expect(db.prepare("select * from users").all()).toHaveLength(2)
      expect([...db.prepare("select * from users").iterate()]).toHaveLength(2)
      expect(db.prepare("select * from users where id = ?").get(99)).toBeUndefined()
    })
    expect(shape(trace)).toEqual([
      ["insert", null, 1, null],
      ["insert", null, 1, null],
      ["select", 1, null, null],
      ["select", 2, null, null],
      ["select", 2, null, null],
      ["select", 0, null, null]
    ])
    expect(trace.queries.every(q => q.driver === "better-sqlite3" && q.durationMs !== null)).toBe(true)
    expect(trace.queries[0]!.params).toEqual(["ann"])
    expect(trace.queries[2]!.params).toEqual([1])
    expect(trace.queries[2]!.analysis.tables).toEqual(["users"])
  })

  it("records the error of a failing statement and still throws it", () => {
    const trace = request("/bad")
    runInRequest(trace, () => {
      expect(() => db.prepare("insert into users (id, name) values (1, 'x')").run()).not.toThrow()
      expect(() => db.prepare("insert into users (id, name) values (1, 'dup')").run()).toThrow(/UNIQUE/)
    })
    expect(trace.queries[1]!.error).toContain("UNIQUE")
  })

  it("closes an iterator that is abandoned early", () => {
    const trace = request("/iterate")
    runInRequest(trace, () => {
      db.exec("insert into users (name) values ('a'), ('b'), ('c')")
      for (const _row of db.prepare("select * from users").iterate()) {
        break
      }
    })
    expect(trace.queries.at(-1)).toMatchObject({ rowCount: 1 })
    expect(trace.queries.at(-1)!.durationMs).not.toBeNull()
  })

  it("records exec, including multi-statement scripts", () => {
    const trace = request("/exec")
    runInRequest(trace, () => db.exec("insert into users (name) values ('a'); insert into users (name) values ('b')"))
    expect(trace.queries).toHaveLength(1)
    expect(trace.queries[0]).toMatchObject({ api: "run", driver: "better-sqlite3" })
    expect(trace.queries[0]!.analysis.kind).toBe("insert")
  })

  it("shows db.transaction() as a transaction, rolled back when the function throws", () => {
    const trace = request("/tx")
    runInRequest(trace, () => {
      db.transaction(() => {
        db.prepare("insert into users (name) values ('in tx')").run()
      })()
      expect(() => db.transaction(() => {
        db.prepare("insert into users (name) values ('doomed')").run()
        throw new Error("abort")
      })()).toThrow("abort")
    })
    const tree = buildReport(trace).tree
    expect(tree.map(node => node.type === "transaction" ? node.status : node.type)).toEqual(["committed", "rolled-back"])
  })

  it("keeps two databases apart as two connections", () => {
    const other = new BetterSqlite(":memory:")
    other.exec("create table t (a)")
    const trace = request("/two")
    runInRequest(trace, () => {
      db.prepare("select 1").get()
      other.prepare("select 2").get()
    })
    other.close()
    expect(new Set(trace.queries.map(q => q.connectionId)).size).toBe(2)
  })

  it("flags an N+1 in a loop of point reads", () => {
    const trace = request("/n-plus-one")
    runInRequest(trace, () => {
      for (const id of [1, 2, 3, 4]) {
        db.prepare("select name from users where id = ?").get(id)
      }
    })
    expect(buildReport(trace).insights.map(i => i.type)).toEqual(["n-plus-one"])
  })

  it("restores the library when uninstalled", () => {
    const proto = Object.getPrototypeOf(db.prepare("select 1")) as { run: unknown }
    const patched = proto.run
    uninstall?.()
    uninstall = null
    expect(proto.run).not.toBe(patched)
    const trace = request("/after")
    runInRequest(trace, () => db.prepare("select 1").get())
    expect(trace.queries).toHaveLength(0)
  })
})

describe("node:sqlite", () => {
  let uninstall: (() => void) | null
  let db: InstanceType<typeof nodeSqlite.DatabaseSync>
  beforeEach(() => {
    db = new nodeSqlite.DatabaseSync(":memory:")
    db.exec("create table users (id integer primary key, name text)")
    uninstall = nodeSqliteDriver.install(recorder(), { explicit: true })
  })
  afterEach(() => {
    uninstall?.()
    db.close()
  })

  it("only installs when asked for, so an app that never uses it never loads it", () => {
    expect(nodeSqliteDriver.install(recorder(), { explicit: false })).toBeNull()
  })

  it("records statements and exec, with the connection of the database that made them", () => {
    const other = new nodeSqlite.DatabaseSync(":memory:")
    const trace = request("/node-sqlite")
    runInRequest(trace, () => {
      db.prepare("insert into users (name) values (?)").run("ann")
      expect(db.prepare("select * from users where id = ?").get(1)).toMatchObject({ name: "ann" })
      expect(db.prepare("select * from users").all()).toHaveLength(1)
      db.exec("insert into users (name) values ('bob')")
      other.exec("create table z (a)")
    })
    other.close()
    expect(shape(trace)).toEqual([
      ["insert", null, 1, null],
      ["select", 1, null, null],
      ["select", 1, null, null],
      ["insert", null, null, null],
      ["other", null, null, null]
    ])
    expect(trace.queries[0]!.driver).toBe("node:sqlite")
    expect(trace.queries[0]!.connectionId).toBe(trace.queries[1]!.connectionId)
    expect(trace.queries[0]!.connectionId).toBe(trace.queries[3]!.connectionId)
    expect(trace.queries[4]!.connectionId).not.toBe(trace.queries[0]!.connectionId)
  })

  it("records iterate and errors", () => {
    const trace = request("/iterate")
    runInRequest(trace, () => {
      db.exec("insert into users (name) values ('a'), ('b')")
      expect([...db.prepare("select * from users").iterate()]).toHaveLength(2)
      expect(() => db.prepare("insert into users (id) values (1), (1)").run()).toThrow(/UNIQUE/)
    })
    expect(trace.queries[1]).toMatchObject({ rowCount: 2 })
    expect(trace.queries[2]!.error).toContain("UNIQUE")
  })

  it("builds the transaction tree from BEGIN / COMMIT run through exec", () => {
    const trace = request("/tx")
    runInRequest(trace, () => {
      db.exec("BEGIN")
      db.prepare("insert into users (name) values ('x')").run()
      db.exec("SAVEPOINT a")
      db.exec("ROLLBACK TO a")
      db.exec("COMMIT")
    })
    const tree = buildReport(trace).tree
    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({ type: "transaction", status: "committed" })
  })
})
