// The inspector module registers itself in `nuxt dev` only: nothing is added to `nuxt build`.
export default defineNuxtConfig({
  compatibilityDate: "2026-01-01",
  modules: ["backend-dev-inspector/nuxt"],
  nitro: {
    // The shared package is TypeScript source: bundle it instead of loading it from node_modules.
    externals: { inline: ["@playground/shared"] }
  }
})
