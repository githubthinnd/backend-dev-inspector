import type { IncomingMessage, ServerResponse } from "node:http"
import { EventEmitter } from "node:events"
import { drizzle } from "drizzle-orm/mysql2"
import { int, mysqlTable } from "drizzle-orm/mysql-core"
import { createPool, type Pool } from "mysql2/promise"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createSqlInspector } from "../src/node"
import { getInspector } from "../src/runtime"
import { resetInspectorForTests } from "../src/setup"
import { startMockMysql } from "./mock-mysql-server"

const users = mysqlTable("users", { id: int("id") })
const RUNTIME_KEY = Symbol.for("sqlDevInspector.runtime")

class FakeRes extends EventEmitter {
  statusCode = 200
  body = ""
  headers: Record<string, string> = {}
  writeHead(status: number, headers: Record<string, string> = {}) {
    this.statusCode = status
    this.headers = headers
    return this
  }

  write(chunk: string) {
    this.body += chunk
    return true
  }

  end(chunk?: string) {
    this.body += chunk ?? ""
  }
}

function request(url: string, method = "GET") {
  const req = Object.assign(new EventEmitter(), { url, method }) as unknown as IncomingMessage
  const res = new FakeRes()
  return { req, res, asRes: res as unknown as ServerResponse }
}

let pool: Pool
let db: ReturnType<typeof makeDb>
const makeDb = (p: Pool) => drizzle(p, { mode: "default" })

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development")
  vi.stubEnv("SQL_INSPECTOR", "")
  delete (globalThis as Record<symbol, unknown>)[RUNTIME_KEY]
  resetInspectorForTests()
  vi.spyOn(console, "log").mockImplementation(() => {})
  pool = createPool({ stream: startMockMysql().stream, connectionLimit: 2 })
  db = makeDb(pool)
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await pool.end()
})

describe("createSqlInspector", () => {
  it("as Express-style middleware: traces what the route handler queries and serves its own pages", async () => {
    const inspector = createSqlInspector()
    expect(inspector.enabled).toBe(true)

    const { req, res, asRes } = request("/orders?id=1")
    await new Promise<void>((resolve) => {
      inspector.middleware(req, asRes, () => {
        void db.select().from(users).then(() => {
          res.emit("close")
          resolve()
        })
      })
    })

    const list = request("/__sql-inspector/api/requests")
    let calledNext = false
    inspector.middleware(list.req, list.asRes, () => {
      calledNext = true
    })
    expect(calledNext).toBe(false)
    expect(JSON.parse(list.res.body)).toMatchObject([{ method: "GET", url: "/orders?id=1", status: 200, queryCount: 1 }])
  })

  it("handle() answers inspector URLs and leaves the rest alone; track() attributes queries", async () => {
    const inspector = createSqlInspector()
    expect(inspector.handle(request("/api/x").req, request("/api/x").asRes)).toBe(false)
    const page = request("/__sql-inspector/")
    expect(inspector.handle(page.req, page.asRes)).toBe(true)
    expect(page.res.body).toContain("SQL Inspector")

    const { req, res, asRes } = request("/plain")
    await inspector.track(req, asRes, async () => await db.select().from(users))
    res.emit("close")
    expect(getInspector().store.list()[0]).toMatchObject({ url: "/plain", status: 200 })
    expect(getInspector().store.list()[0]!.queries).toHaveLength(1)
  })

  it("uses Express's originalUrl when a router has rewritten url", async () => {
    const inspector = createSqlInspector()
    const { req, asRes } = request("/stripped")
    ;(req as IncomingMessage & { originalUrl?: string }).originalUrl = "/api/stripped"
    await inspector.track(req, asRes, async () => await db.select().from(users))
    expect(getInspector().store.list()[0]!.url).toBe("/api/stripped")
  })

  it("task() traces work that is not an HTTP request, and returns its value", async () => {
    const inspector = createSqlInspector()
    const value = await inspector.task("nightly-sync", async () => {
      await db.select().from(users)
      return 42
    })
    expect(value).toBe(42)
    const [trace] = getInspector().store.list()
    expect(trace).toMatchObject({ method: "TASK", url: "nightly-sync" })
    expect(trace!.queries).toHaveLength(1)
  })

  it("task() still finishes the trace and rethrows when the work fails", async () => {
    const inspector = createSqlInspector()
    await expect(inspector.task("boom-job", async () => {
      await db.select().from(users)
      throw new Error("job failed")
    })).rejects.toThrow("job failed")
    expect(getInspector().store.list()[0]!.durationMs).not.toBeNull()
  })

  it("is a transparent no-op in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const inspector = createSqlInspector()
    expect(inspector.enabled).toBe(false)

    const { req, asRes } = request("/__sql-inspector/api/requests")
    let calledNext = false
    inspector.middleware(req, asRes, () => {
      calledNext = true
    })
    expect(calledNext).toBe(true)
    expect(inspector.handle(req, asRes)).toBe(false)
    expect(await inspector.task("x", async () => "ok")).toBe("ok")
    expect(inspector.track(req, asRes, () => 7)).toBe(7)
  })
})
