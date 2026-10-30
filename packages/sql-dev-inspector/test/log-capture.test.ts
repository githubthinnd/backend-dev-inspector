import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { runIgnored, runInRequest } from "../src/context"
import { createRecorder } from "../src/recorder"
import { getInspector } from "../src/runtime"
import { resetInspectorForTests, startInspector } from "../src/setup"
import { analyzeSql } from "../src/sql-analyzer"
import { mysql2Driver } from "../src/tracer"

const printed: string[] = []

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development")
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("sqlDevInspector.runtime")]
  resetInspectorForTests()
  // the app's console, standing in for the terminal; installed before the inspector, as an app's own is
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { printed.push(`${level}: ${args.join(" ")}`) })
  }
  printed.length = 0
  startInspector({ NODE_ENV: "development", SQL_INSPECTOR_LOG: "0", SQL_INSPECTOR_NOTICE: "0" }, { drivers: [mysql2Driver] })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

const record = (trace: ReturnType<typeof getInspector>["store"]["startRequest"] extends (...a: never[]) => infer T ? T : never) =>
  createRecorder(getInspector().store).begin({ driver: "t", api: "q", text: "select 1", connectionId: 1, analysis: analyzeSql("select 1") })?.end() ?? trace

describe("console output under its request", () => {
  it("is off by default: nothing is listed, and the application still prints", () => {
    const trace = getInspector().store.startRequest("GET", "/x")
    runInRequest(trace, () => console.log("hello", 1))
    expect(trace.logs).toBeUndefined()
    expect(printed).toEqual(["log: hello 1"])
  })

  it("lists each line under the request that printed it, with its level, time and calling line, and still prints it", () => {
    const inspector = getInspector()
    inspector.logs = true
    inspector.stack = true
    const trace = inspector.store.startRequest("GET", "/orders")
    runInRequest(trace, () => {
      console.log("loading %s", "orders")
      console.warn("slow cache")
      console.error(new Error("boom").message, { id: 7 })
    })
    expect(trace.logs!.map(entry => [entry.level, entry.message])).toEqual([["log", "loading orders"], ["warn", "slow cache"], ["error", "boom { id: 7 }"]])
    expect(trace.logs![0]!.caller!.file).toMatch(/log-capture\.test\.ts$/)
    expect(trace.logs![0]!.at).toBeGreaterThan(0)
    expect(printed).toHaveLength(3)
  })

  it("ignores output outside any request, in a request the filters leave out, and the inspector's own", () => {
    const inspector = getInspector()
    inspector.logs = true
    console.log("at startup")
    runIgnored(() => console.log("a filtered request"))
    expect(inspector.store.list().flatMap(trace => trace.logs ?? [])).toEqual([])
    expect(printed).toHaveLength(2)
  })

  it("keeps ANSI colours out, and the list and each line within bounds", () => {
    const inspector = getInspector()
    inspector.logs = true
    const trace = inspector.store.startRequest("GET", "/x")
    runInRequest(trace, () => {
      console.log("\u001B[31mred\u001B[0m")
      console.log("x".repeat(5000))
      for (let i = 0; i < 300; i++) {
        console.debug(`line ${i}`)
      }
    })
    expect(trace.logs![0]!.message).toBe("red")
    expect(trace.logs![1]!.message).toHaveLength(2000)
    expect(trace.logs).toHaveLength(200)
  })

  it("shows with the request in the report API once the request has a call", () => {
    const inspector = getInspector()
    inspector.logs = true
    const trace = inspector.store.startRequest("GET", "/x")
    runInRequest(trace, () => {
      console.log("before the query")
      record(trace)
    })
    expect(inspector.store.get(trace.id)!.logs![0]!.message).toBe("before the query")
  })
})
