import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"
import { ENV_KEYS, pickEnv } from "../src/env"

const root = join(import.meta.dirname, "..")
const read = (path: string) => readFileSync(join(root, path), "utf8")
const pkg = JSON.parse(read("package.json")) as Record<string, Record<string, string> | string[] | undefined>

function sourceFiles(dir = join(root, "src")): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : []
  })
}

describe("what the package depends on", () => {
  it("has no runtime dependencies: only the mysql2 the application already has, as a peer", () => {
    expect(pkg.dependencies).toBeUndefined()
    expect(pkg.optionalDependencies).toBeUndefined()
    expect(Object.keys(pkg.peerDependencies ?? {})).toEqual(["mysql2"])
  })

  it("runs no install scripts of its own, which every consumer would execute", () => {
    const scripts = Object.keys(pkg.scripts ?? {})
    expect(scripts.filter(name => ["preinstall", "install", "postinstall"].includes(name))).toEqual([])
  })

  it("publishes only files that exist in the repository", () => {
    for (const entry of pkg.files as string[]) {
      if (entry !== "dist") {
        expect(existsSync(join(root, entry)), entry).toBe(true)
      }
    }
  })

  it("asks npm for provenance, so a publish outside a trusted CI fails instead of going out unsigned", () => {
    expect(pkg.publishConfig).toMatchObject({ provenance: true })
  })
})

describe("what the package does", () => {
  const files = sourceFiles().map(path => ({ name: relative(root, path), text: readFileSync(path, "utf8") }))

  it("reads the process environment in one place, through an allow-list", () => {
    const readers = files.filter(file => file.text.includes("process.env")).map(file => file.name)
    expect(readers).toEqual(["src/env.ts"])
  })

  it("never sees variables beyond its own", () => {
    const picked = pickEnv({ NODE_ENV: "development", SQL_INSPECTOR_SLOW_MS: "50", DATABASE_URL: "mysql://root:secret@db", AWS_SECRET_ACCESS_KEY: "x", NPM_TOKEN: "y" })
    expect(picked).toEqual({ NODE_ENV: "development", SQL_INSPECTOR_SLOW_MS: "50" })
    expect(ENV_KEYS.every(key => key === "NODE_ENV" || key === "NO_COLOR" || key.startsWith("SQL_INSPECTOR"))).toBe(true)
  })

  it("compiles no code from strings, starts no processes and opens no outbound connections", () => {
    const forbidden = [
      /\beval\s*\(/,
      /\bnew\s+Function\b/,
      /\bFunction\s*\(/,
      /new\s+RegExp\s*\(/,
      /node:child_process/,
      /node:vm\b/,
      /node:inspector/,
      /node:net\b/,
      /node:dns/,
      /^import (?!type\b)[^\n]*from "node:https?"/m, // `import type` from node:http is erased at build time
      /\bhttps?\.(?:request|get)\s*\(/,
      /\brequire\s*\(/
    ]
    for (const file of files) {
      for (const pattern of forbidden) {
        expect(file.text, `${file.name} must not match ${pattern}`).not.toMatch(pattern)
      }
    }
  })

  it("touches the file system only to read a bundle's source map, and never writes", () => {
    expect(files.filter(file => /from "node:fs"/.test(file.text)).map(file => file.name).sort()).toEqual(["src/nuxt.ts", "src/sourcemap.ts"])
    for (const file of files) {
      expect(file.text, file.name).not.toMatch(/\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|unlink|unlinkSync|rm|rmSync|rename|renameSync|mkdir|mkdirSync|copyFile|copyFileSync)\b/)
    }
  })

  it("loads optional peers in one place, by literal name, and only the ones the package declares", () => {
    const declared = Object.keys((pkg.peerDependencies ?? {}) as Record<string, string>)
    expect(files.filter(file => file.text.includes("createRequire")).map(file => file.name)).toEqual(["src/peer.ts"])

    let total = 0
    let literal = 0
    for (const file of files.filter(f => f.name !== "src/peer.ts")) {
      total += [...file.text.matchAll(/\btryLoad\(/g)].length
      for (const match of file.text.matchAll(/\btryLoad\((\w+) => \1\("([^"]+)"\)/g)) {
        literal++
        expect(declared, `${file.name} loads ${match[2]}, which is not a declared peer dependency`).toContain(match[2])
      }
    }
    expect(total).toBeGreaterThan(0)
    expect(literal, "every tryLoad call must have the form tryLoad(r => r(\"literal\"))").toBe(total)
  })

  it("makes every peer optional, so installing the package pulls nothing in", () => {
    const meta = pkg.peerDependenciesMeta as unknown as Record<string, { optional?: boolean }>
    for (const name of Object.keys((pkg.peerDependencies ?? {}) as Record<string, string>)) {
      expect(meta[name]?.optional, name).toBe(true)
    }
  })

  it("calls fetch only from the code that runs in the browser", () => {
    const callers = files.filter(file => /\bfetch\s*\(/.test(file.text)).map(file => file.name).sort()
    expect(callers).toEqual(["src/client/widget.ts", "src/ui/client.ts"])
  })
})
