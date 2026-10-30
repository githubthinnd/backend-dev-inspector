import express from "express"
import { createInspector } from "backend-dev-inspector"

/**
 * A gateway in front of another service (the orders API of `express-sqlite`). Every call it makes to that service is an
 * outbound HTTP call in its own inspector and, with SQL_INSPECTOR_PROPAGATE=1, carries a `traceparent`: open the
 * orders service's inspector and search its requests by the trace id shown here to see what each call did there.
 */
export function createApp(options: { ordersUrl: string }) {
  const app = express()
  app.use(createInspector().middleware)

  const orders = async (path: string) => {
    const response = await fetch(`${options.ordersUrl}${path}`)
    return { status: response.status, body: await response.json() as unknown }
  }

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true })
  })
  // One call to the other service: a healthy request across two services.
  app.get("/api/gateway/orders", async (_request, response) => {
    const { status, body } = await orders("/api/orders")
    response.status(status).json(body)
  })
  // The same call four times: a repeated call across services, which is invisible in either service alone.
  app.get("/api/gateway/fanout", async (_request, response) => {
    const results = []
    for (let page = 1; page <= 4; page++) {
      results.push((await orders("/api/orders")).body)
    }
    response.json({ pages: results.length })
  })
  // The other service's own N+1 and its slow query, reached through the gateway.
  app.get("/api/gateway/orders/n-plus-one", async (_request, response) => {
    const { status, body } = await orders("/api/orders/n-plus-one")
    response.status(status).json(body)
  })
  return app
}
