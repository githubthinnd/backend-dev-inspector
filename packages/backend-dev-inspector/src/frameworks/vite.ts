import type { IncomingMessage, ServerResponse } from "node:http"
import type { StartOptions } from "sql-dev-inspector"
import { createInspector } from "../start.js"

interface ViteServerLike {
  middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => void) => unknown }
}

/**
 * Vite plugin for apps whose backend runs inside the Vite dev server (SvelteKit, Remix, Astro,
 * SSR setups): `plugins: [inspector()]`. It serves `/__sql-inspector/` and wraps every request
 * the dev server handles, development only.
 */
export function inspector(options: StartOptions = {}) {
  return {
    name: "backend-dev-inspector",
    apply: "serve" as const,
    configureServer(server: ViteServerLike) {
      const instance = createInspector(options)
      if (instance.enabled) {
        server.middlewares.use(instance.middleware)
      }
    }
  }
}

export default inspector
