import { describe, expect, it } from "vitest"
import { runInOperation, runInRequest } from "../src/context"
import { exportOtlp } from "../src/otlp"
import { createRecorder } from "../src/recorder"
import { buildReport } from "../src/report"
import { analyzeSql } from "../src/sql-analyzer"
import { TraceStore } from "../src/store"

function sample() {
  const store = new TraceStore({ maxRequests: 10, maxQueriesPerRequest: 100 })
  store.captureCaller = true
  const rec = createRecorder(store)
  const trace = store.startRequest("GET", "/api/orders?page=2", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
  runInRequest(trace, () => {
    const outer = rec.begin({ driver: "prisma", api: "findMany", text: "Order.findMany {}", connectionId: 0, analysis: analyzeSql("select 1 from Order") })!
    runInOperation(outer.event, () => {
      rec.begin({ driver: "pg", api: "query", text: 'select "id" from "Order"', connectionId: 1, analysis: analyzeSql('select "id" from "Order"', "postgres") })?.end({ rowCount: 3 })
    })
    outer.end({ rowCount: 3 })
    const http = rec.begin({ driver: "fetch", api: "GET", text: "GET http://pay.test/charge", connectionId: 2, analysis: analyzeSql("select 1") })!
    http.end({ error: "HTTP 502", details: { status: 502, spanId: "abcdef0123456789" } })
  })
  store.finishRequest(trace, 200)
  return trace
}

describe("OTLP export", () => {
  const doc = exportOtlp([buildReport(sample())], { serviceName: "orders", root: process.cwd() })
  const spans = doc.resourceSpans[0]!.scopeSpans[0]!.spans
  const attr = (span: (typeof spans)[number], key: string) => span.attributes.find(a => a.key === key)?.value

  it("names the service and the scope", () => {
    expect(doc.resourceSpans[0]!.resource.attributes).toEqual([{ key: "service.name", value: { stringValue: "orders" } }])
    expect(doc.resourceSpans[0]!.scopeSpans[0]!.scope.name).toBe("sql-dev-inspector")
  })

  it("makes a server span for the request, under the caller's span when it came with a traceparent", () => {
    const root = spans[0]!
    expect(root).toMatchObject({ traceId: "4bf92f3577b34da6a3ce929d0e0e4736", parentSpanId: "00f067aa0ba902b7", name: "GET /api/orders", kind: 2 })
    expect(root.spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(BigInt(root.endTimeUnixNano)).toBeGreaterThanOrEqual(BigInt(root.startTimeUnixNano))
  })

  it("makes a client span for each call, with the database attributes and where it was called from", () => {
    const [root, op, inner] = spans as [typeof spans[number], typeof spans[number], typeof spans[number]]
    expect(op).toMatchObject({ kind: 3, parentSpanId: root.spanId })
    expect(attr(op, "db.system")).toEqual({ stringValue: "other_sql" })
    expect(attr(op, "code.file.path")).toEqual({ stringValue: "test/otlp.test.ts" })
    expect(inner).toMatchObject({ parentSpanId: op.spanId })
    expect(attr(inner, "db.system")).toEqual({ stringValue: "postgresql" })
    expect(attr(inner, "db.response.returned_rows")).toEqual({ intValue: "3" })
  })

  it("makes an HTTP call a client span with its status, the span id it propagated, and its error", () => {
    const call = spans.at(-1)!
    expect(call).toMatchObject({ spanId: "abcdef0123456789", status: { code: 2, message: "HTTP 502" } })
    expect(attr(call, "http.response.status_code")).toEqual({ intValue: "502" })
    expect(attr(call, "url.full")).toEqual({ stringValue: "http://pay.test/charge" })
  })

  it("gives the same ids when the same request is exported twice", () => {
    const report = buildReport(sample())
    const a = exportOtlp([report]).resourceSpans[0]!.scopeSpans[0]!.spans.map(s => s.spanId)
    const b = exportOtlp([report]).resourceSpans[0]!.scopeSpans[0]!.spans.map(s => s.spanId)
    expect(a).toEqual(b)
  })

  it("leaves the background out", () => {
    const store = new TraceStore({ maxRequests: 5, maxQueriesPerRequest: 5 })
    createRecorder(store).begin({ driver: "pg", api: "q", text: "select 1", connectionId: 1, analysis: analyzeSql("select 1") })?.end()
    expect(exportOtlp([buildReport(store.backgroundTrace())]).resourceSpans[0]!.scopeSpans[0]!.spans).toEqual([])
  })
})
