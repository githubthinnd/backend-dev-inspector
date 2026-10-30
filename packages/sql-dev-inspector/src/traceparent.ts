import { randomBytes } from "node:crypto"

/**
 * W3C Trace Context (`traceparent: 00-<trace id>-<parent span id>-<flags>`). A request that arrives with one joins that
 * trace; with propagation on (`SQL_INSPECTOR_PROPAGATE=1`) the calls it makes to other services carry one, so the
 * request each of them handles knows which call of which request it came from.
 */

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/
const ZEROS = /^0+$/

export interface ParentContext {
  traceId: string
  parentSpanId: string
  sampled: boolean
}

export function parseTraceparent(header: string | readonly string[] | undefined): ParentContext | null {
  const value = Array.isArray(header) ? header[0] : header
  const match = TRACEPARENT.exec(String(value ?? "").trim().toLowerCase())
  if (!match || ZEROS.test(match[1]!) || ZEROS.test(match[2]!)) {
    return null
  }
  return { traceId: match[1]!, parentSpanId: match[2]!, sampled: (Number.parseInt(match[3]!, 16) & 1) === 1 }
}

export const newTraceId = () => randomBytes(16).toString("hex")
export const newSpanId = () => randomBytes(8).toString("hex")
export const formatTraceparent = (traceId: string, spanId: string, sampled = true) => `00-${traceId}-${spanId}-${sampled ? "01" : "00"}`
