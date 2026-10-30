import type { DriverAdapter } from "./driver.js"
import { type InspectorEnv, pickEnv } from "./env.js"
import type { RedactMode } from "./redact.js"
import { parsePatterns } from "./route-filter.js"
import { translate } from "./i18n/index.js"
import { createRecorder } from "./recorder.js"
import { buildReport } from "./report.js"
import { type Brand, getInspector, type Inspector, isInspectorEnabled, normalizeMount } from "./runtime.js"
import { hasVisibleStatements, renderReport } from "./terminal.js"
import { mysql2Driver } from "./tracer.js"

const STARTED = Symbol.for("sqlDevInspector.started")
const DRIVERS = Symbol.for("sqlDevInspector.drivers")
/** Set by `backend-dev-inspector` when it is loaded, which is when the tip about it is pointless. */
const SIBLING = Symbol.for("backendDevInspector.loaded")

export interface StartOptions {
  /** The drivers to install; defaults to mysql2. `SQL_INSPECTOR_DRIVERS` can narrow the list. */
  drivers?: DriverAdapter[]
  /** What the UI calls itself. */
  brand?: Brand
  /** What is kept of values: `params` (default), `all` or `off`. Overrides `SQL_INSPECTOR_REDACT`. */
  redact?: RedactMode
  /** Only requests matching these paths are traced (`/api/**`). Overrides `SQL_INSPECTOR_INCLUDE`. */
  include?: string[]
  /** Requests matching these paths are never traced. Overrides `SQL_INSPECTOR_EXCLUDE`. */
  exclude?: string[]
  /** Where the inspector is served, instead of `/__sql-inspector/`: `/_dev/sql`. Overrides `SQL_INSPECTOR_PATH`. */
  path?: string
}

type Holder = Record<symbol, unknown>

/** `SQL_INSPECTOR_DRIVERS=pg,redis`: the drivers to keep, or empty for all of them. `all` also means all. */
export function parseDriverList(raw: string | undefined): string[] {
  const names = (raw ?? "").split(",").map(name => name.trim().toLowerCase()).filter(Boolean)
  return names.includes("all") ? [] : names
}

/**
 * Starts the terminal printer, once per process, and installs the drivers that are not
 * installed yet (mysql2 unless asked otherwise). Calling it again with more drivers adds them.
 * Returns null when the environment says no (production, opted out), in which case nothing has
 * been touched.
 */
export function startInspector(env: InspectorEnv = pickEnv(), options: StartOptions = {}): Inspector | null {
  if (!isInspectorEnabled(env)) {
    return null
  }
  const inspector = getInspector(env)
  if (options.brand) {
    inspector.brand = options.brand
  }
  if (options.redact) {
    inspector.redact = options.redact
    inspector.store.redact = options.redact
    inspector.defaults.redact = options.redact
  }
  if (options.include) {
    inspector.filters.include = parsePatterns(options.include)
    inspector.defaults.filters.include = [...inspector.filters.include]
  }
  if (options.exclude) {
    inspector.filters.exclude = parsePatterns(options.exclude)
    inspector.defaults.filters.exclude = [...inspector.filters.exclude]
  }
  if (options.path) {
    inspector.mount = normalizeMount(options.path)
  }
  const holder = globalThis as unknown as Holder
  const first = !holder[STARTED]
  holder[STARTED] = true

  const { store } = inspector
  const installed = (holder[DRIVERS] ??= new Map<string, () => void>()) as Map<string, () => void>
  const wanted = parseDriverList(env.SQL_INSPECTOR_DRIVERS)
  const recorder = createRecorder(store)
  for (const driver of options.drivers ?? [mysql2Driver]) {
    if (installed.has(driver.name) || (wanted.length > 0 && !wanted.includes(driver.name))) {
      continue
    }
    // A driver that cannot be installed (a native module that was never built, a library of an
    // unexpected version) must never stop the application from starting.
    let uninstall: (() => void) | null = null
    try {
      uninstall = driver.install(recorder, { explicit: wanted.includes(driver.name) })
    } catch {
      uninstall = null
    }
    if (uninstall) {
      installed.set(driver.name, uninstall)
    }
  }

  if (first) {
    if (inspector.logToTerminal) {
      store.subscribe((change) => {
        if (change.type !== "request-end") {
          return
        }
        const trace = store.get(change.requestId)
        if (!trace) {
          return
        }
        const report = buildReport(trace, inspector.report)
        if (hasVisibleStatements(report)) {
          console.log(`\n${renderReport(report, inspector.locale)}`)
        }
      })
    }
    if (env.SQL_INSPECTOR_NOTICE !== "0" && !holder[SIBLING]) {
      console.log(translate(inspector.locale, "term.notice"))
    }
  }
  return inspector
}

/** The names of the drivers that are installed right now. */
export function installedDrivers(): string[] {
  const installed = (globalThis as unknown as Holder)[DRIVERS] as Map<string, () => void> | undefined
  return installed ? [...installed.keys()] : []
}

/** Called by packages built on this one, so the tip about them is not shown to their own users. */
export function markSiblingLoaded() {
  ;(globalThis as unknown as Holder)[SIBLING] = true
}

/** Test helper: forget that the inspector was started, so the next start installs again. */
export function resetInspectorForTests() {
  const holder = globalThis as unknown as Holder
  holder[STARTED] = false
  holder[DRIVERS] = undefined
}
