import { createPool, type Pool } from "mysql2/promise"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { TraceStore } from "../src/store"
import { installTracer, runInRequest } from "../src/tracer"
import { type MockServer, startMockMysql } from "./mock-mysql-server"

let server: MockServer
let pool: Pool
let store: TraceStore
let uninstall: () => void

beforeAll(() => {
  server = startMockMysql()
})
afterAll(() => server.close())
beforeEach(() => {
  store = new TraceStore({ maxRequests: 50, maxQueriesPerRequest: 500 })
  uninstall = installTracer(store)
  pool = createPool({ stream: server.stream, connectionLimit: 2 })
})
afterEach(async () => {
  uninstall()
  await pool.end()
})

async function run(redact: "params" | "all" | "off", fn: () => Promise<unknown>) {
  store.redact = redact
  const trace = store.startRequest("GET", "/x")
  await runInRequest(trace, async () => await fn())
  return trace.queries[0]!
}

describe("mysql2 and redaction", () => {
  it("query(sql, values): the values are not in what is recorded; the statement is shown as written", async () => {
    const event = await run("params", () => pool.query("select * from users where email = ? and id = ?", ["a@b.c", 7]))
    expect(event.sql).toBe("select * from users where email = ? and id = ?")
    expect(event.params).toEqual(["<string:5>", "<number>"])
    expect(JSON.stringify(event)).not.toContain("a@b.c")
    expect(server.statements.at(-1)).toContain("a@b.c") // the server still got the real statement
  })

  it("all: even a value written into the statement is masked", async () => {
    const event = await run("all", () => pool.query("select * from users where email = 'a@b.c'"))
    expect(event.sql).not.toContain("a@b.c")
    expect(event.sql).toContain("?")
  })

  it("off: the statement and the values are shown as sent", async () => {
    const event = await run("off", () => pool.query("select * from users where email = ?", ["a@b.c"]))
    expect(event.sql).toContain("a@b.c")
    expect(event.params).toEqual(["a@b.c"])
  })
})
