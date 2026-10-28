import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const root = join(import.meta.dirname, "..")
const read = (path: string) => readFileSync(join(root, path), "utf8")
const pkg = JSON.parse(read("package.json")) as Record<string, any>
const oldPkg = JSON.parse(readFileSync(join(root, "..", "sql-dev-inspector", "package.json"), "utf8")) as { version: string }

function sourceFiles(dir = join(root, "src")): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : []
  })
}
const files = sourceFiles().map(path => ({ name: relative(root, path), text: readFileSync(path, "utf8") }))

describe("what the package depends on", () => {
  it("has exactly one runtime dependency: sql-dev-inspector, which it builds on", () => {
    expect(Object.keys(pkg.dependencies)).toEqual(["sql-dev-inspector"])
    expect(pkg.optionalDependencies).toBeUndefined()
  })

  it("asks for a sql-dev-inspector the workspace can satisfy", () => {
    const [, major, minor] = /^\^(\d+)\.(\d+)\.\d+$/.exec(pkg.dependencies["sql-dev-inspector"])!.map(Number)
    const [oldMajor, oldMinor] = oldPkg.version.split(".").map(Number)
    expect(oldMajor).toBe(major)
    expect(oldMinor).toBeGreaterThanOrEqual(minor!)
  })

  it("makes every peer optional, so installing the package pulls no driver in", () => {
    expect(Object.keys(pkg.peerDependencies).sort()).toEqual(["better-sqlite3", "ioredis", "mongodb", "mysql2", "pg"])
    for (const name of Object.keys(pkg.peerDependencies)) {
      expect(pkg.peerDependenciesMeta[name]?.optional, name).toBe(true)
    }
  })

  it("runs no install scripts of its own", () => {
    expect(Object.keys(pkg.scripts).filter(name => ["preinstall", "install", "postinstall", "prepare"].includes(name))).toEqual([])
  })

  it("publishes only files that exist, with provenance", () => {
    for (const entry of pkg.files as string[]) {
      if (entry !== "dist") {
        expect(existsSync(join(root, entry)), entry).toBe(true)
      }
    }
    expect(pkg.publishConfig).toMatchObject({ provenance: true, access: "public" })
  })

  it("exports only entry points that have a source file", () => {
    for (const [name, target] of Object.entries(pkg.exports as Record<string, string | { import?: string }>)) {
      if (name === "./package.json") {
        continue
      }
      const file = (target as { import: string }).import.replace("./dist/", "src/").replace(/\.js$/, ".ts")
      expect(existsSync(join(root, file)), `${name} → ${file}`).toBe(true)
    }
  })
})

describe("what the package does", () => {
  it("does not read the process environment: that belongs to sql-dev-inspector's allow-list", () => {
    expect(files.filter(file => file.text.includes("process.env")).map(file => file.name)).toEqual([])
  })

  it("loads optional peers in one place, by literal name, and only the ones it declares", () => {
    const declared = Object.keys(pkg.peerDependencies as Record<string, string>)
    expect(files.filter(file => file.text.includes("createRequire")).map(file => file.name)).toEqual(["src/peer.ts"])
    let total = 0
    let literal = 0
    for (const file of files.filter(f => f.name !== "src/peer.ts")) {
      total += [...file.text.matchAll(/\btryLoad\(/g)].length
      for (const match of file.text.matchAll(/\btryLoad\(r => r\("([^"]+)"\)/g)) {
        literal++
        expect(declared, `${file.name} loads ${match[1]}, which is not a declared peer dependency`).toContain(match[1])
      }
    }
    expect(total).toBeGreaterThan(0)
    expect(literal, "every tryLoad call must have the form tryLoad(r => r(\"literal\"))").toBe(total)
  })

  it("compiles no code from strings, starts no processes, makes no calls of its own", () => {
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
      /\bfetch\s*\(/,
      /\bhttps?\.(?:request|get)\s*\(/,
      /^import (?!type\b)[^\n]*from "node:https?"/m,
      /\brequire\s*\(/
    ]
    for (const file of files) {
      for (const pattern of forbidden) {
        expect(file.text, `${file.name} must not match ${pattern}`).not.toMatch(pattern)
      }
    }
  })

  it("touches the file system only to find its own sibling modules (the Nuxt module)", () => {
    expect(files.filter(file => /node:fs/.test(file.text)).map(file => file.name)).toEqual(["src/nuxt.ts"])
  })

  it("never writes a value a request carries into a log: no console output of its own", () => {
    expect(files.filter(file => /\bconsole\./.test(file.text)).map(file => file.name)).toEqual([])
  })
})
