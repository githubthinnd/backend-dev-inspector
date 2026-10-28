import type { QueryEvent, RequestReport, TraceNode } from "./types.js"
import process from "node:process"
import { pickEnv } from "./env.js"
import { type Locale, translate } from "./i18n/index.js"
import { isControlStatement } from "./sql-analyzer.js"

const useColor = Boolean(process.stdout?.isTTY) && !pickEnv().NO_COLOR
const paint = (code: number) => (text: string) => useColor ? `\u001B[${code}m${text}\u001B[0m` : text
const dim = paint(2)
const bold = paint(1)
const red = paint(31)
const yellow = paint(33)
const green = paint(32)
const cyan = paint(36)

const WHITESPACE_RUN = /\s+/g
const ms = (value: number | null) => value === null ? "…" : `${value.toFixed(value < 10 ? 2 : 1)}ms`
function oneLine(sql: string, max = 140) {
  const flat = sql.replace(WHITESPACE_RUN, " ").trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

function describeQuery(query: QueryEvent, locale: Locale): string {
  const { analysis } = query
  const where = analysis.tables.length > 0 ? ` ${cyan(analysis.tables.join(", "))}` : ""
  const nested = analysis.subqueryDepth > 0
    ? yellow(` ⤷${translate(locale, "term.subquery", { count: analysis.subqueryCount, depth: analysis.subqueryDepth })}`)
    : ""
  const rows = query.rowCount !== null
    ? translate(locale, "term.rows", { count: query.rowCount })
    : query.affectedRows !== null ? translate(locale, "term.affected", { count: query.affectedRows }) : ""
  const stats = dim(`${ms(query.durationMs)}${rows ? ` · ${rows}` : ""}`)
  const failed = query.error ? red(` ✖ ${query.error}`) : ""
  const driver = query.driver && query.driver !== "mysql2" ? ` ${dim(`[${query.driver}]`)}` : ""
  return `${bold((analysis.label ?? analysis.kind).toUpperCase())}${driver}${where}${nested} ${stats}${failed}\n${oneLine(query.sql)}`
}

function renderNodes(nodes: TraceNode[], prefix: string, lines: string[], locale: Locale) {
  nodes.forEach((node, index) => {
    const last = index === nodes.length - 1
    const branch = `${prefix}${last ? "└─ " : "├─ "}`
    const childPrefix = `${prefix}${last ? "   " : "│  "}`

    if (node.type === "query") {
      const [head, ...rest] = describeQuery(node.query, locale).split("\n")
      lines.push(`${branch}${head}`)
      rest.forEach(line => lines.push(`${childPrefix}${dim(line)}`))
      return
    }
    const label = node.type === "transaction" ? translate(locale, "tx.transaction").toUpperCase() : translate(locale, "tx.savepoint", { name: node.name ?? "" }).toUpperCase()
    const statusText = translate(locale, `status.${node.status}`)
    const status = node.status === "committed" ? green(statusText) : node.status === "rolled-back" ? red(statusText) : yellow(statusText)
    lines.push(`${branch}${bold(label)} ${dim(`[conn ${node.connectionId}]`)} ${status} ${dim(ms(node.durationMs))}`)
    renderNodes(node.children, childPrefix, lines, locale)
  })
}

export function renderReport(report: RequestReport, locale: Locale = "en"): string {
  const { trace, totals } = report
  const lines = [
    `${bold(`${trace.method} ${trace.id === "background" ? translate(locale, "requests.background") : trace.url}`)} → ${trace.status ?? "…"} ${dim([translate(locale, "term.total", { ms: ms(trace.durationMs) }), translate(locale, "term.queries", { count: totals.queryCount }), translate(locale, "term.inSql", { ms: ms(totals.sqlTimeMs) })].join(" · "))}`
  ]
  renderNodes(report.tree, "", lines, locale)
  for (const insight of report.insights) {
    const mark = insight.severity === "error" ? red("✖") : insight.severity === "warn" ? yellow("⚠") : dim("ℹ")
    lines.push(`${mark} ${insight.message}`)
  }
  return lines.join("\n")
}

/** Statements worth a terminal line; transaction plumbing is already shown by the tree. */
export function hasVisibleStatements(report: RequestReport) {
  return report.trace.queries.some(query => !isControlStatement(query.analysis.kind))
}
