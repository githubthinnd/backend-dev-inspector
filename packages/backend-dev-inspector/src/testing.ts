import type { Insight, QueryEvent, RequestReport, RequestTrace, StartOptions } from "sql-dev-inspector"
import { buildReport, runInRequest, shortLocation, startInspector } from "sql-dev-inspector"
import { withDefaults } from "./options.js"

/**
 * Query budgets for tests. `capture(fn)` runs `fn` and returns everything the application did while it ran (queries,
 * Redis and Mongo calls, outgoing HTTP), as the inspector sees it; the matchers turn that into assertions, so a
 * pull request that adds an N+1 fails its tests instead of being found in production.
 *
 *   import { capture, matchers } from "backend-dev-inspector/testing"
 *   expect.extend(matchers)
 *
 *   const run = await capture(() => app.get("/orders"))
 *   expect(run).toHaveNoNPlusOne()
 *   expect(run).toHaveMaxQueries(5)
 *
 * It needs nothing from the application: it switches the inspector on for the process (tests run with `NODE_ENV=test`,
 * where it would be off) and attributes whatever `fn` awaits to one trace.
 */

export interface Capture<T = unknown> {
  /** What `fn` returned. */
  result: T
  trace: RequestTrace
  report: RequestReport
  /** The statements that count (BEGIN / COMMIT and the like are left out). */
  queries: QueryEvent[]
  insights: Insight[]
}

export interface CaptureOptions {
  /** Shown in failure messages. */
  name?: string
  /** Passed to the inspector the first time it is started in the process. */
  inspector?: StartOptions
}

const CONTROL = new Set(["tx-begin", "tx-commit", "tx-rollback", "tx-config", "savepoint", "savepoint-release", "savepoint-rollback"])

export async function capture<T>(fn: () => T | Promise<T>, options: CaptureOptions = {}): Promise<Capture<T>> {
  const env = { NODE_ENV: "development", SQL_INSPECTOR: "1", SQL_INSPECTOR_LOG: "0", SQL_INSPECTOR_NOTICE: "0", SQL_INSPECTOR_REDACT: "off", SQL_INSPECTOR_STACK: "1" }
  const inspector = startInspector(env, withDefaults(options.inspector ?? {}, env))
  if (!inspector) {
    throw new Error("backend-dev-inspector/testing: the inspector could not be started")
  }
  const trace = inspector.store.startRequest("TEST", options.name ?? "capture")
  let result: T
  try {
    result = await runInRequest(trace, async () => await fn())
  } finally {
    inspector.store.finishRequest(trace, 0)
  }
  const report = buildReport(trace, inspector.report)
  return { result, trace, report, queries: trace.queries.filter(query => !CONTROL.has(query.analysis.kind)), insights: report.insights }
}

interface MatcherResult {
  pass: boolean
  message: () => string
}

const isCapture = (value: unknown): value is Capture =>
  !!value && typeof value === "object" && Array.isArray((value as Capture).queries) && Array.isArray((value as Capture).insights)

function ofCapture(received: unknown, matcher: string): Capture {
  if (!isCapture(received)) {
    throw new TypeError(`${matcher}: expected the result of capture(), got ${typeof received}`)
  }
  return received
}

const where = (insight: Insight, root?: string) => {
  const caller = String(insight.params.caller ?? "")
  return caller ? ` (from ${shortLocation({ file: caller.replace(/:\d+$/, ""), line: Number(/:(\d+)$/.exec(caller)?.[1] ?? 0) }, root)})` : ""
}

function describeInsights(found: Insight[]): string {
  return found.map(insight => `  - ${insight.message}${where(insight, process.cwd())}${insight.hint ? `\n    ${insight.hint}` : ""}`).join("\n")
}

/** A matcher that passes when no insight of the given types was raised. */
function noInsight(received: unknown, matcher: string, types: string[], what: string): MatcherResult {
  const run = ofCapture(received, matcher)
  const found = run.insights.filter(insight => types.includes(insight.type))
  return {
    pass: found.length === 0,
    message: () => found.length === 0
      ? `expected ${what}, but there was none`
      : `expected ${what}, but the inspector found:\n${describeInsights(found)}`
  }
}

/** Matchers for `expect.extend(matchers)`; they take the result of `capture()`. */
export const matchers = {
  toHaveNoNPlusOne: (received: unknown): MatcherResult => noInsight(received, "toHaveNoNPlusOne", ["n-plus-one"], "no N+1 query"),
  toHaveNoDuplicates: (received: unknown): MatcherResult => noInsight(received, "toHaveNoDuplicates", ["duplicate"], "no repeated identical call"),
  toHaveNoSlowQueries: (received: unknown): MatcherResult => noInsight(received, "toHaveNoSlowQueries", ["slow"], "no slow call"),
  toHaveNoErrors: (received: unknown): MatcherResult => noInsight(received, "toHaveNoErrors", ["error"], "no failing call"),
  toHaveNoInsights: (received: unknown): MatcherResult => {
    const run = ofCapture(received, "toHaveNoInsights")
    const found = run.insights.filter(insight => insight.severity !== "info")
    return { pass: found.length === 0, message: () => found.length === 0 ? "expected the inspector to find something, but it found nothing" : `expected no warnings or errors, but the inspector found:\n${describeInsights(found)}` }
  },
  toHaveMaxQueries: (received: unknown, max: number): MatcherResult => {
    const run = ofCapture(received, "toHaveMaxQueries")
    const count = run.queries.length
    return {
      pass: count <= max,
      message: () => count <= max
        ? `expected more than ${max} calls, but there were ${count}`
        : `expected at most ${max} calls, but there were ${count}:\n${run.queries.slice(0, 15).map(query => `  - ${query.sql.replace(/\s+/g, " ").slice(0, 110)}`).join("\n")}${count > 15 ? `\n  … and ${count - 15} more` : ""}`
    }
  },
  toRunQueries: (received: unknown, expected: number): MatcherResult => {
    const run = ofCapture(received, "toRunQueries")
    return { pass: run.queries.length === expected, message: () => `expected ${expected} calls, but there were ${run.queries.length}` }
  }
}

export type InspectorMatchers<R = unknown> = {
  [K in keyof typeof matchers]: (typeof matchers)[K] extends (received: unknown, ...args: infer A) => MatcherResult ? (...args: A) => R : never
}
