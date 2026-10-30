import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    env: {
      SQL_INSPECTOR: "1",
      SQL_INSPECTOR_LOG: "0",
      SQL_INSPECTOR_NOTICE: "0"
    }
  }
})
