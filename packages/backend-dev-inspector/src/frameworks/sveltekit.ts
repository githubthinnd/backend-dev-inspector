import type { StartOptions } from "sql-dev-inspector"
import { createWebInspector } from "../start.js"

interface SvelteKitEventLike {
  request: Request
}

/**
 * SvelteKit `handle` hook (src/hooks.server.ts): `export const handle = inspectorHandle()`, or
 * `sequence(inspectorHandle(), yourHandle)` to keep your own hook.
 */
export function inspectorHandle(options: StartOptions = {}) {
  const web = createWebInspector(options)
  return async <Event extends SvelteKitEventLike>({ event, resolve }: { event: Event, resolve: (event: Event) => Response | Promise<Response> }): Promise<Response> => {
    if (!web.enabled) {
      return await resolve(event)
    }
    return (await web.handle(event.request)) ?? await web.track(event.request, () => resolve(event))
  }
}

export default inspectorHandle
