import type { DriverAdapter, OperationHandle, Recorder, StatementKind } from "sql-dev-inspector"
import { channel, unsubscribe } from "node:diagnostics_channel"
import { describeOperation } from "sql-dev-inspector"

/**
 * Outbound HTTP: what the backend asks other services. Node publishes every client request on
 * `diagnostics_channel` (`http.client.*` for `node:http` / `node:https`, `undici:request:*` for
 * the global fetch function and undici), so nothing is patched. A call is described as the statement it resembles
 * (GET is a `select`, POST an `insert`...), which makes a loop of requests to the same endpoint
 * with different ids an N+1.
 *
 * Secrets stay out: user names and passwords in the URL are dropped and the values of query
 * parameters that look like credentials are hidden.
 */

const SECRET_PARAMETER = /token|key|secret|password|passwd|auth|signature|sig|credential|session/i
const MAX_TEXT = 300

function kindOf(method: string): StatementKind {
  switch (method) {
    case "POST":
      return "insert"
    case "PUT":
    case "PATCH":
      return "update"
    case "DELETE":
      return "delete"
    default:
      return "select"
  }
}

/** The URL without credentials, with the values of secret-looking query parameters hidden. */
export function safeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.username = ""
    parsed.password = ""
    for (const key of [...parsed.searchParams.keys()]) {
      if (SECRET_PARAMETER.test(key)) {
        parsed.searchParams.set(key, "?")
      }
    }
    return parsed.toString().replaceAll("%3F", "?")
  } catch {
    return url.slice(0, MAX_TEXT)
  }
}

function addressId(address: string): number {
  let hash = 5381
  for (let i = 0; i < address.length; i++) {
    hash = ((hash << 5) + hash + address.charCodeAt(i)) | 0
  }
  return -(Math.abs(hash) + 1)
}

function begin(recorder: Recorder, driver: string, method: string, url: string, authority: string): OperationHandle | null {
  const verb = method.toUpperCase()
  const text = `${verb} ${safeUrl(url)}`.slice(0, MAX_TEXT)
  let target = url
  try {
    const parsed = new URL(url)
    target = `${parsed.host}${parsed.pathname}`
  } catch {
    // keep the raw value
  }
  return recorder.begin({
    driver,
    api: verb,
    text,
    connectionId: addressId(authority),
    analysis: describeOperation({ kind: kindOf(verb), label: verb, targets: [target], text })
  })
}

/** Closes a call with the status the server answered; a 5xx counts as an error, a 4xx is a normal answer. */
function finish(handle: OperationHandle, status: number | undefined) {
  const { event } = handle
  if (status !== undefined) {
    event.analysis = { ...event.analysis, label: `${event.api} ${status}` }
  }
  handle.end({ error: status !== undefined && status >= 500 ? `HTTP ${status}` : null })
}

type Handler = (message: unknown) => void

function subscribeAll(subscriptions: [string, Handler][]): () => void {
  for (const [name, handler] of subscriptions) {
    channel(name).subscribe(handler)
  }
  return () => {
    for (const [name, handler] of subscriptions) {
      unsubscribe(name, handler)
    }
  }
}

// ── node:http and node:https ────────────────────────────────────────────

interface ClientRequestLike {
  method?: string
  protocol?: string
  host?: string
  path?: string
  getHeader?: (name: string) => unknown
}

export const httpDriver: DriverAdapter = {
  name: "http",
  install(recorder) {
    const open = new WeakMap<object, OperationHandle>()
    return subscribeAll([
      ["http.client.request.start", (message) => {
        try {
          const request = (message as { request: ClientRequestLike }).request
          const authority = String(request.getHeader?.("host") ?? request.host ?? "")
          const handle = begin(recorder, "http", request.method ?? "GET", `${request.protocol ?? "http:"}//${authority}${request.path ?? "/"}`, authority)
          if (handle) {
            open.set(request as object, handle)
          }
        } catch {
          // best effort
        }
      }],
      ["http.client.response.finish", (message) => {
        const { request, response } = message as { request: object, response: { statusCode?: number } }
        const handle = open.get(request)
        open.delete(request)
        if (handle) {
          finish(handle, response.statusCode)
        }
      }],
      ["http.client.request.error", (message) => {
        const { request, error } = message as { request: object, error: unknown }
        const handle = open.get(request)
        open.delete(request)
        handle?.end({ error })
      }]
    ])
  }
}

// ── fetch and undici ────────────────────────────────────────────────────

interface UndiciRequestLike {
  origin?: string | URL
  method?: string
  path?: string
}

/** The global fetch function of Node (which bundles undici) and the `undici` package, which publish the same channels. */
export const fetchDriver: DriverAdapter = {
  name: "fetch",
  install(recorder) {
    const open = new WeakMap<object, OperationHandle>()
    return subscribeAll([
      ["undici:request:create", (message) => {
        try {
          const request = (message as { request: UndiciRequestLike }).request
          const origin = String(request.origin ?? "")
          const handle = begin(recorder, "fetch", request.method ?? "GET", `${origin}${request.path ?? "/"}`, origin)
          if (handle) {
            open.set(request as object, handle)
          }
        } catch {
          // best effort
        }
      }],
      ["undici:request:headers", (message) => {
        const { request, response } = message as { request: object, response: { statusCode?: number } }
        const handle = open.get(request)
        open.delete(request)
        if (handle) {
          finish(handle, response.statusCode)
        }
      }],
      ["undici:request:error", (message) => {
        const { request, error } = message as { request: object, error: unknown }
        const handle = open.get(request)
        open.delete(request)
        handle?.end({ error })
      }]
    ])
  }
}
