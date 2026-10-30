/**
 * What the inspector keeps of the values in a call.
 *
 *  - `params` (the default): bind parameters are replaced by their type and size, and a statement
 *    that a driver builds from a template (`where id = ?`) is shown as the template. Values that
 *    you typed into the SQL yourself are still visible.
 *  - `all`: the statement itself is shown with every value masked (`where id = ?`), the way the
 *    N+1 detector sees it.
 *  - `off`: everything is shown as it was sent.
 */
export type RedactMode = "params" | "all" | "off"

export const DEFAULT_REDACT: RedactMode = "params"

const OFF = new Set(["off", "0", "false", "no", "none"])
const ALL = new Set(["all", "strict", "sql"])

/** `SQL_INSPECTOR_REDACT`: anything unknown keeps the safe default. */
export function parseRedactMode(raw: string | undefined): RedactMode {
  const value = (raw ?? "").trim().toLowerCase()
  if (OFF.has(value)) {
    return "off"
  }
  return ALL.has(value) ? "all" : DEFAULT_REDACT
}

/** A value as its type and, where it has one, its size: `<string:12>`, `<number>`, `<buffer:8>`. */
export function redactValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "<null>"
  }
  if (typeof value === "string") {
    return `<string:${value.length}>`
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return `<${typeof value}>`
  }
  if (value instanceof Date) {
    return "<date>"
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return `<buffer:${value.length}>`
  }
  if (Array.isArray(value)) {
    return `<array:${value.length}>`
  }
  return "<object>"
}

export function redactParams(params: unknown[] | null | undefined): string[] | null {
  return params ? params.map(redactValue) : null
}
