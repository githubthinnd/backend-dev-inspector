# Security policy

This repository publishes two development-time tools, `sql-dev-inspector` and `backend-dev-inspector`. Neither makes network calls of its own, and both do nothing when `NODE_ENV=production`. `sql-dev-inspector` has no runtime dependencies (it patches the `mysql2` your app already has); `backend-dev-inspector` has one, `sql-dev-inspector`, and patches or subscribes to the libraries your app already has (`pg`, `better-sqlite3`, `mongodb`, `ioredis`, `redis`, Node's HTTP clients…), or wraps the objects you hand it (`instrumentAws(client)`…).

## What the tools do with data

- **Recorded values.** Bind parameters are kept as their type and size by default; a stricter mode masks whole statements, and "show all" is a choice. A request keeps the mode it was recorded under.
- **Where it lives.** In the memory of the development process. The tools write nothing to disk by themselves: a history file, a Markdown / JSON / OpenTelemetry export and the MCP answers are produced when you or an agent ask, and carry what was recorded, as hidden as it was recorded.
- **Who can read it.** The inspector page, its API and MCP answer only to local `Host` names, and refuse cross-site POSTs. With `SQL_INSPECTOR_TOKEN` set they answer only to a request that carries the token (a bearer header, or a cookie that is `HttpOnly` and `SameSite=Strict`), and then accept other host names so a container or a tunnel can be used. A token that is too short locks the inspector instead of being ignored.
- **Reading source maps.** To show the file you wrote instead of a dev server's bundle, the tools read the `.map` file the bundle points at: read-only, in the bundle's own folder, at most 64 MB.

## Supported versions

Only the latest release of each package receives fixes.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private reporting:
<https://github.com/githubthinnd/backend-dev-inspector/security/advisories/new>

Include the version, how to reproduce it, and what an attacker could read or change. You can expect a first answer within a few days.

## What is in scope

- Anything that lets a web page or another machine read the recorded SQL, or change the inspector's state, without the developer's action (the inspector refuses non-local `Host` headers and cross-site POSTs, and with a token set refuses every request that does not carry it).
- A way around the token, the redaction setting or the limits on what a history file or a source map may make the tools read.
- Anything that makes the package do something in production.
- Problems with how the package is built and published (provenance, release workflow).

## Verifying a download

Releases are published from GitHub Actions with npm provenance. After installing:

```bash
npm audit signatures
```
