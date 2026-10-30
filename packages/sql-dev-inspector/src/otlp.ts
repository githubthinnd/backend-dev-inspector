import type { QueryEvent, RequestReport } from "./types.js"
import { createHash } from "node:crypto"
import { isControlStatement } from "./sql-analyzer.js"
import { newTraceId } from "./traceparent.js"

/**
 * The recorded requests as OpenTelemetry traces, in the OTLP/JSON format (`resourceSpans`), so what the inspector saw can
 * be loaded into any OpenTelemetry backend or tool (Jaeger, Tempo, Grafana, `otel-cli`, a collector's `/v1/traces`). This
 * only builds the document; the inspector never sends anything anywhere, so forwarding is yours:
 *
 *   curl -X POST -H 'content-type: application/json' --data-binary @traces.json http://localhost:4318/v1/traces
 *
 * One span per request (kind server), one per call (kind client) under it; the calls a library made for another
 * (the SQL Prisma sent) are children of that call. Values are as redacted as the inspector is set to redact them.
 */

type Attribute = { key: string, value: { stringValue: string } | { intValue: string } | { doubleValue: number } | { boolValue: boolean } }

export interface OtlpSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: 2 | 3
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes: Attribute[]
  status: { code: 0 | 1 | 2, message?: string }
}

export interface OtlpDocument {
  resourceSpans: Array<{
    resource: { attributes: Attribute[] }
    scopeSpans: Array<{ scope: { name: string, version?: string }, spans: OtlpSpan[] }>
  }>
}

const SYSTEMS: Record<string, string> = {
  mysql2: "mysql", mariadb: "mariadb", pg: "postgresql", postgres: "postgresql", neon: "postgresql", "better-sqlite3": "sqlite", "node:sqlite": "sqlite", d1: "sqlite",
  libsql: "sqlite", mongodb: "mongodb", ioredis: "redis", redis: "redis", elasticsearch: "elasticsearch", db0: "other_sql", prisma: "other_sql", aws: "aws", bullmq: "redis"
}
const HTTP_DRIVERS = new Set(["http", "fetch"])

const str = (key: string, value: string): Attribute => ({ key, value: { stringValue: value } })
const int = (key: string, value: number): Attribute => ({ key, value: { intValue: String(Math.round(value)) } })
const nano = (ms: number) => String(Math.round(ms * 1_000_000))
const ID = /^[0-9a-f]+$/

/** A span id that is the same every time the same call is exported: 8 bytes of a hash of where it is. */
const spanIdOf = (traceId: string, seq: number) => createHash("sha256").update(`${traceId}:${seq}`).digest("hex").slice(0, 16)

function spanOf(query: QueryEvent, traceId: string, parentSpanId: string, root?: string): OtlpSpan {
  const http = HTTP_DRIVERS.has(query.driver ?? "")
  const spanId = typeof query.details?.spanId === "string" && ID.test(query.details.spanId) && query.details.spanId.length === 16 ? query.details.spanId : spanIdOf(traceId, query.seq)
  const attributes: Attribute[] = [str("inspector.driver", query.driver ?? "unknown")]
  if (http) {
    const [method, ...url] = query.sql.split(" ")
    attributes.push(str("http.request.method", method ?? "GET"), str("url.full", url.join(" ")))
    if (typeof query.details?.status === "number") {
      attributes.push(int("http.response.status_code", query.details.status))
    }
  } else {
    attributes.push(str("db.system", SYSTEMS[query.driver ?? ""] ?? query.driver ?? "unknown"), str("db.query.text", query.sql), str("db.operation.name", query.analysis.label ?? query.analysis.kind))
    if (query.analysis.tables[0]) {
      attributes.push(str("db.collection.name", query.analysis.tables[0]))
    }
    if (query.rowCount !== null) {
      attributes.push(int("db.response.returned_rows", query.rowCount))
    }
  }
  for (const [key, value] of Object.entries(query.details ?? {})) {
    if (key !== "spanId" && key !== "status") {
      attributes.push(typeof value === "number" ? int(`inspector.${key}`, value) : str(`inspector.${key}`, String(value)))
    }
  }
  if (query.caller) {
    const file = root && query.caller.file.startsWith(`${root}/`) ? query.caller.file.slice(root.length + 1) : query.caller.file
    attributes.push(str("code.file.path", file), int("code.line.number", query.caller.line), ...(query.caller.fn ? [str("code.function.name", query.caller.fn)] : []))
  }
  return {
    traceId,
    spanId,
    parentSpanId,
    name: http ? query.sql.split("?")[0]!.slice(0, 120) : `${query.analysis.label ?? query.analysis.kind} ${query.analysis.tables[0] ?? ""}`.trim(),
    kind: 3,
    startTimeUnixNano: nano(query.startedAt),
    endTimeUnixNano: nano(query.startedAt + (query.durationMs ?? 0)),
    attributes,
    status: query.error ? { code: 2, message: query.error.slice(0, 200) } : { code: 0 }
  }
}

export function exportOtlp(reports: RequestReport[], options: { serviceName?: string, root?: string } = {}): OtlpDocument {
  const spans: OtlpSpan[] = []
  for (const { trace } of reports) {
    if (trace.id === "background") {
      continue
    }
    const traceId = trace.traceId ?? newTraceId()
    const spanId = trace.spanId ?? spanIdOf(traceId, -1)
    const end = trace.durationMs !== null ? trace.startedAt + trace.durationMs : Math.max(trace.startedAt, ...trace.queries.map(q => q.startedAt + (q.durationMs ?? 0)))
    const failed = (trace.status ?? 0) >= 500
    spans.push({
      traceId,
      spanId,
      ...(trace.parentSpanId ? { parentSpanId: trace.parentSpanId } : {}),
      name: `${trace.method} ${trace.url.split("?")[0]}`,
      kind: 2,
      startTimeUnixNano: nano(trace.startedAt),
      endTimeUnixNano: nano(end),
      attributes: [str("http.request.method", trace.method), str("url.path", trace.url.split("?")[0]!), ...(trace.status !== null ? [int("http.response.status_code", trace.status)] : [])],
      status: failed ? { code: 2 } : { code: 0 }
    })
    for (const query of trace.queries) {
      if (isControlStatement(query.analysis.kind)) {
        continue
      }
      const span = spanOf(query, traceId, spanId, options.root)
      spans.push(span)
      for (const inner of query.statements ?? []) {
        spans.push(spanOf(inner, traceId, span.spanId, options.root))
      }
    }
  }
  return {
    resourceSpans: [{
      resource: { attributes: [str("service.name", options.serviceName ?? "dev-inspector")] },
      scopeSpans: [{ scope: { name: "sql-dev-inspector" }, spans }]
    }]
  }
}
