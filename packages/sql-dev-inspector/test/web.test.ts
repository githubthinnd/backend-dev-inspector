import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRecorder } from "../src/recorder"
import { getInspector } from "../src/runtime"
import { resetInspectorForTests } from "../src/setup"
import { analyzeSql } from "../src/sql-analyzer"
import { createWebInspector } from "../src/web"

const URL_BASE = "http://localhost:3000"
const call = (path: string, init?: RequestInit) => new Request(`${URL_BASE}/__sql-inspector${path}`, init)

beforeEach(() => {
  vi.stubEnv("SQL_INSPECTOR", "1")
  vi.stubEnv("SQL_INSPECTOR_LOG", "0")
})
afterEach(() => {
  vi.unstubAllEnvs()
  resetInspectorForTests()
  getInspector().store.clear()
  getInspector().report.slowMs = getInspector().defaultSlowMs
})

describe("web inspector", () => {
  it("is a no-op when the environment says no", async () => {
    vi.stubEnv("SQL_INSPECTOR", "0")
    const web = createWebInspector()
    expect(web.enabled).toBe(false)
    expect(await web.handle(call("/"))).toBeNull()
    const res = await web.track(new Request(`${URL_BASE}/x`), () => new Response("ok"))
    expect(await res.text()).toBe("ok")
  })

  it("leaves other URLs alone", async () => {
    const web = createWebInspector()
    expect(await web.handle(new Request(`${URL_BASE}/api/things`))).toBeNull()
    expect(await web.handle(new Request(`${URL_BASE}/api/__sql-inspector-not`))).toBeNull()
  })

  it("serves the page, the JSON API, a redirect and a 404", async () => {
    const web = createWebInspector()
    const page = (await web.handle(call("/")))!
    expect(page.status).toBe(200)
    expect(page.headers.get("content-type")).toContain("text/html")
    expect(await page.text()).toContain("<title>SQL Inspector</title>")

    const list = (await web.handle(call("/api/requests")))!
    expect(list.headers.get("content-type")).toContain("application/json")
    expect(await list.json()).toEqual([])

    const bare = (await web.handle(new Request(`${URL_BASE}/__sql-inspector`)))!
    expect(bare.status).toBe(308)
    expect(bare.headers.get("location")).toBe("/__sql-inspector/")

    expect((await web.handle(call("/api/nope")))!.status).toBe(404)
  })

  it("works under a base path", async () => {
    const web = createWebInspector()
    expect((await web.handle(new Request(`${URL_BASE}/app/__sql-inspector/api/settings`)))!.status).toBe(200)
  })

  it("refuses a rebound host and a cross-site POST", async () => {
    const web = createWebInspector()
    const rebound = (await web.handle(new Request("http://evil.example.com:3000/__sql-inspector/api/requests")))!
    expect(rebound.status).toBe(403)
    expect(((await rebound.json()) as { message: string }).message).toContain("SQL_INSPECTOR_ALLOWED_HOSTS")

    const trace = getInspector().store.startRequest("GET", "/keep")
    createRecorder(getInspector().store).begin({ driver: "t", api: "x", text: "select 1", connectionId: 1, analysis: analyzeSql("select 1") })
    const blocked = (await web.handle(call("/api/clear", { method: "POST", headers: { "sec-fetch-site": "cross-site", "origin": "https://evil.example.com" } })))!
    expect(blocked.status).toBe(403)
    expect(getInspector().store.get("background")).toBeDefined()
    expect(trace).toBeDefined()
  })

  it("reads a JSON body: sets and resets the slow-query threshold", async () => {
    const web = createWebInspector()
    const set = (await web.handle(call("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slowMs: 250 }) })))!
    expect(set.status).toBe(200)
    expect(((await set.json()) as { slowMs: number }).slowMs).toBe(250)
    expect(getInspector().report.slowMs).toBe(250)

    const reset = (await web.handle(call("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slowMs: null }) })))!
    expect(((await reset.json()) as { slowMs: number }).slowMs).toBe(getInspector().defaultSlowMs)

    expect((await web.handle(call("/api/settings", { method: "POST", body: "{}" })))!.status).toBe(415)
    expect((await web.handle(call("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" })))!.status).toBe(400)
  })

  it("streams change events and stops when the client goes away", async () => {
    const web = createWebInspector()
    const res = (await web.handle(call("/api/stream")))!
    expect(res.headers.get("content-type")).toBe("text/event-stream")
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()

    expect(decoder.decode((await reader.read()).value)).toContain(": connected")
    getInspector().store.settingsChanged()
    const event = decoder.decode((await reader.read()).value)
    expect(event).toContain("data:")
    expect(event).toContain("settings")

    await reader.cancel()
    expect(() => getInspector().store.settingsChanged()).not.toThrow()
  })

  it("traces a request: calls made inside belong to it, and it ends with the response's status", async () => {
    const web = createWebInspector()
    const recorder = createRecorder(getInspector().store)
    const response = await web.track(new Request(`${URL_BASE}/api/things?id=1`, { method: "POST" }), async () => {
      await Promise.resolve()
      recorder.begin({ driver: "t", api: "run", text: "select 1", connectionId: 1, analysis: analyzeSql("select 1") })!.end()
      return new Response("created", { status: 201 })
    })
    expect(response.status).toBe(201)

    const [trace] = getInspector().store.list()
    expect(trace).toMatchObject({ method: "POST", url: "/api/things?id=1", status: 201 })
    expect(trace!.queries).toHaveLength(1)
  })

  it("ends a request that throws with a 500, and rethrows", async () => {
    const web = createWebInspector()
    const recorder = createRecorder(getInspector().store)
    await expect(web.track(new Request(`${URL_BASE}/boom`), () => {
      recorder.begin({ driver: "t", api: "run", text: "select 1", connectionId: 1, analysis: analyzeSql("select 1") })
      throw new Error("handler failed")
    })).rejects.toThrow("handler failed")
    expect(getInspector().store.list()[0]).toMatchObject({ url: "/boom", status: 500 })
  })
})

describe("web inspector: a unit of work that has no Request (run)", () => {
  const recordOne = (text: string) => createRecorder(getInspector().store).begin({ driver: "t", api: "q", text, connectionId: 1, analysis: analyzeSql(text) })?.end()
  const traces = () => getInspector().store.list().filter(trace => trace.id !== "background")

  it("is one request of its own, with the calls made inside it, and ends 200 or with the status the caller maps", async () => {
    const web = createWebInspector()
    expect(await web.run("ACTION", "createOrder", async () => { recordOne("insert 1"); return 42 })).toBe(42)
    await web.run("GET", "/orders", async () => { recordOne("select 1") }, () => 307)
    expect(traces().map(t => [t.method, t.url, t.status, t.queries.length])).toEqual([["GET", "/orders", 307, 1], ["ACTION", "createOrder", 200, 1]])
  })

  it("ends 500 when it throws, passes the error on, and lets a mapper turn it into another status", async () => {
    const web = createWebInspector()
    // (a request that made no call is never kept, so each one makes a call before it fails)
    await expect(web.run("ACTION", "boom", async () => { recordOne("select 1"); throw new Error("no") })).rejects.toThrow("no")
    await expect(web.run("ACTION", "gone", async () => { recordOne("select 2"); throw new Error("nf") }, ({ error }) => error ? 404 : 200)).rejects.toThrow("nf")
    expect(traces().map(t => [t.url, t.status])).toEqual([["gone", 404], ["boom", 500]])
  })

  it("joins the request that is already traced, and leaves a filtered label alone", async () => {
    const web = createWebInspector()
    await web.track(new Request(`${URL_BASE}/api/x`), async () => {
      await web.run("ACTION", "inner", async () => { recordOne("select inner") })
      return new Response("ok")
    })
    expect(traces().map(t => [t.url, t.queries.length])).toEqual([["/api/x", 1]])
    getInspector().filters.exclude = ["/skipped"]
    try {
      await web.run("ACTION", "skipped", async () => { recordOne("select skipped") })
      expect(traces().some(t => t.url === "skipped")).toBe(false)
    } finally {
      getInspector().filters.exclude = []
    }
  })

  it("passes the work through when the inspector is off", async () => {
    vi.stubEnv("SQL_INSPECTOR", "0")
    expect(await createWebInspector().run("ACTION", "x", async () => "result")).toBe("result")
  })
})
