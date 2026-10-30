import type { IncomingMessage } from "node:http"
import { EventEmitter } from "node:events"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { diagnose, registerDiagnostics } from "../src/doctor"
import { handleInspectorRequest } from "../src/inspector-server"
import { createRecorder } from "../src/recorder"
import { runInRequest } from "../src/context"
import { getInspector } from "../src/runtime"
import { startInspector, resetInspectorForTests } from "../src/setup"
import { analyzeSql } from "../src/sql-analyzer"
import { mysql2Driver } from "../src/tracer"

const ids = (checks: ReturnType<typeof diagnose>) => Object.fromEntries(checks.map(check => [check.id, check.status]))

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development")
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("sqlDevInspector.runtime")]
  resetInspectorForTests()
  vi.spyOn(console, "log").mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe("the setup check", () => {
  it("says why it is off", () => {
    expect(diagnose(null, { NODE_ENV: "production" }).find(c => c.id === "enabled")!.message).toContain("production")
    expect(diagnose(null, {}).find(c => c.id === "enabled")!.message).toContain("NODE_ENV=development")
  })

  it("names the drivers that are watching, and warns about one that was asked for and is not", () => {
    startInspector({ NODE_ENV: "development", SQL_INSPECTOR_LOG: "0", SQL_INSPECTOR_NOTICE: "0" }, { drivers: [mysql2Driver] })
    const checks = diagnose(getInspector(), { NODE_ENV: "development", SQL_INSPECTOR_DRIVERS: "mysql2,nonsense" })
    expect(checks.find(c => c.id === "drivers")!.message).toContain("mysql2")
    expect(checks.find(c => c.id === "requested")!.message).toContain("nonsense")
  })

  it("errors when no driver is active", () => {
    startInspector({ NODE_ENV: "development", SQL_INSPECTOR_LOG: "0", SQL_INSPECTOR_NOTICE: "0" }, { drivers: [] })
    expect(ids(diagnose(getInspector(), { NODE_ENV: "development" })).drivers).toBe("error")
  })

  it("notices when every call is outside a request", () => {
    startInspector({ NODE_ENV: "development", SQL_INSPECTOR_LOG: "0", SQL_INSPECTOR_NOTICE: "0" }, { drivers: [mysql2Driver] })
    const store = getInspector().store
    createRecorder(store).begin({ driver: "t", api: "q", text: "select 1", connectionId: 1, analysis: analyzeSql("select 1") })?.end()
    expect(ids(diagnose(getInspector(), { NODE_ENV: "development" })).attribution).toBe("warn")

    const trace = store.startRequest("GET", "/x")
    runInRequest(trace, () => createRecorder(store).begin({ driver: "t", api: "q", text: "select 2", connectionId: 1, analysis: analyzeSql("select 2") })?.end())
    expect(ids(diagnose(getInspector(), { NODE_ENV: "development" })).attribution).toBe("ok")
  })

  it("adds the checks other packages register, and survives one that throws", () => {
    registerDiagnostics("test-ok", () => [{ id: "extra", status: "warn", message: "an extra check" }])
    registerDiagnostics("test-broken", () => { throw new Error("boom") })
    expect(diagnose(null, { NODE_ENV: "production" }).some(c => c.id === "extra")).toBe(true)
  })

  it("serves a request as Markdown, and 404s for one that is gone", () => {
    startInspector({ NODE_ENV: "development", SQL_INSPECTOR_LOG: "0", SQL_INSPECTOR_NOTICE: "0" }, { drivers: [mysql2Driver] })
    const store = getInspector().store
    const trace = store.startRequest("GET", "/api/x")
    runInRequest(trace, () => createRecorder(store).begin({ driver: "t", api: "q", text: "select 1", connectionId: 1, analysis: analyzeSql("select 1") })?.end())
    const get = (path: string) => {
      const req = Object.assign(new EventEmitter(), { url: `/__sql-inspector${path}`, method: "GET", headers: {} }) as unknown as IncomingMessage
      const out = { status: 200, type: "", body: "" }
      handleInspectorRequest(req, { writeHead(code: number, headers: Record<string, string> = {}) { out.status = code; out.type = headers["content-type"] ?? ""; return this }, write: (c: string) => (out.body += c), end: (c?: string) => { out.body += c ?? "" } } as never, path, getInspector())
      return out
    }
    const ok = get(`/api/requests/${trace.id}/markdown`)
    expect(ok.type).toContain("text/markdown")
    expect(ok.body).toContain("## GET /api/x")
    expect(get("/api/requests/nope/markdown").status).toBe(404)
    const json = get(`/api/requests/${trace.id}/export`)
    expect(json.type).toContain("application/json")
    expect(JSON.parse(json.body)).toMatchObject({ format: "sql-dev-inspector/request", version: 1, calls: [{ text: "select 1" }] })
    expect(get("/api/requests/nope/export").status).toBe(404)
    expect(JSON.parse(get("/api/overview").body)).toMatchObject({ requests: 1, routes: [{ route: "GET /api/x" }] })
    const other = store.startRequest("GET", "/api/y")
    runInRequest(other, () => createRecorder(store).begin({ driver: "t", api: "q", text: "select 2", connectionId: 1, analysis: analyzeSql("select 2") })?.end())
    const compared = JSON.parse(get(`/api/compare/${trace.id}/${other.id}`).body)
    expect(compared).toMatchObject({ a: { id: trace.id }, b: { id: other.id }, verdict: expect.any(String) })
    expect(get(`/api/compare/${trace.id}/nope`).status).toBe(404)
  })

  it("is served by the inspector as JSON, and the settings list the drivers", () => {
    startInspector({ NODE_ENV: "development", SQL_INSPECTOR_LOG: "0", SQL_INSPECTOR_NOTICE: "0" }, { drivers: [mysql2Driver] })
    const answer = (path: string) => {
      const req = Object.assign(new EventEmitter(), { url: `/__sql-inspector${path}`, method: "GET", headers: {} }) as unknown as IncomingMessage
      let body = ""
      handleInspectorRequest(req, { writeHead() { return this }, write: (c: string) => (body += c), end: (c?: string) => { body += c ?? "" } } as never, path, getInspector())
      return JSON.parse(body) as { checks?: unknown[], drivers?: string[] }
    }
    expect(answer("/api/doctor").checks!.length).toBeGreaterThan(2)
    expect(answer("/api/settings").drivers).toContain("mysql2")
  })
})
