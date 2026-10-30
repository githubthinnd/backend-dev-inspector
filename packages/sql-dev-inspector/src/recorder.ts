import type { TraceStore } from "./store.js"
import type { QueryEvent, SqlAnalysis } from "./types.js"
import { currentOperation, currentTrace, IGNORED_ID } from "./context.js"
import { rememberCallKey } from "./call-key.js"
import { findCaller } from "./caller.js"
import { REDACT_RANK, redactParams } from "./redact.js"

export interface OperationStart {
  /** Driver name, shown next to the call (`pg`, `redis`...). */
  driver: string
  /** The driver's own verb: `query`, `execute`, `run`, `find`... */
  api: string
  /** The SQL, or the call rendered as one line. */
  text: string
  params?: unknown[] | null
  /**
   * The statement before its values were put into it (`where id = ?`), for drivers that build the final
   * text themselves. Shown instead of `text` when values are redacted.
   */
  template?: string
  /** Id of the connection that carries the call; transactions are grouped by it. */
  connectionId: number
  analysis: SqlAnalysis
}

export interface OperationEnd {
  error?: unknown
  rowCount?: number | null
  affectedRows?: number | null
  /** Facts about the call (see `QueryEvent.details`); merged into what the call already has. */
  details?: Record<string, string | number>
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

const MAX_STATEMENTS = 20

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
        const current = currentTrace()
        if (current?.id === IGNORED_ID) {
          return null // a request the route filters leave out
        }
        const trace = current ?? store.backgroundTrace()
        const { redact } = store
        const text = redact === "all" ? operation.analysis.fingerprint || operation.text : redact === "off" ? operation.text : operation.template ?? operation.text
        const event: QueryEvent = {
          seq: nextSeq(),
          requestId: trace.id,
          connectionId: operation.connectionId,
          api: operation.api,
          sql: text,
          driver: operation.driver,
          params: redact === "off" ? operation.params ?? null : redactParams(operation.params),
          startedAt,
          durationMs: null,
          rowCount: null,
          affectedRows: null,
          error: null,
          analysis: operation.analysis
        }
        if (redact !== "off") {
          rememberCallKey(event, operation.text, operation.params)
        }
        if (store.captureCaller) {
          const caller = findCaller()
          if (caller) {
            event.caller = caller
          }
        }
        if (trace.redact === undefined || REDACT_RANK[redact] > REDACT_RANK[trace.redact]) {
          trace.redact = redact
        }
        const parent = currentOperation()
        if (parent && parent.requestId === trace.id) {
          // the work of a layered call (Prisma): kept with it, not counted again
          ;(parent.statements ??= []).push(event)
          if (parent.statements.length > MAX_STATEMENTS) {
            parent.statements.shift()
          }
        } else {
          store.record(trace, event)
        }

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
            if (outcome.details) {
              event.details = { ...event.details, ...outcome.details }
            }
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
