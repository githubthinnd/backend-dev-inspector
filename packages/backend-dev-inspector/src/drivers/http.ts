import type { DriverAdapter, OperationHandle, Recorder, StatementKind } from "sql-dev-inspector"
import { channel, unsubscribe } from "node:diagnostics_channel"
import { describeOperation, outgoingTraceparent } from "sql-dev-inspector"

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
  const handle = recorder.begin({
    driver,
    api: verb,
    text,
    connectionId: addressId(authority),
    analysis: describeOperation({ kind: kindOf(verb), label: verb, targets: [target], text })
  })
  return handle
}

/** With propagation on, the call carries a `traceparent` naming this call as the span the other service's request answers. */
function propagate(handle: OperationHandle | null, setHeader: (value: string) => void) {
  const next = handle ? outgoingTraceparent() : null
  if (handle && next) {
    setHeader(next.header)
    handle.event.details = { ...handle.event.details, spanId: next.spanId }
  }
}

const MAX_VALUE = 120

/**
 * What is worth knowing about an exchange without recording headers: the status, how much was sent and received, and a
 * few headers that carry no secret. Everything else (cookies, authorization, bodies) is never looked at.
 */
const SAFE_HEADERS = { "content-type": "contentType", "retry-after": "retryAfter", "x-request-id": "requestId", "cache-control": "cacheControl" } as const

type HeaderBag = Record<string, unknown> | unknown[] | undefined

/** Headers arrive as an object (node:http) or as a flat `[name, value, …]` list of buffers (undici). */
function headerValue(headers: HeaderBag, name: string): string | undefined {
  const text = (value: unknown) => Array.isArray(value) ? value.map(String).join(", ") : value === undefined || value === null ? undefined : String(value)
  if (Array.isArray(headers)) {
    for (let i = 0; i + 1 < headers.length; i += 2) {
      if (String(headers[i]).toLowerCase() === name) {
        return text(headers[i + 1])
      }
    }
    return undefined
  }
  if (!headers) {
    return undefined
  }
  const key = Object.keys(headers).find(candidate => candidate.toLowerCase() === name)
  return key ? text(headers[key]) : undefined
}

function detailsOf(status: number | undefined, requestHeaders: HeaderBag, responseHeaders: HeaderBag, requestBytes?: number): Record<string, string | number> {
  const details: Record<string, string | number> = {}
  if (status !== undefined) {
    details.status = status
  }
  const sent = requestBytes ?? Number(headerValue(requestHeaders, "content-length"))
  if (Number.isFinite(sent) && sent > 0) {
    details.requestBytes = sent
  }
  const received = Number(headerValue(responseHeaders, "content-length"))
  if (Number.isFinite(received) && received >= 0 && headerValue(responseHeaders, "content-length") !== undefined) {
    details.responseBytes = received
  }
  for (const [header, key] of Object.entries(SAFE_HEADERS)) {
    const value = headerValue(responseHeaders, header)
    if (value) {
      details[key] = value.slice(0, MAX_VALUE)
    }
  }
  return details
}

/** Closes a call with the status the server answered; a 5xx counts as an error, a 4xx is a normal answer. */
function finish(handle: OperationHandle, status: number | undefined, details: Record<string, string | number> = {}) {
  const { event } = handle
  if (status !== undefined) {
    event.analysis = { ...event.analysis, label: `${event.api} ${status}` }
  }
  handle.end({ error: status !== undefined && status >= 500 ? `HTTP ${status}` : null, details })
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
  getHeaders?: () => Record<string, unknown>
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
            // `http.client.request.start` is published once the headers are already stored: node:http cannot carry a
            // traceparent from here (only fetch and undici can, below).
          }
        } catch {
          // best effort
        }
      }],
      ["http.client.response.finish", (message) => {
        try {
          const { request, response } = message as { request: ClientRequestLike, response: { statusCode?: number, headers?: Record<string, unknown> } }
          const handle = open.get(request)
          open.delete(request)
          if (handle) {
            finish(handle, response?.statusCode, detailsOf(response?.statusCode, request.getHeaders?.(), response?.headers))
          }
        } catch {
          // best effort: a diagnostics_channel subscriber that throws would crash the application
        }
      }],
      ["http.client.request.error", (message) => {
        try {
          const { request, error } = message as { request: object, error: unknown }
          const handle = open.get(request)
          open.delete(request)
          handle?.end({ error })
        } catch {
          // best effort
        }
      }]
    ])
  }
}

// ── fetch and undici ────────────────────────────────────────────────────

interface UndiciRequestLike {
  origin?: string | URL
  method?: string
  path?: string
  headers?: string | unknown[]
  contentLength?: number | null
  addHeader?: (name: string, value: string) => unknown
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
            const sent = typeof request.headers === "string" ? request.headers.toLowerCase().includes("traceparent:") : Array.isArray(request.headers) && request.headers.some(item => String(item).toLowerCase() === "traceparent")
            if (!sent) {
              propagate(handle, value => request.addHeader?.("traceparent", value))
            }
          }
        } catch {
          // best effort
        }
      }],
      ["undici:request:headers", (message) => {
        try {
          const { request, response } = message as { request: UndiciRequestLike, response: { statusCode?: number, headers?: unknown[] } }
          const handle = open.get(request)
          open.delete(request)
          if (handle) {
            // undici's request headers are a `name: value\r\n` string in some versions and a flat list in others
            const sent = typeof request.headers === "string" ? request.headers.split("\r\n").flatMap(line => line.split(/:\s*(.*)/s).slice(0, 2)) : request.headers
            finish(handle, response?.statusCode, detailsOf(response?.statusCode, sent, response?.headers, typeof request.contentLength === "number" ? request.contentLength : undefined))
          }
        } catch {
          // best effort
        }
      }],
      ["undici:request:error", (message) => {
        try {
          const { request, error } = message as { request: object, error: unknown }
          const handle = open.get(request)
          open.delete(request)
          handle?.end({ error })
        } catch {
          // best effort
        }
      }]
    ])
  }
}
