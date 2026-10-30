import { createServer, type Server } from "node:http"
import { DEFAULT_MOCK_API_URL } from "./scenarios.ts"
import { CUSTOMERS } from "./schema.ts"

/**
 * A small fake "customer service" for the outbound-HTTP scenario: `GET /customers/:id`.
 * Several apps can run at once; the first one to start serves it, the others use it.
 */
export function ensureMockApi(url: string = process.env.MOCK_API_URL ?? DEFAULT_MOCK_API_URL): Promise<Server | null> {
  const port = Number(new URL(url).port)
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      const match = /^\/customers\/(\d+)$/.exec(request.url ?? "")
      setTimeout(() => {
        response.setHeader("content-type", "application/json")
        if (match) {
          const id = Number(match[1])
          response.end(JSON.stringify({ id, name: CUSTOMERS[id - 1]?.name ?? `Customer ${id}`, tier: id % 2 ? "gold" : "silver", points: 120 * id }))
        } else {
          response.statusCode = 404
          response.end(JSON.stringify({ error: "not found" }))
        }
      }, 8)
    })
    server.once("error", () => resolve(null)) // the port is taken: another app is serving it
    server.listen(port, "127.0.0.1", () => resolve(server))
  })
}
