import type { TraceStore } from "./store.js"
import type { QueryEvent, SqlAnalysis } from "./types.js"
import { currentTrace } from "./context.js"

export interface OperationStart {
  /** Driver name, shown next to the call (`pg`, `redis`...). */
  driver: string
  /** The driver's own verb: `query`, `execute`, `run`, `find`... */
  api: string
  /** The SQL, or the call rendered as one line. */
  text: string
  params?: unknown[] | null
  /** Id of the connection that carries the call; transactions are grouped by it. */
  connectionId: number
  analysis: SqlAnalysis
}

export interface OperationEnd {
  error?: unknown
  rowCount?: number | null
  affectedRows?: number | null
}

export interface OperationHandle {
  event: QueryEvent
  /** Closes the call. Safe to call more than once; only the first counts. */
  end: (outcome?: OperationEnd) => void
}

/** What a driver adapter uses to report a call, without knowing about requests or the store. */
export interface Recorder {
  store: TraceStore
  /** Starts timing a call and attaches it to the current request. Returns null if it could not be recorded. */
  begin: (operation: OperationStart) => OperationHandle | null
}

const SEQ = Symbol.for("sqlDevInspector.seq")

/** Monotonic across the process and across package copies, so `seq` identifies a statement everywhere. */
function nextSeq(): number {
  const holder = globalThis as unknown as Record<symbol, { next: number } | undefined>
  const counter = (holder[SEQ] ??= { next: 0 })
  return counter.next++
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return typeof error === "string" ? error : String(error)
}

export function createRecorder(store: TraceStore): Recorder {
  return {
    store,
    begin(operation) {
      try {
        const startedAt = Date.now()
        const t0 = performance.now()
        const trace = currentTrace() ?? store.backgroundTrace()
        const event: QueryEvent = {
          seq: nextSeq(),
          requestId: trace.id,
          connectionId: operation.connectionId,
          api: operation.api,
          sql: operation.text,
          driver: operation.driver,
          params: operation.params ?? null,
          startedAt,
          durationMs: null,
          rowCount: null,
          affectedRows: null,
          error: null,
          analysis: operation.analysis
        }
        store.record(trace, event)

        let done = false
        return {
          event,
          end(outcome = {}) {
            if (done) {
              return
            }
            done = true
            event.durationMs = performance.now() - t0
            event.error = outcome.error === undefined || outcome.error === null ? null : messageOf(outcome.error)
            event.rowCount = outcome.rowCount ?? null
            event.affectedRows = outcome.affectedRows ?? null
            store.touch(trace)
          }
        }
      } catch {
        // Recording is best effort: the real call is already on its way and must be returned untouched.
        return null
      }
    }
  }
}
