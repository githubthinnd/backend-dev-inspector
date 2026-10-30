import type { RequestReport } from "./types.js"
import { isControlStatement } from "./sql-analyzer.js"

export interface RequestRef {
  id: string
  method: string
  url: string
  status: number | null
  durationMs: number | null
}

export interface Pair {
  a: number
  b: number
  delta: number
}

export interface GroupDiff {
  driver: string | null
  /** The call with its values masked, so the same call with other values is one group. */
  text: string
  label: string
  tables: string[]
  count: Pair
  ms: Pair
  /** `added` and `removed` are in only one of the two requests. */
  change: "added" | "removed" | "more" | "fewer" | "slower" | "faster"
}

export interface Comparison {
  a: RequestRef
  b: RequestRef
  totals: { calls: Pair, callMs: Pair, totalMs: Pair, database: Pair, cache: Pair, http: Pair, app: Pair }
  groups: GroupDiff[]
  findings: Array<{ type: string, a: number, b: number }>
  /** `b` against `a`, by wall-clock duration: more than 10% and 5 ms apart counts as a change. */
  verdict: "slower" | "faster" | "same"
}

const pair = (a: number, b: number): Pair => ({ a, b, delta: b - a })
const refOf = (report: RequestReport): RequestRef => {
  const { id, method, url, status, durationMs } = report.trace
  return { id, method, url, status, durationMs }
}

interface Acc { driver: string | null, text: string, label: string, tables: string[], count: number, ms: number }

function groupsOf(report: RequestReport): Map<string, Acc> {
  const groups = new Map<string, Acc>()
  for (const query of report.trace.queries) {
    if (isControlStatement(query.analysis.kind)) {
      continue
    }
    const text = query.analysis.fingerprint || query.sql
    const key = `${query.driver ?? ""}\u0000${text}`
    const group = groups.get(key) ?? { driver: query.driver ?? null, text, label: query.analysis.label ?? query.analysis.kind, tables: query.analysis.tables, count: 0, ms: 0 }
    group.count++
    group.ms += query.durationMs ?? 0
    groups.set(key, group)
  }
  return groups
}

const round = (value: number) => Math.round(value * 100) / 100

/**
 * What changed between two requests: the calls that are new or gone, the calls that ran more often or took longer,
 * and the findings that appeared or went away. Calls are matched by what they are (driver and masked text), not by order.
 */
export function compareReports(a: RequestReport, b: RequestReport): Comparison {
  const left = groupsOf(a)
  const right = groupsOf(b)
  const groups: GroupDiff[] = []
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const x = left.get(key)
    const y = right.get(key)
    const base = (y ?? x)!
    const count = pair(x?.count ?? 0, y?.count ?? 0)
    const ms = pair(round(x?.ms ?? 0), round(y?.ms ?? 0))
    ms.delta = round(ms.delta)
    let change: GroupDiff["change"] | null = null
    if (!x) {
      change = "added"
    } else if (!y) {
      change = "removed"
    } else if (count.delta !== 0) {
      change = count.delta > 0 ? "more" : "fewer"
    } else if (Math.abs(ms.delta) >= 5 && Math.abs(ms.delta) >= 0.25 * Math.max(ms.a, 1)) {
      change = ms.delta > 0 ? "slower" : "faster"
    }
    if (change) {
      groups.push({ driver: base.driver, text: base.text, label: base.label, tables: base.tables, count, ms, change })
    }
  }
  groups.sort((p, q) => Math.abs(q.ms.delta) - Math.abs(p.ms.delta) || Math.abs(q.count.delta) - Math.abs(p.count.delta))

  const types = new Set([...a.insights, ...b.insights].map(insight => insight.type))
  const findings = [...types]
    .map(type => ({ type, a: a.insights.filter(i => i.type === type).length, b: b.insights.filter(i => i.type === type).length }))
    .filter(row => row.a !== row.b)

  const ba = a.totals.breakdown
  const bb = b.totals.breakdown
  const totals = {
    calls: pair(a.totals.queryCount, b.totals.queryCount),
    callMs: pair(round(a.totals.sqlTimeMs), round(b.totals.sqlTimeMs)),
    totalMs: pair(round(ba.total), round(bb.total)),
    database: pair(round(ba.database), round(bb.database)),
    cache: pair(round(ba.cache), round(bb.cache)),
    http: pair(round(ba.http), round(bb.http)),
    app: pair(round(ba.app), round(bb.app))
  }
  for (const part of Object.values(totals)) {
    part.delta = round(part.delta)
  }
  const verdict = Math.abs(totals.totalMs.delta) >= 5 && Math.abs(totals.totalMs.delta) >= 0.1 * Math.max(totals.totalMs.a, 1)
    ? (totals.totalMs.delta > 0 ? "slower" : "faster")
    : "same"
  return { a: refOf(a), b: refOf(b), totals, groups, findings, verdict }
}
