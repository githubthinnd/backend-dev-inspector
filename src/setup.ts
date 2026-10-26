import { type InspectorEnv, pickEnv } from "./env.js"
import { buildReport } from "./report.js"
import { getInspector, type Inspector, isInspectorEnabled } from "./runtime.js"
import { hasVisibleStatements, renderReport } from "./terminal.js"
import { installTracer } from "./tracer.js"

const STARTED = Symbol.for("sqlDevInspector.started")

/**
 * Patches mysql2 and starts the terminal printer, once per process. Returns null when the
 * environment says no (production, opted out), in which case nothing has been touched.
 */
export function startInspector(env: InspectorEnv = pickEnv()): Inspector | null {
  if (!isInspectorEnabled(env)) {
    return null
  }
  const inspector = getInspector(env)
  const holder = globalThis as unknown as Record<symbol, boolean | undefined>
  if (holder[STARTED]) {
    return inspector
  }
  holder[STARTED] = true

  const { store } = inspector
  installTracer(store)

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
  return inspector
}

/** Test helper: forget that the inspector was started, so the next start installs again. */
export function resetInspectorForTests() {
  const holder = globalThis as unknown as Record<symbol, boolean | undefined>
  holder[STARTED] = false
}
