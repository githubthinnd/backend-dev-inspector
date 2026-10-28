import type { Duplex } from "node:stream"
import { createRequire } from "node:module"

const { serialize, deserialize, Long } = createRequire(import.meta.url)("bson") as typeof import("bson")

/**
 * A MongoDB server for the commands the tests use, speaking the real wire protocol: the legacy
 * OP_QUERY handshake the driver opens with, then OP_MSG. `find` returns two documents,
 * `insert` / `update` / `delete` report the counts, a filter with `boom` fails, and `sleepMs` in
 * a filter delays the reply.
 */

export interface MockMongo {
  serve: (socket: Duplex) => void
  /** Every command received that is not part of the handshake, in order. */
  commands: Record<string, unknown>[]
}

const OP_REPLY = 1
const OP_QUERY = 2004
const OP_MSG = 2013

const HELLO = {
  helloOk: true,
  isWritablePrimary: true,
  ismaster: true,
  maxBsonObjectSize: 16777216,
  maxMessageSizeBytes: 48000000,
  maxWriteBatchSize: 100000,
  logicalSessionTimeoutMinutes: 30,
  minWireVersion: 0,
  maxWireVersion: 21,
  readOnly: false,
  ok: 1
}

function header(length: number, requestId: number, responseTo: number, opCode: number): Buffer {
  const buffer = Buffer.alloc(16)
  buffer.writeInt32LE(length, 0)
  buffer.writeInt32LE(requestId, 4)
  buffer.writeInt32LE(responseTo, 8)
  buffer.writeInt32LE(opCode, 12)
  return buffer
}

function reply(doc: Record<string, unknown>, responseTo: number, opCode: number): Buffer {
  const body = Buffer.from(serialize(doc))
  if (opCode === OP_QUERY) {
    const fixed = Buffer.alloc(20)
    fixed.writeInt32LE(8, 0) // AwaitCapable
    fixed.writeInt32LE(1, 16) // numberReturned
    return Buffer.concat([header(16 + 20 + body.length, 1, responseTo, OP_REPLY), fixed, body])
  }
  const fixed = Buffer.alloc(5) // flagBits + section kind 0
  return Buffer.concat([header(16 + 5 + body.length, 1, responseTo, OP_MSG), fixed, body])
}

const ok = (extra: Record<string, unknown> = {}) => ({ ok: 1, ...extra })
const cursor = (documents: unknown[], namespace: string) => ok({ cursor: { firstBatch: documents, id: Long.fromNumber(0), ns: namespace } })

function parseMessage(message: Buffer): { opCode: number, requestId: number, command: Record<string, unknown> } {
  const requestId = message.readInt32LE(4)
  const opCode = message.readInt32LE(12)
  if (opCode === OP_QUERY) {
    let offset = 16 + 4 // flags
    offset = message.indexOf(0, offset) + 1 // namespace
    offset += 8 // skip, return
    return { opCode, requestId, command: deserialize(message.subarray(offset)) as Record<string, unknown> }
  }
  // OP_MSG: flagBits, then sections.
  let offset = 16 + 4
  const command: Record<string, unknown> = {}
  while (offset < message.length) {
    const kind = message[offset]!
    offset += 1
    const size = message.readInt32LE(offset)
    if (kind === 0) {
      Object.assign(command, deserialize(message.subarray(offset, offset + size)))
    } else {
      const end = offset + size
      let cursorOffset = offset + 4
      const identifierEnd = message.indexOf(0, cursorOffset)
      const identifier = message.subarray(cursorOffset, identifierEnd).toString()
      cursorOffset = identifierEnd + 1
      const documents: unknown[] = []
      while (cursorOffset < end) {
        const length = message.readInt32LE(cursorOffset)
        documents.push(deserialize(message.subarray(cursorOffset, cursorOffset + length)))
        cursorOffset += length
      }
      command[identifier] = documents
    }
    offset += size
  }
  return { opCode, requestId, command }
}

export function startMockMongo(): MockMongo {
  const commands: Record<string, unknown>[] = []
  let connectionCounter = 0

  function answer(command: Record<string, unknown>): Record<string, unknown> {
    const name = Object.keys(command)[0]!
    const namespace = `${String(command.$db ?? "db")}.${String(command[name])}`
    const filter = JSON.stringify(command.filter ?? command.q ?? "")
    if (/boom/.test(filter)) {
      return { ok: 0, errmsg: "boom", code: 2, codeName: "BadValue" }
    }
    switch (name) {
      case "hello":
      case "isMaster":
      case "ismaster":
        return { ...HELLO, connectionId: connectionCounter, localTime: new Date() }
      case "find":
        return cursor([{ _id: 1, name: "alice" }, { _id: 2, name: "bob" }], namespace)
      case "aggregate":
        return cursor([{ _id: 1, n: 3 }], namespace)
      case "getMore":
        return ok({ cursor: { nextBatch: [], id: Long.fromNumber(0), ns: namespace } })
      case "insert":
        return ok({ n: (command.documents as unknown[]).length })
      case "update":
        return ok({ n: 1, nModified: 1 })
      case "delete":
        return ok({ n: 1 })
      case "count":
        return ok({ n: 5 })
      default:
        return ok()
    }
  }

  function serve(socket: Duplex) {
    const connectionId = ++connectionCounter
    let buffer = Buffer.alloc(0)
    let chain: Promise<void> = Promise.resolve()
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 4 && buffer.length >= buffer.readInt32LE(0)) {
        const length = buffer.readInt32LE(0)
        const message = Buffer.from(buffer.subarray(0, length))
        buffer = buffer.subarray(length)
        const { opCode, requestId, command } = parseMessage(message)
        const name = Object.keys(command)[0]!
        const handshake = name === "hello" || name === "isMaster" || name === "ismaster"
        if (!handshake) {
          commands.push(command)
        }
        // Replies go out in order, even when one is delayed.
        chain = chain.then(async () => {
          const delay = Number(/"sleepMs":(\d+)/.exec(JSON.stringify(command.filter ?? command.q ?? ""))?.[1] ?? 0)
          if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay))
          }
          if (!socket.destroyed) {
            socket.write(reply({ ...answer(command), ...(handshake ? { connectionId } : {}) }, requestId, opCode))
          }
        })
      }
    })
    socket.on("error", () => {})
  }

  return { serve, commands }
}
