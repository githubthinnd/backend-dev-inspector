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
  /** False when the data layer shows its transactions as the operations inside (Prisma), not as BEGIN / COMMIT / SAVEPOINT. */
  sqlTransactions: boolean
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
    sqlTransactions: true,
    boot: async () => viaInject((await import("../apps/express-sqlite/src/app.ts")).createApp())
  },
  {
    name: "express-drizzle",
    sqlTransactions: true,
    boot: async () => viaInject((await import("../apps/express-drizzle/src/app.ts")).createApp())
  },
  {
    name: "fastify-sqlite",
    sqlTransactions: true,
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
    sqlTransactions: true,
    boot: async () => viaInject((await import("../apps/koa-sqlite/src/app.ts")).createApp().callback())
  },
  {
    name: "hono-sqlite",
    sqlTransactions: true,
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
    sqlTransactions: false,
    available: () => existsSync(fileURLToPath(new URL("../apps/nuxt3-prisma/server/generated/prisma/client.ts", import.meta.url))),
    boot: async () => {
      const { createInspector } = await import("backend-dev-inspector")
      const { DEFAULT_MOCK_API_URL, findScenario, runScenario, serveWeb } = await import("@playground/shared")
      const { createPrismaRepository } = await import("../apps/nuxt3-prisma/server/utils/prisma-repository.ts")
      const inspector = createInspector()
      const repo = createPrismaRepository(join(tmpdir(), `playground-prisma-${process.pid}.sqlite`))
      const context = { mockApiUrl: DEFAULT_MOCK_API_URL }
      // The first Prisma call loads its query compiler and takes far longer than the slow-query threshold, and
      // a cold start is not what these tests are about: warm it up outside any request.
      await repo.orderHeaders(1)
      return viaInject((request: IncomingMessage, response: ServerResponse) => {
        if (inspector.handle(request, response)) {
          return
        }
        void inspector.track(request, response, async () => {
          const { pathname } = new URL(request.url ?? "/", "http://localhost")
          const page = serveWeb(pathname, { framework: "Node http", data: "Prisma" })
          const scenario = findScenario(pathname)
          const { status, type, body } = page
            ? { status: page.status, type: page.type, body: page.body }
            : scenario
              ? await runScenario(scenario, repo, context).then(({ status, body }) => ({ status, type: "application/json", body: JSON.stringify(body) }))
              : pathname === "/api/health"
                ? { status: 200, type: "application/json", body: JSON.stringify({ ok: true }) }
                : { status: 404, type: "application/json", body: JSON.stringify({ error: "not found" }) }
          response.statusCode = status
          response.setHeader("content-type", type)
          response.end(body)
        })
      })
    }
  }
]
