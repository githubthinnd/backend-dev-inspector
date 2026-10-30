import type { StatementKind } from "sql-dev-inspector"

const READ = /^(get|list|describe|head|query|scan|batchget|select|search|receive|read|fetch|count|check|lookup|find|exists|view|poll|peek|wait)/i
const DELETE = /^(delete|remove|purge|terminate|cancel|drain|clean|obliterate)/i
const UPDATE = /^(update|modify|change|set|put|replace|upsert|rename|tag|untag|attach|detach|restore)/i
const INSERT = /^(create|add|send|publish|post|write|insert|invoke|start|enqueue|register|copy|upload|batchwrite|index|bulk)/i

/** The SQL statement a service call resembles by its name (`GetObject` is a `select`), so N+1 and repeat detection apply. */
export function kindOfVerb(name: string): StatementKind {
  if (READ.test(name)) {
    return "select"
  }
  if (DELETE.test(name)) {
    return "delete"
  }
  if (UPDATE.test(name)) {
    return "update"
  }
  return INSERT.test(name) ? "insert" : "other"
}

/** `'value'` with quotes, which the analyser masks: a loop over different values is then an N+1. */
export const quoted = (value: string) => `'${value.replaceAll("'", "")}'`
