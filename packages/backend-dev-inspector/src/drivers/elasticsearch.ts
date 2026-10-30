import type { DriverAdapter, OperationHandle, Recorder } from "sql-dev-inspector"
import { describeOperation } from "sql-dev-inspector"
import { objectId } from "../patch.js"
import { wrapperDriver } from "./wrapper.js"
import { kindOfVerb } from "./verbs.js"

/**
 * Elasticsearch and OpenSearch, through the events the client's transport publishes (`client.diagnostic`):
 *
 *   import { instrumentElasticsearch } from "backend-dev-inspector"
 *   const client = instrumentElasticsearch(new Client({ node }))
 *
 * A call is listed as `POST /orders/_search`: the method and the path, which name the index. The query itself (the
 * body) is kept as a parameter, so it is hidden unless values are shown. A retry is a call of its own, with the
 * attempt number. Nothing is loaded from the client library.
 */

const wrapper = wrapperDriver("elasticsearch")

export const elasticsearchDriver: DriverAdapter = wrapper.driver

interface Meta {
  request?: { id?: unknown, params?: { method?: string, path?: string, body?: unknown, bulkBody?: unknown } }
  attempts?: number
  duration?: number
}

interface Result {
  meta?: Meta
  statusCode?: number
  headers?: Record<string, unknown>
  body?: unknown
}

interface Diagnostic {
  on: (event: string, listener: (error: unknown, result: Result) => void) => unknown
}

const MAX_TEXT = 300
const IDS = /\/[0-9a-f]{8,}(?=\/|$)|\/\d+(?=\/|$)/gi

/** The verb of a path (`_search`, `_count`, `_bulk`…), or of the method when the path has none. */
function kindOf(method: string, path: string) {
  const action = /\/(_[a-z_]+)/i.exec(path)?.[1]?.slice(1) ?? ""
  if (action && !["doc", "create", "source"].includes(action)) {
    return kindOfVerb(action === "bulk" ? "bulk" : action === "update" || action === "update_by_query" ? "update" : action === "delete_by_query" ? "delete" : action)
  }
  return method === "GET" || method === "HEAD" ? "select" : method === "DELETE" ? "delete" : method === "PUT" ? "update" : "insert"
}

export function instrumentElasticsearch<T extends object>(client: T, recorder?: Recorder): T {
  const rec = wrapper.recorder(recorder)
  const diagnostic = (client as { diagnostic?: Diagnostic }).diagnostic
  if (!rec || typeof diagnostic?.on !== "function") {
    return client
  }
  const id = objectId(client)
  const open = new Map<unknown, OperationHandle>()
  diagnostic.on("request", (error, result) => {
    try {
      const request = result?.meta?.request
      const params = request?.params
      if (!request || !params) {
        return
      }
      const method = (params.method ?? "GET").toUpperCase()
      const path = params.path ?? "/"
      const text = `${method} ${path}`.slice(0, MAX_TEXT)
      const body = params.body ?? params.bulkBody
      const handle = rec.begin({
        driver: "elasticsearch",
        api: method,
        text,
        params: body === undefined ? null : [body],
        connectionId: id,
        analysis: describeOperation({ kind: kindOf(method, path), label: method, targets: [path.replace(IDS, "/?").split("?")[0]!.slice(0, 120)], text })
      })
      if (!handle) {
        return
      }
      const attempt = (result.meta?.attempts ?? 0) + 1
      if (attempt > 1) {
        handle.event.details = { attempt }
      }
      if (error) {
        handle.end({ error })
        return
      }
      open.get(request.id)?.end()
      open.set(request.id, handle)
    } catch {
      // best effort: a listener that throws would break the request
    }
  })
  diagnostic.on("response", (error, result) => {
    try {
      const key = result?.meta?.request?.id
      const handle = open.get(key)
      open.delete(key)
      if (!handle) {
        return
      }
      const status = result.statusCode
      if (typeof status === "number" && status > 0) {
        handle.event.analysis = { ...handle.event.analysis, label: `${handle.event.api} ${status}` }
      }
      const hits = (result.body as { hits?: { hits?: unknown[] } } | null | undefined)?.hits?.hits
      handle.end({
        error: error ?? (typeof status === "number" && status >= 500 ? `HTTP ${status}` : undefined),
        rowCount: Array.isArray(hits) ? hits.length : null,
        details: typeof status === "number" && status > 0 ? { status } : undefined
      })
    } catch {
      // best effort
    }
  })
  return client
}
