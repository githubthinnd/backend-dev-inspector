import type { DriverAdapter, OperationHandle, Recorder } from "sql-dev-inspector"
import { describeOperation, runInOperation } from "sql-dev-inspector"
import { objectId } from "../patch.js"
import { wrapperDriver } from "./wrapper.js"
import { quoted } from "./verbs.js"

/**
 * BullMQ job queues: what the application adds to a queue while it handles a request.
 *
 *   import { instrumentBullmq } from "backend-dev-inspector"
 *   const emails = instrumentBullmq(new Queue("emails", { connection }))
 *   await emails.add("welcome", { userId })        // listed as  BULLMQ emails add 'welcome'
 *
 * `add`, `addBulk` and `upsertJobScheduler` are reported. The Redis commands BullMQ sends to do it are kept under the
 * call (as `statements`) instead of being listed one by one. The data of a job is never recorded; it is kept as a
 * parameter, so it is hidden unless values are shown. Nothing is loaded from BullMQ.
 */

const wrapper = wrapperDriver("bullmq")

export const bullmqDriver: DriverAdapter = wrapper.driver

const METHODS = new Set(["add", "addBulk", "upsertJobScheduler"])
const MAX_TEXT = 300

type Method = (...args: unknown[]) => Promise<unknown>

function jobNames(method: string, args: unknown[]): string[] {
  if (method === "addBulk" && Array.isArray(args[0])) {
    return [...new Set((args[0] as Array<{ name?: unknown }>).map(job => String(job?.name ?? "")).filter(Boolean))].slice(0, 5)
  }
  return typeof args[0] === "string" ? [args[0]] : []
}

export function instrumentBullmq<T extends object>(queue: T, recorder?: Recorder): T {
  const rec = wrapper.recorder(recorder)
  if (!rec) {
    return queue
  }
  const id = objectId(queue)
  return new Proxy(queue, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown
      if (typeof property !== "string" || typeof value !== "function") {
        return value
      }
      if (!METHODS.has(property)) {
        return (value as Method).bind(target)
      }
      return (...args: unknown[]) => {
        const queueName = String((target as { name?: unknown }).name ?? "queue")
        const names = jobNames(property, args)
        const text = `BULLMQ ${queueName} ${property}${names.length > 0 ? ` ${names.map(quoted).join(", ")}` : ""}`.slice(0, MAX_TEXT)
        const handle: OperationHandle | null = rec.begin({
          driver: "bullmq",
          api: property,
          text,
          params: property === "addBulk" ? [`${Array.isArray(args[0]) ? args[0].length : 0} jobs`] : args.slice(1, 2),
          connectionId: id,
          analysis: describeOperation({ kind: "insert", label: `BULLMQ ${property.replace(/([A-Z])/g, " $1")}`.toUpperCase(), targets: [queueName], text })
        })
        if (!handle) {
          return (value as Method).apply(target, args)
        }
        const finish = (result: unknown) => {
          handle.end({ rowCount: Array.isArray(result) ? result.length : 1 })
          return result
        }
        let pending: Promise<unknown>
        try {
          // Promise.resolve: a queue (or a test double) whose method returns a plain value is still one call
          pending = Promise.resolve(runInOperation(handle.event, () => (value as Method).apply(target, args)))
        } catch (error) {
          handle.end({ error })
          throw error
        }
        return pending.then(finish, (error: unknown) => {
          handle.end({ error })
          throw error
        })
      }
    }
  })
}
