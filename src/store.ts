import type { QueryEvent, RequestTrace } from "./types.js"
import { randomUUID } from "node:crypto"

export interface StoreOptions {
  maxRequests: number
  maxQueriesPerRequest: number
  /**
   * Requests whose last activity is older than this many milliseconds are dropped.
   * Unset or 0 keeps them until `maxRequests` pushes them out.
   */
  maxAgeMs?: number
}

function lastActivity(trace: RequestTrace): number {
  return trace.queries.at(-1)?.startedAt ?? trace.startedAt
}

export type StoreChange
  = | { type: "query" | "request-end", requestId: string }
    | { type: "clear" }

export const BACKGROUND_REQUEST_ID = "background"

/**
 * In-memory ring of the most recent requests that ran at least one statement.
 * A request that never touches the database (static assets, HMR pings) is never kept.
 */
export class TraceStore {
  private readonly traces: RequestTrace[] = []
  private readonly listeners = new Set<(change: StoreChange) => void>()
  private background: RequestTrace | null = null

  constructor(private readonly options: StoreOptions) {}

  startRequest(method: string, url: string): RequestTrace {
    return {
      id: randomUUID(),
      method,
      url,
      status: null,
      startedAt: Date.now(),
      durationMs: null,
      queries: [],
      droppedQueries: 0
    }
  }

  /** Statements issued outside any request (startup, timers, queues) are gathered into one trace. */
  backgroundTrace(): RequestTrace {
    this.purgeExpired()
    this.background ??= {
      ...this.startRequest("-", "(outside any request)"),
      id: BACKGROUND_REQUEST_ID
    }
    return this.background
  }

  record(trace: RequestTrace, query: QueryEvent) {
    this.purgeExpired(trace)
    if (!this.traces.includes(trace)) {
      this.traces.push(trace)
      if (this.traces.length > this.options.maxRequests) {
        this.traces.shift()
      }
    }
    trace.queries.push(query)
    if (trace.queries.length > this.options.maxQueriesPerRequest) {
      trace.queries.shift()
      trace.droppedQueries++
    }
    this.emit({ type: "query", requestId: trace.id })
  }

  /** A statement finished after it was recorded; listeners only need to know the trace changed. */
  touch(trace: RequestTrace) {
    this.emit({ type: "query", requestId: trace.id })
  }

  finishRequest(trace: RequestTrace, status: number) {
    trace.status = status
    trace.durationMs = Date.now() - trace.startedAt
    if (this.traces.includes(trace)) {
      this.emit({ type: "request-end", requestId: trace.id })
    }
  }

  /** Newest first. */
  list(): RequestTrace[] {
    this.purgeExpired()
    return [...this.traces].reverse()
  }

  get(id: string): RequestTrace | undefined {
    this.purgeExpired()
    return this.traces.find(trace => trace.id === id)
  }

  clear() {
    this.traces.length = 0
    this.background = null
    this.emit({ type: "clear" })
  }

  subscribe(listener: (change: StoreChange) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Expiry is checked whenever the store is read or written, not on a timer, so an idle
   * inspector never keeps the process alive. `keep` is the trace being written to right now.
   */
  private purgeExpired(keep?: RequestTrace) {
    const maxAge = this.options.maxAgeMs
    if (!maxAge || maxAge <= 0) {
      return
    }
    const cutoff = Date.now() - maxAge
    const alive = this.traces.filter(trace => trace === keep || lastActivity(trace) >= cutoff)
    if (alive.length === this.traces.length) {
      return
    }
    this.traces.splice(0, this.traces.length, ...alive)
    if (this.background && this.background !== keep && !this.traces.includes(this.background)) {
      this.background = null
    }
  }

  private emit(change: StoreChange) {
    for (const listener of this.listeners) {
      try {
        listener(change)
      } catch {
        // a broken listener (closed SSE socket, terminal printer) must not break the query path
      }
    }
  }
}
