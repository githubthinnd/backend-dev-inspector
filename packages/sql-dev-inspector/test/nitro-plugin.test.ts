import type { IncomingMessage, ServerResponse } from "node:http"
import { EventEmitter } from "node:events"
import { drizzle } from "drizzle-orm/mysql2"
import { int, mysqlTable } from "drizzle-orm/mysql-core"
import { createPool, type Pool } from "mysql2/promise"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { inspectorSubPath } from "../src/inspector-server"
import nitroPlugin from "../src/nitro-plugin"
import { getInspector, isInspectorEnabled } from "../src/runtime"
import { resetInspectorForTests } from "../src/setup"
import { startMockMysql } from "./mock-mysql-server"

const users = mysqlTable("users", { id: int("id") })

class FakeRes extends EventEmitter {
  statusCode = 200
  headers: Record<string, string> = {}
  body = ""
  ended = false
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
    this.ended = true
  }
}

function call(handler: (event: never) => unknown, url: string, method = "GET") {
  const req = Object.assign(new EventEmitter(), { url, method })
  const res = new FakeRes()
  const event = { node: { req: req as unknown as IncomingMessage, res: res as unknown as ServerResponse } }
  const result = handler(event as never)
  return { req, res, result }
}

const json = (res: FakeRes) => JSON.parse(res.body)
const RUNTIME_KEY = Symbol.for("sqlDevInspector.runtime")

let pool: Pool
let handler: (event: never) => unknown
let appHandler: (event: never) => unknown
let logs: string[]

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development")
  vi.stubEnv("SQL_INSPECTOR", "")
  resetInspectorForTests()
  delete (globalThis as Record<symbol, unknown>)[RUNTIME_KEY]
  logs = []
  vi.spyOn(console, "log").mockImplementation((...args) => void logs.push(args.join(" ")))

  const server = startMockMysql()
  pool = createPool({ stream: server.stream, connectionLimit: 2 })
  const db = drizzle(pool, { mode: "default" })

  // The app under inspection: /api/things runs two queries, /static runs none.
  appHandler = async (event: { node: { req: { url: string }, res: FakeRes } }) => {
    if (event.node.req.url.startsWith("/api/things")) {
      await db.select().from(users)
      await db.transaction(async (tx) => {
        await tx.insert(users).values({ id: 1 })
      })
    }
    event.node.res.statusCode = 200
    event.node.res.emit("close")
  }
  const nitroApp = { h3App: { handler: appHandler as never } }
  nitroPlugin(nitroApp)
  handler = nitroApp.h3App.handler as never
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await pool.end()
  // uninstall via a second install is not needed: the next beforeEach re-installs over it
})

describe("environment guard", () => {
  it("is never on in production, on in development or when asked for, and off when opted out", () => {
    expect(isInspectorEnabled({ NODE_ENV: "development" })).toBe(true)
    expect(isInspectorEnabled({ NODE_ENV: "test", SQL_INSPECTOR: "1" })).toBe(true)
    expect(isInspectorEnabled({ SQL_INSPECTOR: "1" })).toBe(true)
    expect(isInspectorEnabled({ NODE_ENV: "production" })).toBe(false)
    expect(isInspectorEnabled({ NODE_ENV: "production", SQL_INSPECTOR: "1" })).toBe(false)
    expect(isInspectorEnabled({})).toBe(false)
    expect(isInspectorEnabled({ NODE_ENV: "test" })).toBe(false)
    expect(isInspectorEnabled({ NODE_ENV: "development", SQL_INSPECTOR: "0" })).toBe(false)
  })

  it("leaves the app handler untouched when disabled", () => {
    vi.stubEnv("NODE_ENV", "production")
    const nitroApp = { h3App: { handler: appHandler as never } }
    nitroPlugin(nitroApp)
    expect(nitroApp.h3App.handler).toBe(appHandler)
  })
})

describe("route matching", () => {
  it.each([
    ["/__sql-inspector", ""],
    ["/__sql-inspector/", "/"],
    ["/__sql-inspector/api/requests?x=1", "/api/requests"],
    ["/app/__sql-inspector/api/stream", "/api/stream"],
    ["/api/__sql-inspector-not", null],
    ["/api/things", null],
    ["/x/__sql-inspectorfoo", null]
  ])("%s → %s", (url, expected) => {
    expect(inspectorSubPath(url)).toBe(expected)
  })
})

describe("nitro plugin, end to end over a real Drizzle pool", () => {
  it("traces a request, groups its queries and transaction, and prints them to the terminal", async () => {
    const { res, result } = call(handler, "/api/things?id=1")
    await result
    expect(res.statusCode).toBe(200)

    const list = call(handler, "/__sql-inspector/api/requests")
    const requests = json(list.res)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: "GET", url: "/api/things?id=1", status: 200, queryCount: 2 })

    const detail = json(call(handler, `/__sql-inspector/api/requests/${requests[0].id}`).res)
    expect(detail.tree.map((n: { type: string }) => n.type)).toEqual(["query", "transaction"])
    expect(detail.tree[1]).toMatchObject({ status: "committed" })
    expect(Object.values(detail.formattedSql as Record<string, string>)[0]).toContain("\nfrom `users`")

    const printed = logs.join("\n")
    expect(printed).toContain("GET /api/things?id=1")
    expect(printed).toContain("TRANSACTION")
    expect(printed).toContain("2 queries")
  })

  it("does not keep requests that never touch the database", async () => {
    await call(handler, "/_nuxt/app.js").result
    expect(json(call(handler, "/__sql-inspector/api/requests").res)).toEqual([])
  })

  it("does not trace the inspector's own requests, under a base path either", async () => {
    await call(handler, "/api/things").result
    call(handler, "/app/__sql-inspector/api/requests")
    call(handler, "/__sql-inspector/")
    expect(json(call(handler, "/__sql-inspector/api/requests").res)).toHaveLength(1)
  })

  it("serves the page, redirects to the trailing slash, and 404s unknown routes", () => {
    const page = call(handler, "/__sql-inspector/")
    expect(page.res.statusCode).toBe(200)
    expect(page.res.headers["content-type"]).toContain("text/html")
    expect(page.res.body).toContain("<title>SQL Inspector</title>")

    const redirect = call(handler, "/app/__sql-inspector?x=1")
    expect(redirect.res.statusCode).toBe(308)
    expect(redirect.res.headers.location).toBe("/app/__sql-inspector/")

    expect(call(handler, "/__sql-inspector/api/nope").res.statusCode).toBe(404)
    expect(call(handler, "/__sql-inspector/api/requests/does-not-exist").res.statusCode).toBe(404)
  })

  it("clears the history", async () => {
    await call(handler, "/api/things").result
    expect(call(handler, "/__sql-inspector/api/clear", "POST").res.statusCode).toBe(200)
    expect(json(call(handler, "/__sql-inspector/api/requests").res)).toEqual([])
  })

  it("streams a change event to a listening page and stops when it disconnects", async () => {
    const stream = call(handler, "/__sql-inspector/api/stream")
    expect(stream.res.headers["content-type"]).toBe("text/event-stream")
    expect(stream.res.body).toContain(": connected")

    await call(handler, "/api/things").result
    await vi.waitFor(() => expect(stream.res.body).toMatch(/data: \{"changed":\[".+"\]\}/))

    stream.req.emit("close")
    const before = stream.res.body
    await call(handler, "/api/things").result
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(stream.res.body).toBe(before)
  })

  it("keeps concurrent requests apart", async () => {
    await Promise.all([call(handler, "/api/things?a").result, call(handler, "/api/things?b").result, call(handler, "/api/things?c").result])
    const requests = json(call(handler, "/__sql-inspector/api/requests").res)
    expect(requests).toHaveLength(3)
    expect(requests.map((r: { queryCount: number }) => r.queryCount)).toEqual([2, 2, 2])
    expect(getInspector().store.get("background")).toBeUndefined()
  })
})
