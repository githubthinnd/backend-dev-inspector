import type { QueryEvent } from "./types.js"

/**
 * Redaction replaces the values of a call by their type, so two calls that differ only in a value
 * would look identical and an N+1 would be reported as a plain duplicate. The recorder remembers,
 * outside the event (so it is never shown or sent anywhere), a hash of the call as it really was;
 * the report compares those.
 */
const KEYS = Symbol.for("sqlDevInspector.callKeys")

function keys(): WeakMap<QueryEvent, string> {
  const holder = globalThis as unknown as Record<symbol, WeakMap<QueryEvent, string> | undefined>
  return (holder[KEYS] ??= new WeakMap())
}

/** Two 32-bit FNV-1a passes with different seeds, as hex. Not a security measure: the hash never leaves the process. */
function hash(text: string): string {
  let a = 0x811C9DC5
  let b = 0x9747B28C
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    a = Math.imul(a ^ code, 0x01000193)
    b = Math.imul(b ^ code, 0x85EBCA6B)
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0")
}

export function rememberCallKey(event: QueryEvent, text: string, params: unknown[] | null | undefined): void {
  try {
    keys().set(event, hash(`${text}\u0000${params && params.length > 0 ? JSON.stringify(params, (_key, value) => typeof value === "bigint" ? String(value) : value) : ""}`))
  } catch {
    // an unserialisable value: the visible statement and parameters are compared instead
  }
}

export function rememberedCallKey(event: QueryEvent): string | undefined {
  return keys().get(event)
}
