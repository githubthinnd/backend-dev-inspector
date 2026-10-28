import type { StartOptions } from "sql-dev-inspector"
import { createWebInspector } from "../start.js"

interface HonoContextLike {
  req: { raw: Request }
  res: Response
}

/**
 * Hono middleware: `app.use("*", inspectorMiddleware())`. Works on every Hono runtime (Node, Bun,
 * Deno, Workers): it serves `/__sql-inspector/` and runs the rest of the chain as one traced request.
 */
export function inspectorMiddleware(options: StartOptions = {}) {
  const web = createWebInspector(options)
  return async (c: HonoContextLike, next: () => Promise<void>): Promise<Response | undefined> => {
    if (!web.enabled) {
      await next()
      return undefined
    }
    const served = await web.handle(c.req.raw)
    if (served) {
      return served
    }
    await web.track(c.req.raw, async () => {
      await next()
      return c.res
    })
    return undefined
  }
}

export default inspectorMiddleware
