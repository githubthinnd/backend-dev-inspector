import type { Duplex } from "node:stream"
import { createServer, type Server } from "node:http"
import net from "node:net"
import { duplexPair } from "node:stream"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

// Two services in one process, talking over real HTTP (undici, `fetch`) on in-memory sockets routed by host name:
// nothing listens on a port. Propagation is switched on before the inspector starts, as `server.ts` does.
process.env.SQL_INSPECTOR_PROPAGATE = "1"

const servers = new Map<string, Server>()
let inspector: typeof import("backend-dev-inspector")

/** `net.connect` hands out one end of an in-memory pair and gives the other to the server that owns the host name. */
function route() {
  const connect = (options: { host?: string } | number, host?: string): Duplex => {
    const name = typeof options === "object" ? options.host : host
    const server = servers.get(String(name))
    const [client, remote] = duplexPair()
    for (const stream of [client, remote] as unknown as Array<Record<string, unknown>>) {
      for (const method of ["setNoDelay", "setKeepAlive", "setTimeout", "ref", "unref"]) {
        stream[method] = () => stream
      }
      Object.assign(stream, { remoteAddress: "127.0.0.1", remotePort: 5000, localAddress: "127.0.0.1", localPort: 80, connecting: false, address: () => ({ address: "127.0.0.1", port: 0, family: "IPv4" }) })
    }
    if (server) {
      server.emit("connection", remote)
    }
    setImmediate(() => {
      if (!server) {
        client.destroy(new Error(`no service named ${String(name)}`))
        return
      }
      client.emit("connect")
      client.emit("ready")
    })
    return client
  }
  vi.spyOn(net, "createConnection").mockImplementation(connect as never)
  vi.spyOn(net, "connect").mockImplementation(connect as never)
}

beforeAll(async () => {
  inspector = await import("backend-dev-inspector")
  const orders = (await import("../apps/express-sqlite/src/app.ts")).createApp()
  const gateway = (await import("../apps/express-gateway/src/app.ts")).createApp({ ordersUrl: "http://orders.test" })
  servers.set("orders.test", createServer(orders))
  servers.set("gateway.test", createServer(gateway))
  route()
})
afterEach(() => {
  inspector.getInspector().store.clear()
})
afterAll(() => {
  vi.restoreAllMocks()
})

const call = async (path: string) => {
  const response = await fetch(`http://gateway.test${path}`)
  return { status: response.status, body: await response.text() }
}
const traces = () => inspector.getInspector().store.list().filter(trace => trace.id !== "background")

describe("two services, one operation", () => {
  it("passes the trace on: the orders service's request belongs to the gateway's trace, and answers the gateway's call", async () => {
    expect((await call("/api/gateway/orders")).status).toBe(200)
    const gatewayRequest = traces().find(t => t.url === "/api/gateway/orders")!
    const ordersRequest = traces().find(t => t.url === "/api/orders")!
    expect(ordersRequest.traceId).toBe(gatewayRequest.traceId)
    const outbound = gatewayRequest.queries.find(q => q.sql === "GET http://orders.test/api/orders")!
    expect(outbound.details!.status).toBe(200)
    expect(ordersRequest.parentSpanId).toBe(outbound.details!.spanId)
    // the test's own call into the gateway came from outside any traced request, so it starts the trace
    expect(gatewayRequest.parentSpanId).toBeUndefined()
  })

  it("shows a repeated call across services in the gateway, and the other service's own findings in its request", async () => {
    await call("/api/gateway/fanout")
    const gatewayRequest = traces().find(t => t.url === "/api/gateway/fanout")!
    expect(inspector.buildReport(gatewayRequest).insights.map(i => i.type)).toContain("duplicate")
    expect(traces().filter(t => t.url === "/api/orders")).toHaveLength(4)
    expect(new Set(traces().map(t => t.traceId)).size).toBe(1)

    await call("/api/gateway/orders/n-plus-one")
    const inner = traces().find(t => t.url === "/api/orders/n-plus-one")!
    expect(inspector.buildReport(inner).insights.map(i => i.type)).toContain("n-plus-one")
  })

  it("exports the whole operation as one trace, with the orders request under the gateway's call", async () => {
    await call("/api/gateway/orders")
    const spans = inspector.exportOtlp(traces().map(t => inspector.buildReport(t))).resourceSpans[0]!.scopeSpans[0]!.spans
    expect(new Set(spans.map(s => s.traceId)).size).toBe(1)
    const outbound = spans.find(s => s.kind === 3 && s.name.startsWith("GET http://orders.test"))!
    const server = spans.find(s => s.kind === 2 && s.name === "GET /api/orders")!
    expect(server.parentSpanId).toBe(outbound.spanId)
  })
})
