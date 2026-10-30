import type { Inspector } from "./runtime.js"
import { type InspectorEnv, pickEnv } from "./env.js"
import { BACKGROUND_REQUEST_ID } from "./store.js"
import { isInspectorEnabled } from "./runtime.js"
import { installedDrivers, parseDriverList } from "./setup.js"

export interface Check {
  id: string
  status: "ok" | "warn" | "error"
  message: string
}

const REGISTRY = Symbol.for("sqlDevInspector.diagnostics")
type Diagnostics = () => Check[]

/** Packages built on this one add their own checks (which libraries the application has, and whether two copies are loaded). */
export function registerDiagnostics(name: string, run: Diagnostics): void {
  const holder = globalThis as unknown as Record<symbol, Map<string, Diagnostics> | undefined>
  ;(holder[REGISTRY] ??= new Map()).set(name, run)
}

function registered(): Check[] {
  const map = (globalThis as unknown as Record<symbol, Map<string, Diagnostics> | undefined>)[REGISTRY]
  const checks: Check[] = []
  for (const run of map?.values() ?? []) {
    try {
      checks.push(...run())
    } catch {
      // a broken extra check must not hide the others
    }
  }
  return checks
}

/**
 * What is wrong, or right, with the setup, in plain words: the questions a developer asks when nothing shows up
 * ("is it on?", "which libraries are watched?", "do calls reach a request?").
 */
export function diagnose(inspector: Inspector | null, env: InspectorEnv = pickEnv()): Check[] {
  const checks: Check[] = []
  const major = Number(process.versions.node.split(".")[0])
  checks.push(major >= 22
    ? { id: "node", status: "ok", message: `Node.js ${process.versions.node}` }
    : { id: "node", status: "error", message: `Node.js ${process.versions.node} is too old: version 22 or newer is required.` })

  if (!isInspectorEnabled(env)) {
    checks.push({
      id: "enabled",
      status: "warn",
      message: env.NODE_ENV === "production"
        ? "Off: NODE_ENV is production, which always switches the inspector off."
        : "Off: run with NODE_ENV=development, or set SQL_INSPECTOR=1."
    })
    return [...checks, ...registered()]
  }
  checks.push({ id: "enabled", status: "ok", message: "On (development)." })

  const drivers = installedDrivers()
  checks.push(drivers.length > 0
    ? { id: "drivers", status: "ok", message: `Watching: ${drivers.join(", ")}.` }
    : { id: "drivers", status: "error", message: "No driver is active: the application's database libraries were not found, or SQL_INSPECTOR_DRIVERS leaves them out." })
  const wanted = parseDriverList(env.SQL_INSPECTOR_DRIVERS)
  const missing = wanted.filter(name => !drivers.includes(name))
  if (missing.length > 0) {
    checks.push({ id: "requested", status: "warn", message: `SQL_INSPECTOR_DRIVERS names ${missing.join(", ")}, which ${missing.length === 1 ? "is" : "are"} not active (a typo, or the library is not installed).` })
  }

  if (inspector) {
    const traces = inspector.store.list()
    const inRequests = traces.filter(trace => trace.id !== BACKGROUND_REQUEST_ID).reduce((sum, trace) => sum + trace.queries.length, 0)
    const outside = traces.find(trace => trace.id === BACKGROUND_REQUEST_ID)?.queries.length ?? 0
    if (inRequests === 0 && outside === 0) {
      checks.push({ id: "traffic", status: "ok", message: "No call recorded yet: use the application, then check again." })
    } else if (inRequests === 0) {
      checks.push({ id: "attribution", status: "warn", message: `All ${outside} recorded calls are outside any request: mount the adapter before the routes that use a database, or wrap background work in inspector.task().` })
    } else {
      checks.push({ id: "attribution", status: "ok", message: `${inRequests} calls attributed to requests${outside > 0 ? `, ${outside} outside any request (startup, jobs)` : ""}.` })
    }
    if (!inspector.stack) {
      checks.push({ id: "stack", status: "ok", message: "The search for the calling line is off (SQL_INSPECTOR_STACK)." })
    }
  }
  return [...checks, ...registered()]
}
