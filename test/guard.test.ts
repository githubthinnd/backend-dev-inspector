import type { QueryEvent, RequestTrace } from "../src/types"
import { EventEmitter } from "node:events"
import { describe, expect, it } from "vitest"
import { hostnameOf, isAllowedHost, isSameOriginRequest, parseAllowedHosts, rejectReason } from "../src/guard"
import { handleInspectorRequest } from "../src/inspector-server"
import { DEFAULT_REPORT_OPTIONS } from "../src/report"
import { cachedReport, formattedSql } from "../src/report-cache"
import { getInspector } from "../src/runtime"
import { analyzeSql } from "../src/sql-analyzer"
import { TraceStore } from "../src/store"

describe("hostnameOf", () => {
  it.each([
    ["localhost:3000", "localhost"],
    ["LocalHost", "localhost"],
    ["127.0.0.1:8080", "127.0.0.1"],
    ["[::1]:3000", "::1"],
    ["[::1]", "::1"],
    ["app.test.", "app.test"],
    ["app.test:", "app.test"]
  ])("reads %s as %s", (input, expected) => {
    expect(hostnameOf(input)).toBe(expected)
  })
})

describe("isAllowedHost", () => {
  it.each(["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "dev.localhost:3000", "192.168.1.20:3000", "10.0.0.5"])("lets %s in without any setting", (host) => {
    expect(isAllowedHost(host)).toBe(true)
  })

  it.each(["evil.example.com", "evil.example.com:3000", "localhost.evil.com", "127.0.0.1.evil.com", "myapp.test"])("refuses %s unless it is allowed", (host) => {
    expect(isAllowedHost(host)).toBe(false)
  })

  it("lets a request with no Host header through: it is not a browser", () => {
    expect(isAllowedHost(undefined)).toBe(true)
  })

  it("honours exact names, subdomain wildcards, and the catch-all", () => {
    const allowed = parseAllowedHosts(" myapp.test , *.dev.example.com ")
    expect(allowed).toEqual(["myapp.test", "*.dev.example.com"])
    expect(isAllowedHost("myapp.test:3000", allowed)).toBe(true)
    expect(isAllowedHost("MyApp.Test", allowed)).toBe(true)
    expect(isAllowedHost("a.dev.example.com", allowed)).toBe(true)
    expect(isAllowedHost("dev.example.com", allowed)).toBe(false)
    expect(isAllowedHost("evil.com", allowed)).toBe(false)
    expect(isAllowedHost("anything.at.all", ["*"])).toBe(true)
  })
})

describe("isSameOriginRequest", () => {
  const check = (headers: Record<string, string>) => isSameOriginRequest({ headers })

  it("accepts a page's own requests and tools that send no browser headers", () => {
    expect(check({ host: "localhost:3000" })).toBe(true)
    expect(check({ "host": "localhost:3000", "origin": "http://localhost:3000", "sec-fetch-site": "same-origin" })).toBe(true)
    expect(check({ host: "localhost:3000", origin: "http://localhost:3000" })).toBe(true)
    expect(check({ "host": "localhost:3000", "sec-fetch-site": "none" })).toBe(true)
  })

  it("refuses another site, another port, and an opaque origin", () => {
    expect(check({ "host": "localhost:3000", "origin": "https://evil.example.com", "sec-fetch-site": "cross-site" })).toBe(false)
    expect(check({ host: "localhost:3000", origin: "https://evil.example.com" })).toBe(false)
    expect(check({ host: "localhost:3000", origin: "null" })).toBe(false)
    expect(check({ "host": "localhost:3000", "sec-fetch-site": "same-site" })).toBe(false)
  })

  it("trusts the browser's own Sec-Fetch-Site over a rewritten Host, as behind a dev-server proxy", () => {
    // Vite on :5173 proxies to :3000 and rewrites Host; the page still asks its own origin.
    expect(check({ "host": "localhost:3000", "origin": "http://localhost:5173", "sec-fetch-site": "same-origin" })).toBe(true)
  })

  it("without Sec-Fetch-Site, accepts the origin of a loopback dev server but not a stranger's", () => {
    expect(check({ host: "localhost:3000", origin: "http://localhost:5173" })).toBe(true)
    expect(check({ host: "localhost:3000", origin: "https://evil.example.com" })).toBe(false)
    expect(isSameOriginRequest({ headers: { host: "localhost:3000", origin: "https://myapp.test" } }, ["myapp.test"])).toBe(true)
  })
})

describe("rejectReason", () => {
  it("names the Host and how to allow it", () => {
    const reason = rejectReason({ headers: { host: "myapp.test:3000" }, method: "GET" }, [])
    expect(reason).toContain("SQL_INSPECTOR_ALLOWED_HOSTS=myapp.test")
  })

  it("checks the origin only for POST, which is what changes state", () => {
    const headers = { host: "localhost:3000", origin: "https://evil.example.com" }
    expect(rejectReason({ headers, method: "GET" }, [])).toBeNull()
    expect(rejectReason({ headers, method: "POST" }, [])).toContain("Cross-origin")
  })
})

class FakeRes {
  statusCode = 200
  body = ""
  writeHead(status: number) {
    this.statusCode = status
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

function call(method: string, subPath: string, headers: Record<string, string> = {}) {
  const req = Object.assign(new EventEmitter(), { url: `/__sql-inspector${subPath}`, method, headers: { host: "localhost:3000", ...headers } })
  const res = new FakeRes()
  const inspector = getInspector()
  handleInspectorRequest(req as never, res as never, subPath, inspector)
  return { res, inspector }
}

describe("the inspector's routes", () => {
  it("answers a rebound host with 403 and no data", () => {
    const { res } = call("GET", "/api/requests", { host: "evil.example.com:3000" })
    expect(res.statusCode).toBe(403)
    expect(res.body).toContain("SQL_INSPECTOR_ALLOWED_HOSTS")
    expect(call("GET", "/", { host: "evil.example.com" }).res.statusCode).toBe(403)
  })

  it("serves the page and API to localhost, and to a host that was allowed", () => {
    expect(call("GET", "/api/requests").res.statusCode).toBe(200)
    const { inspector } = call("GET", "/api/settings")
    inspector.allowedHosts.push("myapp.test")
    try {
      expect(call("GET", "/api/requests", { host: "myapp.test:3000" }).res.statusCode).toBe(200)
    } finally {
      inspector.allowedHosts.pop()
    }
  })

  it("refuses a cross-site clear and keeps the history", () => {
    const { inspector } = call("GET", "/api/requests")
    const trace = inspector.store.startRequest("GET", "/keep")
    inspector.store.record(trace, queryFor(trace))

    const blocked = call("POST", "/api/clear", { "origin": "https://evil.example.com", "sec-fetch-site": "cross-site" })
    expect(blocked.res.statusCode).toBe(403)
    expect(inspector.store.get(trace.id)).toBeDefined()

    expect(call("POST", "/api/clear", { origin: "http://localhost:3000" }).res.statusCode).toBe(200)
    expect(inspector.store.get(trace.id)).toBeUndefined()
  })
})

function queryFor(trace: RequestTrace, sql = "select 1", seq = 1): QueryEvent {
  return {
    seq,
    requestId: trace.id,
    connectionId: 1,
    api: "query",
    sql,
    params: null,
    startedAt: Date.now(),
    durationMs: 1,
    rowCount: 1,
    affectedRows: null,
    error: null,
    analysis: analyzeSql(sql)
  }
}

describe("report cache", () => {
  const options = { ...DEFAULT_REPORT_OPTIONS }

  function fresh() {
    const store = new TraceStore({ maxRequests: 10, maxQueriesPerRequest: 100 })
    const trace = store.startRequest("GET", "/x")
    store.record(trace, queryFor(trace))
    return { store, trace }
  }

  it("reuses a report while the trace is unchanged", () => {
    const { store, trace } = fresh()
    expect(cachedReport(store, trace, options)).toBe(cachedReport(store, trace, options))
  })

  it("rebuilds when a statement is added, finishes, or the request ends", () => {
    const { store, trace } = fresh()
    const first = cachedReport(store, trace, options)

    store.record(trace, queryFor(trace, "select 2", 2))
    const second = cachedReport(store, trace, options)
    expect(second).not.toBe(first)
    expect(second.totals.queryCount).toBe(2)

    trace.queries[1]!.durationMs = 500
    store.touch(trace)
    const third = cachedReport(store, trace, options)
    expect(third.insights.map(i => i.type)).toContain("slow")

    store.finishRequest(trace, 200)
    expect(cachedReport(store, trace, options)).not.toBe(third)
    expect(cachedReport(store, trace, options).trace.status).toBe(200)
  })

  it("rebuilds when a report option changes, such as the slow threshold", () => {
    const { store, trace } = fresh()
    trace.queries[0]!.durationMs = 150
    store.touch(trace)
    const strict = cachedReport(store, trace, { ...options, slowMs: 100 })
    const lax = cachedReport(store, trace, { ...options, slowMs: 200 })
    expect(strict.insights.map(i => i.type)).toContain("slow")
    expect(lax.insights.map(i => i.type)).not.toContain("slow")
  })

  it("formats a statement once", () => {
    const { trace } = fresh()
    const query = trace.queries[0]!
    expect(formattedSql(query)).toBe(formattedSql(query))
    expect(formattedSql(query)).toContain("select")
  })
})
