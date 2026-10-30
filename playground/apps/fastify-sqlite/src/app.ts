import Fastify from "fastify"
import inspectorPlugin from "backend-dev-inspector/fastify"
import { createSqliteRepository, DEFAULT_MOCK_API_URL, openDatabase, runScenario, scenarios, serveWeb } from "@playground/shared"

export async function createApp() {
  const app = Fastify()
  await app.register(inspectorPlugin())

  const repo = createSqliteRepository(openDatabase())
  const context = { mockApiUrl: process.env.MOCK_API_URL ?? DEFAULT_MOCK_API_URL }

  const info = { framework: "Fastify 5", data: "better-sqlite3" }
  const web = async (request: { url: string }, reply: import("fastify").FastifyReply) => {
    const page = serveWeb(new URL(request.url, "http://localhost").pathname, info)
    return page ? reply.status(page.status).type(page.type).send(page.body) : reply.status(404).send({ error: "not found" })
  }
  app.get("/", web)
  app.get("/assets/:file", web)
  app.get("/api/health", async () => ({ ok: true }))
  for (const scenario of scenarios) {
    app.get(scenario.path, async (_request, reply) => {
      const { status, body } = await runScenario(scenario, repo, context)
      return reply.status(status).send(body)
    })
  }
  return app
}
