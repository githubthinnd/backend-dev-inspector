import type { IncomingMessage, ServerResponse } from "node:http"
import type { StartOptions } from "./setup.js"
import { EventEmitter } from "node:events"
import { currentTrace, runIgnored, runInRequest } from "./context.js"
import { handleInspectorRequest, inspectorSubPath } from "./inspector-server.js"
import { isTracked } from "./route-filter.js"
import { startInspector } from "./setup.js"

/**
 * The inspector for frameworks built on the web-standard `Request` / `Response` (Hono, SvelteKit,
 * Next.js route handlers, Remix, Astro, Bun, Deno, Cloudflare-style fetch handlers). The routes
 * are the same ones the Node adapters serve; only the plumbing differs.
 */
export interface WebInspector {
  /** False when the environment switched the inspector off; every other member is then a no-op. */
  enabled: boolean
  /** Serves the inspector's own pages, or returns null when `request` is not for them. */
  handle: (request: Request) => Promise<Response | null>
  /** Runs `handler` as one traced request; the request ends with the status of the Response it returns. */
  track: (request: Request, handler: () => Response | Promise<Response>) => Promise<Response>
  /**
   * Runs `fn` as one traced unit that has no `Request` of its own: a server component, a server action, a job.
   * It is listed as `method` + `label` (`GET /orders`, `ACTION createOrder`), ends with `status(result)` or 500 when it throws,
   * and is left alone when it runs inside a request that is already traced.
   */
  run: <T>(method: string, label: string, fn: () => T | Promise<T>, status?: (outcome: { result?: T, error?: unknown }) => number) => Promise<T>
}

function pathOf(url: string): string {
  const { pathname, search } = new URL(url)
  return pathname + search
}

function headersOf(request: Request, url: URL): Record<string, string> {
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })
  headers.host ??= url.host
  return headers
}

export function createWebInspector(options: StartOptions = {}): WebInspector {
  const inspector = startInspector(undefined, options)
  if (!inspector) {
    return { enabled: false, handle: async () => null, track: async (_request, handler) => await handler(), run: async (_method, _label, fn) => await fn() }
  }
  const { store } = inspector

  const handle: WebInspector["handle"] = async (request) => {
    const url = new URL(request.url)
    const subPath = inspectorSubPath(url.pathname + url.search, inspector.mount)
    if (subPath === null) {
      return null
    }
    const text = request.method === "GET" || request.method === "HEAD" ? "" : await request.text()

    return await new Promise<Response>((resolve) => {
      const req = Object.assign(new EventEmitter(), { url: url.pathname + url.search, method: request.method, headers: headersOf(request, url) })
      const encoder = new TextEncoder()
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined
      let status = 200
      let closed = false

      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c
        },
        cancel() {
          closed = true
          req.emit("close")
        }
      })
      request.signal?.addEventListener("abort", () => {
        closed = true
        req.emit("close")
      })

      const write = (chunk: unknown) => {
        if (!closed && controller && chunk !== undefined && chunk !== "") {
          controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk as Uint8Array)
        }
        return true
      }
      const res = {
        get statusCode() {
          return status
        },
        set statusCode(value: number) {
          status = value
        },
        writeHead(code: number, headers: Record<string, string> = {}) {
          status = code
          resolve(new Response(stream, { status: code, headers }))
          return res
        },
        write,
        end(chunk?: unknown) {
          write(chunk)
          if (!closed) {
            closed = true
            controller?.close()
          }
        }
      }

      handleInspectorRequest(req as unknown as IncomingMessage, res as unknown as ServerResponse, subPath, inspector)
      // The handler has attached its listeners by now; feed it the body, if the route reads one.
      queueMicrotask(() => {
        if (text) {
          req.emit("data", Buffer.from(text))
        }
        req.emit("end")
      })
    })
  }

  const track: WebInspector["track"] = async (request, handler) => {
    if (!isTracked(inspector.filters, new URL(request.url).pathname)) {
      return await runIgnored(handler)
    }
    const trace = store.startRequest(request.method, pathOf(request.url))
    try {
      const response = await runInRequest(trace, handler)
      store.finishRequest(trace, response.status)
      return response
    } catch (error) {
      store.finishRequest(trace, 500)
      throw error
    }
  }

  const run: WebInspector["run"] = async (method, label, fn, status) => {
    const current = currentTrace()
    if (current) {
      return await fn()
    }
    if (!isTracked(inspector.filters, label.startsWith("/") ? label.split("?")[0]! : `/${label}`)) {
      return await runIgnored(fn)
    }
    const trace = store.startRequest(method, label)
    try {
      const result = await runInRequest(trace, fn)
      store.finishRequest(trace, status?.({ result }) ?? 200)
      return result
    } catch (error) {
      store.finishRequest(trace, status?.({ error }) ?? 500)
      throw error
    }
  }

  return { enabled: true, handle, track, run }
}
