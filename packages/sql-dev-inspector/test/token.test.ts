import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it } from "vitest"
import { checkToken, isTokenRejected, parseToken, rejectReason, TOKEN_COOKIE } from "../src/guard"
import { handleInspectorRequest } from "../src/inspector-server"
import { getInspector } from "../src/runtime"

describe("parsing the token", () => {
  it("takes a secret of 8 or more characters, makes one for auto, and ignores the rest", () => {
    expect(parseToken("correct-horse")).toBe("correct-horse")
    expect(parseToken(undefined)).toBeNull()
    expect(parseToken("  ")).toBeNull()
    expect(parseToken("auto")).toMatch(/^[\w-]{20,}$/)
    expect(parseToken("auto")).not.toBe(parseToken("auto"))
  })
})

describe("a token that is set but unusable", () => {
  it("locks the inspector behind a token nobody knows instead of leaving it open", () => {
    expect(isTokenRejected("secret")).toBe(true)
    expect(isTokenRejected("long-enough")).toBe(false)
    expect(isTokenRejected("auto")).toBe(false)
    expect(isTokenRejected(undefined)).toBe(false)
    const locked = parseToken("secret")!
    expect(locked).not.toBe("secret")
    expect(checkToken({ headers: { authorization: "Bearer secret" }, url: "/x", method: "GET" }, locked, "m")).toEqual({ ok: false })
  })
})

describe("checking a request", () => {
  const T = "secret-token-1"
  const req = (headers: Record<string, string>, url = "/__sql-inspector/api/requests", method = "GET") => ({ headers, url, method })

  it("accepts the bearer header and the cookie, and nothing else", () => {
    expect(checkToken(req({ authorization: `Bearer ${T}` }), T, "__sql-inspector")).toEqual({ ok: true })
    expect(checkToken(req({ cookie: `a=b; ${TOKEN_COOKIE}=${T}` }), T, "__sql-inspector")).toEqual({ ok: true })
    for (const headers of [{} as Record<string, string>, { authorization: "Bearer nope" }, { authorization: T }, { cookie: `${TOKEN_COOKIE}=nope` }, { authorization: `Bearer ${T}x` }]) {
      expect(checkToken(req(headers), T, "__sql-inspector"), JSON.stringify(headers)).toEqual({ ok: false })
    }
  })

  it("takes ?token= once on a GET, sets a strict HttpOnly cookie scoped to the page, and redirects without it", () => {
    const check = checkToken(req({}, `/__sql-inspector/?token=${T}&x=1`), T, "__sql-inspector")
    expect(check).toEqual({ ok: true, setCookie: `${TOKEN_COOKIE}=${T}; Path=/__sql-inspector; HttpOnly; SameSite=Strict`, redirect: "/__sql-inspector/?x=1" })
    expect(checkToken(req({}, `/__sql-inspector/api/clear?token=${T}`, "POST"), T, "__sql-inspector")).toEqual({ ok: false })
  })

  it("redirects only to a path on this server, whatever the address looks like", () => {
    for (const url of [`//evil.example/?token=${T}`, `///evil.example/a?token=${T}`, `/\\evil.example/?token=${T}`]) {
      const check = checkToken(req({}, url), T, "m") as { redirect: string }
      expect(check.redirect, url).toMatch(/^\/[^/\\]/)
      expect(check.redirect).not.toContain("token")
    }
    expect((checkToken(req({}, `/__sql-inspector/?a=1&token=${T}&b=2`), T, "m") as { redirect: string }).redirect).toBe("/__sql-inspector/?a=1&b=2")
    // the other parameters keep their spelling: %20 stays %20, + stays +
    expect((checkToken(req({}, `/__sql-inspector/?q=a%20b+c&token=${T}`), T, "m") as { redirect: string }).redirect).toBe("/__sql-inspector/?q=a%20b+c")
  })

  it("lets a non-local Host through only when a token is set", () => {
    expect(rejectReason({ headers: { host: "myapp.example" }, method: "GET" }, [])).toMatch(/not allowed/)
    expect(rejectReason({ headers: { host: "myapp.example" }, method: "GET" }, [], true)).toBeNull()
    expect(rejectReason({ headers: { host: "x.example", origin: "https://evil.example" }, method: "POST" }, [], true)).toMatch(/Cross-origin/)
  })
})

describe("the inspector with a token", () => {
  const inspector = getInspector()
  const T = "secret-token-2"
  afterEach(() => { inspector.token = null })

  function call(headers: Record<string, string>, url: string, subPath: string) {
    const r = Object.assign(new EventEmitter(), { url, method: "GET", headers: { host: "localhost", ...headers } })
    const out = { status: 200, headers: {} as Record<string, string>, body: "" }
    const res = { writeHead(code: number, h: Record<string, string> = {}) { out.status = code; out.headers = h; return this }, write: (c: string) => (out.body += c), end: (c?: string) => { out.body += c ?? "" } }
    handleInspectorRequest(r as never, res as never, subPath, inspector)
    return out
  }

  it("answers 401 without it, serves with it, and redirects a first visit that carries it in the address", () => {
    inspector.token = T
    expect(call({}, "/__sql-inspector/api/requests", "/api/requests").status).toBe(401)
    expect(call({ authorization: `Bearer ${T}` }, "/__sql-inspector/api/requests", "/api/requests").status).toBe(200)
    const first = call({}, `/__sql-inspector/?token=${T}`, "/")
    expect(first.status).toBe(302)
    expect(first.headers["set-cookie"]).toContain("HttpOnly")
    expect(first.headers.location).toBe("/__sql-inspector/")
  })

  it("does not ask for one when none is set", () => {
    inspector.token = null
    expect(call({}, "/__sql-inspector/api/requests", "/api/requests").status).toBe(200)
  })
})
