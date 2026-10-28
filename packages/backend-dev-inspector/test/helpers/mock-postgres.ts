import type { Duplex } from "node:stream"
import { duplexPair } from "node:stream"

/**
 * A PostgreSQL server that speaks the real wire protocol (startup, simple and extended query
 * protocol), so the tests drive the real node-postgres against it. Client and server are joined
 * by in-memory streams, because a test cannot bind a port in every sandbox.
 *
 * Every statement is answered by a fixed rule: SELECT / WITH → two rows (id, name), a statement
 * containing `boom` → an error, anything else → the command tag of its first word. `sleep(N)`
 * in the text delays the answer by N ms, which is how tests make statements overlap.
 */

export interface MockPostgres {
  /** Pass as node-postgres' `stream` option: each call opens one in-memory connection. */
  stream: () => Duplex
  /** Every statement received, in order, from simple and extended queries alike. */
  statements: string[]
  /** The process id each connection reported, in order of connection. */
  processIds: number[]
}

const SLEEP = /sleep\((\d+)\)/i

function message(type: string, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts)
  const head = Buffer.alloc(5)
  head.write(type, 0, "latin1")
  head.writeInt32BE(body.length + 4, 1)
  return Buffer.concat([head, body])
}

const int32 = (value: number) => {
  const buffer = Buffer.alloc(4)
  buffer.writeInt32BE(value)
  return buffer
}
const int16 = (value: number) => {
  const buffer = Buffer.alloc(2)
  buffer.writeInt16BE(value)
  return buffer
}
const cstring = (text: string) => Buffer.from(`${text}\0`, "utf8")

function rowDescription(): Buffer {
  const field = (name: string, oid: number) => Buffer.concat([cstring(name), int32(0), int16(0), int32(oid), int16(-1), int32(-1), int16(0)])
  return message("T", int16(2), field("id", 23), field("name", 25))
}

function dataRow(id: string, name: string): Buffer {
  const column = (text: string) => Buffer.concat([int32(Buffer.byteLength(text)), Buffer.from(text)])
  return message("D", int16(2), column(id), column(name))
}

function error(text: string): Buffer {
  return message("E", Buffer.from("SERROR\0C42601\0M"), cstring(text), Buffer.from("\0"))
}

interface Answer {
  isRows: boolean
  failure: string | null
  tag: string
}

function answerFor(sql: string): Answer {
  const word = /^\s*\(?\s*(\w+)/.exec(sql)?.[1]?.toUpperCase() ?? ""
  if (/\bboom\b/i.test(sql)) {
    return { isRows: false, failure: `syntax error at or near "boom"`, tag: "" }
  }
  if (word === "SELECT" || word === "WITH") {
    return { isRows: true, failure: null, tag: "SELECT 2" }
  }
  const tags: Record<string, string> = { INSERT: "INSERT 0 1", UPDATE: "UPDATE 1", DELETE: "DELETE 1" }
  return { isRows: false, failure: null, tag: tags[word] ?? word }
}

export function startMockPostgres(): MockPostgres {
  const statements: string[] = []
  const processIds: number[] = []
  let nextPid = 4000

  function serve(socket: Duplex) {
    const pid = ++nextPid
    processIds.push(pid)
    let buffer = Buffer.alloc(0)
    let started = false
    let inTransaction = false
    let failed = false
    const portals = new Map<string, string>()
    const prepared = new Map<string, string>()
    let lastParsed = ""
    const queue: (() => Promise<void> | void)[] = []
    let running = false

    const send = (...buffers: Buffer[]) => {
      if (!socket.destroyed) {
        socket.write(Buffer.concat(buffers))
      }
    }
    const ready = () => message("Z", Buffer.from(inTransaction ? "T" : "I"))
    const delayOf = (sql: string) => Number(SLEEP.exec(sql)?.[1] ?? 0)
    const track = (sql: string) => {
      const word = /^\s*(\w+)/.exec(sql)?.[1]?.toLowerCase()
      if (word === "begin" || word === "start") {
        inTransaction = true
      } else if (word === "commit" || word === "end" || word === "rollback") {
        inTransaction = false
      }
    }

    // Replies are written one command at a time, in order, even when a statement is delayed.
    const enqueue = (job: () => Promise<void> | void) => {
      queue.push(job)
      if (running) {
        return
      }
      running = true
      void (async () => {
        while (queue.length > 0) {
          await queue.shift()!()
        }
        running = false
      })()
    }

    const execute = async (sql: string, describeRows: boolean) => {
      statements.push(sql)
      const delay = delayOf(sql)
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay))
      }
      const answer = answerFor(sql)
      track(sql)
      if (answer.failure) {
        failed = true
        send(error(answer.failure))
        return false
      }
      const out: Buffer[] = []
      if (answer.isRows) {
        if (!describeRows) {
          out.push(rowDescription())
        }
        out.push(dataRow("1", "alice"), dataRow("2", "bob"))
      }
      out.push(message("C", cstring(answer.tag)))
      send(...out)
      return true
    }

    function handle(type: string, body: Buffer) {
      switch (type) {
        case "Q":
          enqueue(async () => {
            const sql = body.toString("utf8").replace(/\0$/, "")
            await execute(sql, false)
            failed = false
            send(ready())
          })
          break
        case "P": {
          const name = body.subarray(0, body.indexOf(0)).toString()
          const sql = body.subarray(body.indexOf(0) + 1, body.indexOf(0, body.indexOf(0) + 1)).toString()
          lastParsed = sql
          prepared.set(name, sql)
          enqueue(() => {
            if (!failed) {
              send(message("1"))
            }
          })
          break
        }
        case "B": {
          const portal = body.subarray(0, body.indexOf(0)).toString()
          const rest = body.subarray(body.indexOf(0) + 1)
          const statement = rest.subarray(0, rest.indexOf(0)).toString()
          portals.set(portal, prepared.get(statement) ?? lastParsed)
          enqueue(() => {
            if (!failed) {
              send(message("2"))
            }
          })
          break
        }
        case "D": {
          const kind = String.fromCharCode(body[0]!)
          const name = body.subarray(1, body.indexOf(0, 1)).toString()
          const sql = kind === "P" ? portals.get(name) : prepared.get(name)
          enqueue(() => {
            if (failed) {
              return
            }
            const isRows = answerFor(sql ?? "").isRows
            if (kind === "S") {
              send(message("t", int16(0)))
            }
            send(isRows ? rowDescription() : message("n"))
          })
          break
        }
        case "E": {
          const portal = body.subarray(0, body.indexOf(0)).toString()
          enqueue(async () => {
            if (!failed) {
              await execute(portals.get(portal) ?? lastParsed, true)
            }
          })
          break
        }
        case "S":
          enqueue(() => {
            failed = false
            send(ready())
          })
          break
        case "C":
          enqueue(() => {
            if (!failed) {
              send(message("3"))
            }
          })
          break
        case "X":
          socket.end()
          break
        default:
          break
      }
    }

    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      for (;;) {
        if (!started) {
          if (buffer.length < 8) {
            return
          }
          const length = buffer.readInt32BE(0)
          if (buffer.length < length) {
            return
          }
          const code = buffer.readInt32BE(4)
          buffer = buffer.subarray(length)
          if (code === 80877103) {
            send(Buffer.from("N")) // no TLS
            continue
          }
          started = true
          send(
            message("R", int32(0)),
            message("S", cstring("server_version"), cstring("16.0-mock")),
            message("S", cstring("client_encoding"), cstring("UTF8")),
            message("K", int32(pid), int32(1234)),
            ready()
          )
          continue
        }
        if (buffer.length < 5) {
          return
        }
        const length = buffer.readInt32BE(1)
        if (buffer.length < length + 1) {
          return
        }
        const type = String.fromCharCode(buffer[0]!)
        const body = buffer.subarray(5, length + 1)
        buffer = buffer.subarray(length + 1)
        handle(type, Buffer.from(body))
      }
    })
    socket.on("error", () => {})
  }

  return {
    stream: () => {
      const [client, server] = duplexPair()
      serve(server)
      // node-postgres treats the stream as a net.Socket and calls these on it.
      for (const method of ["setNoDelay", "setKeepAlive", "setTimeout", "ref", "unref"]) {
        ;(client as unknown as Record<string, unknown>)[method] = () => client
      }
      ;(client as unknown as Record<string, unknown>).connect = () => {
        setImmediate(() => client.emit("connect"))
        return client
      }
      return client
    },
    statements,
    processIds
  }
}
