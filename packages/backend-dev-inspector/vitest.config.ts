import { defineConfig } from "vitest/config"

const oldSource = (path: string) => new URL(`../sql-dev-inspector/src/${path}`, import.meta.url).pathname

// Tests run against the sources of sql-dev-inspector, so they need no build of it first. A separate
// check packs both packages and installs them into a scratch project to test what is published.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^sql-dev-inspector$/, replacement: oldSource("index.ts") },
      { find: /^sql-dev-inspector\/nuxt$/, replacement: oldSource("nuxt.ts") },
      { find: /^sql-dev-inspector\/nitro$/, replacement: oldSource("nitro-plugin.ts") },
      { find: /^sql-dev-inspector\/client$/, replacement: oldSource("client/widget.ts") }
    ]
  },
  test: {
    root: import.meta.dirname,
    include: ["test/**/*.test.ts"],
    environment: "node",
    env: { SQL_INSPECTOR_NOTICE: "0", SQL_INSPECTOR_LOG: "0" }
  }
})
