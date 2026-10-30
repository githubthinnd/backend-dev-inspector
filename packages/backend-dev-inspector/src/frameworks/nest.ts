import type { StartOptions } from "sql-dev-inspector"
import { inspectorPlugin } from "./fastify.js"
import { createInspector } from "../start.js"

/**
 * NestJS, on either platform. Nest runs on Express or Fastify underneath, so this picks the matching adapter for the
 * application it is given. Call it in `main.ts`, before `listen`:
 *
 *   const app = await NestFactory.create(AppModule)
 *   await inspectNest(app)
 *   await app.listen(3000)
 *
 * Guards, pipes, interceptors, controllers and services all run inside the request scope, so everything they call
 * belongs to the request. Nothing is loaded from `@nestjs/*`.
 */

interface NestAppLike {
  getHttpAdapter: () => { getType?: () => string, getInstance?: () => unknown }
  use?: (...args: unknown[]) => unknown
  register?: (plugin: unknown, options?: unknown) => unknown
}

export async function inspectNest<T extends object>(app: T, options: StartOptions = {}): Promise<T> {
  const nest = app as unknown as NestAppLike
  const type = nest.getHttpAdapter?.().getType?.() ?? "express"
  if (type === "fastify") {
    // NestFastifyApplication registers fastify plugins itself; the plugin is applied to the whole instance.
    await nest.register?.(inspectorPlugin(options))
    return app
  }
  const inspector = createInspector(options)
  if (inspector.enabled) {
    nest.use?.(inspector.middleware)
  }
  return app
}
