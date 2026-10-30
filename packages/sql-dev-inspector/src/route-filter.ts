/**
 * Which requests the inspector follows. A pattern is a path: `/api/orders` (exactly that),
 * `/api/*` (any one segment), `/api/**` (that path and everything under it), `/*-webhook`
 * (a `*` inside a segment matches any characters). Query strings are ignored.
 *
 * Written by hand, not compiled into regular expressions: nothing in this package builds code
 * from strings.
 */

export interface RouteFilters {
  /** When not empty, only requests matching one of these are traced. */
  include: string[]
  /** Requests matching one of these are never traced (checked after `include`). */
  exclude: string[]
}

export const NO_FILTERS: RouteFilters = { include: [], exclude: [] }

const SEPARATORS = /[?#]/

/** `/api/**,/health` or a list: trimmed, blanks dropped, each given a leading slash. */
export function parsePatterns(raw: string | readonly string[] | undefined): string[] {
  const items = typeof raw === "string" ? raw.split(",") : [...(raw ?? [])]
  return items.map(item => item.trim()).filter(Boolean).map(item => item.startsWith("/") ? item : `/${item}`)
}

function segmentsOf(path: string): string[] {
  return path.split("/").filter(Boolean)
}

/** Does `text` match `pattern`, where `*` stands for any run of characters? */
function wildcardMatch(pattern: string, text: string): boolean {
  if (!pattern.includes("*")) {
    return pattern === text
  }
  const parts = pattern.split("*")
  const first = parts[0]!
  const last = parts.at(-1)!
  if (!text.startsWith(first) || !text.endsWith(last) || text.length < first.length + last.length) {
    return false
  }
  let at = first.length
  const end = text.length - last.length
  for (const part of parts.slice(1, -1)) {
    const found = text.indexOf(part, at)
    if (found === -1 || found + part.length > end) {
      return false
    }
    at = found + part.length
  }
  return true
}

function matchSegments(pattern: string[], path: string[]): boolean {
  if (pattern.length === 0) {
    return path.length === 0
  }
  const [head, ...rest] = pattern
  if (head === "**") {
    // `**` takes zero or more segments.
    for (let taken = 0; taken <= path.length; taken++) {
      if (matchSegments(rest, path.slice(taken))) {
        return true
      }
    }
    return false
  }
  return path.length > 0 && wildcardMatch(head!, path[0]!) && matchSegments(rest, path.slice(1))
}

/** The path of a request URL, without its query string or hash. */
export function pathnameOf(url: string): string {
  return url.split(SEPARATORS)[0] || "/"
}

export function matchRoute(pattern: string, pathname: string): boolean {
  return matchSegments(segmentsOf(pattern), segmentsOf(pathnameOf(pathname)))
}

/** False for a request the filters leave out. */
export function isTracked(filters: RouteFilters, url: string): boolean {
  const path = pathnameOf(url)
  if (filters.include.length > 0 && !filters.include.some(pattern => matchRoute(pattern, path))) {
    return false
  }
  return !filters.exclude.some(pattern => matchRoute(pattern, path))
}
