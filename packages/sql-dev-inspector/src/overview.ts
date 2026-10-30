import type { RequestReport, TimeBreakdown } from "./types.js"
import { isControlStatement } from "./sql-analyzer.js"
import { pathnameOf } from "./route-filter.js"

export interface RouteRow {
  /** `GET /api/orders/:id`: ids in the path are folded together. */
  route: string
  requests: number
  avgMs: number
  p95Ms: number
  maxMs: number
  avgCalls: number
  maxCalls: number
  warnings: number
  errors: number
  /** How many requests of this route had each kind of finding. */
  issues: Record<string, number>
  /** The slowest request of the route, to open. */
  worstId: string
}

export interface CallRow {
  driver: string | null
  /** The call with its values masked. */
  text: string
  label: string
  count: number
  totalMs: number
  maxMs: number
  /** In how many different routes it is made. */
  routes: number
}

export interface Overview {
  requests: number
  from: number | null
  to: number | null
  totals: { calls: number, callMs: number, breakdown: TimeBreakdown }
  routes: RouteRow[]
  calls: CallRow[]
  issues: Array<{ type: string, requests: number, routes: number }>
}

const ID_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{24})$/i
const LIMIT = 15
const round = (value: number) => Math.round(value * 100) / 100

/** `GET /api/orders/42?x=1` → `GET /api/orders/:id`. */
export function routeOf(method: string, url: string): string {
  const path = pathnameOf(url).split("/").map(segment => ID_SEGMENT.test(segment) ? ":id" : segment).join("/")
  return `${method} ${path || "/"}`
}

const percentile = (sorted: number[], p: number) => sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!

/**
 * What the recent requests add up to: which routes are slowest and busiest, which calls cost the most in all, and which
 * findings keep coming back, instead of one request at a time. Requests outside any request (background) are left out.
 */
export function buildOverview(reports: RequestReport[]): Overview {
  const own = reports.filter(report => report.trace.id !== "background")
  const routes = new Map<string, RequestReport[]>()
  const calls = new Map<string, CallRow & { routeSet: Set<string> }>()
  const issues = new Map<string, { requests: number, routes: Set<string> }>()
  const breakdown: TimeBreakdown = { database: 0, cache: 0, http: 0, app: 0, total: 0 }
  let callCount = 0
  let callMs = 0

  for (const report of own) {
    const route = routeOf(report.trace.method, report.trace.url)
    routes.set(route, [...(routes.get(route) ?? []), report])
    callCount += report.totals.queryCount
    callMs += report.totals.sqlTimeMs
    for (const key of Object.keys(breakdown) as Array<keyof TimeBreakdown>) {
      breakdown[key] += report.totals.breakdown[key]
    }
    for (const query of report.trace.queries) {
      if (isControlStatement(query.analysis.kind)) {
        continue
      }
      const text = query.analysis.fingerprint || query.sql
      const key = `${query.driver ?? ""}\u0000${text}`
      const row = calls.get(key) ?? { driver: query.driver ?? null, text, label: query.analysis.label ?? query.analysis.kind, count: 0, totalMs: 0, maxMs: 0, routes: 0, routeSet: new Set<string>() }
      row.count++
      row.totalMs += query.durationMs ?? 0
      row.maxMs = Math.max(row.maxMs, query.durationMs ?? 0)
      row.routeSet.add(route)
      calls.set(key, row)
    }
    for (const type of new Set(report.insights.filter(insight => insight.severity !== "info").map(insight => insight.type))) {
      const entry = issues.get(type) ?? { requests: 0, routes: new Set<string>() }
      entry.requests++
      entry.routes.add(route)
      issues.set(type, entry)
    }
  }

  const rows: RouteRow[] = [...routes].map(([route, list]) => {
    const durations = list.map(report => report.trace.durationMs ?? report.totals.breakdown.total).sort((a, b) => a - b)
    const callCounts = list.map(report => report.totals.queryCount)
    const kinds: Record<string, number> = {}
    for (const report of list) {
      for (const type of new Set(report.insights.filter(insight => insight.severity !== "info").map(insight => insight.type))) {
        kinds[type] = (kinds[type] ?? 0) + 1
      }
    }
    const worst = list.reduce((a, b) => (b.trace.durationMs ?? 0) > (a.trace.durationMs ?? 0) ? b : a)
    return {
      route,
      requests: list.length,
      avgMs: round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
      p95Ms: round(percentile(durations, 0.95)),
      maxMs: round(durations.at(-1) ?? 0),
      avgCalls: round(callCounts.reduce((sum, value) => sum + value, 0) / callCounts.length),
      maxCalls: Math.max(0, ...callCounts),
      warnings: list.reduce((sum, report) => sum + report.insights.filter(insight => insight.severity === "warn").length, 0),
      errors: list.reduce((sum, report) => sum + report.insights.filter(insight => insight.severity === "error").length, 0),
      issues: kinds,
      worstId: worst.trace.id
    }
  }).sort((a, b) => b.avgMs * b.requests - a.avgMs * a.requests).slice(0, LIMIT)

  const starts = own.map(report => report.trace.startedAt)
  return {
    requests: own.length,
    from: starts.length > 0 ? Math.min(...starts) : null,
    to: starts.length > 0 ? Math.max(...starts) : null,
    totals: { calls: callCount, callMs: round(callMs), breakdown: Object.fromEntries(Object.entries(breakdown).map(([key, value]) => [key, round(value)])) as unknown as TimeBreakdown },
    routes: rows,
    calls: [...calls.values()]
      .map(({ routeSet, ...row }) => ({ ...row, totalMs: round(row.totalMs), maxMs: round(row.maxMs), routes: routeSet.size }))
      .sort((a, b) => b.totalMs - a.totalMs || b.count - a.count)
      .slice(0, LIMIT),
    issues: [...issues].map(([type, entry]) => ({ type, requests: entry.requests, routes: entry.routes.size })).sort((a, b) => b.requests - a.requests)
  }
}
