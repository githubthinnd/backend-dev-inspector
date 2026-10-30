import { originalPosition } from "./sourcemap.js"

/**
 * Where in the application a call was made. The statement is recorded synchronously inside the call
 * the application made (`pool.query(...)`, or the `await` of a lazy builder), so the stack at that moment
 * leads back to the application's own code: the first frame that is not a library and not this package.
 */

export interface Caller {
  /** Absolute path of the file, as the runtime reports it (source-mapped where the dev server maps it). */
  file: string
  line: number
  column: number
  /** The function that made the call, when the stack names one. */
  fn?: string
}

const FRAME = /^\s*at (?:async )?(?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/
const FILE_URL = /^file:\/\//
/** Frames that are never "the application": libraries, Node itself, and the inspector's own packages. */
const NOT_APPLICATION = ["/node_modules/", "/sql-dev-inspector/src/", "/sql-dev-inspector/dist/", "/backend-dev-inspector/src/", "/backend-dev-inspector/dist/"]

function isApplicationFile(file: string): boolean {
  if (file.startsWith("node:") || file.startsWith("internal/") || file.includes("<anonymous>") || file.startsWith("native")) {
    return false
  }
  return !NOT_APPLICATION.some(part => file.includes(part))
}

/**
 * The first application frame of a stack. A frame in a bundle (the dev server's `.nuxt/dev/index.mjs`) is looked up in the
 * bundle's source map, so it reads as the file you wrote; a source that turns out to be a library is skipped like any other.
 */
export function callerFromStack(stack: string): Caller | undefined {
  for (const line of stack.split("\n").slice(1)) {
    const match = FRAME.exec(line)
    if (!match) {
      continue
    }
    let file = match[2]!
    if (FILE_URL.test(file)) {
      file = decodeURI(file.replace(FILE_URL, ""))
    }
    if (!isApplicationFile(file)) {
      continue
    }
    let position = { file, line: Number(match[3]), column: Number(match[4]) }
    const original = originalPosition(file, position.line, position.column)
    if (original) {
      if (!isApplicationFile(original.file)) {
        continue
      }
      position = original
    }
    const caller: Caller = position
    if (match[1] && !match[1].includes("<anonymous>")) {
      caller.fn = match[1]
    }
    return caller
  }
  return undefined
}

/** The first application frame of the current stack, or undefined (the call came from a library alone). */
export function findCaller(): Caller | undefined {
  try {
    const limit = Error.stackTraceLimit
    Error.stackTraceLimit = 40
    const holder: { stack?: string } = {}
    Error.captureStackTrace(holder, findCaller)
    Error.stackTraceLimit = limit
    return callerFromStack(String(holder.stack ?? ""))
  } catch {
    // never get in the way of the call
    return undefined
  }
}

/** `src/server/api/orders.ts:42`: the file relative to `root` when it is under it. */
export function shortLocation(caller: Pick<Caller, "file" | "line">, root?: string): string {
  const base = root ? (root.endsWith("/") ? root : `${root}/`) : ""
  const file = base && caller.file.startsWith(base) ? caller.file.slice(base.length) : caller.file
  return `${file}:${caller.line}`
}

/**
 * Link templates of the editors that open `file:line:column` from a URL. The page fills in `{file}` (the absolute
 * path with forward slashes), `{path}` (the same without its leading slash), `{line}` and `{column}`. Only these
 * schemes are ever used for a link.
 */
export const EDITORS: Record<string, string> = {
  "vscode": "vscode://file/{path}:{line}:{column}",
  "vscode-insiders": "vscode-insiders://file/{path}:{line}:{column}",
  "cursor": "cursor://file/{path}:{line}:{column}",
  "windsurf": "windsurf://file/{path}:{line}:{column}",
  "zed": "zed://file/{path}:{line}:{column}",
  "idea": "idea://open?file={file}&line={line}&column={column}",
  "webstorm": "webstorm://open?file={file}&line={line}&column={column}",
  "none": ""
}

export const DEFAULT_EDITOR = "vscode"

const ALLOWED_SCHEME = /^(?:vscode|vscode-insiders|cursor|windsurf|zed|idea|webstorm|phpstorm|pycharm|sublime|subl|txmt|atom):\/\//

/** `SQL_INSPECTOR_EDITOR`: a name from `EDITORS`, or a link template starting with one of the known editor schemes. */
export function resolveEditor(raw: string | undefined): { name: string, template: string } {
  const value = (raw ?? "").trim()
  if (value === "") {
    return { name: DEFAULT_EDITOR, template: EDITORS[DEFAULT_EDITOR]! }
  }
  if (value.toLowerCase() in EDITORS) {
    const name = value.toLowerCase()
    return { name, template: EDITORS[name]! }
  }
  if (ALLOWED_SCHEME.test(value) && (value.includes("{file}") || value.includes("{path}"))) {
    return { name: "custom", template: value }
  }
  return { name: DEFAULT_EDITOR, template: EDITORS[DEFAULT_EDITOR]! }
}
