# Contributing

Thank you for helping. This repository holds two npm packages, `sql-dev-inspector` (the core) and `backend-dev-inspector` (drivers and framework adapters on top of it), and a playground of demo apps.

## Set up

```bash
npm install                 # needs Node.js 22 or newer
npm run build               # the core first, then the other package
npm run typecheck
npm test
```

`better-sqlite3` is a native module: run `npm rebuild better-sqlite3` if you installed with `--ignore-scripts`, or its tests are skipped. The tests need no database and open no port: they drive the real client libraries against in-memory protocol servers.

To try a change in an app, use the [playground](playground): `npm run playground:install`, then `npm run dev:nuxt3-drizzle --prefix playground`.

## Making a change

- **Start with an issue** for anything bigger than a fix, so we agree on the shape first.
- **Tests come with the change.** A new driver follows the pattern in `packages/backend-dev-inspector/test/`: the real library against a mock server. A new setting needs a test of the API and of the page.
- **Texts are translated.** User-visible text lives in `packages/sql-dev-inspector/src/i18n/messages.ts` in English, Vietnamese and Japanese; a test fails if a key or a `{placeholder}` is missing in one.
- **Keep the supply chain small.** A test fails if `src/` uses `eval`, `new Function`, `new RegExp(string)`, child processes, network calls of its own, writes to disk, or reads the environment outside `src/env.ts`. A driver for a library takes it as an object you hand over (`instrumentAws(client)`) or finds it through the application's own folder; it is never a dependency of this package.
- **Process-wide state is shared.** State that every copy of a package must see (the request scope, the recorder of a wrapper, the muting of the console) lives under a `Symbol.for(...)` key on `globalThis`, not in a module variable.
- **Privacy first.** Anything that records a value (parameters, bodies, logs) must go through the redaction setting, and a feature that could expose more than before is off by default.
- Update the package's `CHANGELOG.md` for every user-visible change, and the README tables if support changes.

## Screenshots and recordings

The images in [`docs/media`](docs/media) must match the current version. Take them from the playground's Nuxt app, with the inspector **as a panel inside the app** (a debug bar, opened with the floating button or `Alt`+`Shift`+`S`), in the same tab as the app: not the inspector page full screen in a new tab, and not a mock-up. Use a 1280×960 viewport (the files are 800×600). The terminal pictures are generated from real output: `node playground/scripts/capture-terminal.mts`. The two GIFs are a handful of such screenshots played one after another (about two seconds each); re-take every frame of a GIF when the page changes.

## Commits and releases

Commits follow [Conventional Commits](https://www.conventionalcommits.org) (`feat(core): …`, `fix(sqlite): …`, `docs: …`). Releases are tagged `<package>@<version>` and published from GitHub Actions with provenance; publish `sql-dev-inspector` before `backend-dev-inspector`.

## Reporting a vulnerability

Do not open a public issue: see [SECURITY.md](SECURITY.md).

## CI

`ci.yml` runs the tests on Node 22 and 24 on Linux and macOS, the audit, the playground (with an integration test of the inspector's whole API), the VS Code extension's tests, and a `libraries` job that runs the backend tests with the watched libraries at the oldest version their peer range allows and at the newest published one (advisory until it has passed once). None of this has been run by the author on a runner yet: read the first run before trusting it.
