import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/mysql2"
import { int, mysqlTable } from "drizzle-orm/mysql-core"
import { createPool } from "mysql2/promise"
import { expect, it } from "vitest"
import { TraceStore } from "../src/store"
import { installTracer, runInRequest } from "../src/tracer"
import { startMockMysql } from "./mock-mysql-server"

const users = mysqlTable("users", { id: int("id") })

// Documents a limit of AsyncLocalStorage, not of the tool: a Drizzle builder is lazy, so a
// builder that is returned out of the request scope and awaited elsewhere runs its query there.
it("attributes a lazy Drizzle builder to the scope it is awaited in, not the one it was built in", async () => {
  const server = startMockMysql()
  const store = new TraceStore({ maxRequests: 5, maxQueriesPerRequest: 50 })
  const uninstall = installTracer(store)
  const pool = createPool({ stream: server.stream, connectionLimit: 1 })
  const db = drizzle(pool, { mode: "default" })

  const trace = store.startRequest("GET", "/lazy")
  const builder = runInRequest(trace, () => db.select().from(users).where(eq(users.id, 1)))
  await builder

  expect(trace.queries).toHaveLength(0)
  expect(store.get("background")?.queries).toHaveLength(1)
  uninstall()
  await pool.end()
})
