import type { IncomingMessage, ServerResponse } from "node:http"
import type { StartOptions } from "sql-dev-inspector"
import { createInspector } from "../start.js"

interface KoaContextLike {
  req: IncomingMessage
  res: ServerResponse
  respond: boolean
}

/**
 * Koa middleware: `app.use(inspectorMiddleware())`, before the middleware that touches your
 * database. It serves `/__sql-inspector/` and runs everything after it in the request scope.
 */
export function inspectorMiddleware(options: StartOptions = {}) {
  const inspector = createInspector(options)
  return async (ctx: KoaContextLike, next: () => Promise<unknown>): Promise<unknown> => {
    if (!inspector.enabled) {
      return await next()
    }
    if (inspector.handle(ctx.req, ctx.res)) {
      ctx.respond = false // the inspector has answered on the raw response
      return undefined
    }
    return await inspector.track(ctx.req, ctx.res, () => next())
  }
}

export default inspectorMiddleware
