import Koa from "koa"
import inspectorMiddleware from "backend-dev-inspector/koa"
import { createSqliteRepository, DEFAULT_MOCK_API_URL, findScenario, openDatabase, renderIndex, runScenario } from "@playground/shared"

export function createApp() {
  const app = new Koa()
  app.use(inspectorMiddleware()) // first

  const repo = createSqliteRepository(openDatabase())
  const context = { mockApiUrl: process.env.MOCK_API_URL ?? DEFAULT_MOCK_API_URL }

  app.use(async (ctx) => {
    if (ctx.path === "/") {
      ctx.type = "html"
      ctx.body = renderIndex("koa-sqlite")
      return
    }
    if (ctx.path === "/api/health") {
      ctx.body = { ok: true }
      return
    }
    const scenario = findScenario(ctx.path)
    if (!scenario) {
      ctx.status = 404
      ctx.body = { error: "not found" }
      return
    }
    const { status, body } = await runScenario(scenario, repo, context)
    ctx.status = status
    ctx.body = body
  })
  return app
}
