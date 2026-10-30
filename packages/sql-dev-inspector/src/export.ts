import type { RequestReport } from "./types.js"
import { shortLocation } from "./caller.js"
import { DEFAULT_LOCALE, type Locale, translate } from "./i18n/index.js"
import { isControlStatement } from "./sql-analyzer.js"
import { renderReport } from "./terminal.js"

// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-9;]*m/g
const MAX_ROWS = 60
const WHITESPACE = /\s+/g

const cell = (text: string, max = 110) => {
  const flat = text.replace(WHITESPACE, " ").trim()
  return (flat.length > max ? `${flat.slice(0, max)}…` : flat).replace(/\|/g, "\\|").replace(/`/g, "'")
}

/**
 * One request as Markdown, for a bug report, a pull request or a chat with an assistant: what was found and how to fix
 * it, the calls in order with where they were made, and the tree. Values are as redacted as the inspector is set to
 * redact them; nothing more is added.
 */
export function exportMarkdown(report: RequestReport, root?: string, locale: Locale = DEFAULT_LOCALE): string {
  const { trace, totals, insights } = report
  const title = trace.id === "background" ? translate(locale, "requests.background") : trace.url
  const lines = [
    `## ${trace.method} ${title} → ${trace.status ?? "…"}`,
    "",
    `${totals.queryCount} calls, ${Math.round(totals.sqlTimeMs * 100) / 100} ms in calls${trace.durationMs !== null ? `, ${Math.round(trace.durationMs * 100) / 100} ms in all` : ""}.`,
    ""
  ]
  const { breakdown } = totals
  if (breakdown.total > 0) {
    const part = (label: string, ms: number) => ms > 0 ? `${label} ${Math.round(ms)} ms (${Math.round(ms / breakdown.total * 100)}%)` : null
    lines.push(`Time: ${[part("database", breakdown.database), part("cache", breakdown.cache), part("outbound HTTP", breakdown.http), part("application and waiting", breakdown.app)].filter(Boolean).join(", ")}.`, "")
  }
  if (insights.length > 0) {
    lines.push("### Findings", "")
    for (const insight of insights) {
      const where = insight.params.caller ? ` (from \`${String(insight.params.caller).replace(`${root}/`, "")}\`)` : ""
      lines.push(`- **${translate(locale, `insight.title.${insight.type}` as never)}**: ${insight.message}${where}`)
      if (insight.hint) {
        lines.push(`  - ${translate(locale, "hint.title")}: ${insight.hint}`)
      }
    }
    lines.push("")
  }
  const calls = trace.queries.filter(query => !isControlStatement(query.analysis.kind))
  if (calls.length > 0) {
    lines.push("### Calls", "", "| # | Driver | Call | ms | Rows | From |", "|---|---|---|---|---|---|")
    calls.slice(0, MAX_ROWS).forEach((query, index) => {
      lines.push(`| ${index + 1} | ${query.driver ?? ""} | ${cell(query.sql)}${query.error ? ` ✖ ${cell(query.error, 60)}` : ""} | ${query.durationMs === null ? "…" : Math.round(query.durationMs * 100) / 100} | ${query.rowCount ?? query.affectedRows ?? ""} | ${query.caller ? shortLocation(query.caller, root) : ""} |`)
    })
    if (calls.length > MAX_ROWS) {
      lines.push(`| … | | ${calls.length - MAX_ROWS} more calls not listed | | | |`)
    }
    lines.push("")
  }
  if (trace.logs && trace.logs.length > 0) {
    lines.push("### Console output", "", "```")
    for (const entry of trace.logs.slice(0, 50)) {
      lines.push(`[${entry.level}] +${Math.max(0, Math.round(entry.at - trace.startedAt))}ms ${entry.message.split("\n")[0]}`)
    }
    lines.push("```", "")
  }
  lines.push("### Tree", "", "```", renderReport(report, locale, root).replace(ANSI, ""), "```", "")
  return lines.join("\n")
}
