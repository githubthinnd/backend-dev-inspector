import type { QueryEvent } from "../src/types"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getInspector } from "../src/runtime"
import { TraceStore } from "../src/store"

const MINUTE = 60_000

function query(requestId: string, seq = 0): QueryEvent {
  return {
    seq,
    requestId,
    connectionId: 1,
    api: "query",
    sql: "select 1",
    params: null,
    startedAt: Date.now(),
    durationMs: 1,
    rowCount: 1,
    affectedRows: null,
    error: null,
    analysis: {} as QueryEvent["analysis"]
  }
}

function recordRequest(store: TraceStore, url: string) {
  const trace = store.startRequest("GET", url)
  store.record(trace, query(trace.id))
  return trace
}

describe("TraceStore expiry", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("drops requests whose last activity is older than maxAgeMs", () => {
    const store = new TraceStore({ maxRequests: 50, maxQueriesPerRequest: 500, maxAgeMs: 10 * MINUTE })
    const old = recordRequest(store, "/old")
    vi.advanceTimersByTime(6 * MINUTE)
    const recent = recordRequest(store, "/recent")

    vi.advanceTimersByTime(6 * MINUTE)

    expect(store.list()).toEqual([recent])
    expect(store.get(old.id)).toBeUndefined()
  })

  it("counts a request's newest query as its activity", () => {
    const store = new TraceStore({ maxRequests: 50, maxQueriesPerRequest: 500, maxAgeMs: 10 * MINUTE })
    const trace = recordRequest(store, "/busy")

    vi.advanceTimersByTime(8 * MINUTE)
    store.record(trace, query(trace.id, 1))
    vi.advanceTimersByTime(8 * MINUTE)

    expect(store.list()).toEqual([trace])
  })

  it("keeps everything until the request cap when maxAgeMs is 0 or unset", () => {
    const zero = new TraceStore({ maxRequests: 50, maxQueriesPerRequest: 500, maxAgeMs: 0 })
    const unset = new TraceStore({ maxRequests: 50, maxQueriesPerRequest: 500 })
    recordRequest(zero, "/a")
    recordRequest(unset, "/a")

    vi.advanceTimersByTime(24 * 60 * MINUTE)

    expect(zero.list()).toHaveLength(1)
    expect(unset.list()).toHaveLength(1)
  })

  it("starts a fresh background trace once the old one expired", () => {
    const store = new TraceStore({ maxRequests: 50, maxQueriesPerRequest: 500, maxAgeMs: 10 * MINUTE })
    const first = store.backgroundTrace()
    store.record(first, query(first.id))

    vi.advanceTimersByTime(11 * MINUTE)
    const second = store.backgroundTrace()
    store.record(second, query(second.id, 1))

    expect(second).not.toBe(first)
    expect(store.get("background")?.queries).toHaveLength(1)
  })
})

describe("SQL_INSPECTOR_TTL_MINUTES", () => {
  function maxAgeFor(value: string | undefined) {
    const holder = globalThis as unknown as Record<symbol, unknown>
    delete holder[Symbol.for("sqlDevInspector.runtime")]
    const env = value === undefined ? {} : { SQL_INSPECTOR_TTL_MINUTES: value }
    const inspector = getInspector(env as NodeJS.ProcessEnv) as unknown as { store: { options: { maxAgeMs?: number } } }
    delete holder[Symbol.for("sqlDevInspector.runtime")]
    return inspector.store.options.maxAgeMs
  }

  it("defaults to 60 minutes, accepts 0 to disable, and ignores junk", () => {
    expect(maxAgeFor(undefined)).toBe(60 * MINUTE)
    expect(maxAgeFor("5")).toBe(5 * MINUTE)
    expect(maxAgeFor("0")).toBe(0)
    expect(maxAgeFor("abc")).toBe(60 * MINUTE)
    expect(maxAgeFor("-3")).toBe(60 * MINUTE)
  })
})
