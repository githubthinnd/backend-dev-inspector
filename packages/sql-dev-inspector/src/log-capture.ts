import { format } from "node:util"
import type { Inspector } from "./runtime.js"
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

const INSTALLED = Symbol.for("sqlDevInspector.logsInstalled")
const LEVELS = ["log", "info", "warn", "error", "debug"] as const
const MAX_ENTRIES = 200
const MAX_MESSAGE = 2000
// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-9;]*m/g

let muted = 0

/** Runs `fn` without capturing what it prints: the inspector's own terminal output. */
export function withoutCapture<T>(fn: () => T): T {
  muted++
  try {
    return fn()
  } finally {
    muted--
  }
}

export function installLogCapture(inspector: Inspector): () => void {
  const holder = console as unknown as Record<symbol, (() => void) | undefined>
  holder[INSTALLED]?.() // an earlier install (a restart in a test) stops capturing; its wrapper stays and passes calls through
  let active = true

  for (const level of LEVELS) {
    const original = console[level].bind(console) as (...args: unknown[]) => void
    console[level] = ((...args: unknown[]) => {
      try {
        if (active && inspector.logs && muted === 0) {
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
    }) as never
  }
  const stop = () => {
    active = false
  }
  holder[INSTALLED] = stop
  return stop
}
