import { format } from "node:util"
import { getInspector, type Inspector } from "./runtime.js"
import { currentTrace, IGNORED_ID } from "./context.js"
import { findCaller } from "./caller.js"

/**
 * What the application prints while it handles a request (`console.log`, `info`, `warn`, `error`, `debug`), listed
 * under that request. Off by default: a log line can hold a token or a person's data, and the inspector otherwise keeps
 * values out. Switch it on with `SQL_INSPECTOR_LOGS=1`, or in the settings.
 *
 * `console` is patched once, when the inspector starts in development; each call looks at the setting, so turning it
 * on or off later needs nothing more. The inspector's own output is never captured.
 */

const WRAPPED = Symbol.for("sqlDevInspector.logsWrapper")
const LEVELS = ["log", "info", "warn", "error", "debug"] as const
const MAX_ENTRIES = 200
const MAX_MESSAGE = 2000
// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-9;]*m/g

// One counter per process: the wrappers belong to whichever copy of this package patched `console` first, and the
// inspector's own output (printed by any copy) must be muted for them.
const MUTED = Symbol.for("sqlDevInspector.logsMuted")
const mutedCount = () => ((globalThis as unknown as Record<symbol, { n: number } | undefined>)[MUTED] ??= { n: 0 })

/** Runs `fn` without capturing what it prints: the inspector's own terminal output. */
export function withoutCapture<T>(fn: () => T): T {
  const muted = mutedCount()
  muted.n++
  try {
    return fn()
  } finally {
    muted.n--
  }
}

/**
 * Wraps each console method that is not wrapped yet. The wrappers read the setting on every call, so switching capture
 * off leaves them in place and inert; if something else replaced a method since (another logger, a test's spy), the next
 * switch-on wraps the new one.
 */
function patchConsole() {
  for (const level of LEVELS) {
    if ((console[level] as unknown as Record<symbol, boolean | undefined>)[WRAPPED]) {
      continue
    }
    const original = console[level].bind(console) as (...args: unknown[]) => void
    const wrapper = ((...args: unknown[]) => {
      try {
        const inspector = getInspector()
        if (inspector.logs && mutedCount().n === 0) {
          const trace = currentTrace()
          if (trace && trace.id !== IGNORED_ID) {
            const logs = (trace.logs ??= [])
            if (logs.length < MAX_ENTRIES) {
              const caller = inspector.stack ? findCaller() : undefined
              logs.push({ level, at: Date.now(), message: format(...args).replace(ANSI, "").slice(0, MAX_MESSAGE), ...(caller ? { caller } : {}) })
              inspector.store.touch(trace)
            }
          }
        }
      } catch {
        // never get in the way of the application's own logging
      }
      original(...args)
    }) as unknown as Record<symbol, boolean>
    wrapper[WRAPPED] = true
    console[level] = wrapper as never
  }
}

/**
 * Turns the listing of console output on or off. `console` is only touched once it is on for the first time, so an
 * application that never asks for it keeps the console it has (and so do the tests that spy on it).
 */
export function setLogCapture(inspector: Inspector, on: boolean): void {
  inspector.logs = on
  if (on) {
    patchConsole()
  }
}
