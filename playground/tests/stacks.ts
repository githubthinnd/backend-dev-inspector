import { existsSync } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const load = createRequire(import.meta.url)
const inject = load("light-my-request") as (handler: unknown, options: { url: string }) => Promise<{ statusCode: number, body: string }>

export interface Response {
  status: number
  body: string
}

export interface Stack {
  name: string
  /** False when the data layer has no savepoints (Prisma): the transaction scenario is then only checked for its transaction. */
  savepoints: boolean
  /** The stack needs something the checkout does not have until it is generated (the Prisma client). */
  available?: () => boolean
  /** Starts the app (nothing listens on a port) and answers a GET. */
  boot: () => Promise<(path: string) => Promise<Response>>
}

const viaInject = (handler: unknown) => async (path: string): Promise<Response> => {
  const response = await inject(handler, { url: path })
  return { status: response.statusCode, body: response.body }
}

/** One entry per app in apps/. The test below runs the same scenarios against each. */
export const stacks: Stack[] = [
  {
    name: "express-sqlite",
    savepoints: true,
    boot: async () => viaInject((await import("../apps/express-sqlite/src/app.ts")).createApp())
  },
  {
    name: "express-drizzle",
    savepoints: true,
    boot: async () => viaInject((await import("../apps/express-drizzle/src/app.ts")).createApp())
  },
  {
    name: "fastify-sqlite",
    savepoints: true,
    boot: async () => {
      const app = await (await import("../apps/fastify-sqlite/src/app.ts")).createApp()
      await app.ready()
      return async (path) => {
        const response = await app.inject({ url: path })
        return { status: response.statusCode, body: response.body }
      }
    }
  },
  {
    name: "koa-sqlite",
    savepoints: true,
    boot: async () => viaInject((await import("../apps/koa-sqlite/src/app.ts")).createApp().callback())
  },
  {
    name: "hono-sqlite",
    savepoints: true,
    boot: async () => {
      const app = (await import("../apps/hono-sqlite/src/app.ts")).createApp()
      return async (path) => {
        const response = await app.request(path)
        return { status: response.status, body: await response.text() }
      }
    }
  },
  {
    // The Prisma app is a Nuxt app: its repository is served here by a plain Node `http` handler, which is all the inspector sees of a framework.
    name: "nuxt3-prisma (repository)",
    savepoints: false,
    available: () => existsSync(fileURLToPath(new URL("../apps/nuxt3-prisma/server/generated/prisma/client.ts", import.meta.url))),
    boot: async () => {
      const { createInspector } = await import("backend-dev-inspector")
      const { DEFAULT_MOCK_API_URL, findScenario, runScenario } = await import("@playground/shared")
      const { createPrismaRepository } = await import("../apps/nuxt3-prisma/server/utils/prisma-repository.ts")
      const inspector = createInspector()
      const repo = createPrismaRepository(join(tmpdir(), `playground-prisma-${process.pid}.sqlite`))
      const context = { mockApiUrl: DEFAULT_MOCK_API_URL }
      return viaInject((request: IncomingMessage, response: ServerResponse) => {
        if (inspector.handle(request, response)) {
          return
        }
        void inspector.track(request, response, async () => {
          const scenario = findScenario(new URL(request.url ?? "/", "http://localhost").pathname)
          const { status, body } = scenario ? await runScenario(scenario, repo, context) : { status: 404, body: { error: "not found" } }
          response.statusCode = status
          response.setHeader("content-type", "application/json")
          response.end(JSON.stringify(body))
        })
      })
    }
  }
]
