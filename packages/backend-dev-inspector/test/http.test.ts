import http from "node:http"
import { duplexPair } from "node:stream"
import { createRequire } from "node:module"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildReport, createRecorder, getInspector, type RequestTrace, resetInspectorForTests, runInRequest, startInspector } from "sql-dev-inspector"
import { fetchDriver, httpDriver, safeUrl } from "../src/drivers/http"
import { fakeNetwork } from "./helpers/fake-net"
import { type MockHttp, startMockHttp } from "./helpers/mock-http"

const undici = createRequire(import.meta.url)("undici") as typeof import("undici")

let server: MockHttp
let uninstall: (() => void) | null = null
let restoreNetwork: (() => void) | null = null

const recorder = () => createRecorder(getInspector().store)
const request = (url: string): RequestTrace => getInspector().store.startRequest("GET", url)

/** A node:http request answered by the mock, over an in-memory stream instead of a socket. */
function get(path: string, options: http.RequestOptions & { body?: string } = {}): Promise<{ status: number, body: string }> {
  return new Promise((resolve, reject) => {
    const { body, ...rest } = options
    const req = http.request({ host: "api.test", port: 80, path, method: "GET", createConnection: () => server.stream() as never, ...rest }, (res) => {
      let data = ""
      res.on("data", chunk => (data += chunk))
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }))
    })
    req.on("error", reject)
    req.end(body)
  })
}

beforeEach(() => {
  server = startMockHttp()
  startInspector({ NODE_ENV: "development", SQL_INSPECTOR_LOG: "0", SQL_INSPECTOR_NOTICE: "0" }, { drivers: [] })
})
afterEach(() => {
  uninstall?.()
  uninstall = null
  restoreNetwork?.()
  restoreNetwork = null
  getInspector().store.clear()
  resetInspectorForTests()
})

describe("safeUrl", () => {
  it("drops credentials and hides the values of secret-looking parameters", () => {
    expect(safeUrl("https://user:pass@api.test/v1/items?id=4&api_key=SECRET&page=2&Token=abc")).toBe("https://api.test/v1/items?id=4&api_key=?&page=2&Token=?")
    expect(safeUrl("not a url")).toBe("not a url")
    expect(safeUrl("http://api.test/plain")).toBe("http://api.test/plain")
  })
})

describe("node:http client", () => {
  beforeEach(() => {
    uninstall = httpDriver.install(recorder())
  })

  it("records a request as the statement it resembles, with the status in its label", async () => {
    const trace = request("/page")
    await runInRequest(trace, async () => {
      expect((await get("/ok")).status).toBe(200)
      expect((await get("/echo", { method: "POST", body: "{\"a\":1}" })).status).toBe(200)
      expect((await get("/missing")).status).toBe(404)
    })
    expect(trace.queries.map(q => [q.driver, q.analysis.kind, q.analysis.label, q.sql, q.error])).toEqual([
      ["http", "select", "GET 200", "GET http://api.test/ok", null],
      ["http", "insert", "POST 200", "POST http://api.test/echo", null],
      ["http", "select", "GET 404", "GET http://api.test/missing", null]
    ])
    expect(trace.queries[0]!.analysis.tables).toEqual(["api.test/ok"])
    expect(trace.queries[0]!.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("keeps the status, the sizes and the harmless headers, and never a secret one", async () => {
    const trace = request("/details")
    await runInRequest(trace, async () => {
      await get("/echo", { method: "POST", body: "{\"a\":1}", headers: { authorization: "Bearer SECRET", cookie: "sid=SECRET", "content-length": "7", "x-api-key": "SECRET" } })
    })
    const details = trace.queries[0]!.details!
    expect(details).toMatchObject({ status: 200, requestBytes: 7 })
    expect(typeof details.responseBytes === "number" || details.contentType !== undefined).toBe(true)
    expect(JSON.stringify(trace.queries[0])).not.toContain("SECRET")
  })

  it("treats a 5xx as an error and a transport failure as an error", async () => {
    const trace = request("/errors")
    await runInRequest(trace, async () => {
      expect((await get("/boom")).status).toBe(500)
      // A connection nobody answers on, which dies after the request was sent, as when a server resets it.
      const dying = () => {
        const [stream] = duplexPair()
        for (const method of ["setNoDelay", "setKeepAlive", "setTimeout", "ref", "unref"]) {
          ;(stream as unknown as Record<string, unknown>)[method] = () => stream
        }
        setImmediate(() => stream.destroy(new Error("connection reset")))
        return stream
      }
      await expect(new Promise((_, reject) => {
        const req = http.request({ host: "api.test", path: "/x", createConnection: dying as never })
        req.on("error", reject)
        req.end()
      })).rejects.toThrow("connection reset")
    })
    expect(trace.queries[0]).toMatchObject({ error: "HTTP 500" })
    expect(trace.queries[1]!.error).toContain("connection reset")
  })

  it("reports an N+1 of calls to one endpoint that differ only by an id", async () => {
    const trace = request("/n-plus-one")
    await runInRequest(trace, async () => {
      for (const id of [1, 2, 3]) {
        await get(`/users/${id}`)
      }
    })
    expect(buildReport(trace).insights.find(i => i.type === "n-plus-one")?.params.sql).toBe("GET http://api.test/users/?")
  })

  it("keeps overlapping requests apart", async () => {
    const a = request("/a")
    const b = request("/b")
    await Promise.all([
      runInRequest(a, () => get("/slow?ms=30")),
      runInRequest(b, () => get("/ok?who=b"))
    ])
    expect(a.queries.map(q => q.sql)).toEqual(["GET http://api.test/slow?ms=30"])
    expect(b.queries.map(q => q.sql)).toEqual(["GET http://api.test/ok?who=b"])
  })

  it("hides credentials in the URL it records", async () => {
    const trace = request("/secret")
    await runInRequest(trace, () => get("/ok?api_key=TOPSECRET&q=1"))
    expect(JSON.stringify(trace.queries)).not.toContain("TOPSECRET")
    expect(trace.queries[0]!.sql).toContain("q=1")
  })

  it("stops recording once uninstalled", async () => {
    uninstall?.()
    uninstall = null
    const trace = request("/after")
    await runInRequest(trace, () => get("/ok"))
    expect(trace.queries).toHaveLength(0)
  })
})

describe("fetch and undici", () => {
  beforeEach(() => {
    restoreNetwork = fakeNetwork(server.serve)
    uninstall = fetchDriver.install(recorder())
  })

  it("records the global fetch", async () => {
    const trace = request("/fetch")
    await runInRequest(trace, async () => {
      const res = await fetch("http://api.test/ok")
      expect(res.status).toBe(200)
      await res.text()
      const echoed = await (await fetch("http://api.test/echo", { method: "POST", body: "hello" })).json() as { body: string }
      expect(echoed.body).toBe("hello")
    })
    expect(trace.queries.map(q => [q.driver, q.analysis.label, q.sql])).toEqual([
      ["fetch", "GET 200", "GET http://api.test/ok"],
      ["fetch", "POST 200", "POST http://api.test/echo"]
    ])
  })

  it("keeps the status and the size of what fetch got", async () => {
    const trace = request("/fetch-details")
    await runInRequest(trace, async () => {
      await (await fetch("http://api.test/echo", { method: "POST", body: "hello", headers: { authorization: "Bearer SECRET" } })).text()
    })
    expect(trace.queries[0]!.details).toMatchObject({ status: 200, requestBytes: 5 })
    expect(JSON.stringify(trace.queries[0])).not.toContain("SECRET")
  })

  it("records undici's own request() and its failures", async () => {
    const trace = request("/undici")
    await runInRequest(trace, async () => {
      const { statusCode, body } = await undici.request("http://api.test/boom")
      await body.text()
      expect(statusCode).toBe(500)
    })
    expect(trace.queries[0]).toMatchObject({ driver: "fetch", error: "HTTP 500" })
  })

  it("records a call that cannot connect, with its error", async () => {
    restoreNetwork?.()
    restoreNetwork = fakeNetwork(server.serve, { refuse: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), { code: "ECONNREFUSED" }) })
    const trace = request("/refused")
    await runInRequest(trace, async () => {
      await expect(fetch("http://refused.test/never")).rejects.toThrow()
    })
    expect(trace.queries).toHaveLength(1)
    expect(trace.queries[0]).toMatchObject({ driver: "fetch", sql: "GET http://refused.test/never" })
    expect(trace.queries[0]!.error).toBeTruthy()
    expect(trace.queries[0]!.durationMs).not.toBeNull()
  })

  it("reports an N+1 of fetches, and keeps overlapping requests apart", async () => {
    const n = request("/n-plus-one")
    await runInRequest(n, async () => {
      for (const id of [1, 2, 3]) {
        await (await fetch(`http://api.test/orders/${id}`)).text()
      }
    })
    expect(buildReport(n).insights.map(i => i.type)).toEqual(["n-plus-one"])

    const a = request("/a")
    const b = request("/b")
    await Promise.all([
      runInRequest(a, async () => (await fetch("http://api.test/slow?ms=30")).text()),
      runInRequest(b, async () => (await fetch("http://api.test/ok?who=b")).text())
    ])
    expect(a.queries.map(q => q.sql)).toEqual(["GET http://api.test/slow?ms=30"])
    expect(b.queries.map(q => q.sql)).toEqual(["GET http://api.test/ok?who=b"])
  })
})
