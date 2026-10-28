import type { Duplex } from "node:stream"
import { duplexPair } from "node:stream"

/**
 * A Redis server speaking RESP2 for the commands the tests use. `statements` lists every
 * command received. `SLEEP n` delays its reply; `BOOM` fails; MULTI queues until EXEC.
 */

export interface MockRedis {
  /** A socket-shaped stream connected to a fresh server connection. */
  stream: () => Duplex
  /** Serves one connection on the given stream; for `fakeNetwork`. */
  serve: (socket: Duplex) => void
  commands: string[][]
}

const bulk = (value: string) => Buffer.from(`$${Buffer.byteLength(value)}\r\n${value}\r\n`)
const simple = (value: string) => Buffer.from(`+${value}\r\n`)
const failure = (message: string) => Buffer.from(`-ERR ${message}\r\n`)
const integer = (value: number) => Buffer.from(`:${value}\r\n`)
const NIL = Buffer.from("$-1\r\n")

function reply(args: string[]): Buffer {
  const [name, ...rest] = args
  switch (name?.toUpperCase()) {
    case "PING":
      return simple("PONG")
    case "GET":
      return rest[0] === "missing" ? NIL : bulk(`value:${rest[0]}`)
    case "MGET":
      return Buffer.concat([Buffer.from(`*${rest.length}\r\n`), ...rest.map(key => bulk(`value:${key}`))])
    case "HGETALL":
      return Buffer.concat([Buffer.from("*2\r\n"), bulk("field"), bulk("value")])
    case "SET":
    case "SELECT":
    case "CLIENT":
    case "MULTI":
    case "SLEEP":
      return simple("OK")
    case "DEL":
    case "INCR":
    case "LPUSH":
      return integer(1)
    case "HELLO": {
      // The answer to HELLO 2: a flat array of field names and values.
      const fields: [string, string | number][] = [["server", "redis"], ["version", "7.2.0"], ["proto", 2], ["id", 1], ["mode", "standalone"], ["role", "master"]]
      const items = fields.flatMap(([key, value]) => [bulk(key), typeof value === "number" ? integer(value) : bulk(value)])
      return Buffer.concat([Buffer.from(`*${items.length + 2}\r\n`), ...items, bulk("modules"), Buffer.from("*0\r\n")])
    }
    case "INFO":
      return bulk("# Server\r\nredis_version:7.2.0\r\nloading:0\r\nrole:master\r\n")
    case "BOOM":
      return failure("boom")
    default:
      return failure(`unknown command '${name}'`)
  }
}

export function startMockRedis(): MockRedis {
  const commands: string[][] = []

  function serve(socket: Duplex) {
    let buffer = Buffer.alloc(0)
    let queued: string[][] | null = null
    const jobs: (() => Promise<void>)[] = []
    let running = false

    const enqueue = (job: () => Promise<void>) => {
      jobs.push(job)
      if (running) {
        return
      }
      running = true
      void (async () => {
        while (jobs.length > 0) {
          await jobs.shift()!()
        }
        running = false
      })()
    }

    const answer = async (args: string[]) => {
      const name = args[0]!.toUpperCase()
      if (name === "SLEEP") {
        await new Promise(resolve => setTimeout(resolve, Number(args[1] ?? 0)))
      }
      let out: Buffer
      if (name === "MULTI") {
        queued = []
        out = simple("OK")
      } else if (name === "EXEC") {
        const results = (queued ?? []).map(reply)
        queued = null
        out = Buffer.concat([Buffer.from(`*${results.length}\r\n`), ...results])
      } else if (queued && name !== "DISCARD") {
        queued.push(args)
        out = simple("QUEUED")
      } else {
        out = reply(args)
      }
      if (!socket.destroyed) {
        socket.write(out)
      }
    }

    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      for (;;) {
        // One request is an array of bulk strings: *N\r\n($len\r\ndata\r\n)*N
        const text = buffer.toString("latin1")
        if (!text.startsWith("*")) {
          return
        }
        const header = text.indexOf("\r\n")
        if (header === -1) {
          return
        }
        const count = Number(text.slice(1, header))
        let offset = header + 2
        const args: string[] = []
        let complete = true
        for (let i = 0; i < count; i++) {
          const lengthEnd = text.indexOf("\r\n", offset)
          if (lengthEnd === -1) {
            complete = false
            break
          }
          const length = Number(text.slice(offset + 1, lengthEnd))
          const start = lengthEnd + 2
          if (text.length < start + length + 2) {
            complete = false
            break
          }
          args.push(buffer.subarray(start, start + length).toString("utf8"))
          offset = start + length + 2
        }
        if (!complete) {
          return
        }
        buffer = buffer.subarray(offset)
        commands.push(args)
        enqueue(() => answer(args))
      }
    })
    socket.on("error", () => {})
  }

  return {
    stream: () => {
      const [client, server] = duplexPair()
      serve(server)
      for (const method of ["setNoDelay", "setKeepAlive", "setTimeout", "ref", "unref"]) {
        ;(client as unknown as Record<string, unknown>)[method] = () => client
      }
      ;(client as unknown as Record<string, unknown>).remoteAddress = "mock"
      ;(client as unknown as Record<string, unknown>).remotePort = 6379
      return client
    },
    serve,
    commands
  }
}
