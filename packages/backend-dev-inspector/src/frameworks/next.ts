import type { StartOptions } from "sql-dev-inspector"
import { createWebInspector, startInspector } from "../start.js"

/**
 * Next.js (App Router).
 *
 * 1. instrumentation.ts: call `register()` once, on the Node.js runtime only (see the README for
 *    the exact snippet: the edge runtime must not load this package).
 * 2. app/%5F%5Fsql-inspector/[[...path]]/route.ts (%5F is "_": a folder that starts with an
 *    underscore is private in Next.js and would not be a route):
 *      import { inspectorRoute } from "backend-dev-inspector/next"
 *      export const { GET, POST } = inspectorRoute()
 * 3. Wrap the route handlers you want attributed:
 *      export const GET = withInspector(async (request) => Response.json(await db.query(…)))
 *
 * Server components and server actions have no hook: their calls are listed under
 * "outside any request".
 */
export async function register(options: StartOptions = {}): Promise<void> {
  startInspector(undefined, options)
}

export function inspectorRoute(options: StartOptions = {}) {
  const web = createWebInspector(options)
  const serve = async (request: Request): Promise<Response> =>
    (await web.handle(request)) ?? new Response("Not found", { status: 404 })
  return { GET: serve, POST: serve }
}

type RouteHandler<Context> = (request: Request, context: Context) => Response | Promise<Response>

/** Wraps an App Router route handler so its database and HTTP calls belong to the request. */
export function withInspector<Context = unknown>(handler: RouteHandler<Context>, options: StartOptions = {}): RouteHandler<Context> {
  const web = createWebInspector(options)
  if (!web.enabled) {
    return handler
  }
  return (request, context) => web.track(request, () => handler(request, context))
}
