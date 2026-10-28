import type { Duplex } from "node:stream"
import net from "node:net"
import { duplexPair } from "node:stream"
import { vi } from "vitest"

/**
 * Lets a test run a real client library against an in-memory server without opening a port:
 * `net.createConnection` / `net.connect` hand out a socket-shaped stream wired to `serve`.
 * Libraries that call them (node-redis, mongodb, undici) then talk to the mock.
 */
export function fakeNetwork(serve: (socket: Duplex) => void, options: { refuse?: Error } = {}): () => void {
  const connect = (): Duplex => {
    const [client, server] = duplexPair()
    serve(server)
    const socket = client as unknown as Record<string, unknown>
    for (const method of ["setNoDelay", "setKeepAlive", "setTimeout", "ref", "unref"]) {
      socket[method] = () => client
    }
    Object.assign(socket, { remoteAddress: "127.0.0.1", remotePort: 27017, connecting: false, address: () => ({ address: "127.0.0.1", port: 0, family: "IPv4" }) })
    setImmediate(() => {
      if (options.refuse) {
        client.destroy(options.refuse) // a refused connection: the socket errors instead of connecting
        return
      }
      client.emit("connect")
      client.emit("ready")
    })
    return client
  }
  const created = vi.spyOn(net, "createConnection").mockImplementation(connect as never)
  const connected = vi.spyOn(net, "connect").mockImplementation(connect as never)
  return () => {
    created.mockRestore()
    connected.mockRestore()
  }
}
