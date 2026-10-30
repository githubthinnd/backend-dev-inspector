import type { QueryEvent, RequestTrace } from "./types.js"
import { randomUUID } from "node:crypto"
import { analyzeSql } from "./sql-analyzer.js"

/**
 * Saving the recorded requests and loading them again, so a profile can be kept, attached to a bug report, or compared with
 * one taken after a fix. This is a file the person saves and opens themselves (a download and an upload), not a
 * write to disk by the inspector: nothing is stored unless you ask for it, and values are as redacted as the inspector was
 * set to redact them when they were recorded.
 */

export const HISTORY_FORMAT = "sql-dev-inspector/history"
export const HISTORY_VERSION = 1
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024
const MAX_REQUESTS = 200
const MAX_CALLS = 500
const MAX_TEXT = 20_000

export interface HistoryFile {
  format: typeof HISTORY_FORMAT
  version: number
  savedAt: string
  requests: RequestTrace[]
}

export const exportHistory = (traces: RequestTrace[], now = new Date()): HistoryFile => ({
  format: HISTORY_FORMAT,
  version: HISTORY_VERSION,
  savedAt: now.toISOString(),
  requests: [...traces].reverse() // oldest first, so loading keeps the order
})

type Raw = Record<string, unknown>
const isObject = (value: unknown): value is Raw => !!value && typeof value === "object" && !Array.isArray(value)
const text = (value: unknown, max = MAX_TEXT) => typeof value === "string" ? value.slice(0, max) : null
const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null
const ID = /^[0-9a-f]+$/

const MAX_STATEMENTS = 20

function callOf(raw: unknown, requestId: string, next: () => number, nested = false): QueryEvent | null {
  if (!isObject(raw) || typeof raw.sql !== "string") {
    return null
  }
  const sql = raw.sql.slice(0, MAX_TEXT)
  const analysis = isObject(raw.analysis) ? raw.analysis : {}
  const fallback = analyzeSql(sql)
  const caller = isObject(raw.caller) && typeof raw.caller.file === "string" && num(raw.caller.line) !== null ? { file: raw.caller.file.slice(0, 500), line: raw.caller.line as number, column: num(raw.caller.column) ?? 0, ...(typeof raw.caller.fn === "string" ? { fn: raw.caller.fn.slice(0, 200) } : {}) } : null
  const details = isObject(raw.details) ? Object.fromEntries(Object.entries(raw.details).filter(([key, value]) => key.length < 40 && (typeof value === "number" || typeof value === "string")).slice(0, 20).map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 200) : value])) as Record<string, string | number> : null
  return {
    seq: next(),
    requestId,
    connectionId: num(raw.connectionId) ?? 0,
    api: text(raw.api, 60) ?? "query",
    sql,
    ...(text(raw.driver, 40) ? { driver: text(raw.driver, 40)! } : {}),
    params: Array.isArray(raw.params) ? raw.params.slice(0, 100).map(value => typeof value === "string" ? value.slice(0, 200) : value) : null,
    startedAt: num(raw.startedAt) ?? Date.now(),
    durationMs: num(raw.durationMs),
    rowCount: num(raw.rowCount),
    affectedRows: num(raw.affectedRows),
    error: text(raw.error, 2000),
    analysis: {
      kind: typeof analysis.kind === "string" ? analysis.kind as QueryEvent["analysis"]["kind"] : fallback.kind,
      ...(text(analysis.label, 80) ? { label: text(analysis.label, 80)! } : {}),
      tables: Array.isArray(analysis.tables) ? analysis.tables.filter((t): t is string => typeof t === "string").slice(0, 20).map(t => t.slice(0, 200)) : fallback.tables,
      subqueryDepth: num(analysis.subqueryDepth) ?? 0,
      subqueryCount: num(analysis.subqueryCount) ?? 0,
      fingerprint: text(analysis.fingerprint) ?? fallback.fingerprint,
      selectStar: analysis.selectStar === true,
      savepoint: text(analysis.savepoint, 200)
    },
    ...(caller ? { caller } : {}),
    ...(details && Object.keys(details).length > 0 ? { details } : {}),
    // what a library ran for this call (the SQL Prisma sent); one level, as the recorder keeps it
    ...(!nested && Array.isArray(raw.statements) && raw.statements.length > 0
      ? { statements: raw.statements.slice(-MAX_STATEMENTS).map(inner => callOf(inner, requestId, next, true)).filter((inner): inner is QueryEvent => inner !== null) }
      : {})
  }
}

/**
 * The requests of a history file, rebuilt field by field: only known fields are kept, with their types and sizes checked,
 * and ids are made new, so a file cannot overwrite a request or put anything in the store that the recorder could not.
 * Returns null when it is not a history file.
 */
export function importHistory(raw: unknown): RequestTrace[] | null {
  if (!isObject(raw) || raw.format !== HISTORY_FORMAT || raw.version !== HISTORY_VERSION || !Array.isArray(raw.requests)) {
    return null
  }
  let seq = -1_000_000_000 // imported calls sort before anything recorded now, and never clash with a live `seq`
  const traces: RequestTrace[] = []
  for (const item of raw.requests.slice(-MAX_REQUESTS)) {
    if (!isObject(item) || !Array.isArray(item.queries)) {
      continue
    }
    const id = randomUUID()
    const queries = item.queries.slice(-MAX_CALLS).map(query => callOf(query, id, () => seq++)).filter((query): query is QueryEvent => query !== null)
    traces.push({
      id,
      method: text(item.method, 20) ?? "GET",
      url: text(item.url, 2000) ?? "/",
      status: num(item.status),
      startedAt: num(item.startedAt) ?? Date.now(),
      durationMs: num(item.durationMs),
      ...(["params", "all", "off"].includes(String(item.redact)) ? { redact: item.redact as "params" } : {}),
      ...(typeof item.traceId === "string" && item.traceId.length === 32 && ID.test(item.traceId) ? { traceId: item.traceId } : {}),
      ...(typeof item.spanId === "string" && item.spanId.length === 16 && ID.test(item.spanId) ? { spanId: item.spanId } : {}),
      ...(typeof item.parentSpanId === "string" && item.parentSpanId.length === 16 && ID.test(item.parentSpanId) ? { parentSpanId: item.parentSpanId } : {}),
      queries,
      droppedQueries: num(item.droppedQueries) ?? 0,
      ...(Array.isArray(item.logs) ? { logs: item.logs.slice(0, 200).filter(isObject).map(entry => ({ level: (["log", "info", "warn", "error", "debug"].includes(String(entry.level)) ? entry.level : "log") as "log", at: num(entry.at) ?? 0, message: text(entry.message, 2000) ?? "" })) } : {})
    })
  }
  return traces
}
