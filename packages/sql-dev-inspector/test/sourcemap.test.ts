import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { callerFromStack } from "../src/caller"
import { originalPosition, resetSourceMapCache } from "../src/sourcemap"

const dir = mkdtempSync(join(tmpdir(), "sourcemap-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
beforeEach(() => resetSourceMapCache())

/**
 * A bundle of 5 lines whose map says: line 3, column 3 is `server/api/orders.get.ts` line 11, column 5;
 * line 4, column 1 is a file in node_modules (the bundler inlined a library). Mappings were encoded by hand.
 */
const MAPPINGS = ";;EAUI;ACPJ"
const map = (sources = ["../server/api/orders.get.ts", "../node_modules/lib/index.js"]) => JSON.stringify({ version: 3, file: "index.mjs", sources, names: [], mappings: MAPPINGS })

function bundle(name: string, comment: string, mapFile?: string, content = map()) {
  mkdirSync(join(dir, name), { recursive: true })
  writeFileSync(join(dir, name, "index.mjs"), `// bundle\nconst a = 1\nfoo(a)\nbar()\n${comment}\n`)
  if (mapFile) {
    writeFileSync(join(dir, name, mapFile), content)
  }
  return join(dir, name, "index.mjs")
}

describe("the original position of a bundled one", () => {
  it("reads the map the bundle points at, next to it", () => {
    const file = bundle("next-to", "//# sourceMappingURL=index.mjs.map", "index.mjs.map")
    expect(originalPosition(file, 3, 3)).toEqual({ file: join(dir, "server/api/orders.get.ts"), line: 11, column: 5 })
  })

  it("reads an inline map", () => {
    const file = bundle("inline", `//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(map()).toString("base64")}`)
    expect(originalPosition(file, 3, 3)?.file).toBe(join(dir, "server/api/orders.get.ts"))
  })

  it("uses the map beside the bundle when it has no comment", () => {
    const file = bundle("no-comment", "", "index.mjs.map")
    expect(originalPosition(file, 3, 3)?.line).toBe(11)
  })

  it("is null for a bundle without a map, a position the map does not cover, a file that is not a bundle and a library", () => {
    expect(originalPosition(bundle("none", ""), 3, 3)).toBeNull()
    expect(originalPosition(bundle("elsewhere", "//# sourceMappingURL=index.mjs.map", "index.mjs.map"), 1, 1)).toBeNull()
    expect(originalPosition(join(dir, "x.ts"), 1, 1)).toBeNull()
    expect(originalPosition("/p/node_modules/lib/index.js", 1, 1)).toBeNull()
  })

  it("does not follow a pointer out of the bundle's folder, nor to another scheme", () => {
    writeFileSync(join(dir, "outside.map"), map())
    expect(originalPosition(bundle("escape", "//# sourceMappingURL=../outside.map"), 3, 3)).toBeNull()
    expect(originalPosition(bundle("remote", "//# sourceMappingURL=https://example.test/x.map"), 3, 3)).toBeNull()
  })

  it("survives a map that is not JSON, and virtual sources", () => {
    expect(originalPosition(bundle("broken", "//# sourceMappingURL=index.mjs.map", "index.mjs.map", "not json"), 3, 3)).toBeNull()
    const virtual = bundle("virtual", "//# sourceMappingURL=index.mjs.map", "index.mjs.map", map(["\0virtual:x", "x"]))
    expect(originalPosition(virtual, 3, 3)).toBeNull()
  })
})

describe("the caller of a stack that goes through a bundle", () => {
  const stack = (file: string, line: number, column: number) => `Error\n    at inspector (/p/node_modules/sql-dev-inspector/src/x.js:1:1)\n    at handler (${file}:${line}:${column})\n    at next (node:internal/x:1:1)`

  it("is the file you wrote, not the bundle", () => {
    const file = bundle("caller", "//# sourceMappingURL=index.mjs.map", "index.mjs.map")
    expect(callerFromStack(stack(file, 3, 3))).toEqual({ file: join(dir, "server/api/orders.get.ts"), line: 11, column: 5, fn: "handler" })
  })

  it("skips a frame that was a library inside the bundle and takes the next application frame", () => {
    const file = bundle("library", "//# sourceMappingURL=index.mjs.map", "index.mjs.map")
    const text = `Error\n    at lib (${file}:4:1)\n    at route (/app/server/api/real.ts:7:3)`
    expect(callerFromStack(text)).toMatchObject({ file: "/app/server/api/real.ts", line: 7 })
  })

  it("keeps the bundled position when there is no map", () => {
    const file = bundle("unmapped", "")
    expect(callerFromStack(stack(file, 3, 3))).toMatchObject({ file, line: 3, column: 3 })
  })
})
