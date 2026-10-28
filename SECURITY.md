# Security policy

This repository publishes two development-time tools, `sql-dev-inspector` and `backend-dev-inspector`. Neither makes network calls of its own, and both do nothing when `NODE_ENV=production`. `sql-dev-inspector` has no runtime dependencies (it patches the `mysql2` your app already has); `backend-dev-inspector` has one, `sql-dev-inspector`, and patches or subscribes to the libraries your app already has (`pg`, `better-sqlite3`, `mongodb`, `ioredis`, `redis`, Node's HTTP clients…).

## Supported versions

Only the latest release of each package receives fixes.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private reporting:
<https://github.com/githubthinnd/backend-dev-inspector/security/advisories/new>

Include the version, how to reproduce it, and what an attacker could read or change. You can expect a first answer within a few days.

## What is in scope

- Anything that lets a web page or another machine read the recorded SQL, or change the inspector's state, without the developer's action (the inspector refuses non-local `Host` headers and cross-site POSTs for this reason).
- Anything that makes the package do something in production.
- Problems with how the package is built and published (provenance, release workflow).

## Verifying a download

Releases are published from GitHub Actions with npm provenance. After installing:

```bash
npm audit signatures
```
