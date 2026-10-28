import type { Recorder } from "./recorder.js"

export interface InstallContext {
  /** True when `SQL_INSPECTOR_DRIVERS` names this driver: the user asked for it, so a driver that is usually cautious may go ahead. */
  explicit: boolean
}

/**
 * A way of seeing the calls one library makes. Adapters patch the library (or subscribe to what
 * it publishes) and report every call through the recorder; everything after that, the request
 * tree, warnings, terminal output and web UI, is shared.
 */
export interface DriverAdapter {
  /** Stable name: shown on each call, and what `SQL_INSPECTOR_DRIVERS` lists. */
  name: string
  /**
   * Starts reporting. Returns the function that stops it again, or null when the library is not
   * installed in this application (nothing was touched).
   */
  install: (recorder: Recorder, context?: InstallContext) => (() => void) | null
}
