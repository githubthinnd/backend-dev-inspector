import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs"
import { SourceMap } from "node:module"
import { dirname, isAbsolute, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Where a position in a bundled file came from. A dev server (Nitro, Vite, webpack) runs your code as one bundle, so the
 * stack of a call says `.nuxt/dev/index.mjs:3323` where you wrote `server/api/orders.get.ts:12`. When Node was not started
 * with source maps on (`--enable-source-maps`), nothing maps the stack, so the map the bundler wrote next to the bundle is
 * read here.
 *
 * It only reads: the map named by the bundle's own `sourceMappingURL` comment (next to it, or inline), at most once per
 * bundle, at most 64 MB, never anything outside the bundle's folder, and nothing is written.
 */

export interface Original {
  file: string
  line: number
  column: number
}

const BUNDLE = /\.[cm]?js$/
const URL_COMMENT = /\/\/[#@] sourceMappingURL=([^\s'"]+)\s*$/
const INLINE = /^data:application\/json[^,]*;base64,/
const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const TAIL_BYTES = 2048
const MAX_MAP_BYTES = 64 * 1024 * 1024
const MAX_CACHED = 256

interface Loaded {
  map: SourceMap
  dir: string
  root: string
}

// One cache per process, however many copies of this package are loaded (like the request scope).
const CACHE = Symbol.for("sqlDevInspector.sourceMaps")
const cache = ((globalThis as unknown as Record<symbol, Map<string, Loaded | null> | undefined>)[CACHE] ??= new Map<string, Loaded | null>())

/** The last bytes of a file: where a bundler puts the pointer to its map. */
function tailOf(file: string): string {
  const fd = openSync(file, "r")
  try {
    const size = statSync(file).size
    const length = Math.min(TAIL_BYTES, size)
    const buffer = Buffer.alloc(length)
    readSync(fd, buffer, 0, length, size - length)
    return buffer.toString("utf8")
  } finally {
    closeSync(fd)
  }
}

function payloadOf(file: string): { payload: string, dir: string } | null {
  const dir = dirname(file)
  const pointer = URL_COMMENT.exec(tailOf(file).trimEnd())?.[1]
  if (pointer && INLINE.test(pointer)) {
    return { payload: Buffer.from(pointer.replace(INLINE, ""), "base64").toString("utf8"), dir }
  }
  // Only a map in the bundle's own folder: a comment cannot make the inspector read anywhere else.
  const target = resolve(dir, pointer && !SCHEME.test(pointer) ? decodeURIComponent(pointer) : `${file}.map`)
  if (!target.startsWith(dir + sep) || statSync(target).size > MAX_MAP_BYTES) {
    return null
  }
  return { payload: readFileSync(target, "utf8"), dir: dirname(target) }
}

function load(file: string): Loaded | null {
  if (cache.has(file)) {
    // least recently used goes last: a bundle that is looked up all the time is never the one evicted
    const hit = cache.get(file) ?? null
    cache.delete(file)
    cache.set(file, hit)
    return hit
  }
  let loaded: Loaded | null = null
  try {
    const found = payloadOf(file)
    if (found) {
      const parsed = JSON.parse(found.payload) as { sourceRoot?: unknown, sections?: unknown }
      loaded = { map: new SourceMap(parsed as never), dir: found.dir, root: typeof parsed.sourceRoot === "string" ? parsed.sourceRoot : "" }
    }
  } catch {
    loaded = null // no map, or not one we can read: the bundled position stays
  }
  if (cache.size >= MAX_CACHED) {
    cache.delete(cache.keys().next().value!)
  }
  cache.set(file, loaded)
  return loaded
}

/** A source name of a map as an absolute path, or null for one that is not a file (`virtual:`, `\0` ids, other schemes). */
function pathOf(source: string, loaded: Loaded): string | null {
  if (!source || source.startsWith("\0") || source.startsWith("#")) {
    return null
  }
  if (source.startsWith("file://")) {
    return fileURLToPath(source)
  }
  if (SCHEME.test(source) && !/^[a-z]:[\\/]/i.test(source)) {
    return null
  }
  return isAbsolute(source) ? source : resolve(loaded.dir, loaded.root.replace(/^file:\/\//, ""), source)
}

/** The original position of `line:column` (1-based, as stacks print them) in `file`, or null when there is no map or no mapping. */
export function originalPosition(file: string, line: number, column: number): Original | null {
  if (!BUNDLE.test(file) || file.includes("/node_modules/")) {
    return null
  }
  const loaded = load(file)
  if (!loaded) {
    return null
  }
  try {
    const entry = loaded.map.findEntry(line - 1, column - 1) as { originalSource?: string, originalLine?: number, originalColumn?: number }
    const source = entry?.originalSource === undefined ? null : pathOf(entry.originalSource, loaded)
    if (!source || typeof entry.originalLine !== "number") {
      return null
    }
    return { file: source, line: entry.originalLine + 1, column: (entry.originalColumn ?? 0) + 1 }
  } catch {
    return null
  }
}

/** Test helper: forget the maps that were read. */
export function resetSourceMapCache() {
  cache.clear()
}
