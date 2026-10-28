import type { Duplex } from "node:stream"
import { duplexPair } from "node:stream"

/**
 * An HTTP/1.1 server for the paths the tests use, over an in-memory stream:
 *   /ok → 200 JSON, /missing → 404, /boom → 500, /slow?ms=N → 200 after N ms,
 *   /echo → 200 with the request's method, path and body. Connections are kept alive.
 */

export interface MockHttp {
  serve: (socket: Duplex) => void
  /** `http.request({ createConnection })` helper: a stream connected to a fresh server connection. */
  stream: () => Duplex
  requests: { method: string, url: string, body: string }[]
}

const STATUS_TEXT: Record<number, string> = { 200: "OK", 404: "Not Found", 500: "Internal Server Error" }

export function startMockHttp(): MockHttp {
  const requests: MockHttp["requests"] = []

  function serve(socket: Duplex) {
    let buffer = Buffer.alloc(0)
    let chain: Promise<void> = Promise.resolve()

    const respond = (status: number, body: string) => {
      socket.write(`HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? "OK"}\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: keep-alive\r\n\r\n${body}`)
    }

    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      for (;;) {
        const end = buffer.indexOf("\r\n\r\n")
        if (end === -1) {
          return
        }
        const head = buffer.subarray(0, end).toString("latin1")
        const length = Number(/content-length:\s*(\d+)/i.exec(head)?.[1] ?? 0)
        if (buffer.length < end + 4 + length) {
          return
        }
        const body = buffer.subarray(end + 4, end + 4 + length).toString()
        buffer = buffer.subarray(end + 4 + length)
        const [method, url] = head.split("\r\n")[0]!.split(" ") as [string, string]
        requests.push({ method, url, body })
        chain = chain.then(async () => {
          const path = url.split("?")[0]
          const delay = Number(/[?&]ms=(\d+)/.exec(url)?.[1] ?? 0)
          if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay))
          }
          if (socket.destroyed) {
            return
          }
          if (path === "/missing") {
            respond(404, "{\"error\":\"not found\"}")
          } else if (path === "/boom") {
            respond(500, "{\"error\":\"boom\"}")
          } else if (path === "/echo") {
            respond(200, JSON.stringify({ method, url, body }))
          } else {
            respond(200, "{\"ok\":true}")
          }
        })
      }
    })
    socket.on("error", () => {})
  }

  return {
    serve,
    stream: () => {
      const [client, server] = duplexPair()
      serve(server)
      for (const method of ["setNoDelay", "setKeepAlive", "setTimeout", "ref", "unref"]) {
        ;(client as unknown as Record<string, unknown>)[method] = () => client
      }
      return client
    },
    requests
  }
}
