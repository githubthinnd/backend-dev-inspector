import type { StartOptions } from "sql-dev-inspector"
import { wrapFetch } from "../web.js"

/**
 * Remix and React Router (framework mode). Both build a request handler shaped `(request, loadContext) => Response`; wrap it
 * where you create it, and every loader and action it runs belongs to its request:
 *
 *   import { createRequestHandler } from "@remix-run/node"        // or "react-router"
 *   import { inspectRemix } from "backend-dev-inspector/remix"
 *   const handler = inspectRemix(createRequestHandler(build))
 *
 * The inspector's own pages are answered by the wrapper. With the Express adapter of Remix, use `createInspector().middleware`
 * on the Express app instead. Nothing is loaded from Remix or React Router.
 */
export function inspectRemix<Args extends unknown[]>(handler: (request: Request, ...args: Args) => Response | Promise<Response>, options: StartOptions = {}) {
  return wrapFetch(handler, options)
}

export const inspectReactRouter = inspectRemix
