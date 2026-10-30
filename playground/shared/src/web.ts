import { readFileSync } from "node:fs"
import { views } from "./content.ts"

/** What the page says about the app that serves it. */
export interface StackInfo {
  framework: string
  data: string
}

export interface WebResponse {
  status: number
  type: string
  body: string
}

const dir = new URL("../web/", import.meta.url)
const TYPES: Record<string, string> = {
  "index.html": "text/html; charset=utf-8",
  "app.css": "text/css; charset=utf-8",
  "app.js": "text/javascript; charset=utf-8"
}

/**
 * The front end of the plain-HTML apps: `/` (the Antimatter admin) and `/assets/app.css|app.js`.
 * The files are read on every call, so an edit shows after a reload without restarting the app.
 * Nuxt apps do not use this: they render the same design with Vue (layers/antimatter-ui).
 */
export function serveWeb(pathname: string, info: StackInfo): WebResponse | undefined {
  const file = pathname === "/" || pathname === "/index.html" ? "index.html" : /^\/assets\/(app\.css|app\.js)$/.exec(pathname)?.[1]
  if (!file) {
    return undefined
  }
  let body = readFileSync(new URL(file, dir), "utf8")
  if (file === "index.html") {
    const config = JSON.stringify({ ...info, views }).replace(/</g, "\\u003c")
    body = body.replaceAll("{{FRAMEWORK}}", info.framework.replace(/[<>&"]/g, "")).replaceAll("{{CONFIG}}", config)
  }
  return { status: 200, type: TYPES[file]!, body }
}
