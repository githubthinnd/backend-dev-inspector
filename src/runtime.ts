import process from "node:process"
import { chosenLocale, DEFAULT_LOCALE, type Locale } from "./i18n/index.js"
import { DEFAULT_REPORT_OPTIONS, type ReportOptions } from "./report.js"
import { TraceStore } from "./store.js"

export interface Inspector {
  store: TraceStore
  report: ReportOptions
  logToTerminal: boolean
  /** Language of server-side text (terminal output, `Insight.message`). */
  locale: Locale
  /** Set only when `SQL_INSPECTOR_LANG` was given: tells the web UI which language to start in. */
  localeHint: Locale | null
}

const KEY = Symbol.for("sqlDevInspector.runtime")

function positiveNumber(raw: string | undefined, fallback: number) {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * Development only. Never in production (`NODE_ENV=production` is a hard stop, even with
 * `SQL_INSPECTOR=1`); otherwise on when `NODE_ENV=development` (what `nuxt dev`, `next dev`,
 * `vite` and most dev scripts set) or when asked for with `SQL_INSPECTOR=1`.
 * `SQL_INSPECTOR=0` switches it off.
 */
export function isInspectorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "production" || env.SQL_INSPECTOR === "0") {
    return false
  }
  return env.SQL_INSPECTOR === "1" || env.NODE_ENV === "development"
}

/** One inspector per process, however many bundles import this module. */
export function getInspector(env: NodeJS.ProcessEnv = process.env): Inspector {
  const holder = globalThis as unknown as Record<symbol, Inspector | undefined>
  const hint = chosenLocale(env)
  holder[KEY] ??= {
    locale: hint ?? DEFAULT_LOCALE,
    localeHint: hint,
    store: new TraceStore({
      maxRequests: positiveNumber(env.SQL_INSPECTOR_MAX_REQUESTS, 200),
      maxQueriesPerRequest: positiveNumber(env.SQL_INSPECTOR_MAX_QUERIES, 1000)
    }),
    report: {
      ...DEFAULT_REPORT_OPTIONS,
      slowMs: positiveNumber(env.SQL_INSPECTOR_SLOW_MS, DEFAULT_REPORT_OPTIONS.slowMs),
      transactionConvention: env.SQL_INSPECTOR_TX_CONVENTION === "1",
      locale: hint ?? DEFAULT_LOCALE
    },
    logToTerminal: env.SQL_INSPECTOR_LOG !== "0"
  }
  return holder[KEY]
}
