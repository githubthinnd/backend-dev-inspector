import type { Duplex } from "node:stream"
import { duplexPair } from "node:stream"
import { createServer } from "mysql2"

/**
 * A MySQL server that speaks the real wire protocol (mysql2's own server half), so the
 * tests drive the real mysql2 client and the real Drizzle against it. `mysqld` itself
 * cannot start in every sandbox, nor can a test bind a port, so client and server are
 * joined by in-memory streams; the protocol is the part the tracer depends on.
 *
 * Every statement is answered by `respond`, which defaults to: SELECT → two rows of
 * (id, name), `select boom` → an error, anything else → OK. `sleep(N)` in the text delays
 * the answer by N ms, which is how tests make statements overlap.
 */

export interface MockServer {
  /** Pass as mysql2's `stream` option: each call opens one in-memory connection to the server. */
  stream: () => Duplex
  statements: string[]
  close: () => Promise<void>
}

const SLEEP = /sleep\((\d+)\)/i
const BOOM = /\bboom\b/i
const SELECT = /^\s*(?:\(\s*)?select/i

function COLUMN(name: string) {
  return {
    catalog: "def",
    schema: "",
    table: "users",
    orgTable: "users",
    name,
    orgName: name,
    characterSet: 33,
    columnLength: 255,
    columnType: 253,
    flags: 0,
    decimals: 0
  }
}

export function startMockMysql(): MockServer {
  const statements: string[] = []
  let connectionId = 100

  const server = createServer(() => {})
  server.on("connection", (conn) => {
    conn.serverHandshake({
      protocolVersion: 10,
      serverVersion: "8.0.0-mock",
      connectionId: ++connectionId,
      statusFlags: 2,
      characterSet: 8,
      capabilityFlags: 0xFFFFFF
    })
    conn.on("error", () => {})
    conn.on("query", (sql: string) => {
      statements.push(sql)
      const delay = Number(SLEEP.exec(sql)?.[1] ?? 0)
      setTimeout(() => {
        // A reply to a client command always starts at sequence 1.
        conn.sequenceId = 1
        if (BOOM.test(sql)) {
          conn.writeError({ code: 1064, message: "boom: syntax error" })
        } else if (SELECT.test(sql)) {
          conn.writeColumns([COLUMN("id"), COLUMN("name")])
          conn.writeTextRow(["1", "alice"])
          conn.writeTextRow(["2", "bob"])
          conn.writeEof()
        } else {
          conn.writeOk({ affectedRows: 1, insertId: 7 })
        }
        // The next command starts a new sequence at 0; without this mysql2 warns "packets out of order".
        conn.sequenceId = 0
      }, delay)
    })
  })

  // `createServer` has no in-memory entry point; this is the handler its own `listen` uses per socket.
  const accept = (server as unknown as { _handleConnection: (socket: Duplex) => void })._handleConnection.bind(server)

  return {
    stream: () => {
      const [client, serverSide] = duplexPair()
      accept(serverSide)
      return client
    },
    statements,
    close: () => Promise.resolve()
  }
}
