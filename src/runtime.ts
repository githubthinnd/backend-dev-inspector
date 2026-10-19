import process from "node:process"
import { parseAllowedHosts } from "./guard.js"
import { chosenLocale, DEFAULT_LOCALE, type Locale } from "./i18n/index.js"
import { DEFAULT_REPORT_OPTIONS, type ReportOptions } from "./report.js"
import { TraceStore } from "./store.js"

export interface Inspector {
  store: TraceStore
  report: ReportOptions
  /** The slow-query threshold the process started with (`SQL_INSPECTOR_SLOW_MS`), what a reset from the UI returns to. */
  defaultSlowMs: number
  /** Host names besides loopback and IP addresses that may open the inspector (`SQL_INSPECTOR_ALLOWED_HOSTS`). */
  allowedHosts: string[]
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

/** Minutes to milliseconds; `0` means "never expire", anything unusable falls back. */
function minutesToMs(raw: string | undefined, fallbackMinutes: number) {
  const value = raw === undefined || raw === "" ? Number.NaN : Number(raw)
  const minutes = Number.isFinite(value) && value >= 0 ? value : fallbackMinutes
  return Math.round(minutes * 60_000)
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
  const slowMs = positiveNumber(env.SQL_INSPECTOR_SLOW_MS, DEFAULT_REPORT_OPTIONS.slowMs)
  holder[KEY] ??= {
    locale: hint ?? DEFAULT_LOCALE,
    localeHint: hint,
    defaultSlowMs: slowMs,
    allowedHosts: parseAllowedHosts(env.SQL_INSPECTOR_ALLOWED_HOSTS),
    store: new TraceStore({
      maxRequests: positiveNumber(env.SQL_INSPECTOR_MAX_REQUESTS, 200),
      maxQueriesPerRequest: positiveNumber(env.SQL_INSPECTOR_MAX_QUERIES, 1000),
      maxAgeMs: minutesToMs(env.SQL_INSPECTOR_TTL_MINUTES, 60)
    }),
    report: {
      ...DEFAULT_REPORT_OPTIONS,
      slowMs,
      transactionConvention: env.SQL_INSPECTOR_TX_CONVENTION === "1",
      locale: hint ?? DEFAULT_LOCALE
    },
    logToTerminal: env.SQL_INSPECTOR_LOG !== "0"
  }
  return holder[KEY]
}
