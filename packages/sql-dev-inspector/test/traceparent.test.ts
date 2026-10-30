import { describe, expect, it } from "vitest"
import { formatTraceparent, newSpanId, newTraceId, parseTraceparent } from "../src/traceparent"
import { TraceStore } from "../src/store"

describe("traceparent", () => {
  const good = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"

  it("parses a valid header and refuses what is not one", () => {
    expect(parseTraceparent(good)).toEqual({ traceId: "4bf92f3577b34da6a3ce929d0e0e4736", parentSpanId: "00f067aa0ba902b7", sampled: true })
    expect(parseTraceparent(good.toUpperCase())).not.toBeNull()
    expect(parseTraceparent(good.replace(/01$/, "00"))!.sampled).toBe(false)
    for (const bad of [undefined, "", "garbage", "01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01", `00-${"0".repeat(32)}-00f067aa0ba902b7-01`, "00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01", `${good}-extra`]) {
      expect(parseTraceparent(bad), String(bad)).toBeNull()
    }
  })

  it("makes ids of the right size and formats a header that parses back", () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/)
    expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/)
    const header = formatTraceparent("a".repeat(32), "b".repeat(16))
    expect(parseTraceparent(header)).toEqual({ traceId: "a".repeat(32), parentSpanId: "b".repeat(16), sampled: true })
  })
})

describe("a request that arrives with a traceparent", () => {
  const store = new TraceStore({ maxRequests: 5, maxQueriesPerRequest: 10 })

  it("joins the caller's trace and records the span it answers; one without starts its own", () => {
    const joined = store.startRequest("GET", "/x", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
    expect(joined).toMatchObject({ traceId: "4bf92f3577b34da6a3ce929d0e0e4736", parentSpanId: "00f067aa0ba902b7" })
    expect(joined.spanId).toMatch(/^[0-9a-f]{16}$/)
    const own = store.startRequest("GET", "/y")
    expect(own.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(own.parentSpanId).toBeUndefined()
    expect(own.traceId).not.toBe(joined.traceId)
  })
})
