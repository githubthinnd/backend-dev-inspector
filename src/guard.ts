import type { IncomingMessage } from "node:http"

/**
 * The inspector shows real SQL, so it must not answer a page that merely reached the dev
 * server's port. Two attacks matter:
 *  - DNS rebinding: a hostile domain is pointed at 127.0.0.1, so the browser treats the dev
 *    server as that domain's own and lets its script read the answers. The giveaway is a `Host`
 *    header that is neither a loopback name nor an IP literal.
 *  - Cross-site requests that change state (clear, settings): a browser always labels those
 *    with `Origin` / `Sec-Fetch-Site`, which a real visit to the page never contradicts.
 */

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/
const PORT_SUFFIX = /:\d*$/
const TRAILING_DOT = /\.$/

/** `Host` header (or an allow-list entry) to a bare lowercase host name: no port, no brackets, no trailing dot. */
export function hostnameOf(value: string): string {
  const text = value.trim().toLowerCase()
  const host = text.startsWith("[") ? text.slice(1, text.indexOf("]") === -1 ? undefined : text.indexOf("]")) : text.replace(PORT_SUFFIX, "")
  return host.replace(TRAILING_DOT, "")
}

/** Parses `SQL_INSPECTOR_ALLOWED_HOSTS`: comma separated names, `*.example.test` for subdomains, `*` for anything. */
export function parseAllowedHosts(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map(hostnameOf).filter(Boolean)
}

export function isAllowedHost(hostHeader: string | undefined, allowed: readonly string[] = []): boolean {
  if (!hostHeader) {
    return true // HTTP/1.0 or a hand-made request: not a browser, so not a rebinding attack
  }
  const host = hostnameOf(hostHeader)
  if (host === "localhost" || host.endsWith(".localhost") || IPV4.test(host) || host.includes(":")) {
    return true
  }
  return allowed.some(entry => entry === "*" || (entry.startsWith("*.") ? host.endsWith(entry.slice(1)) : entry === host))
}

/**
 * True unless a browser says this request comes from another origin. Tools like curl send
 * neither header and pass. `Sec-Fetch-Site` is set by the browser itself and cannot be forged by
 * a page, so it decides when present (it also stays "same-origin" behind a dev-server proxy that
 * rewrites `Host`). Older browsers fall back to `Origin`, which must be this server's own host or
 * a host that would be allowed to open the inspector anyway (such as the proxying dev server).
 */
export function isSameOriginRequest(req: Pick<IncomingMessage, "headers">, allowedHosts: readonly string[] = []): boolean {
  const headers = req.headers ?? {}
  const site = headers["sec-fetch-site"]
  if (site !== undefined) {
    return site === "same-origin" || site === "none"
  }
  const origin = headers.origin
  if (origin === undefined) {
    return true
  }
  try {
    const { host } = new URL(origin)
    return host === (headers.host ?? "") || isAllowedHost(host, allowedHosts)
  } catch {
    return false // "null" (sandboxed frames, redirects) and anything unparsable
  }
}

/** Why a request must be refused, or null when it may proceed. */
export function rejectReason(req: Pick<IncomingMessage, "headers" | "method">, allowedHosts: readonly string[]): string | null {
  const host = req.headers?.host
  if (!isAllowedHost(host, allowedHosts)) {
    return `Host "${host}" is not allowed. If it is yours, start the app with SQL_INSPECTOR_ALLOWED_HOSTS=${hostnameOf(host ?? "")} (comma separated; "*.example.test" for subdomains).`
  }
  if (req.method === "POST" && !isSameOriginRequest(req, allowedHosts)) {
    return "Cross-origin requests are not allowed."
  }
  return null
}
