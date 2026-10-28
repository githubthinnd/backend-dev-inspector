import type { StartOptions } from "sql-dev-inspector"
import { createWebInspector } from "../start.js"

interface AstroContextLike {
  request: Request
}

/** Astro middleware (src/middleware.ts): `export const onRequest = inspectorMiddleware()`. */
export function inspectorMiddleware(options: StartOptions = {}) {
  const web = createWebInspector(options)
  return async (context: AstroContextLike, next: () => Response | Promise<Response>): Promise<Response> => {
    if (!web.enabled) {
      return await next()
    }
    return (await web.handle(context.request)) ?? await web.track(context.request, () => next())
  }
}

export default inspectorMiddleware
