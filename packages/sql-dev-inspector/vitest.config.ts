import { defineConfig } from "vitest/config"

// Own config: the root vitest config boots the Nuxt environment, which this tool does not need.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["test/**/*.test.ts"],
    environment: "node",
    // The tip about backend-dev-inspector would otherwise print in every test that starts the inspector.
    env: { SQL_INSPECTOR_NOTICE: "0" }
  }
})
