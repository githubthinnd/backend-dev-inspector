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
