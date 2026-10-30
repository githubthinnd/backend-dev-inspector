import type { SqlAnalysis, StatementKind } from "./types.js"

/**
 * Helpers for drivers whose calls are not SQL (a Mongo command, a Redis command, an HTTP
 * request). Each call is described as the SQL statement it most resembles, so the request tree,
 * N+1 / repeat / slow detection and the UI treat it like any other statement.
 */

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const OBJECT_ID = /\b[0-9a-f]{24}\b/gi
const NUMBER = /\b\d+(?:\.\d+)?\b/g
const JSON_STRING_VALUE = /(:\s*)"(?:[^"\\]|\\.)*"/g
const SINGLE_QUOTED = /'(?:[^'\\]|\\.)*'/g
const WHITESPACE_RUN = /\s+/g

/** The call with its values masked, so two calls that differ only in ids or literals share one fingerprint. */
export function genericFingerprint(text: string): string {
  return text
    .replace(SINGLE_QUOTED, "?")
    .replace(JSON_STRING_VALUE, "$1\"?\"")
    .replace(UUID, "?")
    .replace(OBJECT_ID, "?")
    .replace(NUMBER, "?")
    .replace(WHITESPACE_RUN, " ")
    .trim()
}

export interface OperationDescription {
  /** The SQL statement this call is closest to: a read is `select`, a write `insert` / `update` / `delete`. */
  kind: StatementKind
  /** Shown instead of the kind (`FIND`, `GET`, `HTTP GET`). */
  label: string
  /** Collections, keys or hosts the call touches. */
  targets?: string[]
  /** The call as one line; masked into the fingerprint. */
  text: string
}

export function describeOperation({ kind, label, targets = [], text }: OperationDescription): SqlAnalysis {
  return {
    kind,
    label,
    tables: targets,
    subqueryDepth: 0,
    subqueryCount: 0,
    fingerprint: genericFingerprint(text),
    selectStar: false,
    savepoint: null
  }
}
