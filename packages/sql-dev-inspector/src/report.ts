import { rememberedCallKey } from "./call-key.js"
import type { Insight, InsightType, QueryEvent, RequestReport, RequestTrace, TimeBreakdown, TraceNode, TransactionNode } from "./types.js"
import { DEFAULT_LOCALE, isMessageKey, type Locale, type MessageKey, translate } from "./i18n/index.js"
import { type Budget, budgetFor } from "./budget.js"
import { isControlStatement, isWriteStatement } from "./sql-analyzer.js"

export interface ReportOptions {
  slowMs: number
  nPlusOneThreshold: number
  manyQueriesThreshold: number
  /**
   * Opt-in team convention check: reads belong outside a transaction, and a transaction is only
   * for writes. Off by default because it is a style rule, not a defect.
   */
  transactionConvention: boolean
  /** Language of `Insight.message`. The structured fields are language-neutral. */
  locale: Locale
  /** Limits per route; a request over its limit gets a warning. */
  budgets: Budget[]
}

export const DEFAULT_REPORT_OPTIONS: ReportOptions = {
  slowMs: 100,
  nPlusOneThreshold: 3,
  manyQueriesThreshold: 30,
  transactionConvention: false,
  locale: DEFAULT_LOCALE,
  budgets: []
}

const endOf = (query: QueryEvent) => query.startedAt + (query.durationMs ?? 0)

/**
 * Rebuilds the call structure of one request: statements run in a transaction nest under it,
 * savepoints nest under their parent transaction, and everything else sits at the top level.
 *
 * Nesting is per connection. A transaction owns one connection, so two transactions running
 * at once in the same request (Promise.all) stay apart instead of interleaving.
 */
export function buildTree(queries: QueryEvent[]): TraceNode[] {
  const roots: TraceNode[] = []
  const openByConnection = new Map<number, TransactionNode[]>()

  const place = (node: TraceNode, connectionId: number) => {
    const stack = openByConnection.get(connectionId)
    const parent = stack?.at(-1)
    if (parent) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const open = (query: QueryEvent, type: TransactionNode["type"]) => {
    const node: TransactionNode = {
      type,
      connectionId: query.connectionId,
      name: query.analysis.savepoint,
      status: "open",
      startedAt: query.startedAt,
      durationMs: null,
      children: []
    }
    place(node, query.connectionId)
    const stack = openByConnection.get(query.connectionId) ?? []
    stack.push(node)
    openByConnection.set(query.connectionId, stack)
  }

  // `until` names the savepoint to stop at. A release / rollback of a savepoint that is not open
  // (already rolled back, or opened before the capped window) must leave the transaction alone.
  const close = (query: QueryEvent, status: TransactionNode["status"], until?: (node: TransactionNode) => boolean) => {
    const stack = openByConnection.get(query.connectionId) ?? []
    if (until && !stack.some(until)) {
      return
    }
    while (stack.length > 0) {
      const node = stack.pop()!
      node.status = status
      node.durationMs = endOf(query) - node.startedAt
      if (until?.(node)) {
        break
      }
    }
  }

  for (const query of [...queries].sort((a, b) => a.seq - b.seq)) {
    switch (query.analysis.kind) {
      case "tx-begin":
        open(query, "transaction")
        break
      case "savepoint":
        open(query, "savepoint")
        break
      case "tx-commit":
        close(query, "committed")
        break
      case "tx-rollback":
        close(query, "rolled-back")
        break
      case "savepoint-release":
        close(query, "committed", node => node.type === "savepoint" && node.name === query.analysis.savepoint)
        break
      case "savepoint-rollback":
        close(query, "rolled-back", node => node.type === "savepoint" && node.name === query.analysis.savepoint)
        break
      case "tx-config":
        break
      default:
        place({ type: "query", query }, query.connectionId)
    }
  }
  return roots
}

function* walk(nodes: TraceNode[], insideTransaction = false): Generator<{ query: QueryEvent, insideTransaction: boolean }> {
  for (const node of nodes) {
    if (node.type === "query") {
      yield { query: node.query, insideTransaction }
    } else {
      yield* walk(node.children, true)
    }
  }
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const group = groups.get(key)
    if (group) {
      group.push(item)
    } else {
      groups.set(key, [item])
    }
  }
  return groups
}

/**
 * What makes two statements the same call: the text, plus the bound values of a prepared
 * statement (`execute`), whose text is identical for every value. `query()` has the values
 * inlined in its text already.
 */
function callKey(query: QueryEvent): string {
  const remembered = rememberedCallKey(query)
  if (remembered) {
    return remembered
  }
  if (!query.params || query.params.length === 0) {
    return query.sql
  }
  try {
    return `${query.sql}\u0000${JSON.stringify(query.params)}`
  } catch {
    return `${query.sql}\u0000${query.params.map(String).join(",")}`
  }
}

const shorten = (text: string, max = 90) => text.length > max ? `${text.slice(0, max)}…` : text
const sumMs = (queries: QueryEvent[]) => queries.reduce((total, q) => total + (q.durationMs ?? 0), 0)
const formatMs = (value: number) => value < 1000 ? `${value.toFixed(value < 10 ? 2 : 1)}ms` : `${(value / 1000).toFixed(2)}s`

type InsightDraft = Omit<Insight, "message" | "hint">

const FAMILIES: Record<string, string> = {
  mongodb: "mongodb", redis: "redis", ioredis: "redis", http: "http", fetch: "http"
}

/** `sql`, `mongodb`, `redis` or `http`: what kind of call an insight is about, which decides what to advise. */
function familyOf(insight: InsightDraft, queries: QueryEvent[]): string {
  const first = queries.find(query => insight.seqs.includes(query.seq))
  return FAMILIES[first?.driver ?? ""] ?? "sql"
}

/** The advice for an insight, from the most specific message that exists (`insight.hint.slow.http`, then `insight.hint.slow`). */
export function hintKey(type: string, family: string): MessageKey | null {
  for (const key of [`insight.hint.${type}.${family}`, `insight.hint.${type}`]) {
    if (isMessageKey(key)) {
      return key
    }
  }
  return null
}

/** `file:line` of the first call in `queries` that knows where it was made. */
function callerOf(queries: QueryEvent[]): { caller: string } | Record<string, never> {
  const found = queries.find(query => query.caller)?.caller
  return found ? { caller: `${found.file}:${found.line}` } : {}
}

/** Findings as data (type + params), so any front end can phrase them in its own language. */
function findInsights(trace: RequestTrace, tree: TraceNode[], queries: QueryEvent[], options: ReportOptions): InsightDraft[] {
  const insights: InsightDraft[] = []
  const statements = queries.filter(q => !isControlStatement(q.analysis.kind))
  const flagged = new Set<number>()

  for (const group of groupBy(statements.filter(q => q.analysis.kind === "select"), q => q.analysis.fingerprint).values()) {
    if (group.length < options.nPlusOneThreshold) {
      continue
    }
    const distinctSql = new Set(group.map(callKey)).size
    // Same text repeated is plain duplication; same shape with different values is the N+1 signature.
    const isNPlusOne = distinctSql > 1
    insights.push({
      type: isNPlusOne ? "n-plus-one" : "duplicate",
      severity: "warn",
      params: isNPlusOne
        ? { count: group.length, total: formatMs(sumMs(group)), sql: shorten(group[0]!.analysis.fingerprint), ...callerOf(group) }
        : { count: group.length, sql: shorten(group[0]!.sql), ...callerOf(group) },
      seqs: group.map(q => q.seq)
    })
    group.forEach(q => flagged.add(q.seq))
  }

  for (const group of groupBy(statements.filter(q => !flagged.has(q.seq)), callKey).values()) {
    if (group.length >= 2) {
      insights.push({ type: "duplicate", severity: "warn", params: { count: group.length, sql: shorten(group[0]!.sql), ...callerOf(group) }, seqs: group.map(q => q.seq) })
    }
  }

  for (const query of statements) {
    if (query.error) {
      insights.push({ type: "error", severity: "error", params: { error: query.error, ...callerOf([query]) }, seqs: [query.seq] })
    }
    if (query.durationMs !== null && query.durationMs >= options.slowMs) {
      insights.push({
        type: "slow",
        severity: "warn",
        params: { ms: formatMs(query.durationMs), threshold: formatMs(options.slowMs), sql: shorten(query.sql), ...callerOf([query]) },
        seqs: [query.seq]
      })
    }
    if (query.analysis.selectStar) {
      insights.push({ type: "select-star", severity: "info", params: { tables: query.analysis.tables.join(", ") || "?" }, seqs: [query.seq] })
    }
    if (query.analysis.subqueryDepth >= 3) {
      insights.push({ type: "deep-subquery", severity: "info", params: { depth: query.analysis.subqueryDepth }, seqs: [query.seq] })
    }
  }

  const placed = [...walk(tree)]
  const readsInside = placed.filter(p => p.insideTransaction && p.query.analysis.kind === "select")
  if (options.transactionConvention && readsInside.length > 0) {
    insights.push({ type: "select-in-transaction", severity: "info", params: { count: readsInside.length }, seqs: readsInside.map(p => p.query.seq) })
  }
  const writesOutside = placed.filter(p => !p.insideTransaction && isWriteStatement(p.query.analysis.kind))
  if (options.transactionConvention && writesOutside.length >= 2) {
    insights.push({ type: "write-outside-transaction", severity: "info", params: { count: writesOutside.length }, seqs: writesOutside.map(p => p.query.seq) })
  }

  const budget = budgetFor(options.budgets ?? [], trace.method, trace.url)
  if (budget && trace.id !== "background") {
    const route = `${budget.method ? `${budget.method} ` : ""}${budget.route}`
    const over = (type: InsightType, actual: number, max: number | null, format: (n: number) => string) => {
      if (max !== null && actual > max) {
        insights.push({ type, severity: "warn", params: { route, actual: format(actual), max: format(max) }, seqs: [] })
      }
    }
    over("budget-calls", statements.length, budget.calls, String)
    over("budget-time", trace.durationMs ?? 0, budget.ms, formatMs)
    over("budget-call-time", sumMs(statements), budget.callMs, formatMs)
  }

  if (statements.length >= options.manyQueriesThreshold) {
    insights.push({ type: "many-queries", severity: "warn", params: { count: statements.length }, seqs: [] })
  }
  return insights
}

const CACHE_DRIVERS = new Set(["redis", "ioredis"])
const HTTP_DRIVERS = new Set(["http", "fetch"])

/** Length of the union of the calls' time spans: overlapping calls are counted once. */
function busyMs(queries: QueryEvent[], now: number): number {
  const spans = queries
    .map(q => [q.startedAt, q.startedAt + (q.durationMs ?? Math.max(0, now - q.startedAt))] as const)
    .sort((a, b) => a[0] - b[0])
  let total = 0
  let from = -Infinity
  for (const [start, end] of spans) {
    if (end <= from) {
      continue
    }
    total += end - Math.max(start, from)
    from = end
  }
  return total
}

export function timeBreakdown(trace: RequestTrace, statements: QueryEvent[]): TimeBreakdown {
  const now = Date.now()
  const last = Math.max(trace.startedAt, ...statements.map(q => q.startedAt + (q.durationMs ?? 0)))
  const total = trace.durationMs ?? last - trace.startedAt
  const database = busyMs(statements.filter(q => !CACHE_DRIVERS.has(q.driver ?? "") && !HTTP_DRIVERS.has(q.driver ?? "")), now)
  const cache = busyMs(statements.filter(q => CACHE_DRIVERS.has(q.driver ?? "")), now)
  const http = busyMs(statements.filter(q => HTTP_DRIVERS.has(q.driver ?? "")), now)
  return { database, cache, http, app: Math.max(0, total - busyMs(statements, now)), total: Math.max(total, 0) }
}

export function buildReport(trace: RequestTrace, options: ReportOptions = DEFAULT_REPORT_OPTIONS): RequestReport {
  const tree = buildTree(trace.queries)
  const statements = trace.queries.filter(q => !isControlStatement(q.analysis.kind))
  return {
    trace,
    tree,
    insights: findInsights(trace, tree, trace.queries, options).map((insight) => {
      const family = familyOf(insight, trace.queries)
      const key = hintKey(insight.type, family)
      return {
        ...insight,
        params: { ...insight.params, family },
        message: translate(options.locale, `insight.msg.${insight.type}`, insight.params),
        ...(key ? { hint: translate(options.locale, key) } : {})
      }
    }),
    totals: {
      queryCount: statements.length,
      sqlTimeMs: sumMs(statements),
      maxSubqueryDepth: Math.max(0, ...statements.map(q => q.analysis.subqueryDepth)),
      breakdown: timeBreakdown(trace, statements)
    }
  }
}
