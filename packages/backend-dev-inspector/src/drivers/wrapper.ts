import type { DriverAdapter, Recorder } from "sql-dev-inspector"
import { isInspectorEnabled } from "sql-dev-inspector"

/**
 * What the drivers that work on an object the application hands over (`instrumentAws(client)`, `instrumentD1(db)`…) have in
 * common: the recorder their install receives is kept under a key shared by every copy of this package, and the wrapper
 * looks it up when a call is made, not when the object is wrapped. A wrapper is usually applied at the top of a module,
 * before the application has started the inspector; and two copies of the package (ESM and CommonJS, or two versions) must
 * see the same recorder.
 */

const SLOT = Symbol.for("backendDevInspector.wrapperRecorders")

function recorders(): Map<string, Recorder> {
  return ((globalThis as unknown as Record<symbol, Map<string, Recorder> | undefined>)[SLOT] ??= new Map())
}

export interface WrapperDriver {
  driver: DriverAdapter
  /**
   * The recorder to report to: `explicit` when given; a façade that finds the installed one at call time; or null when the
   * inspector is switched off for this process (the object is then returned untouched, which is how production stays clean).
   */
  recorder: (explicit?: Recorder) => Recorder | null
}

export function wrapperDriver(name: string): WrapperDriver {
  const current = () => recorders().get(name) ?? null
  return {
    driver: {
      name,
      install(recorder) {
        recorders().set(name, recorder)
        return () => {
          if (recorders().get(name) === recorder) {
            recorders().delete(name)
          }
        }
      }
    },
    recorder(explicit) {
      if (explicit) {
        return explicit
      }
      if (!current() && !isInspectorEnabled()) {
        return null
      }
      return {
        get store() {
          return (current() as Recorder).store
        },
        begin: operation => current()?.begin(operation) ?? null
      }
    }
  }
}
