import type { SqlAnalysis, StatementKind } from "./types.js"

/**
 * Not a SQL parser. Drizzle only emits well-formed statements, so a tokenizer that knows
 * about string literals, identifiers and comments is enough to classify them, find their
 * tables and measure subquery nesting. Anything it cannot read degrades to `other` rather
 * than throwing — a query inspector must never break the query path.
 */

const TOKEN = /'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.|"")*"|`[^`]*`|\/\*[\s\S]*?\*\/|--[^\n]*|#[^\n]*|\w+|[\s\S]/g

/** Replace string literals and comments with placeholders; keep everything else intact. */
export function maskLiterals(sql: string): string {
  return sql.replace(TOKEN, (token) => {
    if (token.startsWith("'") || token.startsWith("\"")) {
      return "?"
    }
    if (token.startsWith("/*") || token.startsWith("--") || token.startsWith("#")) {
      return " "
    }
    return token
  })
}

const WHITESPACE_RUN = /\s+/g
const BACKTICKS = /`/g
const PAREN_TOKEN = /\(\s*(select|with)\b|\(|\)/gi
const LEADING_PARENS = /^\(+/
const FIRST_WORD = /^(\w+)/
const QUOTES_AND_SEMICOLON = /[`;]/g
const START_TRANSACTION = /^start\s+transaction\b/
const ROLLBACK_TO = /^rollback\s+to\b/
const ROLLBACK_TO_NAME = /^rollback\s+to\s+(?:savepoint\s+)?(\S+)/
const SAVEPOINT_NAME = /^savepoint\s+(\S+)/
const RELEASE_SAVEPOINT = /^release\s+savepoint\b/
const RELEASE_NAME = /^release\s+savepoint\s+(\S+)/
const SET_TRANSACTION = /^set\s+(?:session\s+|global\s+)?transaction\b/
const SELECT_STAR = /\bselect\s+(?:distinct\s+)?(?:\w+\.)?\*/i
const SUBQUERY_KEYWORD = /^(?:select|with)$/i
const WORD = /^\w+$/
const NUMBER_LITERAL = /\b\d+(?:\.\d+)?\b/g
const IN_LIST = /\bin\s*\(\s*\?(?:\s*,\s*\?)*\s*\)/gi
const VALUES_ROWS = /\bvalues\s*\(\s*\?(?:\s*,\s*\?)*\s*\)(?:\s*,\s*\(\s*\?(?:\s*,\s*\?)*\s*\))*/gi

export function fingerprintOf(sql: string): string {
  return maskLiterals(sql)
    .replace(NUMBER_LITERAL, "?")
    .replace(WHITESPACE_RUN, " ")
    .replace(IN_LIST, "in (?)")
    .replace(VALUES_ROWS, "values (?)")
    .trim()
    .toLowerCase()
}

const TABLE_REFERENCE = /(?<!\bon\s)(?<!\bkey\s)(?<!\bfor\s)\b(from|join|into|update)\s+((?:`[^`]+`|\w+)(?:\.(?:`[^`]+`|\w+))?)/gi
const NOT_A_TABLE = new Set(["select", "set", "values", "lateral", "dual"])

function tablesOf(masked: string): string[] {
  const tables = new Set<string>()
  for (const match of masked.matchAll(TABLE_REFERENCE)) {
    const name = match[2]!.replace(BACKTICKS, "")
    if (!NOT_A_TABLE.has(name.toLowerCase())) {
      tables.add(name)
    }
  }
  return [...tables]
}

function measureSubqueries(masked: string): { depth: number, count: number } {
  // Each open paren is remembered with whether it opens a subquery, so `IN (1, 2)` and
  // `COUNT(*)` do not count towards the depth and `((SELECT ...))` counts once.
  const stack: boolean[] = []
  let depth = 0
  let count = 0
  let open = 0
  for (const match of masked.matchAll(PAREN_TOKEN)) {
    const token = match[0]
    if (token === ")") {
      if (stack.pop()) {
        open--
      }
      continue
    }
    const opensSubquery = match[1] !== undefined
    stack.push(opensSubquery)
    if (opensSubquery) {
      open++
      count++
      depth = Math.max(depth, open)
    }
  }
  return { depth, count }
}

function kindOf(masked: string): { kind: StatementKind, savepoint: string | null } {
  const text = masked.trim().replace(LEADING_PARENS, "").toLowerCase()
  const word = FIRST_WORD.exec(text)?.[1] ?? ""
  const clean = (name: string | undefined) => name?.replace(QUOTES_AND_SEMICOLON, "") ?? null

  if (word === "select" || word === "with") {
    return { kind: "select", savepoint: null }
  }
  if (word === "insert" || word === "update" || word === "delete" || word === "replace") {
    return { kind: word, savepoint: null }
  }
  if (word === "begin" || START_TRANSACTION.test(text)) {
    return { kind: "tx-begin", savepoint: null }
  }
  if (word === "commit") {
    return { kind: "tx-commit", savepoint: null }
  }
  if (ROLLBACK_TO.test(text)) {
    return { kind: "savepoint-rollback", savepoint: clean(ROLLBACK_TO_NAME.exec(text)?.[1]) }
  }
  if (word === "rollback") {
    return { kind: "tx-rollback", savepoint: null }
  }
  if (word === "savepoint") {
    return { kind: "savepoint", savepoint: clean(SAVEPOINT_NAME.exec(text)?.[1]) }
  }
  if (RELEASE_SAVEPOINT.test(text)) {
    return { kind: "savepoint-release", savepoint: clean(RELEASE_NAME.exec(text)?.[1]) }
  }
  if (SET_TRANSACTION.test(text)) {
    return { kind: "tx-config", savepoint: null }
  }
  return { kind: "other", savepoint: null }
}

export function analyzeSql(sql: string): SqlAnalysis {
  try {
    const masked = maskLiterals(sql)
    const { kind, savepoint } = kindOf(masked)
    const subqueries = measureSubqueries(masked)
    return {
      kind,
      tables: tablesOf(masked),
      subqueryDepth: subqueries.depth,
      subqueryCount: subqueries.count,
      fingerprint: fingerprintOf(sql),
      selectStar: SELECT_STAR.test(masked),
      savepoint
    }
  } catch {
    return { kind: "other", tables: [], subqueryDepth: 0, subqueryCount: 0, fingerprint: sql, selectStar: false, savepoint: null }
  }
}

export function isControlStatement(kind: StatementKind) {
  return kind === "tx-begin" || kind === "tx-commit" || kind === "tx-rollback" || kind === "tx-config"
    || kind === "savepoint" || kind === "savepoint-release" || kind === "savepoint-rollback"
}

export function isWriteStatement(kind: StatementKind) {
  return kind === "insert" || kind === "update" || kind === "delete" || kind === "replace"
}

const BREAK_BEFORE = /^(?:select|from|where|group|order|having|limit|offset|union|set|values|left|right|inner|cross|join|for)$/i
const JOIN_MODIFIER = /^(?:left|right|inner|cross|full|outer|natural)$/i
const WHITESPACE = /^\s+$/

function nextSignificantToken(tokens: string[], from: number): string {
  for (let i = from; i < tokens.length; i++) {
    if (!WHITESPACE.test(tokens[i]!)) {
      return tokens[i]!
    }
  }
  return ""
}

/**
 * Indents by subquery depth and starts a new line at each major clause, so a nested Drizzle
 * relational query reads as a tree. Display only — never executed.
 */
export function formatSql(sql: string): string {
  const out: string[] = []
  const subqueryParens: boolean[] = []
  let indent = 0
  let previousWord = ""
  let line = ""

  const newline = () => {
    if (line.trim()) {
      out.push(line.trimEnd())
    }
    line = "  ".repeat(indent)
  }

  const tokens = sql.match(TOKEN) ?? []
  for (const [i, token] of tokens.entries()) {
    if (WHITESPACE.test(token)) {
      if (line.trim() && !line.endsWith(" ")) {
        line += " "
      }
      continue
    }
    if (token === "(") {
      const opensSubquery = SUBQUERY_KEYWORD.test(nextSignificantToken(tokens, i + 1))
      subqueryParens.push(opensSubquery)
      line += "("
      if (opensSubquery) {
        indent++
        newline()
      }
      previousWord = ""
      continue
    }
    if (token === ")") {
      if (subqueryParens.pop()) {
        indent = Math.max(0, indent - 1)
        newline()
      }
      line += ")"
      previousWord = ""
      continue
    }
    const word = token.toLowerCase()
    if (WORD.test(token)) {
      if (word === "and" || word === "or") {
        newline()
        line += "  "
      } else if (BREAK_BEFORE.test(word) && !(word === "join" && JOIN_MODIFIER.test(previousWord))) {
        newline()
      }
    }
    line += token
    previousWord = WORD.test(token) ? word : ""
  }
  newline()
  return out.join("\n")
}
