import type { DriverAdapter, OperationHandle, Recorder } from "sql-dev-inspector"
import { describeOperation } from "sql-dev-inspector"
import { objectId } from "../patch.js"
import { kindOfVerb, quoted } from "./verbs.js"

/**
 * AWS SDK for JavaScript v3 (S3, DynamoDB, SQS, SNS, Lambda, …), through the client's own middleware stack:
 *
 *   import { instrumentAws } from "backend-dev-inspector"
 *   const s3 = instrumentAws(new S3Client({}))
 *
 * One call is listed per command, however many times the SDK retried it; the status, the request id and the number
 * of attempts are on the call. Only the names of the resources are recorded (bucket, table, queue, function…): never
 * a body, an item or a key of a DynamoDB table. Nothing is loaded from the SDK, so it adds no dependency.
 */

let active: Recorder | null = null

export const awsDriver: DriverAdapter = {
  name: "aws",
  install(recorder) {
    active = recorder
    return () => {
      if (active === recorder) {
        active = null
      }
    }
  }
}

const MAX_TEXT = 300
/** The inputs that name a resource and say nothing about its content. */
const RESOURCES = ["Bucket", "Key", "TableName", "IndexName", "QueueUrl", "QueueName", "TopicArn", "FunctionName", "StreamName", "SecretId", "ParameterName", "Name", "ClusterName", "RoleName", "DomainName", "LogGroupName", "StateMachineArn"]

interface ClientLike {
  middlewareStack?: { add: (middleware: unknown, options: Record<string, unknown>) => void }
}

interface MiddlewareContext {
  clientName?: string
  commandName?: string
}

interface Metadata {
  httpStatusCode?: number
  requestId?: string
  attempts?: number
  totalRetryDelay?: number
}

const name = (value: string | undefined, suffix: string) => {
  const text = value ?? "AWS"
  return text.endsWith(suffix) ? text.slice(0, -suffix.length) : text
}

function describe(recorder: Recorder, clientId: number, context: MiddlewareContext, input: unknown): OperationHandle | null {
  const service = name(context.clientName, "Client")
  const operation = name(context.commandName, "Command")
  const named = RESOURCES
    .map(key => [key, (input as Record<string, unknown> | undefined)?.[key]] as const)
    .filter((entry): entry is readonly [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
    .map(([key, value]) => `${key}=${quoted(value.length > 120 ? `${value.slice(0, 120)}…` : value)}`)
  const text = `${service} ${operation}${named.length > 0 ? ` ${named.join(" ")}` : ""}`.slice(0, MAX_TEXT)
  const target = RESOURCES.map(key => (input as Record<string, unknown> | undefined)?.[key]).find((value): value is string => typeof value === "string")
  return recorder.begin({
    driver: "aws",
    api: operation,
    text,
    connectionId: clientId,
    analysis: describeOperation({ kind: kindOfVerb(operation), label: `${service} ${operation}`.toUpperCase(), targets: target ? [target.slice(0, 120)] : [service], text })
  })
}

/**
 * Reports every command sent through `client`. Returns `client`; it does nothing when the inspector is off, and
 * calling it twice on one client does no harm.
 */
export function instrumentAws<T extends object>(client: T, recorder?: Recorder): T {
  const rec = recorder ?? active
  const stack = (client as ClientLike).middlewareStack
  if (!rec || !stack) {
    return client
  }
  const id = objectId(client)
  try {
    stack.add(
      (next: (args: { input?: unknown }) => Promise<{ output?: { $metadata?: Metadata } }>, context: MiddlewareContext) => async (args: { input?: unknown }) => {
        const handle = describe(rec, id, context, args.input)
        try {
          const result = await next(args)
          const meta = result.output?.$metadata
          handle?.end({ details: detailsOf(meta) })
          return result
        } catch (error) {
          const meta = (error as { $metadata?: Metadata } | null)?.$metadata
          handle?.end({ error: error instanceof Error ? `${error.name}: ${error.message}` : error, details: detailsOf(meta) })
          throw error
        }
      },
      // `initialize` runs before the retry middleware: one call per command, with the attempts it took.
      { step: "initialize", name: "backendDevInspector", priority: "high", override: true }
    )
  } catch {
    // a client whose stack refuses the middleware is left alone
  }
  return client
}

function detailsOf(meta: Metadata | undefined): Record<string, string | number> {
  const details: Record<string, string | number> = {}
  if (typeof meta?.httpStatusCode === "number") {
    details.status = meta.httpStatusCode
  }
  if (typeof meta?.requestId === "string") {
    details.requestId = meta.requestId.slice(0, 80)
  }
  if (typeof meta?.attempts === "number" && meta.attempts > 1) {
    details.attempts = meta.attempts
  }
  if (typeof meta?.totalRetryDelay === "number" && meta.totalRetryDelay > 0) {
    details.retryDelayMs = meta.totalRetryDelay
  }
  return details
}
