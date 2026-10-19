import type { IncomingMessage, ServerResponse } from "node:http"
import { translate } from "./i18n/index.js"
import { handleInspectorRequest, inspectorSubPath } from "./inspector-server.js"
import { startInspector } from "./setup.js"
import { runInRequest } from "./tracer.js"

interface NitroEventLike {
  node: { req: IncomingMessage, res: ServerResponse }
}

interface NitroAppLike {
  h3App: { handler: (event: NitroEventLike) => unknown }
}

/**
 * Nitro plugin (Nuxt, Nitro): patches mysql2 once, then wraps the top-level h3 handler (the
 * same hook Nitro uses for its own async context) so every statement awaited anywhere beneath
 * a request is attributed to it, middleware included.
 */
export default function sqlInspectorPlugin(nitroApp: NitroAppLike) {
  const inspector = startInspector()
  if (!inspector) {
    return
  }
  const { store } = inspector

  const next = nitroApp.h3App.handler
  nitroApp.h3App.handler = (event) => {
    const { req, res } = event.node
    const subPath = inspectorSubPath(req.url)
    if (subPath !== null) {
      handleInspectorRequest(req, res, subPath, inspector)
      return undefined
    }

    const trace = store.startRequest(req.method ?? "GET", req.url ?? "/")
    // `close` fires on a finished response and on an aborted one alike.
    res.once("close", () => store.finishRequest(trace, res.statusCode))
    return runInRequest(trace, () => next(event))
  }

  console.log(translate(inspector.locale, "term.ready", { path: "/__sql-inspector/" }))
}
