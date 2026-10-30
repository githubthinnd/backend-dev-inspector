import type { IncomingMessage } from "node:http"
import { randomBytes, timingSafeEqual } from "node:crypto"

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
export function rejectReason(req: Pick<IncomingMessage, "headers" | "method">, allowedHosts: readonly string[], tokenSet = false): string | null {
  const host = req.headers?.host
  // A token makes DNS rebinding harmless (the page has no way to know it), and lets a container or a tunnel be opened by name.
  if (!tokenSet && !isAllowedHost(host, allowedHosts)) {
    return `Host "${host}" is not allowed. If it is yours, start the app with SQL_INSPECTOR_ALLOWED_HOSTS=${hostnameOf(host ?? "")} (comma separated; "*.example.test" for subdomains).`
  }
  if (req.method === "POST" && !isSameOriginRequest(req, allowedHosts)) {
    return "Cross-origin requests are not allowed."
  }
  return null
}

// ── token ────────────────────────────────────────────────────────────────

export const TOKEN_COOKIE = "sql_inspector_token"
const MIN_TOKEN = 8

/** True when `SQL_INSPECTOR_TOKEN` was given but cannot be used (shorter than 8 characters). */
export function isTokenRejected(raw: string | undefined): boolean {
  const value = (raw ?? "").trim()
  return value !== "" && value.toLowerCase() !== "auto" && value.length < MIN_TOKEN
}

/**
 * `SQL_INSPECTOR_TOKEN`: a secret of at least 8 characters; `auto` makes a random one; unset means no token. A value that is
 * set but too short is not "no token": it would leave the page open to someone who believes it is protected. The inspector is
 * locked instead, behind a random token nobody knows, until the setting is fixed (see `isTokenRejected`).
 */
export function parseToken(raw: string | undefined): string | null {
  const value = (raw ?? "").trim()
  if (value === "") {
    return null
  }
  return value.toLowerCase() === "auto" || value.length < MIN_TOKEN ? randomBytes(18).toString("base64url") : value
}

function sameSecret(given: string | undefined, expected: string): boolean {
  if (given === undefined) {
    return false
  }
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function cookieOf(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=")
    if (key === name) {
      return value.join("=")
    }
  }
  return undefined
}

export type TokenCheck
  = | { ok: true }
    | { ok: true, setCookie: string, redirect: string }
    | { ok: false }

/**
 * With a token set, every request must carry it: as `Authorization: Bearer <token>` (scripts, MCP clients), in the
 * cookie a first visit sets, or once as `?token=` in the address, which sets the cookie and redirects to the address
 * without it. The cookie is `HttpOnly` and `SameSite=Strict`, scoped to the inspector's path.
 */
export function checkToken(req: Pick<IncomingMessage, "headers" | "url" | "method">, token: string, mount: string): TokenCheck {
  const headers = req.headers ?? {}
  const bearer = /^Bearer (.+)$/i.exec(String(headers.authorization ?? ""))?.[1]
  if (sameSecret(bearer, token) || sameSecret(cookieOf(headers.cookie, TOKEN_COOKIE), token)) {
    return { ok: true }
  }
  // Split by hand: `new URL("//host/…")` would read the first segment as a host, and the redirect must stay on this server.
  const raw = req.url ?? "/"
  const at = raw.indexOf("?")
  const query = new URLSearchParams(at === -1 ? "" : raw.slice(at + 1))
  if (req.method === "GET" && sameSecret(query.get("token") ?? undefined, token)) {
    query.delete("token")
    const path = `/${(at === -1 ? raw : raw.slice(0, at)).replace(/^[/\\]+/, "")}`
    const rest = query.toString()
    return {
      ok: true,
      setCookie: `${TOKEN_COOKIE}=${token}; Path=/${mount}; HttpOnly; SameSite=Strict`,
      redirect: rest ? `${path}?${rest}` : path
    }
  }
  return { ok: false }
}
