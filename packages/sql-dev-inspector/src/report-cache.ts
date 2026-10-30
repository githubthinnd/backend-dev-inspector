import type { ReportOptions } from "./report.js"
import type { TraceStore } from "./store.js"
import type { QueryEvent, RequestReport, RequestTrace } from "./types.js"
import { budgetKey } from "./budget.js"
import { buildReport } from "./report.js"
import { formatSql } from "./sql-analyzer.js"

/**
 * The request list and the detail view both want a report for the same trace on every change
 * event, and a report costs time proportional to the trace. A report only changes when its trace
 * does (the store counts those changes) or when a report option does, so it is kept until then.
 */
const reports = new WeakMap<RequestTrace, { key: string, report: RequestReport }>()
const formatted = new WeakMap<QueryEvent, string>()

export function cachedReport(store: TraceStore, trace: RequestTrace, options: ReportOptions): RequestReport {
  const key = `${store.versionOf(trace)}|${options.slowMs}|${options.nPlusOneThreshold}|${options.manyQueriesThreshold}|${options.transactionConvention}|${options.locale}|${budgetKey(options.budgets ?? [])}`
  const hit = reports.get(trace)
  if (hit?.key === key) {
    return hit.report
  }
  const report = buildReport(trace, options)
  reports.set(trace, { key, report })
  return report
}

/** A statement's text never changes, so its formatted form is computed once. */
export function formattedSql(query: QueryEvent): string {
  let text = formatted.get(query)
  if (text === undefined) {
    text = formatSql(query.sql)
    formatted.set(query, text)
  }
  return text
}
