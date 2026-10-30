import type { IncomingMessage, ServerResponse } from "node:http"
import { resolveEditor } from "./caller.js"
import { diagnose } from "./doctor.js"
import { handleMcp } from "./mcp.js"
import { installedDrivers } from "./setup.js"
import { parsePatterns } from "./route-filter.js"
import type { RedactMode } from "./redact.js"
import { DEFAULT_MOUNT, type Inspector } from "./runtime.js"
import { rejectReason } from "./guard.js"
import { cachedReport, formattedSql } from "./report-cache.js"
import { renderPage } from "./ui/page.js"

const TRAILING_SLASHES = /\/+$/
const REDACT_MODES = new Set(["params", "all", "off"])
const QUERY_OR_HASH = /[?#]/
const REQUEST_DETAIL = /^\/api\/requests\/([\w-]+)$/

export { DEFAULT_MOUNT as INSPECTOR_PATH } from "./runtime.js"

/**
 * Matches `/<mount>/...` under any base path (`/__sql-inspector/...`, `/app/__sql-inspector/...`, or
 * wherever `SQL_INSPECTOR_PATH` put it); returns the part after it, or null. Done with segments,
 * not a pattern built from the setting: nothing in this package compiles code from strings.
 */
export function inspectorSubPath(url: string | undefined, mount: string = DEFAULT_MOUNT): string | null {
  if (!url) {
    return null
  }
  const end = url.search(QUERY_OR_HASH)
  const segments = (end === -1 ? url : url.slice(0, end)).split("/")
  const wanted = mount.split("/")
  // segments[0] is what precedes the first slash; the base path may not contain empty segments.
  for (let at = 1; at + wanted.length <= segments.length; at++) {
    if (segments[at - 1] === "" && at > 1) {
      return null // an empty segment before the match: not a base path
    }
    if (wanted.every((part, offset) => segments[at + offset] === part)) {
      const rest = segments.slice(at + wanted.length)
      return rest.length > 0 ? `/${rest.join("/")}` : ""
    }
  }
  return null
}

/** Range the UI may set the slow-query threshold to, in milliseconds. */
export const SLOW_MS_RANGE = { min: 1, max: 600_000 } as const
const MAX_BODY_BYTES = 1024
const MAX_MCP_BYTES = 64 * 1024

function settingsOf(inspector: Inspector) {
  return {
    slowMs: inspector.report.slowMs,
    defaultSlowMs: inspector.defaultSlowMs,
    ...SLOW_MS_RANGE,
    brand: inspector.brand,
    redact: inspector.redact,
    include: inspector.filters.include,
    exclude: inspector.filters.exclude,
    stack: inspector.stack,
    logs: inspector.logs,
    drivers: installedDrivers(),
    editor: inspector.editor,
    root: inspector.root,
    defaults: { redact: inspector.defaults.redact, include: inspector.defaults.filters.include, exclude: inspector.defaults.filters.exclude, stack: inspector.defaults.stack, logs: inspector.defaults.logs, editor: inspector.defaults.editor.name },
    mount: inspector.mount
  }
}

function sendJson(res: ServerResponse, body: unknown, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
  res.end(JSON.stringify(body))
}

function readJsonBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer | string) => {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk
      size += buffer.length
      if (size > limit) {
        reject(new Error("body too large"))
        return
      }
      chunks.push(buffer)
    })
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      } catch (error) {
        reject(error as Error)
      }
    })
    req.on("error", reject)
  })
}

/** `null` asks for the default; a number must be a whole millisecond count in `SLOW_MS_RANGE`. */
function parseSlowMs(value: unknown): number | null | undefined {
  if (value === null) {
    return null
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= SLOW_MS_RANGE.min && value <= SLOW_MS_RANGE.max) {
    return value
  }
  return undefined
}

const MAX_PATTERNS = 50
const MAX_PATTERN_LENGTH = 200
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/

/** A list of route patterns, each a short plain string. */
function parsePatternList(value: unknown): string[] | null | undefined {
  if (value === null) {
    return null
  }
  if (!Array.isArray(value) || value.length > MAX_PATTERNS) {
    return undefined
  }
  const cleaned: string[] = []
  for (const item of value) {
    if (typeof item !== "string" || item.length > MAX_PATTERN_LENGTH || CONTROL_CHARACTERS.test(item)) {
      return undefined
    }
    cleaned.push(item)
  }
  return parsePatterns(cleaned)
}

interface SettingsChange {
  slowMs?: number | null
  redact?: RedactMode | null
  include?: string[] | null
  exclude?: string[] | null
  stack?: boolean | null
  logs?: boolean | null
  editor?: string | null
}

/** What a POST to `/api/settings` may change: any of these, each validated on its own; anything else is refused. */
function parseSettingsBody(body: unknown): SettingsChange | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Expected a JSON object"
  }
  const input = body as Record<string, unknown>
  const change: SettingsChange = {}
  if ("slowMs" in input) {
    const slowMs = parseSlowMs(input.slowMs)
    if (slowMs === undefined) {
      return `slowMs must be a whole number from ${SLOW_MS_RANGE.min} to ${SLOW_MS_RANGE.max}, or null`
    }
    change.slowMs = slowMs
  }
  if ("redact" in input) {
    if (input.redact !== null && !REDACT_MODES.has(String(input.redact))) {
      return "redact must be \"params\", \"all\", \"off\" or null"
    }
    change.redact = input.redact as RedactMode | null
  }
  if ("stack" in input) {
    if (input.stack !== null && typeof input.stack !== "boolean") {
      return "stack must be true, false or null"
    }
    change.stack = input.stack as boolean | null
  }
  if ("logs" in input) {
    if (input.logs !== null && typeof input.logs !== "boolean") {
      return "logs must be true, false or null"
    }
    change.logs = input.logs as boolean | null
  }
  if ("editor" in input) {
    if (input.editor !== null && (typeof input.editor !== "string" || input.editor.length > 300 || CONTROL_CHARACTERS.test(input.editor))) {
      return "editor must be the name of an editor, a link template, or null"
    }
    change.editor = input.editor as string | null
  }
  for (const key of ["include", "exclude"] as const) {
    if (key in input) {
      const list = parsePatternList(input[key])
      if (list === undefined) {
        return `${key} must be a list of at most ${MAX_PATTERNS} short route patterns, or null`
      }
      change[key] = list
    }
  }
  return Object.keys(change).length > 0 ? change : "Nothing to change"
}

/**
 * The inspector is served straight from the Nitro handler chain's entry point, ahead of
 * every Nuxt middleware: it must not need the app to authenticate it, and the queries those middlewares
 * run to authenticate the inspector itself would otherwise pollute what it shows.
 */
export function handleInspectorRequest(req: IncomingMessage, res: ServerResponse, subPath: string, inspector: Inspector) {
  const { store } = inspector
  const path = subPath.replace(TRAILING_SLASHES, "")

  const refusal = rejectReason(req, inspector.allowedHosts)
  if (refusal) {
    sendJson(res, { message: refusal }, 403)
    return
  }

  if (subPath === "") {
    res.writeHead(308, { location: `${req.url!.split("?")[0]}/` })
    res.end()
    return
  }

  if (req.method === "GET" && path === "") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" })
    res.end(renderPage(inspector.localeHint, inspector.brand?.title ?? null))
    return
  }

  if (req.method === "GET" && path === "/api/requests") {
    sendJson(res, store.list().map((trace) => {
      const { totals, insights } = cachedReport(store, trace, inspector.report)
      return {
        id: trace.id,
        method: trace.method,
        url: trace.url,
        status: trace.status,
        startedAt: trace.startedAt,
        durationMs: trace.durationMs,
        queryCount: totals.queryCount,
        sqlTimeMs: totals.sqlTimeMs,
        warnings: insights.filter(i => i.severity === "warn").length,
        errors: insights.filter(i => i.severity === "error").length
      }
    }))
    return
  }

  const detail = REQUEST_DETAIL.exec(path)
  if (req.method === "GET" && detail) {
    const trace = store.get(detail[1]!)
    if (!trace) {
      sendJson(res, { message: "Request not found (evicted or cleared)" }, 404)
      return
    }
    const report = cachedReport(store, trace, inspector.report)
    sendJson(res, {
      ...report,
      formattedSql: Object.fromEntries(trace.queries.map(q => [q.seq, formattedSql(q)]))
    })
    return
  }

  if (req.method === "GET" && path === "/api/stream") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", "connection": "keep-alive" })
    res.write(": connected\n\n")
    let timer: NodeJS.Timeout | null = null
    const pending = new Set<string>()
    const unsubscribe = store.subscribe((change) => {
      pending.add(change.type === "clear" || change.type === "settings" ? change.type : change.requestId)
      // A burst of statements becomes one event, so a 500-query request cannot flood the page.
      timer ??= setTimeout(() => {
        timer = null
        res.write(`data: ${JSON.stringify({ changed: [...pending] })}\n\n`)
        pending.clear()
      }, 80)
    })
    req.on("close", () => {
      unsubscribe()
      if (timer) {
        clearTimeout(timer)
      }
    })
    return
  }

  if (path === "/mcp") {
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST", "content-type": "application/json; charset=utf-8" })
      res.end(JSON.stringify({ message: "The MCP endpoint takes POST (JSON-RPC)." }))
      return
    }
    readJsonBody(req, MAX_MCP_BYTES).then((body) => {
      const answer = handleMcp(inspector, body)
      if (answer === null) {
        res.writeHead(202, { "cache-control": "no-store" })
        res.end()
        return
      }
      sendJson(res, answer)
    }).catch(() => sendJson(res, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400))
    return
  }

  if (req.method === "GET" && path === "/api/doctor") {
    sendJson(res, { checks: diagnose(inspector) })
    return
  }

  if (req.method === "GET" && path === "/api/settings") {
    sendJson(res, settingsOf(inspector))
    return
  }

  if (req.method === "POST" && path === "/api/settings") {
    // Only a JSON content type: a cross-origin page cannot send one without a CORS preflight, which this server never answers.
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      sendJson(res, { message: "Expected application/json" }, 415)
      return
    }
    readJsonBody(req).then((body) => {
      const change = parseSettingsBody(body)
      if (typeof change === "string") {
        sendJson(res, { message: change }, 400)
        return
      }
      if ("slowMs" in change) {
        inspector.report.slowMs = change.slowMs ?? inspector.defaultSlowMs
      }
      if ("redact" in change) {
        inspector.redact = change.redact ?? inspector.defaults.redact
        store.redact = inspector.redact
      }
      if ("stack" in change) {
        inspector.stack = change.stack ?? inspector.defaults.stack
        store.captureCaller = inspector.stack
      }
      if ("logs" in change) {
        inspector.logs = change.logs ?? inspector.defaults.logs
      }
      if ("editor" in change) {
        inspector.editor = change.editor === null || change.editor === undefined ? { ...inspector.defaults.editor } : resolveEditor(change.editor)
      }
      if ("include" in change) {
        inspector.filters.include = change.include ?? [...inspector.defaults.filters.include]
      }
      if ("exclude" in change) {
        inspector.filters.exclude = change.exclude ?? [...inspector.defaults.filters.exclude]
      }
      store.settingsChanged()
      sendJson(res, settingsOf(inspector))
    }).catch(() => sendJson(res, { message: "Invalid JSON body" }, 400))
    return
  }

  if (req.method === "POST" && path === "/api/clear") {
    store.clear()
    sendJson(res, { ok: true })
    return
  }

  sendJson(res, { message: "Not found" }, 404)
}
