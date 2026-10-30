// Renders the inspector's real terminal output for three scenarios as SVG "screenshots" for the READMEs.
//   node scripts/capture-terminal.mts      (from playground/, after `npm run playground:install` in the root)
// The text is what the express-sqlite app prints; only the window, colours and an explicit "… n more" line are added.
import "@playground/shared/dev-env"
import { mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const OUT = fileURLToPath(new URL("../../docs/media/", import.meta.url))
mkdirSync(OUT, { recursive: true })

const chunks: string[] = []
const realWrite = process.stdout.write.bind(process.stdout)
process.stdout.write = ((chunk: string | Uint8Array) => {
  chunks.push(String(chunk))
  return true
}) as typeof process.stdout.write

const { createApp } = await import("../apps/express-sqlite/src/app.ts")
const inject = (await import("light-my-request")).default as (handler: unknown, options: { url: string }) => Promise<unknown>
const app = createApp()

async function capture(url: string): Promise<string[]> {
  chunks.length = 0
  await inject(app, { url })
  return chunks.join("").split("\n").filter(line => line.length > 0)
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const COLORS = { text: "#c9d1d9", dim: "#6e7681", sql: "#8b949e", head: "#f0f6fc", keyword: "#79c0ff", table: "#7ee787", warn: "#d29922", error: "#f85149" }

type Span = [text: string, color: string, bold?: boolean]

function spansFor(line: string): Span[] {
  if (/^(GET|POST|PUT|PATCH|DELETE) /.test(line)) {
    return [[line, COLORS.head, true]]
  }
  if (line.startsWith("⚠")) {
    return [[line, COLORS.warn]]
  }
  const prefix = /^[│├└─ ]*/.exec(line)![0]
  const rest = line.slice(prefix.length)
  const spans: Span[] = prefix ? [[prefix, COLORS.dim]] : []
  const statement = /^([A-Z]+)( \[[^\]]+\])?(.*?)( \d+(?:\.\d+)?ms.*?)?( ✖ .*)?$/.exec(rest)
  if (!statement || !/^(SELECT|INSERT|UPDATE|DELETE|TRANSACTION|SAVEPOINT|FIND|GET)$/.test(statement[1]!)) {
    return [...spans, [rest, COLORS.sql]]
  }
  const [, keyword, driver, tables, stats, failed] = statement
  spans.push([keyword!, COLORS.keyword, true])
  if (driver) {
    spans.push([driver, COLORS.dim])
  }
  if (tables) {
    spans.push([tables, COLORS.table])
  }
  if (stats) {
    spans.push([stats, COLORS.dim])
  }
  if (failed) {
    spans.push([failed, COLORS.error])
  }
  return spans
}

function render(title: string, lines: string[]): string {
  const charWidth = 8.4
  const lineHeight = 21
  const width = Math.ceil(Math.max(...lines.map(line => [...line].length)) * charWidth) + 48
  const height = lines.length * lineHeight + 78
  const body = lines.map((line, index) => {
    const spans = spansFor(line).map(([text, color, bold]) =>
      `<tspan fill="${color}"${bold ? " font-weight=\"700\"" : ""}>${escape(text)}</tspan>`).join("")
    return `<text x="24" y="${58 + index * lineHeight}" xml:space="preserve">${spans}</text>`
  }).join("\n    ")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(title)}">
  <title>${escape(title)}</title>
  <rect width="${width}" height="${height}" rx="10" fill="#0d1117"/>
  <rect width="${width}" height="34" rx="10" fill="#161b22"/>
  <rect y="24" width="${width}" height="10" fill="#161b22"/>
  <circle cx="20" cy="17" r="6" fill="#ff5f56"/><circle cx="40" cy="17" r="6" fill="#ffbd2e"/><circle cx="60" cy="17" r="6" fill="#27c93f"/>
  <text x="${width / 2}" y="22" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="12" fill="${COLORS.dim}">${escape(title)}</text>
  <g font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="14" fill="${COLORS.text}">
    ${body}
  </g>
</svg>
`
}

/** Keeps the head of a long tree and its closing warning; the cut is written out, not hidden. */
function shorten(lines: string[], keep: number): string[] {
  const tree = lines.filter(line => !line.startsWith("⚠") && !/^(GET|POST) /.test(line))
  const head = lines.filter(line => /^(GET|POST) /.test(line))
  const warnings = lines.filter(line => line.startsWith("⚠"))
  if (tree.length <= keep * 2) {
    return lines
  }
  const hidden = tree.length / 2 - keep // every statement is two lines: the call and its SQL
  return [...head, ...tree.slice(0, keep * 2 - 2), `│  … ${hidden} more statements`, ...tree.slice(-2), ...warnings]
}

const shots: Array<[file: string, title: string, url: string, keep?: number]> = [
  ["terminal-n-plus-one.svg", "backend-dev-inspector: an N+1 in the terminal", "/api/orders/n-plus-one", 3],
  ["terminal-error.svg", "backend-dev-inspector: a failing statement", "/api/orders/error"],
  ["terminal-transaction.svg", "backend-dev-inspector: a transaction with a rolled-back savepoint", "/api/orders/transaction"]
]
const written: string[] = []
for (const [file, title, url, keep] of shots) {
  const lines = await capture(url)
  writeFileSync(`${OUT}${file}`, render(title, keep ? shorten(lines, keep) : lines))
  written.push(file)
}
process.stdout.write = realWrite
console.log(`wrote ${written.join(", ")} to docs/media/`)
