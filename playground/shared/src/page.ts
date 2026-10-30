import { scenarios } from "./scenarios.ts"

const escape = (text: string) => text.replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char]!)

/** The home page of every app: the scenarios to click and the link to the inspector. */
export function renderIndex(stack: string): string {
  const rows = scenarios.map(scenario => `
    <li><a href="${scenario.path}"><strong>${escape(scenario.title)}</strong></a><br><small>${escape(scenario.expect)}</small></li>`).join("")
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(stack)} playground</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:42rem;margin:3rem auto;padding:0 1rem}li{margin:.8rem 0}small{color:#666}a.big{display:inline-block;margin:.5rem 0 1rem}</style>
</head><body>
<h1>${escape(stack)}</h1>
<p>Open a scenario, then look at it in the inspector.</p>
<a class="big" href="/__sql-inspector/">Open the inspector &rarr;</a>
<ul>${rows}</ul>
</body></html>`
}
