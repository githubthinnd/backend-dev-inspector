import { createRequire } from "node:module"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { getInspector, resetInspectorForTests } from "sql-dev-inspector"
import { capture, type InspectorMatchers, matchers } from "../src/testing"

// What a project adds once, so its editor and type checker know the matchers.
declare module "vitest" {
  interface Assertion<R extends void | Promise<void> = void, T = unknown> extends InspectorMatchers<R> {} // eslint-disable-line ts/no-empty-object-type, unused-imports/no-unused-vars
}

const BetterSqlite = createRequire(import.meta.url)("better-sqlite3") as typeof import("better-sqlite3")
const built = (() => {
  try {
    new BetterSqlite(":memory:").close()
    return true
  } catch {
    return false
  }
})()

beforeAll(() => {
  expect.extend(matchers)
})
afterEach(() => {
  getInspector().store.clear()
  resetInspectorForTests()
})

function database() {
  const db = new BetterSqlite(":memory:")
  db.exec("create table users (id integer primary key, name text)")
  db.exec("insert into users values (1, 'a'), (2, 'b'), (3, 'c'), (4, 'd')")
  return db
}

describe.skipIf(!built)("query budgets in tests", () => {
  it("captures what the code did, with the result, without the application starting the inspector", async () => {
    const db = database()
    const run = await capture(() => db.prepare("select * from users where id = ?").get(1))
    expect(run.result).toEqual({ id: 1, name: "a" })
    expect(run.queries).toHaveLength(1)
    expect(run.trace.method).toBe("TEST")
    expect(run).toHaveMaxQueries(1)
    expect(run).toRunQueries(1)
    expect(run).toHaveNoNPlusOne()
    expect(run).toHaveNoErrors()
  })

  it("fails a test that has an N+1, and says what it found, where, and how to fix it", async () => {
    const db = database()
    const run = await capture(async () => {
      for (const id of [1, 2, 3, 4]) {
        db.prepare("select * from users where id = ?").get(id)
      }
    })
    expect(run.insights.map(i => i.type)).toContain("n-plus-one")
    expect(() => expect(run).toHaveNoNPlusOne()).toThrow(/N\+1[\s\S]*testing\.test\.ts[\s\S]*join/)
    expect(() => expect(run).toHaveMaxQueries(2)).toThrow(/at most 2 calls, but there were 4/)
    expect(run).not.toHaveNoNPlusOne()
  })

  it("passes a loop that does not repeat the same shape", async () => {
    const db = database()
    const run = await capture(() => db.prepare("select * from users where id in (1, 2, 3, 4)").all())
    expect(run).toHaveNoNPlusOne()
    expect(run).toHaveNoDuplicates()
  })

  it("flags errors and duplicates", async () => {
    const db = database()
    const failing = await capture(() => { try { db.prepare("select * from missing").get() } catch { /* expected */ } })
    expect(() => expect(failing).toHaveNoErrors()).toThrow(/missing/)

    const twice = await capture(() => { db.prepare("select 1").get(); db.prepare("select 1").get() })
    expect(() => expect(twice).toHaveNoDuplicates()).toThrow(/identical|similar|repeated/i)
  })

  it("keeps two captures apart, and rejects a value that is not a capture", async () => {
    const db = database()
    const [a, b] = await Promise.all([
      capture(async () => { db.prepare("select 1").get() }),
      capture(async () => { db.prepare("select 1").get(); db.prepare("select 2").get() })
    ])
    expect([a.queries.length, b.queries.length]).toEqual([1, 2])
    expect(() => expect({} as never).toHaveMaxQueries(1)).toThrow(/result of capture/)
  })
})
