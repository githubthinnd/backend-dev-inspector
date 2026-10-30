import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { runIgnored, runInRequest } from "../src/context"
import { getInspector, outgoingTraceparent } from "../src/runtime"
import { resetInspectorForTests, startInspector } from "../src/setup"
import { parseTraceparent } from "../src/traceparent"

const KEY = Symbol.for("sqlDevInspector.runtime")
const fresh = (env: Record<string, string>, options = {}) => {
  delete (globalThis as Record<symbol, unknown>)[KEY]
  resetInspectorForTests()
  return startInspector({ NODE_ENV: "development", SQL_INSPECTOR_LOG: "0", SQL_INSPECTOR_NOTICE: "0", ...env }, { drivers: [], ...options })!
}

let printed: string[] = []
beforeEach(() => {
  printed = []
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { printed.push(args.join(" ")) })
})
afterEach(() => {
  vi.restoreAllMocks()
  delete (globalThis as Record<symbol, unknown>)[KEY]
  resetInspectorForTests()
})

describe("starting with a token", () => {
  it("prints the address to open when the token is made up (auto), and nothing when you chose it", () => {
    const auto = fresh({ SQL_INSPECTOR_TOKEN: "auto" })
    expect(auto.token).toMatch(/^[\w-]{20,}$/)
    expect(printed.join("\n")).toContain(`/__sql-inspector/?token=${auto.token}`)
    printed = []
    fresh({ SQL_INSPECTOR_TOKEN: "my-own-secret" })
    expect(printed.join("\n")).not.toContain("my-own-secret")
  })

  it("says the inspector is locked when the token is too short, and never prints the token it made up", () => {
    const locked = fresh({ SQL_INSPECTOR_TOKEN: "short" })
    expect(locked.tokenRejected).toBe(true)
    expect(printed.join("\n")).toMatch(/LOCKED/)
    expect(printed.join("\n")).not.toContain(locked.token!)
  })

  it("has no token, and says nothing, when none is set", () => {
    const open = fresh({})
    expect(open.token).toBeNull()
    expect(printed.filter(line => /token/i.test(line))).toEqual([])
  })
})

describe("the options of startInspector", () => {
  it("take budgets, the path, the editor and the filters, and keep them as the defaults the page can go back to", () => {
    const inspector = fresh({}, { budgets: ["/api/**=calls:5"], path: "/_dev/sql", editor: "cursor", include: ["/api/**"], exclude: ["/api/health"], redact: "all", stack: false })
    expect(inspector.budgets).toEqual(["/api/**=calls:5"])
    expect(inspector.defaults.budgets).toEqual(["/api/**=calls:5"])
    expect(inspector.report.budgets).toHaveLength(1)
    expect(inspector.mount).toBe("_dev/sql")
    expect(inspector.editor.name).toBe("cursor")
    expect(inspector.filters).toEqual({ include: ["/api/**"], exclude: ["/api/health"] })
    expect(inspector.redact).toBe("all")
    expect(inspector.store.redact).toBe("all")
    expect(inspector.stack).toBe(false)
    expect(inspector.store.captureCaller).toBe(false)
  })
})

describe("the traceparent of an outgoing call", () => {
  it("names the current request's trace and a new span, only when propagation is on and the request is traced", () => {
    const inspector = fresh({ SQL_INSPECTOR_PROPAGATE: "1" })
    expect(outgoingTraceparent()).toBeNull() // no request
    const trace = inspector.store.startRequest("GET", "/x")
    const next = runInRequest(trace, () => outgoingTraceparent())!
    expect(parseTraceparent(next.header)).toMatchObject({ traceId: trace.traceId, parentSpanId: next.spanId })
    expect(next.spanId).not.toBe(trace.spanId)
    expect(runIgnored(() => outgoingTraceparent())).toBeNull()
    inspector.propagate = false
    expect(runInRequest(trace, () => outgoingTraceparent())).toBeNull()
    expect(getInspector().propagate).toBe(false)
  })
})
