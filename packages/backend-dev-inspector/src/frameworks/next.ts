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
 * Server components and server actions have no request object to hook, so wrap them and say what to call them:
 *      export default withInspectorPage("/orders", async function OrdersPage() { … })
 *      export const createOrder = withInspectorAction("createOrder", async (formData: FormData) => { … })
 * Each is then one request in the inspector (`GET /orders`, `ACTION createOrder`) with its own calls and findings; a
 * `redirect()` or `notFound()` is not a failure. Called inside a wrapped route handler, they join that request.
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

/** What Next.js throws for `redirect()` and `notFound()`: control flow, not errors. */
function statusOfThrown(error: unknown): number {
  const digest = String((error as { digest?: unknown } | null)?.digest ?? "")
  if (digest.startsWith("NEXT_REDIRECT")) {
    return 307
  }
  return digest.startsWith("NEXT_NOT_FOUND") || digest.includes("NEXT_HTTP_ERROR_FALLBACK;404") ? 404 : 500
}

/** Wraps a server component (an async function) so its database and HTTP calls are one request, `GET <path>`. */
export function withInspectorPage<Args extends unknown[], Result>(path: string, component: (...args: Args) => Result | Promise<Result>, options: StartOptions = {}): (...args: Args) => Promise<Result> {
  const web = createWebInspector(options)
  if (!web.enabled) {
    return async (...args) => await component(...args)
  }
  return async (...args) => await web.run("GET", path, () => component(...args), ({ error }) => error === undefined ? 200 : statusOfThrown(error))
}

/** Wraps a server action so its calls are one request, `ACTION <name>`. */
export function withInspectorAction<Args extends unknown[], Result>(name: string, action: (...args: Args) => Result | Promise<Result>, options: StartOptions = {}): (...args: Args) => Promise<Result> {
  const web = createWebInspector(options)
  if (!web.enabled) {
    return async (...args) => await action(...args)
  }
  return async (...args) => await web.run("ACTION", name, () => action(...args), ({ error }) => error === undefined ? 200 : statusOfThrown(error))
}
