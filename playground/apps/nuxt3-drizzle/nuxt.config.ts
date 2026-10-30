// The inspector module registers itself in `nuxt dev` only: nothing is added to `nuxt build`.
export default defineNuxtConfig({
  // The Antimatter front end, shared by the Nuxt apps.
  extends: ["../../layers/antimatter-ui"],
  compatibilityDate: "2026-01-01",
  modules: ["backend-dev-inspector/nuxt"],
  // The inspector's own settings: hide bind parameters (the default), and leave these routes out of the list.
  sqlInspector: { redact: "params", exclude: ["/api/health", "/api/scenarios"] },
  runtimeConfig: {
    public: { playgroundFramework: "Nuxt 3", playgroundData: "Drizzle ORM" }
  },
  nitro: {
    // The shared package is TypeScript source: bundle it instead of loading it from node_modules.
    externals: { inline: ["@playground/shared"] }
  }
})
