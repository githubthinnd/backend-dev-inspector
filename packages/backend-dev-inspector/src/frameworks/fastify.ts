import type { IncomingMessage, ServerResponse } from "node:http"
import type { StartOptions } from "sql-dev-inspector"
import { createInspector } from "../start.js"

interface FastifyRequestLike {
  raw: IncomingMessage
}

interface FastifyReplyLike {
  raw: ServerResponse
  hijack: () => unknown
}

interface FastifyLike {
  addHook: (name: "onRequest", hook: (request: FastifyRequestLike, reply: FastifyReplyLike, done: (error?: Error) => void) => void) => unknown
}

/**
 * Fastify plugin: `await app.register(inspectorPlugin())`. It serves `/__sql-inspector/` and runs
 * every request, with its hooks and handler, inside the request scope. It is registered without
 * encapsulation, so it applies to the whole application however it is registered.
 */
export function inspectorPlugin(options: StartOptions = {}) {
  const inspector = createInspector(options)
  const plugin = (fastify: FastifyLike, _options: unknown, done: (error?: Error) => void) => {
    if (inspector.enabled) {
      fastify.addHook("onRequest", (request, reply, next) => {
        if (inspector.handle(request.raw, reply.raw)) {
          reply.hijack() // the inspector has answered on the raw response
          return
        }
        inspector.track(request.raw, reply.raw, () => next())
      })
    }
    done()
  }
  // What `fastify-plugin` does: apply the hooks to the parent instance too.
  ;(plugin as unknown as Record<symbol, unknown>)[Symbol.for("skip-override")] = true
  ;(plugin as unknown as Record<symbol, unknown>)[Symbol.for("fastify.display-name")] = "backend-dev-inspector"
  return plugin
}

export default inspectorPlugin
