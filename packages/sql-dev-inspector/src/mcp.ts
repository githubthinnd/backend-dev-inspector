import type { Inspector } from "./runtime.js"
import { shortLocation } from "./caller.js"
import { compareReports } from "./compare.js"
import { diagnose } from "./doctor.js"
import { cachedReport } from "./report-cache.js"
import { pathnameOf } from "./route-filter.js"
import { installedDrivers } from "./setup.js"

/**
 * A Model Context Protocol server over HTTP (`POST <page>/mcp`), so a coding agent can ask the running application what
 * it did: "which request is slow?", "where does this N+1 come from?". It is read-only: six tools, no way to change a
 * setting, clear the history or run anything. It answers with what the inspector already holds, with values redacted
 * as the inspector is set to redact them, and the same guards as the page apply (local `Host` only).
 *
 * Connect it:  claude mcp add --transport http dev-inspector http://localhost:3000/__sql-inspector/mcp
 */

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"]
const MAX_STATEMENTS = 200
const MAX_SQL = 1000
const MAX_PROBLEMS = 30

interface RpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

interface RpcResponse {
  jsonrpc: "2.0"
  id: string | number | null
  result?: unknown
  error?: { code: number, message: string }
}

const TOOLS = [
  {
    name: "list_requests",
    description: "The requests the application has handled recently, newest first, with how many calls (SQL, Redis, MongoDB, HTTP) each made, how long they took, and how many warnings and errors the inspector raised.",
    inputSchema: { type: "object", properties: { limit: { type: "number", description: "At most this many (default 20)." }, onlyIssues: { type: "boolean", description: "Only requests with a warning or an error." } } }
  },
  {
    name: "get_request",
    description: "One request in full: its calls in order, with timing, rows, errors and the line of code that made each; the insights (N+1, duplicates, slow calls, errors) with advice on how to fix them.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "A request id from list_requests." } }, required: ["id"] }
  },
  {
    name: "compare_requests",
    description: "What changed between two requests (for example the same endpoint before and after a fix): calls that are new, gone, repeated more or fewer times or slower, the time split, and warnings that appeared or went away. `before` and `after` are request ids from list_requests.",
    inputSchema: { type: "object", properties: { before: { type: "string" }, after: { type: "string" } }, required: ["before", "after"] }
  },
  {
    name: "find_problems",
    description: "Every warning and error across the recent requests, grouped by route and kind, worst first. The place to start when asked what is wrong with the application.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_settings",
    description: "How the inspector is set up: slow-call threshold, whether values are hidden, which routes are followed, which drivers are active.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "diagnose",
    description: "Checks the inspector's own setup: is it on, which libraries are watched, do calls reach requests. Use it when the other tools return nothing.",
    inputSchema: { type: "object", properties: {} }
  }
]

const text = (value: unknown, isError = false) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) })

function summary(inspector: Inspector, trace: ReturnType<Inspector["store"]["list"]>[number]) {
  const { totals, insights } = cachedReport(inspector.store, trace, inspector.report)
  return {
    id: trace.id,
    method: trace.method,
    url: trace.url,
    status: trace.status,
    durationMs: trace.durationMs,
    calls: totals.queryCount,
    callTimeMs: Math.round(totals.sqlTimeMs * 100) / 100,
    warnings: insights.filter(insight => insight.severity === "warn").length,
    errors: insights.filter(insight => insight.severity === "error").length
  }
}

function listRequests(inspector: Inspector, args: Record<string, unknown>) {
  const limit = typeof args.limit === "number" && args.limit > 0 ? Math.min(200, Math.floor(args.limit)) : 20
  const rows = inspector.store.list().map(trace => summary(inspector, trace))
  return text(args.onlyIssues ? rows.filter(row => row.warnings + row.errors > 0).slice(0, limit) : rows.slice(0, limit))
}

function getRequest(inspector: Inspector, args: Record<string, unknown>) {
  const trace = typeof args.id === "string" ? inspector.store.get(args.id) : undefined
  if (!trace) {
    return text({ error: "Request not found: it was evicted or cleared. Call list_requests for the current ids." }, true)
  }
  const report = cachedReport(inspector.store, trace, inspector.report)
  const where = (caller?: { file: string, line: number }) => caller ? shortLocation(caller, inspector.root) : undefined
  return text({
    ...summary(inspector, trace),
    totals: report.totals,
    insights: report.insights.map(insight => ({
      type: insight.type,
      severity: insight.severity,
      message: insight.message,
      ...(insight.hint ? { hint: insight.hint } : {}),
      ...(insight.params.caller ? { calledFrom: String(insight.params.caller).replace(`${inspector.root}/`, "") } : {}),
      statements: insight.seqs
    })),
    ...(trace.logs && trace.logs.length > 0 ? { logs: trace.logs.slice(0, 100).map(entry => ({ level: entry.level, atMs: entry.at - trace.startedAt, message: entry.message, ...(entry.caller ? { calledFrom: where(entry.caller) } : {}) })) } : {}),
    statements: trace.queries.slice(0, MAX_STATEMENTS).map(query => ({
      seq: query.seq,
      driver: query.driver,
      call: query.api,
      sql: query.sql.length > MAX_SQL ? `${query.sql.slice(0, MAX_SQL)}…` : query.sql,
      ...(query.params && query.params.length > 0 ? { params: query.params } : {}),
      durationMs: query.durationMs === null ? null : Math.round(query.durationMs * 100) / 100,
      rows: query.rowCount ?? query.affectedRows ?? undefined,
      ...(query.error ? { error: query.error } : {}),
      ...(query.caller ? { calledFrom: where(query.caller) } : {}),
      ...(query.details ? { details: query.details } : {}),
      ...(query.statements?.length ? { sentToDatabase: query.statements.map(s => ({ sql: s.sql.length > MAX_SQL ? `${s.sql.slice(0, MAX_SQL)}…` : s.sql, durationMs: s.durationMs === null ? null : Math.round(s.durationMs * 100) / 100 })) } : {}),
      connection: query.connectionId
    })),
    ...(trace.queries.length > MAX_STATEMENTS ? { truncated: `${trace.queries.length - MAX_STATEMENTS} more calls not listed` } : {})
  })
}

function compareRequests(inspector: Inspector, args: Record<string, unknown>) {
  const first = typeof args.before === "string" ? inspector.store.get(args.before) : undefined
  const second = typeof args.after === "string" ? inspector.store.get(args.after) : undefined
  if (!first || !second) {
    return text({ error: "Request not found: it was evicted or cleared. Call list_requests for the current ids." }, true)
  }
  return text(compareReports(cachedReport(inspector.store, first, inspector.report), cachedReport(inspector.store, second, inspector.report)))
}

function findProblems(inspector: Inspector) {
  const groups = new Map<string, { route: string, type: string, severity: string, requests: number, example: string, hint?: string, calledFrom?: string, requestId: string }>()
  for (const trace of inspector.store.list()) {
    for (const insight of cachedReport(inspector.store, trace, inspector.report).insights) {
      if (insight.severity === "info") {
        continue
      }
      const route = `${trace.method} ${pathnameOf(trace.url)}`
      const key = `${route}|${insight.type}`
      const found = groups.get(key)
      if (found) {
        found.requests++
      } else {
        groups.set(key, {
          route, type: insight.type, severity: insight.severity, requests: 1, example: insight.message, requestId: trace.id,
          ...(insight.hint ? { hint: insight.hint } : {}),
          ...(insight.params.caller ? { calledFrom: String(insight.params.caller).replace(`${inspector.root}/`, "") } : {})
        })
      }
    }
  }
  const order = (severity: string) => severity === "error" ? 0 : 1
  const problems = [...groups.values()].sort((a, b) => order(a.severity) - order(b.severity) || b.requests - a.requests).slice(0, MAX_PROBLEMS)
  return text(problems.length > 0 ? problems : { message: "No warnings or errors in the recent requests." })
}

function callTool(inspector: Inspector, name: string, args: Record<string, unknown>) {
  switch (name) {
    case "list_requests":
      return listRequests(inspector, args)
    case "get_request":
      return getRequest(inspector, args)
    case "compare_requests":
      return compareRequests(inspector, args)
    case "find_problems":
      return findProblems(inspector)
    case "get_settings":
      return text({
        slowMs: inspector.report.slowMs,
        redact: inspector.redact,
        include: inspector.filters.include,
        exclude: inspector.filters.exclude,
        findCallingLine: inspector.stack,
        drivers: installedDrivers(),
        page: `/${inspector.mount}/`
      })
    case "diagnose":
      return text({ checks: diagnose(inspector) })
    default:
      return null
  }
}

function respond(inspector: Inspector, request: RpcRequest): RpcResponse | null {
  const id = request.id ?? null
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid request" } }
  }
  if (request.id === undefined) {
    return null // a notification (notifications/initialized…): nothing to answer
  }
  switch (request.method) {
    case "initialize": {
      const asked = String(request.params?.protocolVersion ?? "")
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "dev-inspector", version: "1" },
          instructions: "Read-only view of what the running application just did: requests, the calls each made (SQL, Redis, MongoDB, HTTP), and the problems found. Start with find_problems, then get_request."
        }
      }
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} }
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } }
    case "tools/call": {
      const name = String(request.params?.name ?? "")
      const args = (request.params?.arguments ?? {}) as Record<string, unknown>
      const result = callTool(inspector, name, args)
      return result ? { jsonrpc: "2.0", id, result } : { jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${name}` } }
    }
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${request.method}` } }
  }
}

/** The answer to one JSON-RPC message or a batch of them; `null` when there is nothing to send back (notifications only). */
export function handleMcp(inspector: Inspector, body: unknown): RpcResponse | RpcResponse[] | null {
  if (Array.isArray(body)) {
    const answers = body.map(item => respond(inspector, item as RpcRequest)).filter((answer): answer is RpcResponse => answer !== null)
    return answers.length > 0 ? answers : null
  }
  return respond(inspector, (body ?? {}) as RpcRequest)
}
