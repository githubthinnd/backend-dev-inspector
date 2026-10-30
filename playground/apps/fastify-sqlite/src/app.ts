import Fastify from "fastify"
import inspectorPlugin from "backend-dev-inspector/fastify"
import { createSqliteRepository, DEFAULT_MOCK_API_URL, openDatabase, renderIndex, runScenario, scenarios } from "@playground/shared"

export async function createApp() {
  const app = Fastify()
  await app.register(inspectorPlugin())

  const repo = createSqliteRepository(openDatabase())
  const context = { mockApiUrl: process.env.MOCK_API_URL ?? DEFAULT_MOCK_API_URL }

  app.get("/", async (_request, reply) => reply.type("text/html").send(renderIndex("fastify-sqlite")))
  app.get("/api/health", async () => ({ ok: true }))
  for (const scenario of scenarios) {
    app.get(scenario.path, async (_request, reply) => {
      const { status, body } = await runScenario(scenario, repo, context)
      return reply.status(status).send(body)
    })
  }
  return app
}
