import type { StartOptions } from "sql-dev-inspector"
import { createWebInspector } from "./start.js"

export type FetchHandler<Args extends unknown[] = []> = (request: Request, ...args: Args) => Response | Promise<Response>

/**
 * Wraps a handler shaped `(request) => Response`: the inspector's own pages are answered first, and everything
 * else runs as one traced request. For `Bun.serve`, `Deno.serve`, Cloudflare-style workers and
 * anything else with that shape.
 */
export function wrapFetch<Args extends unknown[] = []>(handler: FetchHandler<Args>, options: StartOptions = {}): FetchHandler<Args> {
  const web = createWebInspector(options)
  if (!web.enabled) {
    return handler
  }
  return async (request, ...args) => (await web.handle(request)) ?? await web.track(request, () => handler(request, ...args))
}
